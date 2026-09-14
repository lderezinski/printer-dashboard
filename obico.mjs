import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

export const CAMERA_INTERVAL = 20000;
const RESULT_TTL = 60000;

export function canAnalyze(sample, now = Date.now()) {
  const age = now - Date.parse(sample?.lastSeen);
  return Boolean(sample?.connected && sample.rawState === 'printing' && age >= 0 && age <= 15000);
}

// These are dashboard alert rules, not Obico Cloud's calibrated failure probability.
export function nextDetection(previous, result, jobKey) {
  if (!Array.isArray(result.detections)) throw new Error('Invalid detections');
  const confidences = result.detections.map(d => d?.[1]);
  if (confidences.some(c => !Number.isFinite(c) || c < 0 || c > 1)) throw new Error('Invalid detection confidence');
  const strongest = Math.max(0, ...confidences);
  const continuing = previous?.jobKey === jobKey && result.capturedAt > previous.capturedAt && result.capturedAt - previous.capturedAt <= RESULT_TTL;
  const consecutive = strongest >= 0.6 ? (continuing ? previous.consecutive : 0) + 1 : 0;
  return { jobKey, capturedAt: result.capturedAt, strongest, consecutive,
    frames: (continuing ? previous.frames : 0) + 1,
    state: consecutive >= 3 ? 'warning' : strongest >= 0.3 ? 'suspect' : 'clear',
    inferenceMs: result.inferenceMs };
}

