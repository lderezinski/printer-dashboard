import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import snmp from 'net-snmp';
import { LASER_MODELS, OIDS, SUPPLIES_OID, normalizeBrother, readBrotherPrinter } from '../brother.mjs';

const values = () => ({
  [OIDS.model]: Buffer.from('Brother MFC-L2710DW series'),
  [OIDS.deviceStatus]: 2, [OIDS.status]: 3, [OIDS.errors]: Buffer.from([0]),
  [OIDS.display]: Buffer.from('Sleep'), [OIDS.counterUnit]: 8, [OIDS.counter]: 4041,
});
function addSupply(data, index, name, level, maximum, receptacle = false) {
  for (const [column, value] of Object.entries({ 4: receptacle ? 4 : 3, 5: name.includes('Toner') ? 3 : 9, 6: Buffer.from(name), 8: maximum, 9: level })) data[`${SUPPLIES_OID}.${column}.1.${index}`] = value;
  return data;
}
test('Brother readings retain unknown toner levels and calculate reported drum life', () => {
  const data = addSupply(addSupply(values(), 1, 'Black Toner Cartridge', -3, -2), 2, 'Drum Unit', 7959, 12000);
  const result = normalizeBrother(data, LASER_MODELS[0]);
  assert.equal(result.state, 'Sleep');
  assert.equal(result.health, 'ok');
  assert.equal(result.pageCount, 4041);
  assert.equal(result.pageCountLabel, 'Sheets printed');
  assert.equal(result.supplies[0].percent, null);
  assert.match(result.supplies[0].status, /Some remaining/);
  assert.equal(result.supplies[0].low, false);
  assert.equal(result.supplies[1].percent, 66);
  for (const level of [-1, -2]) {
    const unknown = normalizeBrother(addSupply(values(), 1, 'Toner', level, 100), LASER_MODELS[0]);
    assert.equal(unknown.supplies[0].percent, null);
    assert.equal(unknown.supplies[0].low, false);
  }
});
test('SNMP error bits distinguish low toner from paper jam and receptacle capacity', () => {
  const data = values();
  data[OIDS.errors] = Buffer.from([0x20]);
  assert.equal(normalizeBrother(data, LASER_MODELS[0]).health, 'warning');
  data[OIDS.errors] = Buffer.from([0x04]);
  const jam = normalizeBrother(data, LASER_MODELS[0]);
  assert.deepEqual(jam.alerts, ['Paper jam']);
  assert.equal(jam.health, 'error');
  const waste = normalizeBrother(addSupply(values(), 1, 'Waste Toner Box', -3, -2, true), LASER_MODELS[0]);
  assert.match(waste.supplies[0].status, /Space available/);
  assert.equal(waste.supplies[0].percent, null);
});
test('a wrong model or missing status cannot appear as a connected Brother printer', () => {
  assert.throws(() => normalizeBrother(values(), LASER_MODELS[1]), /Expected Brother HL/);
  const data = values();
  delete data[OIDS.status];
  assert.throws(() => normalizeBrother(data, LASER_MODELS[0]), /valid status/);
  data[OIDS.status] = 4;
  assert.equal(normalizeBrother(data, LASER_MODELS[0]).state, 'Printing');
  data[OIDS.counterUnit] = 5;
  assert.equal(normalizeBrother(data, LASER_MODELS[0]).pageCount, null);
});

function mockSession({ failGet = false, failSupplies = false, wrongModel = false } = {}) {
  const session = new EventEmitter();
  const sent = [];
  const data = values();
  if (wrongModel) data[OIDS.model] = Buffer.from('Other printer');
  const supplies = Object.entries(addSupply({}, 1, 'Black Toner Cartridge', -3, -2));
  session.get = (oids, callback) => {
    sent.push(['get', oids]);
    setImmediate(() => callback(failGet ? new Error('timeout') : null, Object.entries(data).map(([oid, value]) => ({ oid, value, type: Buffer.isBuffer(value) ? snmp.ObjectType.OctetString : snmp.ObjectType.Integer }))));
  };
  session.getNext = (oids, callback) => {
    sent.push(['getNext', oids]);
    const [oid, value] = supplies.shift() || ['1.3.6.1.2.1.43.12.1', 0];
    setImmediate(() => callback(failSupplies ? new Error('timeout') : null, [{ oid, value, type: Buffer.isBuffer(value) ? snmp.ObjectType.OctetString : snmp.ObjectType.Integer }]));
  };
  session.close = () => { session.closed = true; };
  return { session, sent };
}
test('reader uses only GET/GETNEXT and closes the session after success or failures', async () => {
  for (const options of [{}, { failGet: true }, { failSupplies: true }, { wrongModel: true }]) {
    const { session, sent } = mockSession(options);
    const pending = readBrotherPrinter({ host: '192.168.1.105' }, LASER_MODELS[0], () => session);
    if (options.failGet || options.wrongModel) await assert.rejects(pending);
    else {
      const result = await pending;
      assert.equal(result.state, 'Sleep');
      assert.equal(result.supplies.length, options.failSupplies ? 0 : 1);
      assert.equal(Boolean(result.supplyMessage), Boolean(options.failSupplies));
    }
    assert.equal(session.closed, true);
    assert.ok(sent.every(([method]) => ['get', 'getNext'].includes(method)));
    if (options.wrongModel) assert.equal(sent.length, 1);
  }
});
test('socket errors reject the read and close its session', async () => {
  const session = new EventEmitter();
  session.get = () => setImmediate(() => session.emit('error', new Error('unreachable')));
  session.close = () => { session.closed = true; };
  await assert.rejects(readBrotherPrinter({ host: '192.168.1.105' }, LASER_MODELS[0], () => session), /Unable to reach/);
  assert.equal(session.closed, true);
});
