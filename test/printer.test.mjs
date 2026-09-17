// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, normalize, readPrinter, validateConfig } from '../printer.mjs';

test('5M progress is a ratio and estimatedTime is remaining, not total', () => {
  const p = normalize({ status: 'printing', printProgress: .42, estimatedTime: 3600, printDuration: 1800, rightTemp: 210, rightTargetTemp: 215, platTemp: 60 }, MODELS[0]);
  assert.equal(p.progress, 42);
  assert.equal(p.remaining, 3600);
  assert.deepEqual(p.nozzles, [{ current: 210, target: 215 }]);
  assert.equal(p.bed.target, null);
  assert.equal(p.chamber, null);
});
test('C5 uses four tool readings and hides unsupported chamber and door', () => {
  const p = normalize({ status: 'ready', nozzleTemps: [200, 30, 31, -108], nozzleTargetTemps: [210, 0, 0, 0], rightTemp: 999, chamberTemp: -108, doorStatus: 'close' }, MODELS[2]);
  assert.equal(p.nozzles.length, 4);
  assert.deepEqual(p.nozzles[0], { current: 200, target: 210 });
  assert.equal(p.nozzles[3].current, null);
  assert.equal(p.chamber, null);
  assert.equal(p.door, null);
});
test('C5P chamber and door readings, paused remaining suppressed', () => {
  const p = normalize({ status: 'pause', printProgress: .5, estimatedTime: 300, chamberTemp: '45', chamberTargetTemp: 50, doorStatus: 'open' }, MODELS[3]);
  assert.equal(p.state, 'Paused');
  assert.equal(p.health, 'warning');
  assert.equal(p.remaining, null);
  assert.deepEqual(p.chamber, { current: 45, target: 50 });
  assert.equal(p.door, 'Open');
});
test('missing measurements and unknown state do not report healthy zeroes', () => {
  const p = normalize({ status: 'new_state', rightTemp: '', rightTargetTemp: null }, MODELS[0]);
  assert.equal(p.health, 'unknown');
  assert.deepEqual(p.nozzles, [{ current: null, target: null }]);
  assert.equal(p.progress, null);
});
test('real error codes and error state need attention; zero code is clear', () => {
  assert.equal(normalize({ status: 'printing', errorCode: 'E0162' }, MODELS[3]).health, 'error');
  assert.equal(normalize({ status: 'error', errorCode: '' }, MODELS[3]).health, 'error');
  assert.equal(normalize({ status: 'ready', errorCode: 0 }, MODELS[0]).health, 'ok');
});
test('only private IPv4 printer addresses accepted', () => {
  assert.equal(validateConfig({ host: '192.168.50.101' }).host, '192.168.50.101');
  for (const host of ['127.0.0.1', '8.8.8.8', '192.168.50.999', 'printer.local/path', '192.168.50.101:80', '192.168.050.101']) assert.throws(() => validateConfig({ host }));
});
const config = { host: '192.168.50.101', serialNumber: 'test-serial', checkCode: 'test-code' };
test('transport only requests /detail and tolerates firmware content-type typo', async () => {
  const p = await readPrinter(config, MODELS[0], async (url, options) => {
    assert.equal(url, 'http://192.168.50.101:8898/detail');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { serialNumber: 'test-serial', checkCode: 'test-code' });
    return new Response(JSON.stringify({ code: 0, detail: { status: 'ready' } }), { headers: { 'Content-Type': 'appliation/json' } });
  });
  assert.equal(p.state, 'Ready');
});
test('authentication, LAN mode, malformed responses and offline connections fail distinctly', async () => {
  for (const [payload, expected] of [[{ code: 1 }, /Access denied/], [{ code: -2 }, /LAN mode/], [{ code: 0, detail: {} }, /missing status/], [null, /Unexpected/]]) {
    await assert.rejects(readPrinter(config, MODELS[0], async () => new Response(JSON.stringify(payload))), expected);
  }
  await assert.rejects(readPrinter(config, MODELS[0], async () => new Response('not json')), /unreadable/);
  await assert.rejects(readPrinter(config, MODELS[0], async () => { throw new Error('connect failed'); }), /Unreachable/);
});
