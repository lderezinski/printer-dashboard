// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Exercise the browser helper without starting the dashboard or its camera workers.
const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function spaghettiStatus('), source.indexOf('\nfunction card('));
const status = runInNewContext(`(${helper})`, { escape: String });
const printer = { id: 'a5mp', connected: true, rawState: 'printing' };
const camera = (states, extra = {}) => ({ enabled: true, state: states[0], frames: states.length,
  history: states.map(state => ({ state })), ...extra });
const render = (internal, external, p = printer) => status(p, { a5mp: internal }, { a5mp: external });

test('counts positive images only within the last five checks', () => {
  const html = render(camera(['clear', 'suspect', 'clear', 'suspect', 'clear', 'warning']));
  assert.match(html, />Spaghetti detected 2\/5<\/span>/);
  assert.match(html, /class="spaghetti-status warning"/);
});
test('zero is green and repeated-detection alerts are red', () => {
  assert.match(render(camera(Array(5).fill('clear'))), /spaghetti-status ok/);
  const html = render(camera(['clear', 'warning', 'suspect', 'clear', 'clear']));
  assert.match(html, /spaghetti-status error/);
  assert.match(html, />Spaghetti detected 2\/5</);
});
test('two cameras use the higher count rather than adding their counts', () => {
  const html = render(camera(['suspect', 'clear', 'clear', 'clear', 'clear']),
    camera(['suspect', 'suspect', 'suspect', 'clear', 'clear']));
  assert.match(html, />Spaghetti detected 3\/5</);
  assert.match(html, /Integrated camera: 1 positive/);
  assert.match(html, /Tapo C120: 3 positive/);
});
test('nonprinting and disconnected printers have no indicator', () => {
  for (const p of [{ ...printer, rawState: 'ready' }, { ...printer, rawState: 'pause' }, { ...printer, connected: false }]) {
    assert.equal(render(camera(Array(5).fill('clear')), undefined, p), '');
  }
});
test('missing, disabled and stale cameras do not imply zero detections', () => {
  for (const c of [undefined, camera(['clear'], { enabled: false }), camera(['warning'], { state: 'unavailable' }), camera(['warning'], { state: 'starting' })]) {
    assert.match(render(c), /spaghetti-status unknown/);
    assert.match(render(c), />Spaghetti detected —\/5</);
  }
  assert.match(render(undefined, camera(Array(5).fill('clear'))), /spaghetti-status ok/);
  const partial = render(camera(Array(5).fill('clear')), camera(['warning'], { state: 'unavailable' }));
  assert.match(partial, /spaghetti-status ok/);
  assert.match(partial, /Camera check unavailable/);
});
test('fresh zero detections stay green while incomplete coverage is explained separately', () => {
  const html = render(camera(['clear', 'warning', 'warning', 'warning', 'warning'], { frames: 1 }));
  assert.match(html, />Spaghetti detected 0\/5</);
  assert.match(html, /spaghetti-status ok/);
  assert.match(html, /Collecting camera checks/);
  assert.match(html, /0 positive in 1 recent checks/);
});
