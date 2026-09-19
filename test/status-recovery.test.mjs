// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readRecoveringStatus, unavailableStatus } from '../status-recovery.mjs';
import { MODELS } from '../printer.mjs';

const now = 1_800_000_000_000;
const settings = { host: '192.168.50.101', serialNumber: 'fixture-serial', checkCode: 'test-code' };
const sample = age => ({ connected: true, rawState: 'printing', progress: 50, lastSeen: new Date(now - age).toISOString() });
const fail = async () => { throw new Error('Local status unavailable.'); };

test('local fallback starts before cloud expiry and HTTP failure tries TCP', async () => {
  const reads = [];
  const result = await readRecoveringStatus(settings, MODELS[0], { now: () => now, cloud: { get: () => sample(7000) },
    readHttp: async () => { reads.push('http'); return fail(); },
    readTcp: async () => { reads.push('tcp'); return { rawState: 'printing', progress: 51 }; } });
  assert.deepEqual(reads, ['http', 'tcp']);
  assert.equal(result.connected, true); assert.equal(result.progress, 51);
  assert.equal(result.lastSeen, new Date(now).toISOString());
});

test('fresh cloud avoids unnecessary reads and explicit cloud offline still tries local status', async () => {
  let reads = 0;
  const readHttp = async () => { reads++; return { rawState: 'printing' }; };
  await readRecoveringStatus(settings, MODELS[0], { now: () => now, cloud: { get: () => sample(1000) }, readHttp });
  assert.equal(reads, 0);
  const result = await readRecoveringStatus(settings, MODELS[0], { now: () => now, cloud: { get: () => ({ ...sample(0), connected: false }) }, readHttp });
  assert.equal(reads, 1); assert.equal(result.connected, true);
});

test('a cloud report arriving during failed local reads recovers without a false offline sample', async () => {
  let current = null;
  const result = await readRecoveringStatus(settings, MODELS[0], { now: () => now, cloud: { get: () => current }, readHttp: fail,
    readTcp: async () => { current = sample(0); return fail(); } });
  assert.equal(result, current);
});

test('brief gaps are reconnecting without live measurements; longer gaps remain unavailable', async () => {
  const previous = sample(20000);
  const result = await readRecoveringStatus(settings, MODELS[0], { now: () => now, previous, readHttp: fail, readTcp: fail });
  assert.equal(result.state, 'Reconnecting'); assert.equal(result.connected, false);
  assert.equal(result.progress, undefined); assert.equal(result.rawState, undefined);
  assert.equal(result.lastSeen, previous.lastSeen);
  assert.equal(unavailableStatus(sample(70001), 'Offline', now).state, 'Unavailable');
  assert.equal(unavailableStatus(sample(-1), 'Offline', now).recovering, false);
});

test('switching back to cloud cannot move the last successful observation backwards', async () => {
  const previous = sample(1000);
  const result = await readRecoveringStatus(settings, MODELS[0], { now: () => now, previous, cloud: { get: () => sample(4000) } });
  assert.equal(result, previous);
});
