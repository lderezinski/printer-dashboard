// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import ipp from 'ipp';
import { validateConfig } from './printer.mjs';

const JOB_LIMIT = 100;
const MAX_RESPONSE = 256 * 1024;
const states = { pending: 'Queued', 'pending-held': 'Held', processing: 'Printing', 'processing-stopped': 'Stopped', canceled: 'Cancelled', aborted: 'Aborted', completed: 'Completed' };
const stateCodes = { 3: 'pending', 4: 'pending-held', 5: 'processing', 6: 'processing-stopped', 7: 'canceled', 8: 'aborted', 9: 'completed' };
const text = value => typeof value === 'string' ? value.split('\u001e').at(-1).replace(/\0/g, '').slice(0, 255) : '';
const count = value => Number.isInteger(value) && value >= 0 ? value : null;

export function normalizeQueue(response) {
  if (!response.statusCode?.startsWith('successful-ok')) throw new Error('Printer queue access was not accepted.');
  const group = response['job-attributes-tag'];
  const rows = group === undefined ? [] : Array.isArray(group) ? group : [group];
  const jobs = rows.slice(0, JOB_LIMIT).flatMap(row => {
    if (!row || typeof row !== 'object' || !Number.isInteger(row['job-id']) || row['job-id'] < 1) throw new Error('Printer returned an invalid queue entry.');
    const rawState = stateCodes[row['job-state']] || row['job-state'];
    if (['canceled', 'aborted', 'completed'].includes(rawState)) return [];
    const sheets = count(row['job-media-sheets']);
    const sheetsDone = count(row['job-media-sheets-completed']);
    const useSheets = sheets !== null || sheetsDone !== null;
    return [{ id: row['job-id'], name: text(row['job-name']) || `Job ${row['job-id']}`,
      state: states[rawState] || 'Unknown', health: ['pending-held', 'processing-stopped'].includes(rawState) ? 'warning' : states[rawState] ? 'ok' : 'unknown',
      completed: useSheets ? sheetsDone : count(row['job-impressions-completed']),
      total: useSheets ? sheets : count(row['job-impressions']), unit: useSheets ? 'sheets' : 'impressions' }];
  });
  return { jobs, limited: rows.length >= JOB_LIMIT };
}

async function request(host, operation, attributes, fetcher) {
  const id = Math.floor(Math.random() * 0x7ffffffe) + 1;
  const body = ipp.serialize({ version: '1.1', id, operation, 'operation-attributes-tag': {
    'attributes-charset': 'utf-8', 'attributes-natural-language': 'en',
    'printer-uri': `ipp://${host}:631/ipp/print`, ...attributes,
  } });
  const response = await fetcher(`http://${host}:631/ipp/print`, {
    method: 'POST', headers: { 'Content-Type': 'application/ipp' }, body,
    signal: AbortSignal.timeout(4000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`Printer queue returned HTTP ${response.status}.`);
  if (!response.body) throw new Error('Printer returned no queue response.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESPONSE) throw new Error('Printer queue response is too large.');
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length < 9 || ![1, 2].includes(buffer[0]) || buffer.at(-1) !== 3 || buffer.readInt32BE(4) !== id) throw new Error('Invalid printer queue response.');
  const status = buffer.readUInt16BE(2);
  if (status > 0xff) throw new Error('Printer queue access is unavailable or not permitted.');
  try {
    const parsed = ipp.parse(buffer);
    if (!parsed['operation-attributes-tag']?.['attributes-charset']) throw new Error('Missing response attributes.');
    return parsed;
  } catch { throw new Error('Printer returned an unreadable queue response.'); }
}

export async function readPrinterQueue(config, printer, fetcher = fetch) {
  validateConfig(config);
  if (!config.host) throw new Error('Set the printer’s IP address in Laserjets → Settings.');
  const identity = await request(config.host, 'Get-Printer-Attributes', { 'requested-attributes': ['printer-make-and-model'] }, fetcher);
  const model = text(identity['printer-attributes-tag']?.['printer-make-and-model']);
  if (!model.toLowerCase().includes(printer.model.toLowerCase())) throw new Error(`This address does not report ${printer.model}. Check Laserjets → Settings.`);
  const result = await request(config.host, 'Get-Jobs', {
    'which-jobs': 'not-completed', 'my-jobs': false, limit: JOB_LIMIT,
    'requested-attributes': ['job-id', 'job-name', 'job-state', 'job-media-sheets', 'job-media-sheets-completed', 'job-impressions', 'job-impressions-completed'],
  }, fetcher);
  return { ...normalizeQueue(result), available: true, checkedAt: new Date().toISOString(), message: '' };
}
