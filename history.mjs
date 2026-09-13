import { randomUUID } from 'node:crypto';

const activeStates = new Set(['printing', 'heating', 'pause', 'paused', 'pausing']);
const idleStates = new Set(['ready', 'completed']);
const iso = now => new Date(now).toISOString();
export function createHistory() { return { version: 1, runs: [] }; }
function note(run, message) { if (!run.notes.includes(message)) run.notes.push(message); }

// Previous samples are intentionally not restored across restarts: continuity is unknown.
export function observeHistory(history, printerId, previous, sample, now = Date.now()) {
  const snapshot = { at: now, connected: sample.connected, state: sample.rawState, job: sample.job || '', progress: sample.progress, layer: sample.layer };
  const continuous = previous?.connected && sample.connected && now > previous.at && now - previous.at <= 15000;
  let run = history.runs.findLast(r => r.printerId === printerId && r.status === 'active');
  if (run && !continuous) { run.hasGap = true; note(run, 'Monitoring was interrupted.'); }
  if (!sample.connected) return snapshot;
  const active = activeStates.has(sample.rawState);
  const changedJob = run && sample.job && run.job !== sample.job;
  const reset = run && active && previous?.state === 'printing' && Number.isFinite(previous.layer) && Number.isFinite(sample.layer) && previous.layer > sample.layer + 1 && Number.isFinite(previous.progress) && Number.isFinite(sample.progress) && previous.progress > sample.progress + 5;
  if (run && (changedJob || reset)) {
    run.status = 'unknown'; run.endedAt = run.lastSeenAt;
    note(run, 'Another print was detected; the previous outcome was not observed.');
    run = null;
  }
  if (!run && active && sample.job) {
    // A nearby idle reading bounds the start, unless progress already shows a late observation.
    const startObserved = Boolean(continuous && idleStates.has(previous.state) && (sample.layer == null || sample.layer <= 1) && (sample.progress == null || sample.progress <= 1));
    run = { id: randomUUID(), printerId, job: sample.job, createdAt: iso(now), firstSeenAt: iso(now), startedAt: startObserved ? iso(now) : null, lastSeenAt: iso(now), endedAt: null,
      status: 'active', origin: 'monitor', hasGap: false, notes: startObserved ? [] : ['First seen after the print may have started.'], estimate: null, actualOverrideSeconds: null, outcomeOverride: null };
    history.runs.push(run);
  }
  if (run) {
    if (active) { run.lastSeenAt = iso(now); run.lastState = sample.rawState; }
    else if (sample.rawState === 'completed') { run.status = 'completed'; run.endedAt = iso(now); run.lastSeenAt = iso(now); }
    else if (sample.rawState === 'ready') {
      run.status = 'unknown'; run.endedAt = iso(now); run.lastSeenAt = iso(now);
      note(run, 'Printer returned to idle; completion or cancellation needs confirmation.');
    }
    else if (['cancel', 'canceling'].includes(sample.rawState)) { run.status = 'cancelled'; run.endedAt = iso(now); run.lastSeenAt = iso(now); }
    else { run.hasGap = true; note(run, 'An unrecognized or error state interrupted timing.'); }
  }
  return snapshot;
}

function duration(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 86400 * 365) throw new Error(`Enter a valid ${label} (up to one year).`);
  return value;
}
export function setTiming(run, value, now = Date.now()) {
  const seconds = duration(value.estimateSeconds, 'estimate');
  const actual = duration(value.actualSeconds, 'actual duration');
  const outcome = value.outcome || null;
  if (![null, 'completed', 'cancelled', 'failed', 'unknown'].includes(outcome)) throw new Error('Invalid print outcome.');
  if (run.status === 'active' && (actual !== null || outcome !== null)) throw new Error('This print is still active. Its total duration can be recorded after it ends.');
  const source = value.estimateSource;
  if (source != null && (typeof source !== 'object' || typeof source.filename !== 'string' || source.filename.length > 255 || typeof source.generatedBy !== 'string' || source.generatedBy.length > 255)) throw new Error('Invalid estimate source.');
  run.estimate = seconds === null ? null : { seconds, source: source ? 'gcode' : 'manual', filename: source?.filename || null, generatedBy: source?.generatedBy || null, savedAt: iso(now) };
  run.actualOverrideSeconds = actual;
  run.outcomeOverride = outcome;
}
export function addManualRun(history, value, printerIds, now = Date.now()) {
  if (!printerIds.includes(value.printerId)) throw new Error('Choose a printer.');
  const job = typeof value.job === 'string' ? value.job.trim() : '';
  if (!job || job.length > 255) throw new Error('Enter a job name (up to 255 characters).');
  const date = Date.parse(value.printedAt);
  if (!Number.isFinite(date) || date > now + 60000) throw new Error('Enter a past print date and time.');
  const run = { id: randomUUID(), printerId: value.printerId, job, createdAt: iso(now), firstSeenAt: iso(date), startedAt: null, lastSeenAt: iso(date), endedAt: iso(date), status: 'unknown', origin: 'manual', hasGap: false, notes: ['Timing entered manually.'], estimate: null, actualOverrideSeconds: null, outcomeOverride: null };
  setTiming(run, value, now);
  if (!run.actualOverrideSeconds) throw new Error('Enter the actual duration for this past print.');
  history.runs.push(run);
  return run;
}
export function timingView(run) {
  const status = run.outcomeOverride || run.status;
  const actualSeconds = run.actualOverrideSeconds ?? (run.startedAt && run.endedAt && !run.hasGap ? Math.max(0, (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000) : null);
  const estimateSeconds = run.estimate?.seconds ?? null;
  const comparable = status === 'completed' && actualSeconds !== null && estimateSeconds !== null;
  return { ...run, effectiveStatus: status, actualSeconds, actualSource: run.actualOverrideSeconds !== null ? 'manual' : actualSeconds !== null ? 'observed' : null,
    observedSpanSeconds: Math.max(0, (Date.parse(run.lastSeenAt) - Date.parse(run.firstSeenAt)) / 1000),
    deltaSeconds: comparable ? actualSeconds - estimateSeconds : null,
    deltaPercent: comparable ? (actualSeconds / estimateSeconds - 1) * 100 : null };
}