export class ObicoMonitor {
  constructor(root, getSample, getJobKey, printerId = 'ad5m') {
    if (!['ad5m', 'a5mp', 'c5'].includes(printerId)) throw new Error('Unsupported printer camera');
    this.printerId = printerId;
    this.name = { ad5m: 'AD5M', a5mp: 'A5MP', c5: 'C5' }[printerId];
    this.root = root;
    this.getSample = getSample;
    this.getJobKey = getJobKey;
    this.enabled = existsSync(path.join(root, 'data', `camera-${printerId}.json`)) && process.env.FLASHFORGE_CAMERA !== 'off';
    this.nextAt = 0;
    this.sequence = 0;
    this.error = '';
    this.history = [];
  }
  start() {
    if (!this.enabled) return;
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }
  launch() {
    const worker = spawn(path.join(this.root, 'data', 'obico-venv', 'bin', 'python'), ['-u', path.join(this.root, 'obico-worker.py'), this.printerId], {
      cwd: this.root, stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    this.worker = worker;
    this.ready = false;
    this.startupTimer = setTimeout(() => {
      if (this.worker === worker && !this.ready) { this.error = 'Local detector startup timed out. Retrying automatically.'; worker.kill(); }
    }, 45000);
    worker.stdin.on('error', () => {});
    const lines = createInterface({ input: worker.stdout });
    lines.on('line', line => {
      if (this.worker !== worker) return;
      try { this.receive(JSON.parse(line)); }
      catch { this.error = 'Invalid detector response. Retrying automatically.'; this.pending = null; worker.kill(); }
    });
    const exited = () => {
      if (this.worker !== worker) return;
      clearTimeout(this.startupTimer);
      this.worker = null; this.ready = false; this.pending = null;
      this.error ||= 'Local detector stopped. Retrying automatically.';
      this.nextAt = Date.now() + CAMERA_INTERVAL;
    };
    worker.on('error', exited);
    worker.on('exit', exited);
  }
  tick() {
    const now = Date.now();
    if (this.stopped || !this.enabled) return;
    if (this.pending && now - this.pending.startedAt > 35000) {
      this.height?.invalidate();
      this.error = 'Camera analysis timed out. Retrying automatically.';
      this.pending = null; this.worker?.kill(); return;
    }
    if (!canAnalyze(this.getSample(), now)) {
      this.height?.invalidate();
      this.previous = null;
      this.suspended = true;
      return;
    }
    if (this.pending || now < this.nextAt) return;
    if (!this.worker) { this.launch(); return; }
    if (!this.ready) return;
    const jobKey = this.getJobKey();
    if (!jobKey) return;
    const sample = this.getSample();
    this.pending = { id: ++this.sequence, jobKey, startedAt: now, sample: { job: sample.job, layer: sample.layer }, heightContext: this.height?.context(sample) };
    this.worker.stdin.write(JSON.stringify({ type: 'capture', id: this.pending.id, heightContext: this.pending.heightContext }) + '\n');
  }
  receive(result) {
    if (result.type === 'ready') {
      clearTimeout(this.startupTimer); this.ready = true; this.error = ''; this.tick(); return;
    }
    if (result.type === 'fatal') { this.error = 'Local detector could not start. Check its installation and camera configuration.'; this.worker?.kill(); return; }
    const pending = this.pending;
    if (!pending || result.id !== pending.id) return;
    this.pending = null;
    this.nextAt = Date.now() + CAMERA_INTERVAL;
    if (!canAnalyze(this.getSample()) || pending.jobKey !== this.getJobKey()) { this.previous = null; this.height?.invalidate(); return; }
    this.height?.observe(result, pending);
    if (result.type === 'error') {
      this.error = result.message; this.previous = null; return;
    }
    if (result.type !== 'result' || !Number.isFinite(result.capturedAt) || result.capturedAt < pending.startedAt || result.capturedAt > Date.now() || typeof result.jpeg !== 'string' || result.jpeg.length > 4_000_000) throw new Error('Invalid image result');
    const detection = nextDetection(this.previous, result, pending.jobKey);
    this.previous = detection;
    this.suspended = false;
    this.latest = detection;
    this.image = Buffer.from(result.jpeg, 'base64');
    this.error = '';
    this.history = [{ capturedAt: detection.capturedAt, state: detection.state }, ...this.history].slice(0, 12);
  }
  view(now = Date.now()) {
    const sample = this.getSample();
    let state, message;
    if (!this.enabled) { state = 'disabled'; message = `${this.name} camera detection is not configured.`; }
    else if (!sample?.connected || !Number.isFinite(Date.parse(sample?.lastSeen)) || now - Date.parse(sample.lastSeen) > 15000 || now < Date.parse(sample.lastSeen)) { state = 'unavailable'; message = `Waiting for fresh ${this.name} printer status. Camera checks are suspended.`; }
    else if (sample.rawState !== 'printing') { state = 'idle'; message = `Camera checks resume automatically when the ${this.name} is printing.`; }
    else if (this.error) { state = 'unavailable'; message = this.error; }
    else if (this.suspended || !this.latest || this.latest.jobKey !== this.getJobKey()) { state = 'starting'; message = 'Waiting for a fresh camera check for this print…'; }
    else if (now - this.latest.capturedAt > RESULT_TTL) { state = 'unavailable'; message = 'The last camera check is stale. Waiting for a fresh image.'; }
    else {
      state = this.latest.state;
      message = { clear: 'No spaghetti detected in the latest image.', suspect: 'Possible spaghetti in one or more areas. Inspect the image while we check again.', warning: `Possible spaghetti detected repeatedly. Check the ${this.name} now.` }[state];
    }
    const current = this.latest?.jobKey === this.getJobKey();
    const airPrinting = !sample?.connected || !Number.isFinite(Date.parse(sample?.lastSeen)) || Math.abs(now - Date.parse(sample.lastSeen)) > 15000
      ? { state: 'unknown', message: 'Air printing: printer status unavailable.' }
      : sample.rawState === 'printing'
        ? { state: 'unverified', message: 'Filament flow is unverified. Obico cannot reliably detect printing into empty air.' }
        : { state: 'inactive', message: 'Air printing: printer is not reporting an active print.' };
    return { printerId: this.printerId, enabled: this.enabled, state, message, airPrinting: this.gap?.view(now) || this.height?.view(now) || airPrinting, checking: Boolean(this.pending), intervalSeconds: CAMERA_INTERVAL / 1000,
      capturedAt: this.latest?.capturedAt || null, imageUrl: this.image ? `/api/camera/${this.printerId}/image?t=${this.latest.capturedAt}` : null,
      frames: current ? this.latest.frames : 0, inferenceMs: this.latest?.inferenceMs ?? null, history: this.history };
  }
  stop() { this.stopped = true; clearInterval(this.timer); clearTimeout(this.startupTimer); this.worker?.kill(); }
}
