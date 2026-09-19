// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { generateStaticSite, dashboardOrigin, REFRESH_SECONDS } from './static-home.mjs';
import { syncStaticSite, validateSyncDestination } from './sync-static-site.mjs';

if (process.argv.slice(2).some(arg => arg !== '--watch')) throw new Error('Usage: node scripts/render-static-site.mjs [--watch]');
const outputDirectory = fileURLToPath(new URL('../static-site/', import.meta.url));
const origin = dashboardOrigin(process.env.STATIC_DASHBOARD_URL);
let sync = null;
try { sync = JSON.parse(await readFile(new URL('../data/static-site-sync.json', import.meta.url), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read data/static-site-sync.json.'); }
if (sync !== null && (!sync || typeof sync !== 'object' || Array.isArray(sync) || typeof sync.enabled !== 'boolean'
  || Object.keys(sync).some(key => !['enabled', 'destination'].includes(key)))) throw new Error('Invalid data/static-site-sync.json.');
if (sync?.enabled === true) validateSyncDestination(sync.destination);
let running = false;
async function render() {
  if (running) return;
  running = true;
  try {
    const result = await generateStaticSite({ outputDirectory, origin });
    console.log(`${result.capturedAt} · ${result.available ? 'Snapshot updated' : 'Dashboard unavailable; unavailable snapshot written'} · ${result.images} camera images · ${Math.round((result.htmlBytes + result.imageBytes) / 1000)} KB current page${result.imageFailures ? ` · ${result.imageFailures} images unavailable (check local camera/encoder)` : ''}`);
    if (sync?.enabled === true) {
      try {
        await syncStaticSite({ outputDirectory, destination: sync.destination });
        console.log(`${new Date().toISOString()} · Static site synced successfully`);
      } catch {
        console.error(`${new Date().toISOString()} · Static site sync failed; retrying on the next export. Check SSH connectivity and destination permissions.`);
        if (!process.argv.includes('--watch')) process.exitCode = 1;
      }
    }
  } catch {
    console.error('Static snapshot could not be written. Check output directory permissions.');
    if (!process.argv.includes('--watch')) process.exitCode = 1;
  } finally { running = false; }
}
if (process.argv.includes('--watch')) {
  const timer = setInterval(() => void render(), REFRESH_SECONDS * 1000);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => clearInterval(timer));
}
await render();
