// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect } from 'mqtt';
import { MODELS, normalize, number } from './printer.mjs';

const modelNames = { ad5m: 'Adventurer 5M', a5mp: 'Adventurer 5M Pro', c5: 'Creator 5', c5p: 'Creator 5 Pro' };
const pids = { ad5m: '0023', a5mp: '0024', c5: '0028', c5p: '0029' };
export const CLOUD_FRESH_MS = 15000;

export function validateBootstrap(data) {
  if (!data || data.error) throw new Error(data?.error || 'Invalid cloud response.');
  // The verified provider currently advertises the ordinary MQTT endpoint.
  if (!['mqtt.voxelshare.com', 'mqtt://mqtt.voxelshare.com', 'mqtt://mqtt.voxelshare.com:1883', 'mqtts://mqtt.voxelshare.com:8883'].includes(data.server)) throw new Error('Cloud broker changed; connection needs updating.');
  for (const key of ['username', 'password', 'clientId']) if (typeof data[key] !== 'string' || !data[key] || data[key].length > 8192) throw new Error('Invalid cloud credentials.');
  if (!Array.isArray(data.devices) || data.devices.length > 100) throw new Error('Invalid cloud device list.');
  const topic = v => typeof v === 'string' && v.length > 0 && v.length < 512 && !/[+#\0]/.test(v);
  if (!topic(data.userTopic)) throw new Error('Cloud status topic is unavailable.');
  for (const device of data.devices) {
    if (![device.sn, device.deviceID, device.model].every(v => typeof v === 'string' && v.length > 0 && v.length < 128) || !topic(device.gTopic)) throw new Error('Invalid cloud device identity.');
  }
  return data;
}

export function parseCloudMessage(message, devices, settings, now = Date.now()) {
  if (Buffer.byteLength(message) > 262144) return null;
  let event;
  try { event = JSON.parse(message); } catch { return null; }
  if (event?.eventType !== 'device_action' || event?.payload?.action_type !== 'device_status') return null;
  const d = event.payload.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  // Match both account identity and expected model/IP. Never attach an unrelated spool/printer.
  const device = devices.find(v => v.sn === d.sn && v.deviceID === d.deviceID);
  if (!device) return null;
  const printer = MODELS.find(p => modelNames[p.id] === device.model && pids[p.id] === d.pid && settings[p.id]?.host === d.ipAddress);
  if (!printer || devices.filter(v => v.model === device.model).length !== 1 || typeof d.status !== 'string') return null;
  const detail = { status: d.status, errorCode: d.errorCode, printFileName: d.fileName, printProgress: d.progress,
    printLayer: d.printLayer, targetPrintLayer: d.targetLayer, estimatedTime: d.estimateTime,
    rightTemp: d.rightTemperature, rightTargetTemp: d.rightTargetTemperature,
    nozzleTemps: Array.isArray(d.nozzleTemps) ? d.nozzleTemps : [], nozzleTargetTemps: Array.isArray(d.nozzleTargetTemps) ? d.nozzleTargetTemps : [],
    platTemp: d.platformCurTemperature, platTargetTemp: d.platformTargetTemperature,
    chamberTemp: d.chamberTemp, chamberTargetTemp: d.chamberTargetTemp, doorStatus: d.door, firmwareVersion: d.firmwareVersion };
  const sample = { ...normalize(detail, printer), elapsed: number(d.duration), connected: d.status !== 'offline',
    lastSeen: new Date(now).toISOString(), transport: 'Flashforge cloud · Live status', message: '' };
  if (!sample.connected) { sample.state = 'Offline'; sample.health = 'unknown'; sample.message = 'The printer reports that its cloud connection is offline.'; }
  // Only allowlisted measurements reach the app. Tokens, stream URLs and account IDs are discarded.
  return { printerId: printer.id, sample };
}

function bootstrap() {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/arch', ['-x86_64', '/usr/bin/python3', fileURLToPath(new URL('./cloud-bootstrap.py', import.meta.url))],
      { timeout: 25000, maxBuffer: 262144, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME } }, (error, stdout) => {
        let data;
        try { data = JSON.parse(stdout); } catch { return reject(new Error('Could not start the Flash Studio cloud reader on this Mac.')); }
        if (error && !data.error) return reject(new Error('Cloud connection initialization failed.'));
        try { resolve(validateBootstrap(data)); } catch (err) { reject(err); }
      });
  });
}

