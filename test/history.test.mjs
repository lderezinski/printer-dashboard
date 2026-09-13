import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory, observeHistory, setTiming, addManualRun, timingView } from '../history.mjs';
import { parseEstimatedTime, readTimeEstimate } from '../dist/gcode.js';
import { readFile } from 'node:fs/promises';

function monitor() {
  const history = createHistory(); let previous;
  return { history, sample(state, at, extra = {}) {
    previous = observeHistory(history, 'ad5m', previous, { connected: true, rawState: state, job: state === 'ready' ? '' : 'test.gcode', progress: 0, layer: 1, ...extra }, at);
    return history.runs.at(-1);
  } };
}
test('complete observed print compares original estimate with wall time including pauses', () => {
  const m = monitor();
  m.sample('ready', 0); const run = m.sample('printing', 5000);
  m.sample('pause', 10000); m.sample('pause', 20000); m.sample('printing', 30000); m.sample('completed', 35000);
  setTiming(run, { estimateSeconds: 20, actualSeconds: null });
  const view = timingView(run);
  assert.equal(view.actualSeconds, 30); assert.equal(view.deltaSeconds, 10); assert.equal(view.deltaPercent, 50);
  assert.equal(view.actualSource, 'observed'); assert.equal(view.effectiveStatus, 'completed');
});
test('prints already underway do not fabricate total duration', () => {
  const m = monitor(); const run = m.sample('printing', 0, { progress: 30, layer: 300 });
  m.sample('completed', 5000); setTiming(run, { estimateSeconds: 30 });
  assert.equal(timingView(run).actualSeconds, null); assert.equal(timingView(run).deltaSeconds, null);
  assert.equal(timingView(run).observedSpanSeconds, 5);
});
test('late start after idle is marked partial', () => {
  const m = monitor(); m.sample('ready', 0); const run = m.sample('printing', 5000, { progress: 2, layer: 5 });
  assert.equal(run.startedAt, null);
});
test('idle does not prove completion; user can confirm known outcome', () => {
  const m = monitor(); m.sample('ready', 0); const run = m.sample('printing', 5000); m.sample('ready', 10000);
  setTiming(run, { estimateSeconds: 4 });
  assert.equal(timingView(run).actualSeconds, 5); assert.equal(timingView(run).deltaSeconds, null);
  setTiming(run, { estimateSeconds: 4, outcome: 'completed' });
  assert.equal(timingView(run).deltaSeconds, 1);
});
test('disconnect, sleep, and restart exclude inferred duration', () => {
  for (const gap of ['disconnect', 'sleep', 'restart']) {
    const m = monitor(); m.sample('ready', 0); const run = m.sample('printing', 5000);
    if (gap === 'disconnect') { m.sample(undefined, 10000, { connected: false }); m.sample('completed', 15000); }
    if (gap === 'sleep') m.sample('completed', 30000);
    if (gap === 'restart') {
      const restored = JSON.parse(JSON.stringify(m.history));
      observeHistory(restored, 'ad5m', undefined, { connected: true, rawState: 'completed', job: 'test.gcode' }, 10000);
      assert.equal(timingView(restored.runs[0]).actualSeconds, null); assert.equal(restored.runs[0].hasGap, true); continue;
    }
    assert.equal(run.hasGap, true); assert.equal(timingView(run).actualSeconds, null);
  }
});
test('job changes and same-name progress resets create separate partial runs', () => {
  for (const sameName of [true, false]) {
    const m = monitor(); m.sample('ready', 0); const old = m.sample('printing', 5000);
    m.sample('printing', 10000, { progress: 60, layer: 200 });
    const next = m.sample('printing', 15000, { job: sameName ? 'test.gcode' : 'next.gcode', progress: 0, layer: 1 });
    assert.notEqual(old.id, next.id); assert.equal(old.status, 'unknown'); assert.equal(next.startedAt, null);
  }
});
test('cancelled and failed prints remain outside successful timing comparisons', () => {
  const m = monitor(); m.sample('ready', 0); const run = m.sample('printing', 5000); m.sample('canceling', 10000);
  setTiming(run, { estimateSeconds: 10 }); assert.equal(timingView(run).deltaSeconds, null);
  setTiming(run, { estimateSeconds: 10, actualSeconds: 5, outcome: 'failed' }); assert.equal(timingView(run).deltaSeconds, null);
});
test('manual timing fills a partial record, preserving observation notes and provenance', () => {
  const m = monitor(); const run = m.sample('printing', 0); m.sample('ready', 5000);
  setTiming(run, { estimateSeconds: 27475, estimateSource: { filename: 'logo.gcode', generatedBy: 'Flash Studio 1.7.17' }, actualSeconds: 28800, outcome: 'completed' });
  const view = timingView(run);
  assert.equal(view.deltaSeconds, 1325); assert.equal(view.actualSource, 'manual'); assert.equal(view.estimate.source, 'gcode');
  assert.equal(view.startedAt, null); assert.ok(view.notes.length);
});
test('manual records support unconnected printers and validate inputs before adding', () => {
  const history = createHistory();
  const value = { printerId: 'c5', job: 'Logo', printedAt: '2026-09-01T12:00:00Z', estimateSeconds: 27475, actualSeconds: 28800, outcome: 'completed' };
  const run = addManualRun(history, value, ['c5'], Date.parse('2026-09-02'));
  assert.equal(timingView(run).deltaSeconds, 1325); assert.equal(run.origin, 'manual');
  for (const invalid of [{ actualSeconds: -1 }, { actualSeconds: null }, { printerId: 'x' }, { estimateSeconds: '200' }, { printedAt: '2099-01-01' }, { outcome: 'anything' }]) {
    assert.throws(() => addManualRun(history, { ...value, ...invalid }, ['c5'], Date.parse('2026-09-02')));
    assert.equal(history.runs.length, 1);
  }
});
test('active records cannot be marked finished or given a completed total', () => {
  const m = monitor(); const run = m.sample('printing', 0);
  assert.throws(() => setTiming(run, { actualSeconds: 10 }));
  assert.throws(() => setTiming(run, { outcome: 'completed' }));
  assert.equal(run.actualOverrideSeconds, null);
});
test('estimate parsing preserves seconds and rejects ambiguous metadata', async () => {
  const header = await readFile(new URL('./fixtures/flash-studio-logo-header.gcode', import.meta.url), 'utf8');
  assert.equal(readTimeEstimate(header, 'sample.gcode').seconds, 27475);
  assert.equal(parseEstimatedTime('1d 2h 3m 4s'), 93784);
  assert.equal(parseEstimatedTime('38m'), 2280);
  for (const invalid of ['', '7:38', '-1h', '0s', '2h junk', '2m 1h']) assert.equal(parseEstimatedTime(invalid), null);
  assert.throws(() => readTimeEstimate(header.replace('; CONFIG_BLOCK_END', '; estimated printing time (normal mode) = 1h\n; CONFIG_BLOCK_END')));
  assert.throws(() => readTimeEstimate(header.replace('Flash Studio', 'Other Slicer')));
});
