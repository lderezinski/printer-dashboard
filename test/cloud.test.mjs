import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CloudMonitor, parseCloudMessage, validateBootstrap, CLOUD_FRESH_MS } from '../cloud.mjs';
import { createRecord, setSchedule, markServiced, maintenanceStatus, upgradeRecord, setBaseline, alignInitialReminders, lifetimeHours } from '../maintenance.mjs';

const devices = [{ model: 'Creator 5 Pro', sn: 'fixture-serial', deviceID: 'fixture-device', gTopic: 'fixture/printer' }];
const settings = { c5p: { host: '192.168.50.10154' } };
const data = { sn: 'fixture-serial', deviceID: 'fixture-device', pid: '0029', ipAddress: '192.168.50.10154', status: 'printing', fileName: 'drawer.3mf', progress: .521,
  printLayer: 57, targetLayer: 287, duration: 26719, estimateTime: 24298, nozzleTemps: [29, 29, 130, 220], nozzleTargetTemps: [0, 0, 130, 220], platformCurTemperature: 54, platformTargetTemperature: 55,
  chamberTemp: 30, chamberTargetTemp: 0, door: 'close', authToken: 'must-not-escape', stream: 'must-not-escape', firmwareVersion: '1.9.9-1.3.0' };
const message = overrides => Buffer.from(JSON.stringify({ eventType: 'device_action', payload: { action_type: 'device_status', data: { ...data, ...overrides } } }));
const boot = () => ({ clientId: 'fixture-client', server: 'mqtt.voxelshare.com', username: 'fixture-user', password: 'fixture-password', userTopic: 'fixture/user', devices });

test('live Creator reports map remaining time, progress and tool temperatures; secrets are removed', () => {
  const report = parseCloudMessage(message(), devices, settings, 1000);
  assert.equal(report.printerId, 'c5p');
  assert.equal(report.sample.remaining, 24298); assert.equal(report.sample.progress, 52.1); assert.equal(report.sample.elapsed, 26719);
  assert.deepEqual(report.sample.nozzles[3], { current: 220, target: 220 });
  assert.deepEqual(report.sample.chamber, { current: 30, target: 0 }); assert.equal(report.sample.door, 'Closed');
  assert.equal(report.sample.lastSeen, '1970-01-01T00:00:01.000Z');
  assert.ok(!JSON.stringify(report).includes('must-not-escape')); assert.ok(!JSON.stringify(report).includes('fixture-serial'));
});
test('cloud identity checks reject unknown devices, wrong address/model and ambiguous matches', () => {
  for (const change of [{ sn: 'other' }, { deviceID: 'other' }, { ipAddress: '192.168.50.10152' }, { pid: '0028' }, { status: null }]) assert.equal(parseCloudMessage(message(change), devices, settings), null);
  assert.equal(parseCloudMessage(message(), [...devices, { ...devices[0], sn: 'other' }], settings), null);
});
test('cached REST details, commands, malformed or oversized messages cannot become live status', () => {
  for (const value of ['{', JSON.stringify({ detail: data }), JSON.stringify({ cmd: 'deviceUpdateDetail_cmd', args: {} }), ' '.repeat(262145)]) assert.equal(parseCloudMessage(value, devices, settings), null);
  assert.equal(parseCloudMessage(message({ status: 'pause' }), devices, settings).sample.remaining, null);
  assert.equal(parseCloudMessage(message({ estimateTime: null }), devices, settings).sample.remaining, null);
});
test('bootstrap validates broker and topic scope before sending credentials', () => {
  assert.equal(validateBootstrap(boot()).server, 'mqtt.voxelshare.com');
  for (const bad of [{ server: 'mqtt://example.com' }, { userTopic: '#' }, { password: '' }, { devices: [{ ...devices[0], gTopic: 'printers/+' }] }]) assert.throws(() => validateBootstrap({ ...boot(), ...bad }));
});
test('monitor subscribes without publishing, ignores retained messages and clears readings on disconnect', async () => {
  const fake = new EventEmitter(); let subscriptions; let stopped = false;
  fake.subscribe = (topics, options, done) => { subscriptions = topics; done(null, topics.map(topic => ({ topic, qos: 0 }))); };
  fake.end = () => { stopped = true; };
  fake.publish = () => { throw new Error('Status monitor must never publish.'); };
  const monitor = new CloudMonitor(() => settings, { load: async () => boot(), dial: () => fake });
  try {
    monitor.start(); await new Promise(resolve => setImmediate(resolve));
    fake.emit('connect'); assert.deepEqual(subscriptions, ['fixture/user', 'fixture/printer']);
    fake.emit('message', 'fixture/printer', message(), { retain: true }); assert.equal(monitor.get('c5p'), null);
    fake.emit('message', 'fixture/printer', message(), { retain: false });
    const sample = monitor.get('c5p'); assert.equal(sample.remaining, 24298);
    assert.equal(monitor.get('c5p', Date.parse(sample.lastSeen) + CLOUD_FRESH_MS + 1), null);
    fake.emit('close'); assert.equal(monitor.get('c5p'), null); assert.equal(monitor.status.connected, false); assert.equal(stopped, true);
  } finally { monitor.stop(); }
});
test('100-hour nozzle and 200-hour lubrication reminders advance and reset independently', () => {
  const record = createRecord(0);
  const nozzle = setSchedule(record, { id: 'nozzle-bend', name: 'Check for nozzle bend', hours: 100 }, 0);
  const lube = setSchedule(record, { id: 'lubrication', name: 'Lubrication', hours: 200 }, 0);
  record.observedSeconds = 100 * 3600;
  let status = maintenanceStatus(record, true, 1000);
  assert.equal(status.schedules[0].due, true); assert.equal(status.schedules[1].due, false); assert.equal(status.schedules[1].hoursRemaining, 100);
  markServiced(record, nozzle.id, 1000);
  status = maintenanceStatus(record, true, 1000);
  assert.equal(status.schedules[0].hoursRemaining, 100); assert.equal(status.schedules[1].hoursRemaining, 100);
  assert.equal(lube.baselineSeconds, 0); assert.equal(record.serviceHistory[0].id, nozzle.id);
  record.observedSeconds = 200 * 3600;
  assert.ok(maintenanceStatus(record, true, 2000).schedules.every(task => task.due));
  setSchedule(record, { id: lube.id, name: 'Lubrication', hours: 250 }, 3000);
  assert.equal(lube.baselineSeconds, 0); assert.equal(maintenanceStatus(record, true, 3000).schedules[1].hoursRemaining, 50);
});
test('legacy maintenance data migrates without losing baseline, service date or history', () => {
  const record = { observedSeconds: 1000, trackingSince: '1970-01-01T00:00:00.000Z', schedule: { name: 'Existing task', hours: 100, days: 30, since: '1970-01-01T00:00:00.000Z', baselineSeconds: 500, lastServiced: null }, serviceHistory: [] };
  upgradeRecord(record); assert.equal(record.schedules[0].id, 'legacy'); assert.equal(record.schedules[0].baselineSeconds, 500); assert.equal('schedule' in record, false);
  assert.throws(() => markServiced(record, 'missing'));
});

