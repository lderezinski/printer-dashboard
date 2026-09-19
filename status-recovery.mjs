// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { readPrinter } from './printer.mjs';
import { readTcpPrinter } from './tcp-printer.mjs';

export const STATUS_FRESH_MS = 15000;
export const RECOVERING_MS = 70000;

export function freshStatus(sample, now = Date.now()) {
  const age = now - Date.parse(sample?.lastSeen);
  return sample?.connected === true && age >= 0 && age <= STATUS_FRESH_MS;
}

export function unavailableStatus(previous, message, now = Date.now()) {
  const age = now - Date.parse(previous?.lastSeen);
  const recovering = age >= 0 && age <= RECOVERING_MS;
  return { connected: false, recovering, state: recovering ? 'Reconnecting' : 'Unavailable', health: 'unknown',
    lastSeen: previous?.lastSeen || null,
    message: recovering ? 'Waiting for a fresh printer report. Retrying cloud and local status automatically.' : message };
}

export async function readRecoveringStatus(settings, printer, { cloud, previous, now = Date.now, readHttp = readPrinter, readTcp = readTcpPrinter } = {}) {
  const newest = report => freshStatus(previous, now()) && Date.parse(previous.lastSeen) > Date.parse(report.lastSeen) ? previous : report;
  const cloudSample = cloud?.get(printer.id);
  // Give Adventurers a head start on local reads before a cloud report expires.
  if (freshStatus(cloudSample, now()) && (printer.tools > 1 || now() - Date.parse(cloudSample.lastSeen) <= 5000)) return newest(cloudSample);
  try {
    if (printer.tools > 1 && (!settings.serialNumber || !settings.checkCode)) throw new Error(cloud?.status.message || 'Waiting for fresh cloud status.');
    const detail = printer.id === 'ad5m' && settings.serialNumber
      ? await readHttp(settings, printer).then(d => ({ ...d, transport: 'Local status · Cloud stays enabled' })).catch(() => readTcp(settings, printer))
      : await (printer.tools === 1 ? readTcp(settings, printer) : readHttp(settings, printer));
    return { ...detail, connected: true, lastSeen: new Date(now()).toISOString(), message: '' };
  } catch (error) {
    // A new cloud report may have arrived while local requests were in flight.
    const latest = cloud?.get(printer.id);
    if (freshStatus(latest, now())) return newest(latest);
    return unavailableStatus(previous, error.message, now());
  }
}
