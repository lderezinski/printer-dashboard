import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export function expectedHeight(layer, profile) {
  if (!Number.isInteger(layer) || layer < 1 || !profile) return null;
  if (profile.layerZ) { const z = profile.layerZ[layer-1]; return Number.isFinite(z) && z > 0 ? z : null; }
  if (!(Number.isFinite(profile.firstLayerMm) && Number.isFinite(profile.layerMm) && profile.firstLayerMm > 0 && profile.layerMm > 0)) return null;
  return Math.round((profile.firstLayerMm+(layer-1)*profile.layerMm)*1000)/1000;
}

export function compareHeight(previous, measurement, context) {
  const { jobKey, capturedAt, layer, expectedMm } = context;
  const base = { jobKey, capturedAt, layer, expectedMm, measuredMm: null, shortfallMm: null, count: 0, severeCount: 0 };
  if (measurement?.state !== 'measured' || !Number.isFinite(measurement.heightMm) || measurement.heightMm < 0 || !Number.isFinite(measurement.uncertaintyMm) || measurement.uncertaintyMm < 0 || !Number.isFinite(measurement.confidence) || measurement.confidence < .82 || measurement.confidence > 1 || !Number.isFinite(expectedMm))
    return { ...base, state: 'unknown', message: measurement?.reason || 'Physical height cannot be measured in this image.' };
  const shortfallMm = Math.max(0, expectedMm-measurement.heightMm);
  const conservativeGap = shortfallMm-measurement.uncertaintyMm;
  const contiguous = previous?.jobKey === jobKey && capturedAt > previous.capturedAt && capturedAt-previous.capturedAt <= 90000 && layer >= previous.layer;
  const count = conservativeGap >= 2 ? (contiguous ? previous.count : 0)+1 : 0;
  const severeCount = conservativeGap >= 5 ? (contiguous ? previous.severeCount || 0 : 0)+1 : 0;
  const state = severeCount >= 3 ? 'warning' : count >= 3 && conservativeGap >= 2 ? 'suspect' : conservativeGap >= 2 ? 'checking' : 'tracking';
  const message = { warning: 'Possible air printing: repeated height shortfall exceeds 5 mm. Inspect the A5MP now.', suspect: 'Possible stalled growth: repeated height shortfall exceeds 2 mm. Inspect the print.', checking: 'Height looks short. Checking more images before raising an alert.', tracking: 'Tracked height is within the current tolerance. This does not guarantee extrusion.' }[state];
  return { ...base, measuredMm: measurement.heightMm, uncertaintyMm: measurement.uncertaintyMm,
    shortfallMm: Math.round(shortfallMm*1000)/1000, confidence: measurement.confidence, count, severeCount, state, message };
}

export function validateCalibration(value, width, height) {
  if (!value || typeof value !== 'object') throw new Error('Calibration is required.');
  const result = {};
  for (const key of ['bed','top','anchor','scaleBottom','scaleTop']) {
    const point = value[key];
    if (!Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v)) || point[0] < 13 || point[0] > width-14 || point[1] < 13 || point[1] > height-14) throw new Error(`Mark ${key} inside the image, away from its border.`);
    result[key] = point;
  }
  const span = Math.hypot(result.scaleTop[0]-result.scaleBottom[0], result.scaleTop[1]-result.scaleBottom[1]);
  if (!Number.isFinite(value.scaleMm) || value.scaleMm < 5 || value.scaleMm > 100 || span < 12 || span/value.scaleMm < .5 || span/value.scaleMm > 30) throw new Error('Use a vertical reference at least 5 mm tall and 12 pixels apart.');
  if (!(Number.isFinite(value.layerMm) && value.layerMm >= .02 && value.layerMm <= 1 && Number.isFinite(value.firstLayerMm) && value.firstLayerMm >= .02 && value.firstLayerMm <= 1)) throw new Error('Enter valid layer heights in millimeters.');
  if (value.uniformLayers !== true) throw new Error('Confirm these layer heights match the current slice. Variable layers require a layer-Z table.');
  result.scaleMm = value.scaleMm;
  result.profile = { layerMm: value.layerMm, firstLayerMm: value.firstLayerMm, source: 'User-confirmed current slice' };
  return result;
}

