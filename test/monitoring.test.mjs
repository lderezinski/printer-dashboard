import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MODELS } from '../printer.mjs';
import { parseTcp, readTcpPrinter } from '../tcp-printer.mjs';
import { createRecord, accrue, setSchedule, markServiced, maintenanceStatus } from '../maintenance.mjs';

const state = (job = 'pawns.3mf', status = 'BUILDING_FROM_SD', move = 'MOVING') => `CMD M119 Received.\r\nMachineStatus: ${status}\r\nMoveMode: ${move}\r\nCurrentFile: ${job}\r\nok\r\n`;
const progress = 'CMD M27 Received.\r\nSD printing byte 51/100\r\nLayer: 234/749\r\nok\r\n';
const temps = 'CMD M105 Received.\r\nT0:217.1/217.0 T1:0/0 B:45.0/45.0\r\nok\r\n';
test('live-format TCP status reports printing, percent, layers and temperatures', () => {
  const value = parseTcp([state(), progress, temps, state()], MODELS[1]);
  assert.equal(value.rawState, 'printing');
  assert.equal(value.progress, 51);
  assert.equal(value.layer, 234);
  assert.equal(value.layers, 749);
  assert.equal(value.nozzles[0].current, 217.1);
  assert.equal(value.bed.current, 45);
  assert.equal(value.remaining, null);
});
test('job transitions discard mismatched progress; paused movement overrides printing', () => {
  assert.equal(parseTcp([state('old'), progress, temps, state('new')], MODELS[0]).progress, null);
  assert.equal(parseTcp([state(), progress, temps, state('pawns.3mf', 'BUILDING_FROM_SD', 'PAUSED')], MODELS[0]).rawState, 'pause');
  assert.equal(parseTcp([state('', 'READY'), progress, temps, state('', 'READY')], MODELS[0]).progress, null);
  assert.throws(() => parseTcp(['', progress, temps, 'ok'], MODELS[0]), /missing/);
});
test('TCP transport reassembles fragmented responses and sends only status queries', async () => {
  const sent = [];
  const responses = [state(), progress, temps, state()];
  const socket = new EventEmitter();
  socket.setEncoding = () => {};
  socket.destroy = () => { socket.destroyed = true; };
  socket.write = command => {
    sent.push(command);
    const reply = responses.shift();
    setImmediate(() => { socket.emit('data', reply.slice(0, 12)); socket.emit('data', reply.slice(12)); });
  };
  const result = readTcpPrinter({ host: '192.168.50.101' }, MODELS[0], () => {
    setImmediate(() => socket.emit('connect'));
    return socket;
  });
  assert.equal((await result).progress, 51);
  assert.deepEqual(sent, ['~M119\r\n', '~M27\r\n', '~M105\r\n', '~M119\r\n']);
  assert.equal(socket.destroyed, true);
});
test('printing time excludes pauses, lost connections, long gaps and restarts', () => {
  const record = createRecord(0);
  const printing = { connected: true, rawState: 'printing' };
  let previous = accrue(record, undefined, printing, 1000);
  previous = accrue(record, previous, printing, 6000);
  assert.equal(record.observedSeconds, 5);
  previous = accrue(record, previous, { connected: false }, 11000);
  previous = accrue(record, previous, printing, 16000);
  previous = accrue(record, previous, printing, 100000);
  previous = accrue(record, previous, { connected: true, rawState: 'pause' }, 105000);
  accrue(record, previous, printing, 110000);
  accrue(record, undefined, printing, 115000);
  assert.equal(record.observedSeconds, 5);
});
test('reminders become due at either threshold and servicing preserves lifetime observed hours', () => {
  const record = createRecord(0);
  record.observedSeconds = 7200;
  setSchedule(record, { name: 'Inspect rails', hours: 10, days: 30 }, 0);
  assert.equal(maintenanceStatus(record, true, 29 * 86400000).due, false);
  assert.equal(maintenanceStatus(record, true, 30 * 86400000).due, true);
  record.observedSeconds += 36000;
  assert.equal(maintenanceStatus(record, true, 1).due, true);
  assert.equal(maintenanceStatus(record, false, 1).due, false);
  markServiced(record, record.schedules[0].id, 1000);
  assert.equal(maintenanceStatus(record, true, 1000).due, false);
  assert.equal(record.observedSeconds, 43200);
  assert.equal(record.serviceHistory.length, 1);
  assert.equal(maintenanceStatus(record, true, 1000).schedules[0].hoursRemaining, 10);
});
test('editing keeps maintenance baseline; calendar reminders work without printer access', () => {
  const record = createRecord(0);
  setSchedule(record, { name: 'Inspect', days: 10 }, 1000);
  setSchedule(record, { id: record.schedules[0].id, name: 'Inspect', days: 20 }, 5000);
  assert.equal(record.schedules[0].since, new Date(1000).toISOString());
  assert.equal(maintenanceStatus(record, false, 1000 + 20 * 86400000).due, true);
  assert.throws(() => setSchedule(record, { name: 'Task', hours: -1 }, 0));
  assert.throws(() => setSchedule(record, { name: 'Task' }, 0));
});
