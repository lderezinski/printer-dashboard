import test from 'node:test';
import assert from 'node:assert/strict';
import { securitySettings, viewerMaintenance } from '../security.mjs';

test('security defaults require TLS and keep the dashboard on this Mac', () => {
  assert.deepEqual(securitySettings({}, {}), { allowLanReadOnly: false, allowInsecureMqtt: false });
  assert.deepEqual(securitySettings({ allowInsecureMqtt: true }, {}), { allowLanReadOnly: false, allowInsecureMqtt: true });
  assert.deepEqual(securitySettings({ allowInsecureMqtt: true }, { FLASHFORGE_LAN: 'on', FLASHFORGE_ALLOW_INSECURE_MQTT: 'off' }), { allowLanReadOnly: true, allowInsecureMqtt: false });
  for (const value of [null, [], { allowLanReadOnly: 'false' }, { allowInsecureMqtt: 'true' }, { unknown: true }, JSON.parse('{"__proto__":true}')]) assert.throws(() => securitySettings(value, {}));
  assert.throws(() => securitySettings({}, { FLASHFORGE_LAN: 'true' }));
});

test('viewer responses omit serial numbers without changing saved maintenance data', () => {
  const original = { baseline: { serialNumber: 'fixture-serial', printingSeconds: 100 }, schedules: [] };
  assert.equal(viewerMaintenance(original, false).baseline.serialNumber, undefined);
  assert.equal(viewerMaintenance(original, false).baseline.printingSeconds, 100);
  assert.equal(original.baseline.serialNumber, 'fixture-serial');
  assert.equal(viewerMaintenance(original, true), original);
  assert.deepEqual(viewerMaintenance({ baseline: null }, false), { baseline: null });
});