export class HeightMonitor {
  constructor(root, getSample, getJobKey) {
    this.root = root; this.getSample = getSample; this.getJobKey = getJobKey;
    this.config = null; this.latest = null; this.history = [];
  }
  async load() {
    try { this.config = JSON.parse(await readFile(path.join(this.root,'data','height-a5mp.json'),'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') this.error = 'Height calibration could not be read. Recalibrate.'; }
  }
  context(sample = this.getSample()) {
    if (!this.config || this.config.jobKey !== this.getJobKey() || this.config.job !== sample?.job || sample?.layer < this.config.referenceLayer) return null;
    const expectedMm = expectedHeight(sample?.layer, this.config.profile);
    return expectedMm === null ? null : { calibrationId: this.config.id, jobKey: this.getJobKey(), layer: sample.layer, expectedMm };
  }
  observe(result, request) {
    if (request.jobKey !== this.getJobKey()) { this.latest = null; return; }
    const capturedAt = result.heightCapturedAt;
    if (!Number.isFinite(capturedAt) || capturedAt < request.startedAt || capturedAt > Date.now()) { this.latest = null; return; }
    if (typeof result.heightJpeg === 'string' && result.heightJpeg.length < 4_000_000 && typeof result.heightReferenceJpeg === 'string' && result.heightReferenceJpeg.length < 4_000_000 && Number.isInteger(result.heightWidth) && result.heightWidth >= 100 && result.heightWidth <= 4096 && Number.isInteger(result.heightHeight) && result.heightHeight >= 100 && result.heightHeight <= 4096) {
      this.image = Buffer.from(result.heightJpeg, 'base64');
      this.referenceImage = Buffer.from(result.heightReferenceJpeg, 'base64');
      this.snapshot = { capturedAt: result.heightCapturedAt, width: result.heightWidth, height: result.heightHeight,
        jobKey: request.jobKey, job: request.sample.job, layer: request.sample.layer };
    }
    if (!request.heightContext || request.heightContext.calibrationId !== this.config?.id) { this.latest = null; return; }
    this.latest = compareHeight(this.latest, result.heightMeasurement, { ...request.heightContext, capturedAt });
    this.history = [this.latest,...this.history].slice(0,20);
  }
  freeze() {
    const sample = this.getSample();
    const age = Date.now()-Date.parse(sample?.lastSeen);
    if (!sample?.connected || sample.rawState !== 'printing' || !Number.isFinite(age) || age < 0 || age > 15000) throw new Error('Wait for fresh A5MP printing status before calibration.');
    if (!this.image || !this.snapshot || Date.now()-this.snapshot.capturedAt > 60000 || this.snapshot.jobKey !== this.getJobKey()) throw new Error('Wait for a fresh close-up of the current print.');
    this.frozen = { ...this.snapshot, id: randomUUID(), image: Buffer.from(this.referenceImage), createdAt: Date.now() };
    const { image, ...data } = this.frozen;
    return { ...data, imageUrl: `/api/height/a5mp/reference/${data.id}`, suggestedProfile: this.suggestedProfile(data.job) };
  }
  suggestedProfile(job) {
    return job === 'a5mp-dark-chess-calibration.3mf'
      ? { firstLayerMm: .15, layerMm: .12, source: 'Saved dark-chess calibration project; confirm against the running slice.' } : null;
  }
  async calibrate(value) {
    const frozen = this.frozen;
    if (!frozen || value.snapshotId !== frozen.id || Date.now()-frozen.createdAt > 900000 || frozen.jobKey !== this.getJobKey()) throw new Error('Calibration image expired or the print changed. Capture a new reference.');
    const clean = validateCalibration(value, frozen.width, frozen.height);
    const expected = expectedHeight(frozen.layer, clean.profile);
    if (expected === null) throw new Error('Wait until the printer reports layer 1 or later.');
    const id = randomUUID();
    const config = { ...clean, id, jobKey: frozen.jobKey, job: frozen.job, referenceLayer: frozen.layer, referenceExpectedMm: expected,
      referenceFile: `height-reference-${id}.jpg`, calibratedAt: new Date().toISOString(), width: frozen.width, height: frozen.height };
    const directory = path.join(this.root,'data');
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(path.join(directory,config.referenceFile),frozen.image,{mode:0o600});
    let validation;
    try {
      const { stdout } = await execute(path.join(directory,'obico-venv','bin','python'), [path.join(this.root,'height_tracker.py'), path.join(directory,config.referenceFile), JSON.stringify(config)], { timeout: 10000, maxBuffer: 8192 });
      validation = JSON.parse(stdout);
    } catch { throw new Error('The landmark validator could not run. Check the local detector installation.'); }
    if (!validation.valid) throw new Error(validation.error || 'These landmarks cannot be tracked. Select different points.');
    if (frozen.jobKey !== this.getJobKey()) throw new Error('The print changed while validating. Capture a new reference.');
    await writeFile(path.join(directory,'height-a5mp.json.tmp'),JSON.stringify(config,null,2),{mode:0o600});
    await rename(path.join(directory,'height-a5mp.json.tmp'),path.join(directory,'height-a5mp.json'));
    this.config = config; this.latest = null; this.history = []; this.error = ''; this.frozen = null;
  }
  invalidate() { this.latest = null; }
  view(now = Date.now()) {
    const sample = this.getSample();
    const age = now-Date.parse(sample?.lastSeen);
    let state, message;
    if (!sample?.connected || !Number.isFinite(age) || age < 0 || age > 15000) { state = 'unknown'; message = 'Fresh A5MP status is unavailable.'; }
    else if (sample.rawState !== 'printing') { state = 'idle'; message = 'Height checks resume when the A5MP is printing.'; }
    else if (!this.context(sample)) { state = 'calibration'; message = this.error || 'Set the camera scale and landmarks for this print before height detection can run.'; }
    else if (!this.latest || this.latest.jobKey !== this.getJobKey() || now-this.latest.capturedAt < 0 || now-this.latest.capturedAt > 90000) { state = 'unknown'; message = 'Waiting for a fresh, measurable view of the print.'; }
    else ({ state, message } = this.latest);
    const context = this.context(sample);
    const valid = this.latest && this.latest.jobKey === this.getJobKey() && now-this.latest.capturedAt <= 90000 && !['unknown','idle','calibration'].includes(state);
    return { state, message, expectedMm: context?.expectedMm ?? null, measurementExpectedMm: valid ? this.latest.expectedMm : null,
      measuredMm: valid ? this.latest.measuredMm : null, shortfallMm: valid ? this.latest.shortfallMm : null,
      uncertaintyMm: valid ? this.latest.uncertaintyMm : null, layer: sample?.layer ?? null, measurementLayer: valid ? this.latest.layer : null,
      capturedAt: this.snapshot?.capturedAt ?? null, imageUrl: this.image ? `/api/height/a5mp/image?t=${this.snapshot.capturedAt}` : null,
      calibrated: Boolean(context), calibration: this.config ? { calibratedAt:this.config.calibratedAt, profile:this.config.profile } : null,
      history: this.history.map(({state,capturedAt,expectedMm,measuredMm,shortfallMm})=>({state,capturedAt,expectedMm,measuredMm,shortfallMm})) };
  }
}
