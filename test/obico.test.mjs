import test from 'node:test';
import assert from 'node:assert/strict';
import { canAnalyze, nextDetection, ObicoMonitor } from '../obico.mjs';

const now = 1_800_000_000_000;
const sample = { connected: true, rawState: 'printing', lastSeen: new Date(now).toISOString() };
const result = (confidence, capturedAt = now) => ({ detections: confidence === null ? [] : [['failure', confidence, [100, 100, 20, 20]]], capturedAt, inferenceMs: 150 });

test('analyze only fresh printing reports, including rejecting future timestamps', () => {
  assert.equal(canAnalyze(sample, now), true);
  for (const s of [{ ...sample, connected: false }, { ...sample, rawState: 'paused' }, { ...sample, rawState: 'heating' }, { ...sample, lastSeen: 'invalid' }]) assert.equal(canAnalyze(s, now), false);
  assert.equal(canAnalyze(sample, now + 15001), false);
  assert.equal(canAnalyze(sample, now - 1), false);
});

test('repeated strong detections warn; a clean frame resets the streak', () => {
  let p = nextDetection(null, result(0.85), 'job1');
  assert.equal(p.state, 'suspect');
  p = nextDetection(p, result(0.8, now + 20000), 'job1');
  assert.equal(p.state, 'suspect');
  p = nextDetection(p, result(0.9, now + 40000), 'job1');
  assert.equal(p.state, 'warning');
  p = nextDetection(p, result(null, now + 60000), 'job1');
  assert.equal(p.state, 'clear');
  assert.equal(p.consecutive, 0);
});

test('job changes, long gaps, or duplicate frames cannot continue a warning streak', () => {
  const previous = { jobKey: 'old', capturedAt: now, consecutive: 2, frames: 2 };
  for (const [job, at] of [['new', now + 20000], ['old', now + 60001], ['old', now]]) {
    const p = nextDetection(previous, result(0.9, at), job);
    assert.equal(p.consecutive, 1);
    assert.equal(p.state, 'suspect');
  }
  assert.throws(() => nextDetection(null, result(NaN), 'old'));
});

test('stale camera or printer data never displays a clear current result', () => {
  let currentSample = sample;
  let key = 'job1';
  const monitor = new ObicoMonitor('/nonexistent', () => currentSample, () => key);
  monitor.enabled = true;
  monitor.latest = nextDetection(null, result(null), 'job1');
  assert.equal(monitor.view(now).state, 'clear');
  currentSample = { ...sample, lastSeen: new Date(now + 60001).toISOString() };
  assert.equal(monitor.view(now + 60001).state, 'unavailable');
  currentSample = sample;
  assert.equal(monitor.view(now + 15001).state, 'unavailable');
  key = 'job2';
  assert.equal(monitor.view(now).state, 'starting');
  currentSample = { ...sample, rawState: 'paused' };
  assert.equal(monitor.view(now).state, 'idle');
});

test('late inference from a previous job is discarded', () => {
  const monitor = new ObicoMonitor('/nonexistent', () => ({ ...sample, lastSeen: new Date().toISOString() }), () => 'new');
  monitor.pending = { id: 1, jobKey: 'old', startedAt: Date.now() - 5000 };
  monitor.receive({ ...result(0.99, Date.now()), type: 'result', id: 1, jpeg: 'unused' });
  assert.equal(monitor.latest, undefined);
  assert.equal(monitor.image, undefined);
});

test('three cameras keep their images, state, labels and job histories independent', () => {
  const monitors = ['ad5m', 'a5mp', 'c5'].map(id => new ObicoMonitor('/nonexistent', () => sample, () => id + '-job', id));
  for (const monitor of monitors) {
    monitor.enabled = true;
    monitor.latest = nextDetection(null, result(null), monitor.printerId + '-job');
    monitor.image = Buffer.from(monitor.printerId);
    const view = monitor.view(now);
    assert.match(view.imageUrl, new RegExp(`/api/camera/${monitor.printerId}/image`));
    assert.equal(view.printerId, monitor.printerId);
    assert.equal(view.airPrinting.state, 'unverified');
  }
  monitors[1].error = 'Camera disconnected';
  assert.equal(monitors[1].view(now).state, 'unavailable');
  assert.equal(monitors[0].view(now).state, 'clear');
  assert.equal(monitors[2].view(now).state, 'clear');
  assert.throws(() => new ObicoMonitor('/nonexistent', () => sample, () => 'job', '../data'));
});

test('air printing remains unverified while printing, inactive while ready, and unknown on stale status', () => {
  let current = sample;
  const monitor = new ObicoMonitor('/nonexistent', () => current, () => 'job', 'a5mp');
  monitor.enabled = true;
  assert.equal(monitor.view(now).airPrinting.state, 'unverified');
  current = { ...sample, rawState: 'ready' };
  assert.equal(monitor.view(now).airPrinting.state, 'inactive');
  assert.equal(monitor.view(now + 15001).airPrinting.state, 'unknown');
});