export class CloudMonitor {
  constructor(getSettings, { load = bootstrap, dial = connect, allowInsecureMqtt = false } = {}) {
    this.getSettings = getSettings; this.load = load; this.dial = dial;
    this.allowInsecureMqtt = allowInsecureMqtt === true;
    this.samples = new Map(); this.client = null; this.generation = 0; this.timer = null; this.stopped = true;
    this.status = { connected: false, message: 'Connecting through Flash Studio’s saved session…' };
  }
  start() { this.stopped = false; void this.open(); }
  stop() { this.stopped = true; this.generation++; clearTimeout(this.timer); this.client?.end(true); this.client = null; this.samples.clear(); }
  reconnect() { this.stop(); this.start(); }
  get(printerId, now = Date.now()) {
    const sample = this.samples.get(printerId);
    return this.status.connected && sample && now - Date.parse(sample.lastSeen) <= CLOUD_FRESH_MS ? sample : null;
  }
  async open() {
    const generation = ++this.generation;
    const current = () => !this.stopped && this.generation === generation;
    clearTimeout(this.timer);
    this.status = { connected: false, message: 'Connecting through Flash Studio’s saved session…' };
    try {
      const data = await this.load();
      if (!current()) return;
      // Never downgrade a failed TLS connection automatically or disable certificate checks.
      const client = this.dial(this.allowInsecureMqtt ? 'mqtt://mqtt.voxelshare.com:1883' : 'mqtts://mqtt.voxelshare.com:8883', { rejectUnauthorized: true, clientId: data.clientId, username: data.username, password: data.password,
        clean: true, keepalive: 30, connectTimeout: 12000, reconnectPeriod: 0, resubscribe: false, protocolVersion: 4 });
      this.client = client;
      let failed = false;
      const retry = () => {
        if (!current() || failed) return;
        failed = true; this.generation++; client.end(true); this.client = null; this.samples.clear();
        this.status = { connected: false, message: this.allowInsecureMqtt ? 'Cloud status disconnected. Retrying shortly; sign in to Flash Studio again if this persists.' : 'TLS cloud connection unavailable. Retrying without falling back to unencrypted MQTT. Check the cloud connection instructions in README.md.' };
        clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), 15000); this.timer.unref();
      };
      client.on('error', retry); client.on('close', retry);
      client.on('connect', () => {
        if (!current()) return;
        const topics = [...new Set([data.userTopic, ...data.devices.map(d => d.gTopic)])];
        client.subscribe(topics, { qos: 0 }, (error, granted) => {
          if (!current()) return;
          if (error || !granted?.length || granted.some(g => g.qos === 128)) return retry();
          this.status = { connected: true, insecureTransport: this.allowInsecureMqtt, message: this.allowInsecureMqtt ? 'Cloud connected over unencrypted MQTT (enabled in local security settings).' : 'Cloud connected · Waiting for fresh printer reports where needed.' };
          // Renew broker credentials using Flash Studio's current session. Never rotate its refresh token.
          this.timer = setTimeout(() => this.reconnect(), 30 * 60 * 1000); this.timer.unref();
        });
      });
      client.on('message', (topic, message, packet) => {
        if (!current() || packet?.retain) return;
        const report = parseCloudMessage(message, data.devices, this.getSettings());
        if (report) this.samples.set(report.printerId, report.sample);
      });
    } catch (error) {
      if (!current()) return;
      this.status = { connected: false, message: error.message };
      this.timer = setTimeout(() => this.open(), 60000); this.timer.unref();
    }
  }
}
