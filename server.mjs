// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import { lanAddresses, requestAccessError, canUseLocalTools } from './network.mjs';
import { securitySettings, viewerMaintenance } from './security.mjs';
import { CloudMonitor } from './cloud.mjs';
import { ObicoMonitor } from './obico.mjs';
import { GapMonitor } from './gap.mjs';
import { createHistory, observeHistory, timingView, setTiming, addManualRun } from './history.mjs';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MODELS, validateConfig, readPrinter } from './printer.mjs';
import { readTcpPrinter } from './tcp-printer.mjs';
import { LASER_MODELS, readBrotherPrinter } from './brother.mjs';
import { readPrinterQueue } from './printer-queue.mjs';
import { createRecord, upgradeRecord, setBaseline, alignInitialReminders, accrue, setSchedule, markServiced, maintenanceStatus } from './maintenance.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
let securityFile = {};
try { securityFile = JSON.parse(await readFile(path.join(root, 'data', 'security.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read data/security.json. Repair this file before starting.'); }
const security = securitySettings(securityFile);
let dashboardConfig = {};
try { dashboardConfig = JSON.parse(await readFile(path.join(root, 'data', 'dashboard.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read data/dashboard.json. Repair this file before starting.'); }
if (!dashboardConfig || typeof dashboardConfig !== 'object' || Array.isArray(dashboardConfig)
  || Object.keys(dashboardConfig).some(key => key !== 'heading')) throw new Error('Invalid data/dashboard.json. Only heading is supported.');
const dashboardHeading = dashboardConfig.heading ?? 'Printer dashboard';
if (typeof dashboardHeading !== 'string' || !dashboardHeading.trim() || dashboardHeading.trim().length > 100
  || /[\r\n]/.test(dashboardHeading)) throw new Error('Dashboard heading must be a single line of 1–100 characters.');
const configFile = path.join(root, 'data', 'printers.json');
const historyFile = path.join(root, 'data', 'history.json');
const historyObservations = new Map();
let history = createHistory();
try { history = JSON.parse(await readFile(historyFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read data/history.json. Repair this file before starting.'); }
if (history.version !== 1 || !Array.isArray(history.runs)) throw new Error('Invalid print history.');
let historyWrites = Promise.resolve();
let historyStorageError = '';
let historySaving = false;
function saveHistory() {
  const content = JSON.stringify(history, null, 2);
  const write = historyWrites.catch(() => {}).then(async () => {
    await mkdir(path.dirname(historyFile), { recursive: true, mode: 0o700 });
    await writeFile(`${historyFile}.tmp`, content, { mode: 0o600 });
    await rename(`${historyFile}.tmp`, historyFile);
  });
  historyWrites = write;
  return write.then(() => { historyStorageError = ''; }, () => { historyStorageError = 'Print history could not be saved on this Mac.'; throw new Error(historyStorageError); });
}
const maintenanceFile = path.join(root, 'data', 'maintenance.json');
const port = Number(process.env.PORT || 3000);
let config = {};
try { config = JSON.parse(await readFile(configFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read data/printers.json. Repair this file before starting.'); }
for (const printer of MODELS) config[printer.id] = validateConfig(config[printer.id] || { host: printer.defaultHost });
for (const printer of LASER_MODELS) config[printer.id] = validateConfig(config[printer.id] || {});
const laserSamples = new Map();
const laserQueues = new Map();
let queuesPolling = false;
async function pollLaserQueues() {
  if (queuesPolling) return;
  queuesPolling = true;
  try {
    await Promise.all(LASER_MODELS.map(async printer => {
      const settings = config[printer.id];
      if (!settings.host) return;
      let queue;
      try { queue = await readPrinterQueue(settings, printer); }
      catch (error) { queue = { available: false, jobs: [], checkedAt: new Date().toISOString(), message: error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Cannot reach the printer queue. Check its power and connection.' : error.message }; }
      if (settings === config[printer.id]) laserQueues.set(printer.id, queue);
    }));
  } finally { queuesPolling = false; }
}
const queueInterval = setInterval(pollLaserQueues, 10000);
queueInterval.unref();
void pollLaserQueues();
let laserPolling = false;
async function pollLaserPrinters() {
  if (laserPolling) return;
  laserPolling = true;
  try {
    await Promise.all(LASER_MODELS.map(async printer => {
      const settings = config[printer.id];
      if (!settings.host) return;
      const previous = laserSamples.get(printer.id);
      let sample;
      try {
        sample = { ...await readBrotherPrinter(settings, printer), connected: true, lastSeen: new Date().toISOString(), message: '' };
      } catch (error) {
        sample = { connected: false, state: 'Unavailable', health: 'unknown', lastSeen: previous?.lastSeen || null, message: error.message };
      }
      if (settings === config[printer.id]) laserSamples.set(printer.id, sample);
    }));
  } finally { laserPolling = false; }
}
function laserPrinters() {
  return LASER_MODELS.map(printer => ({ ...printer, host: config[printer.id].host,
    queue: laserQueues.get(printer.id) || { available: false, jobs: [], message: config[printer.id].host ? 'Reading printer queue…' : 'Set the printer’s IP address in Laserjets → Settings.' },
    ...(laserSamples.get(printer.id) || { connected: false, state: config[printer.id].host ? 'Connecting' : 'Not configured', health: 'unknown', message: config[printer.id].host ? 'Waiting for the first reading.' : 'Add the printer’s IP address in Settings.' }) }));
}
const laserInterval = setInterval(pollLaserPrinters, 30000);
laserInterval.unref();
void pollLaserPrinters();
const samples = new Map();
const observations = new Map();
const cloud = new CloudMonitor(() => config, { allowInsecureMqtt: security.allowInsecureMqtt });
const cloudEnabled = process.env.FLASHFORGE_CLOUD !== 'off';
if (cloudEnabled) cloud.start();
let maintenance = {};
try { maintenance = JSON.parse(await readFile(maintenanceFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read data/maintenance.json. Repair this file before starting.'); }
for (const printer of MODELS) {
  maintenance[printer.id] ||= createRecord();
  const record = upgradeRecord(maintenance[printer.id]);
  if (!Number.isFinite(record.observedSeconds) || record.observedSeconds < 0 || !Array.isArray(record.serviceHistory)) throw new Error('Invalid maintenance data.');
}
let maintenanceWrites = Promise.resolve();
let storageError = '';
function saveMaintenance() {
  const content = JSON.stringify(maintenance, null, 2);
  const write = maintenanceWrites.catch(() => {}).then(async () => {
    await mkdir(path.dirname(maintenanceFile), { recursive: true, mode: 0o700 });
    await writeFile(`${maintenanceFile}.tmp`, content, { mode: 0o600 });
    await rename(`${maintenanceFile}.tmp`, maintenanceFile);
  });
  maintenanceWrites = write;
  return write.then(() => { storageError = ''; }, () => { storageError = 'Maintenance records could not be saved on this Mac.'; throw new Error(storageError); });
}
let polling = false;
let saving = false;
let maintenanceSaving = false;

async function poll() {
  if (polling) return;
  polling = true;
  try {
    await Promise.all(MODELS.map(async printer => {
      const settings = config[printer.id];
      if (!settings?.host) return;
      const previous = samples.get(printer.id);
      let sample = cloudEnabled ? cloud.get(printer.id) : null;
      if (!sample) {
        try {
          if (printer.tools > 1 && (!settings.serialNumber || !settings.checkCode)) throw new Error(cloud.status.message);
          const detail = printer.id === 'ad5m' && settings.serialNumber
            ? await readPrinter(settings, printer).then(d => ({ ...d, transport: 'Local status · Cloud stays enabled' })).catch(() => readTcpPrinter(settings, printer))
            : await (printer.tools === 1 ? readTcpPrinter(settings, printer) : readPrinter(settings, printer));
          sample = { ...detail, connected: true, lastSeen: new Date().toISOString(), message: '' };
        } catch (error) {
          sample = { connected: false, state: printer.tools > 1 ? 'Waiting for cloud status' : 'Unavailable', health: 'unknown', lastSeen: previous?.lastSeen || null, message: error.message };
        }
      }
      if (settings === config[printer.id]) {
        samples.set(printer.id, sample);
        if (!sample.connected || sample.lastSeen !== previous?.lastSeen) {
          const observedAt = sample.connected ? Date.parse(sample.lastSeen) : Date.now();
          historyObservations.set(printer.id, observeHistory(history, printer.id, historyObservations.get(printer.id), sample, observedAt));
          observations.set(printer.id, accrue(maintenance[printer.id], observations.get(printer.id), sample, observedAt));
        }
      }
    }));
    await Promise.all([saveMaintenance().catch(() => {}), saveHistory().catch(() => {})]);
  } finally { polling = false; }
}
const interval = setInterval(poll, 5000);
interval.unref();
void poll();

const cameras = Object.fromEntries(['a5mp', 'c5', 'c5p'].map(id => [id,
  new ObicoMonitor(root, () => samples.get(id), () => history.runs.findLast(r => r.printerId === id && r.status === 'active')?.id || samples.get(id)?.job || null, id),
]));
const externalCameras = Object.fromEntries(['ad5m', 'a5mp', 'c5', 'c5p'].map(id => [id,
  new ObicoMonitor(root, () => samples.get(id), () => history.runs.findLast(r => r.printerId === id && r.status === 'active')?.id || samples.get(id)?.job || null, id, 'tapo-c120'),
]));
// Keep the experimental gap check available, but opt in explicitly to run it.
const heightMonitor = new GapMonitor(root, () => samples.get('a5mp'), cameras.a5mp.getJobKey, cameras.a5mp.enabled && process.env.FLASHFORGE_GAP === 'on');
await heightMonitor.load();
cameras.a5mp.gap = heightMonitor;
heightMonitor.start();
let heightSaving = false;
for (const camera of [...Object.values(cameras), ...Object.values(externalCameras)]) camera.start();

function printers(localTools = false) {
  return MODELS.map(printer => {
    const settings = config[printer.id] || {};
    const configured = Boolean(settings.host);
    return { ...printer, host: settings.host || '', configured,
      maintenance: viewerMaintenance(maintenanceStatus(maintenance[printer.id], cloudEnabled || printer.tools === 1 || Boolean(settings.serialNumber && settings.checkCode)), localTools),
      ...(configured ? samples.get(printer.id) || { connected: false, state: 'Connecting', health: 'unknown', message: 'Waiting for the first reading.' } : { connected: false, state: 'Not connected', health: 'unknown', message: 'Add this printer’s connection details.' }) };
  });
}
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function json(res, status, value) { res.writeHead(status, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let content = '';
  for await (const chunk of req) { content += chunk; if (content.length > 4096) throw new Error('Settings request is too large.'); }
  try { return JSON.parse(content); } catch { throw new Error('Invalid settings request.'); }
}
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/gcode.js', ['gcode.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
assets.set('/height.js', ['height.js', 'text/javascript']);
const server = http.createServer(async (req, res) => {
  // Exact Host/Origin checks restrict dashboard access to this Mac and its LAN.
  const accessError = requestAccessError(req, port, lanAddresses(), security);
  if (accessError) return json(res, 403, { error: accessError });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/height/a5mp') return json(res, 200, heightMonitor.view());
    const heightReference = url.pathname.match(/^\/api\/height\/a5mp\/reference\/([a-f0-9-]{36})$/);
    if (req.method === 'GET' && (url.pathname === '/api/height/a5mp/image' || heightReference)) {
      const frozen = heightMonitor.frozen;
      const image = heightReference ? (frozen?.id === heightReference[1] && Date.now()-frozen.createdAt <= 900000 ? frozen.image : null) : heightMonitor.image;
      if (!image) return json(res, 404, { error: 'No current reference image. Capture a fresh reference.' });
      res.writeHead(200, { ...headers, 'Content-Type': 'image/jpeg' });
      return res.end(image);
    }
    if ((req.method === 'POST' && url.pathname === '/api/height/a5mp/reference') || (req.method === 'PUT' && url.pathname === '/api/height/a5mp/calibration')) {
      if (!canUseLocalTools(req, port)) return json(res, 403, { error: 'Mark the gap reference at localhost on the dashboard Mac.' });
      if (req.method === 'POST') return json(res, 200, heightMonitor.freeze());
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Send JSON calibration data.' });
      const value = await body(req);
      if (heightSaving) return json(res, 409, { error: 'Calibration is already being saved.' });
      heightSaving = true;
      try { await heightMonitor.calibrate(value); }
      finally { heightSaving = false; }
      return json(res, 200, { saved: true, height: heightMonitor.view() });
    }
    if (req.method === 'GET' && url.pathname === '/api/printers') return json(res, 200, { dashboardHeading: dashboardHeading.trim(), capabilities: { localTools: canUseLocalTools(req, port) }, camera: externalCameras.ad5m.view(), cameras: Object.fromEntries(Object.entries(cameras).map(([id, camera]) => [id, camera.view()])), externalCameras: Object.fromEntries(Object.entries(externalCameras).map(([id, camera]) => [id, camera.view()])), cloud: cloud.status, printers: printers(canUseLocalTools(req, port)), laserPrinters: laserPrinters(), checkedAt: new Date().toISOString(), storageError: [storageError, historyStorageError].filter(Boolean).join(' '), history: history.runs.map(timingView).reverse() });
    const cameraMatch = url.pathname.match(/^\/api\/camera\/(ad5m|a5mp|c5|c5p)\/(tapo\/)?image$/);
    if (req.method === 'GET' && cameraMatch) {
      const camera = (cameraMatch[2] ? externalCameras : cameras)[cameraMatch[1]];
      if (!camera?.image) return json(res, 404, { error: 'No camera image has been analyzed yet.' });
      res.writeHead(200, { ...headers, 'Content-Type': 'image/jpeg' });
      return res.end(camera.image);
    }
    if (req.method === 'POST' && url.pathname === '/api/cloud/reconnect') { cloud.reconnect(); return json(res, 200, { reconnecting: true }); }
    const historyMatch = url.pathname.match(/^\/api\/history\/([a-f0-9-]{36})$/);
    if ((req.method === 'POST' && url.pathname === '/api/history') || (req.method === 'PUT' && historyMatch)) {
      if (req.method === 'POST' && !canUseLocalTools(req, port)) return json(res, 403, { error: 'Add past print is available only at localhost on the dashboard Mac.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Send JSON timing data.' });
      const value = await body(req);
      if (historySaving) return json(res, 409, { error: 'Another timing record is being saved. Please try again.' });
      let run;
      let before;
      if (historyMatch) {
        run = history.runs.find(r => r.id === historyMatch[1]);
        if (!run) return json(res, 404, { error: 'Print record not found.' });
        before = { estimate: run.estimate, actualOverrideSeconds: run.actualOverrideSeconds, outcomeOverride: run.outcomeOverride };
        setTiming(run, value);
      } else run = addManualRun(history, value, MODELS.map(p => p.id));
      historySaving = true;
      try { await saveHistory(); }
      catch (error) {
        if (before) Object.assign(run, before);
        else history.runs = history.runs.filter(r => r !== run);
        throw error;
      } finally { historySaving = false; }
      return json(res, 200, { saved: true, run: timingView(run) });
    }
    const maintenanceMatch = url.pathname.match(/^\/api\/printers\/(ad5m|a5mp|c5|c5p)\/(maintenance|serviced|baseline|baseline-alignment)$/);
    if (maintenanceMatch && req.method === 'PUT') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Send JSON settings.' });
      const value = await body(req);
      if (maintenanceSaving) return json(res, 409, { error: 'Another reminder is being saved. Please try again.' });
      const record = maintenance[maintenanceMatch[1]];
      const before = structuredClone(record);
      if (maintenanceMatch[2] === 'serviced') markServiced(record, value.id);
      else if (maintenanceMatch[2] === 'baseline') setBaseline(record, value);
      else if (maintenanceMatch[2] === 'baseline-alignment') alignInitialReminders(record, value.mode);
      else setSchedule(record, value);
      maintenanceSaving = true;
      try { await saveMaintenance(); }
      catch (error) {
        record.schedules = before.schedules;
        record.baseline = before.baseline;
        record.baselineHistory = before.baselineHistory;
        record.serviceHistory = before.serviceHistory;
        throw error;
      }
      finally { maintenanceSaving = false; }
      return json(res, 200, { saved: true });
    }
    const match = url.pathname.match(/^\/api\/printers\/(ad5m|a5mp|c5|c5p|mfc_l2710dw|hl_l3270cdw)\/settings$/);
    if (match && req.method === 'GET') {
      if (!canUseLocalTools(req, port)) return json(res, 403, { error: 'Connection settings are available only at localhost on the dashboard Mac.' });
      const settings = config[match[1]] || {};
      return json(res, 200, { host: settings.host || '', serialNumber: settings.serialNumber || '', hasAccessCode: Boolean(settings.checkCode) });
    }
    if (match && req.method === 'PUT') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Send JSON settings.' });
      if (saving) return json(res, 409, { error: 'Another save is in progress. Please try again.' });
      const incoming = await body(req);
      if (saving) return json(res, 409, { error: 'Another save is in progress. Please try again.' });
      const settings = validateConfig(incoming);
      if (!settings.checkCode) settings.checkCode = config[match[1]]?.checkCode || '';
      if (!settings.host) throw new Error('Enter the printer’s IP address.');
      if (!settings.serialNumber) settings.serialNumber = config[match[1]]?.serialNumber || '';
      saving = true;
      try {
        const next = { ...config, [match[1]]: settings };
        await mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
        await writeFile(`${configFile}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(`${configFile}.tmp`, configFile);
        config = next;
        samples.delete(match[1]);
        laserSamples.delete(match[1]);
        laserQueues.delete(match[1]);
        observations.delete(match[1]);
        historyObservations.delete(match[1]);
      } finally { saving = false; }
      void poll();
      void pollLaserPrinters();
      void pollLaserQueues();
      return json(res, 200, { saved: true });
    }
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [file, type] = assets.get(url.pathname);
      const content = await readFile(path.join(root, 'dist', file));
      res.writeHead(200, { ...headers, 'Content-Type': `${type}; charset=utf-8` });
      return res.end(content);
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (error) {
    return json(res, 400, { error: error.code ? 'Could not save settings on this Mac.' : error.message });
  }
});
server.listen(port, security.allowLanReadOnly ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Flashforge Health on this Mac: http://localhost:${port}`);
  if (security.allowLanReadOnly) for (const address of lanAddresses()) console.log(`Flashforge Health on your LAN (read-only): http://${address}:${port}`);
});
function stop() { heightMonitor.stop(); for (const camera of [...Object.values(cameras), ...Object.values(externalCameras)]) camera.stop(); cloud.stop(); clearInterval(interval); clearInterval(laserInterval); clearInterval(queueInterval); server.close(); void saveMaintenance().catch(() => {}); void saveHistory().catch(() => {}); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