const baseline = (printingSeconds) => ({printingSeconds, materialCm:543668, machineName:'Creator 5', firmwareVersion:'1.9.9-1.3.0', serialNumber:'fixture-serial', nozzleDiameters:[.4,.4,.4,.4], buildVolume:[256,256,256]});
test('screenshot baseline adds only subsequently observed time and aligns next milestones', () => {
  const cases = [[128*3600, 200, 200], [1898*3600, 200, 2000], [657*3600+26*60, 100, 700], [657*3600+26*60, 200, 800], [377*3600+41*60, 100, 400], [377*3600+41*60, 200, 400]];
  for (const [seconds, interval, due] of cases) {
    const record=createRecord(0); record.observedSeconds=1800;
    setSchedule(record,{id:'task',name:'Task',hours:interval},0);
    setBaseline(record,baseline(seconds),1000); alignInitialReminders(record,'milestones');
    const task=maintenanceStatus(record,true,1000).schedules[0];
    assert.equal(task.initialDueLifetimeHours,due); assert.ok(Math.abs(task.hoursRemaining-(due-seconds/3600))<1e-8);
    assert.equal(lifetimeHours(record),seconds/3600); assert.equal(record.serviceHistory.length,0);
    record.observedSeconds+=3600; assert.equal(lifetimeHours(record),seconds/3600+1);
    markServiced(record,'task',2000);
    const serviced=maintenanceStatus(record,true,2000).schedules[0];
    assert.equal(serviced.initialDueLifetimeHours,null); assert.equal(serviced.hoursRemaining,interval);
  }
});
test('baseline changes preserve service records and observed counters; initial targets become due', () => {
  const record=createRecord(0); setSchedule(record,{id:'nozzle',name:'Nozzle',hours:100},0);
  setBaseline(record,baseline(377*3600+41*60),1000); alignInitialReminders(record,'milestones');
  record.observedSeconds=22*3600+19*60;
  assert.equal(lifetimeHours(record),400); assert.equal(maintenanceStatus(record,true,2000).due,true);
  assert.throws(()=>setBaseline(record,baseline(-1))); assert.equal(record.baseline.printingSeconds,377*3600+41*60);
  setBaseline(record,baseline(400*3600),3000); assert.equal(lifetimeHours(record),400); assert.equal(record.baselineHistory.length,1);
  assert.equal(record.observedSeconds,22*3600+19*60);
});
