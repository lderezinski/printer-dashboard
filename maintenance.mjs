import { randomUUID } from 'node:crypto';

export function createRecord(now = Date.now()) {
  return { observedSeconds: 0, trackingSince: new Date(now).toISOString(), schedules: [], serviceHistory: [], baseline: null };
}

export function upgradeRecord(record) {
  if (!Array.isArray(record.schedules)) record.schedules = record.schedule ? [{ ...record.schedule, id: 'legacy' }] : [];
  delete record.schedule;
  return record;
}

export function accrue(record, previous, sample, now) {
  const elapsed = previous ? (now - previous.at) / 1000 : 0;
  // Never infer printing during downtime, sleep, a restart, or a disconnected interval.
  if (previous?.printing && sample.connected && sample.rawState === 'printing' && elapsed > 0 && elapsed <= 15) record.observedSeconds += elapsed;
  return { at: now, printing: sample.connected && sample.rawState === 'printing' };
}

export function setSchedule(record, value, now = Date.now()) {
  if (!value || typeof value !== 'object') throw new Error('Invalid reminder.');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 100) throw new Error('Enter a maintenance task name (up to 100 characters).');
  const interval = (value, label, max) => {
    if (value === '' || value === null || value === undefined) return null;
    const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > max) throw new Error(`Enter a valid ${label} interval.`);
    return n;
  };
  const hours = interval(value.hours, 'printing hours', 100000);
  const days = interval(value.days, 'days', 36500);
  if (!hours && !days) throw new Error('Set a printing-hours interval, a calendar interval, or both.');
  upgradeRecord(record);
  const id = value.id || randomUUID();
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error('Invalid reminder ID.');
  const old = record.schedules.find(s => s.id === id);
  if (!old && record.schedules.length >= 20) throw new Error('This printer already has 20 reminders.');
  const initialDueLifetimeHours = old?.initialDueLifetimeHours && hours ? (hours === old.hours ? old.initialDueLifetimeHours : (Math.floor(lifetimeHours(record) / hours) + 1) * hours) : null;
  const schedule = { id, name, hours, days, initialDueLifetimeHours, since: old?.since || new Date(now).toISOString(), baselineSeconds: old?.baselineSeconds ?? record.observedSeconds, lastServiced: old?.lastServiced || null };
  if (old) Object.assign(old, schedule); else record.schedules.push(schedule);
  return schedule;
}

export function markServiced(record, id, now = Date.now()) {
  upgradeRecord(record);
  const schedule = record.schedules.find(s => s.id === id);
  if (!schedule) throw new Error('Choose an existing maintenance task.');
  const date = new Date(now).toISOString();
  record.serviceHistory.push({ id, name: schedule.name, at: date, observedSeconds: record.observedSeconds });
  Object.assign(schedule, { initialDueLifetimeHours: null, since: date, baselineSeconds: record.observedSeconds, lastServiced: date });
}

export function maintenanceStatus(record, hoursAvailable, now = Date.now()) {
  upgradeRecord(record);
  const schedules = record.schedules.map(schedule => {
    const hoursUsed = Math.max(0, record.observedSeconds - schedule.baselineSeconds) / 3600;
    const dueAt = schedule.days ? new Date(Date.parse(schedule.since) + schedule.days * 86400000).toISOString() : null;
    const left = schedule.initialDueLifetimeHours != null && record.baseline ? schedule.initialDueLifetimeHours - lifetimeHours(record) : schedule.hours - hoursUsed;
    const hoursRemaining = schedule.hours && hoursAvailable ? Math.max(0, left) : null;
    return { ...schedule, hoursRemaining, dueAtLifetimeHours: schedule.hours && record.baseline ? lifetimeHours(record) + Math.max(0, left) : null,
      dueAt, due: Boolean((hoursAvailable && schedule.hours && left <= 0) || (dueAt && now >= Date.parse(dueAt))) };
  });
  return { baseline: record.baseline || null, lifetimeHours: lifetimeHours(record), observedHours: record.observedSeconds / 3600, trackingSince: record.trackingSince, hoursAvailable, schedules, due: schedules.some(s => s.due) };
}

export function lifetimeHours(record) {
  return record.baseline ? (record.baseline.printingSeconds + Math.max(0, record.observedSeconds - record.baseline.observedSecondsAtCapture)) / 3600 : null;
}

export function setBaseline(record, value, now = Date.now()) {
  const nonnegative = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (!value || !Number.isInteger(value.printingSeconds) || value.printingSeconds < 0 || value.printingSeconds > 3153600000 || !nonnegative(value.materialCm)) throw new Error('Enter valid baseline printing time and material usage.');
  if (!['machineName', 'firmwareVersion', 'serialNumber'].every(k => typeof value[k] === 'string' && value[k].trim() && value[k].length <= 128)) throw new Error('Baseline machine details are incomplete.');
  if (!Array.isArray(value.nozzleDiameters) || ![1, 4].includes(value.nozzleDiameters.length) || !value.nozzleDiameters.every(n => nonnegative(n) && n > 0 && n <= 10)) throw new Error('Invalid baseline nozzle sizes.');
  if (!Array.isArray(value.buildVolume) || value.buildVolume.length !== 3 || !value.buildVolume.every(n => nonnegative(n) && n > 0 && n <= 5000)) throw new Error('Invalid baseline build volume.');
  if (record.baseline) { record.baselineHistory ||= []; record.baselineHistory.push(record.baseline); }
  record.baseline = { printingSeconds: value.printingSeconds, materialCm: value.materialCm, machineName: value.machineName, firmwareVersion: value.firmwareVersion, serialNumber: value.serialNumber,
    nozzleDiameters: [...value.nozzleDiameters], buildVolume: [...value.buildVolume], recordedAt: new Date(now).toISOString(), observedSecondsAtCapture: record.observedSeconds, source: 'User-provided printer information screenshot' };
}

export function alignInitialReminders(record, mode) {
  if (!record.baseline || !['milestones', 'from-baseline'].includes(mode)) throw new Error('Choose a baseline maintenance starting point.');
  upgradeRecord(record);
  for (const schedule of record.schedules) {
    if (schedule.lastServiced) continue;
    schedule.initialDueLifetimeHours = mode === 'milestones' && schedule.hours ? (Math.floor(lifetimeHours(record) / schedule.hours) + 1) * schedule.hours : null;
    schedule.baselineSeconds = record.baseline.observedSecondsAtCapture;
    schedule.since = record.baseline.recordedAt;
  }
  record.baseline.maintenanceAlignment = mode;
}
