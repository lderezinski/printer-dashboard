// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
// This module deliberately does not reuse the private dashboard's HTML or JSON.
import { mkdir, writeFile, rename, rm, lstat, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REFRESH_SECONDS = 60;
export function timestampTone(value, now = Date.now()) {
  const age = now - Date.parse(value);
  return !Number.isFinite(age) || age < 0 ? 'unknown' : age <= 70000 ? 'green' : age <= 300000 ? 'yellow' : 'red';
}
// A clock-only script keeps even an old exported file honest after a reload.
// It cannot fetch data, call APIs, or perform dashboard actions.
export const TIMESTAMP_SCRIPT = `(() => {
  const tone = ${timestampTone.toString()};
  const update = () => {
    const now = Date.now();
    for (const element of document.querySelectorAll('time[data-age]')) {
      element.dataset.age = tone(element.dateTime, now);
    }
  };
  update();
  setInterval(update, 1000);
})();`;
export const PUBLIC_CSP = `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(TIMESTAMP_SCRIPT).digest('base64')}'; connect-src 'none'; base-uri 'none'; form-action 'none'`;
export const PUBLIC_IMAGE = /^(?:ad5m-tapo|(?:a5mp|c5|c5p)-integrated)-[a-f0-9]{64}\.webp$/;
const models = [['ad5m', 'AD5M'], ['a5mp', 'A5MP'], ['c5', 'C5'], ['c5p', 'C5P']];
const states = { ready: 'Ready', printing: 'Printing', pause: 'Paused', paused: 'Paused', error: 'Error', completed: 'Completed', heating: 'Heating', busy: 'Busy', pausing: 'Pausing', canceling: 'Canceling', calibrate_doing: 'Calibrating', downloading: 'Downloading', cloud_slicing: 'Slicing', sending: 'Sending', unzipping: 'Unzipping' };
const cameraStates = { clear: 'No spaghetti detected', suspect: 'Inspect image', warning: 'Check print', idle: 'No active print', starting: 'Waiting for image', unavailable: 'Check unavailable' };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const timestamp = value => typeof value === 'string' ? Date.parse(value) : typeof value === 'number' ? value : NaN;
const fresh = (value, now, ttl) => Number.isFinite(timestamp(value)) && now >= timestamp(value) && now - timestamp(value) <= ttl;
const iso = value => Number.isFinite(timestamp(value)) ? new Date(timestamp(value)).toISOString() : null;
const duration = seconds => seconds < 60 ? 'Less than 1 min' : `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}h ` : ''}${Math.floor(seconds % 3600 / 60)}m`;
const time = (value, now) => value ? `<time datetime="${escape(value)}"${now === undefined ? '' : ` data-age="${timestampTone(value, now)}"`}>${escape(new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZoneName: undefined }))}</time>` : 'Not available';

export function publicSnapshot(data, now = Date.now()) {
  const available = Array.isArray(data?.printers) && fresh(data.checkedAt, now, 15000);
  const printers = models.map(([id, name]) => {
    const source = available ? data.printers.find(p => p?.id === id) : null;
    const connected = source?.connected === true && fresh(source.lastSeen, now, 15000);
    const printing = connected && source.rawState === 'printing';
    const rawState = connected && Object.hasOwn(states, source.rawState) ? source.rawState : null;
    const remaining = printing ? number(source.remaining) : null;
    const progress = connected && ['printing', 'pause', 'paused', 'completed', 'heating', 'pausing', 'error'].includes(rawState) ? number(source.progress) : null;
    const due = available && Array.isArray(source?.maintenance?.schedules) ? source.maintenance.schedules.filter(s => s?.due === true).length : null;
    const recovering = !connected && source?.recovering === true && fresh(source.lastSeen, now, 70000);
    return { id, name, connected, printing, state: connected ? states[rawState] || 'Unknown' : recovering ? 'Reconnecting' : 'Unavailable',
      warning: connected && ['pause', 'paused', 'pausing', 'error'].includes(rawState),
      job: connected && ['printing', 'pause', 'paused', 'heating', 'pausing'].includes(rawState) && typeof source?.job === 'string' ? source.job.split(/[\\/]/).at(-1).slice(0, 255) : '',
      lastSeen: iso(source?.lastSeen), remaining, progress: progress === null ? null : Math.min(100, progress),
      finish: remaining !== null && remaining < 31536000 ? iso(timestamp(source.lastSeen) + remaining * 1000) : null, due };
  });
  const cameras = [];
  for (const id of ['a5mp', 'ad5m', 'c5', 'c5p']) {
    for (const source of [id === 'ad5m' ? 'tapo' : 'integrated']) {
      const camera = source === 'tapo' ? data?.externalCameras?.[id] : data?.cameras?.[id];
      if (camera?.enabled !== true) continue;
      const printer = printers.find(p => p.id === id);
      const current = available && printer.printing && ['clear', 'suspect', 'warning'].includes(camera.state) && fresh(camera.capturedAt, now, 60000);
      const state = current ? camera.state : available && printer.connected && !printer.printing ? 'idle' : 'unavailable';
      const history = current && Array.isArray(camera.history) ? camera.history.slice(0, number(camera.frames) || 0).filter(h => ['clear', 'suspect', 'warning'].includes(h?.state)) : [];
      cameras.push({ id, source, name: `${printer.name} · ${source === 'tapo' ? 'Tapo C120' : 'Integrated camera'}`,
        state, label: cameraStates[state], capturedAt: iso(camera.capturedAt),
        checked: history.length, positive: history.filter(h => ['suspect', 'warning'].includes(h.state)).length,
        image: null, current });
    }
  }
  return { capturedAt: new Date(now).toISOString(), available, printers, cameras };
}

const css = `
:root{color-scheme:dark;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e6eaf0;background:#101419}
time[data-age="green"]{color:#91e9bc}time[data-age="yellow"]{color:#ffda8f}time[data-age="red"]{color:#ffb6bb}time[data-age="unknown"]{color:#a9b5c4}
.print-file{min-width:0}.print-filename{overflow-wrap:anywhere;white-space:normal;word-break:normal}
*{box-sizing:border-box}body{margin:0}main{max-width:1240px;margin:auto;padding:40px 28px}h1,h2,h3,p{margin-top:0}h1{font-size:2.5rem;line-height:1.15;letter-spacing:-.035em;margin-bottom:12px}h2{font-size:1.4rem;margin-bottom:8px}h3{font-size:1.1rem;margin-bottom:6px}header{display:flex;justify-content:space-between;align-items:start;gap:24px;margin-bottom:28px}.eyebrow{color:#a9b5c4;text-transform:uppercase;letter-spacing:.12em;font-size:.875rem;margin-bottom:8px}.help,figcaption{color:#a9b5c4;font-size:.875rem}.snapshot{text-align:right;max-width:370px}.snapshot strong{display:block;color:#e6eaf0}.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-block:1px solid #303a47;padding:20px 0;gap:20px;margin-bottom:32px}.summary strong{display:block;font-size:2rem;font-weight:550}.summary span{color:#a9b5c4;font-size:.875rem}.summary small{font-size:1rem;color:#a9b5c4}.completion-order{list-style:none;padding:0;display:grid;gap:12px;margin-bottom:36px}.completion-row{display:grid;grid-template-columns:32px minmax(120px,1fr) minmax(170px,1fr) minmax(130px,.7fr);gap:20px;align-items:center;background:#191f27;border:1px solid #303a47;border-radius:12px;padding:22px}.rank{color:#a9b5c4;font-size:1.3rem}.completion-row p{margin:4px 0}.estimate{font-size:1.5rem;display:block;font-weight:600;font-variant-numeric:tabular-nums}.ok{color:#91e9bc}.warning{color:#ffda8f}.error{color:#ffb6bb}.unknown{color:#a9b5c4}.badge{display:inline-block;background:#293341;padding:3px 9px;border-radius:5px;font-size:.875rem}.camera{border:1px solid #303a47;background:#191f27;border-radius:12px;padding:22px;margin:20px 0}.camera-heading{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}.camera-body{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(220px,1fr);gap:24px;margin-top:18px}figure{margin:0;min-width:0}img{display:block;width:100%;height:auto;border-radius:8px}figcaption{margin-top:8px}.placeholder{display:grid;place-items:center;min-height:160px;padding:24px;background:#101419;border-radius:8px;color:#a9b5c4}.notice{border-left:3px solid #ffda8f;background:#302a1e;padding:16px;margin-bottom:28px}footer{border-top:1px solid #303a47;margin-top:32px;padding-top:18px}time{font-variant-numeric:tabular-nums}progress{display:block;width:100%;height:7px;accent-color:#78c4ff;margin-top:10px}
@media(max-width:760px){main{padding:28px 18px}header{display:block}.snapshot{text-align:left;max-width:none}.summary{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.completion-row{grid-template-columns:24px minmax(0,1fr);gap:12px}.completion-row>div{grid-column:2}.camera-body{grid-template-columns:1fr}.camera{padding:18px}h1{font-size:2rem}}@media(max-width:380px){.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

export function renderStaticHome(snapshot) {
  const { printers, cameras } = snapshot;
  const capturedAt = Date.parse(snapshot.capturedAt);
  const ordered = [...printers].sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity));
  const due = snapshot.available ? printers.reduce((sum, p) => sum + (p.due || 0), 0) : null;
  const attention = printers.filter(p => p.warning || p.due || cameras.some(c => c.id === p.id && ['suspect', 'warning'].includes(c.state))).length;
  const summary = [['Connected', snapshot.available ? `${printers.filter(p => p.connected).length}<small> / 4</small>` : '—'], ['Printing', snapshot.available ? printers.filter(p => p.printing).length : '—'], ['Need attention', snapshot.available ? attention : '—'], ['Unavailable', printers.filter(p => !p.connected).length], ['Maintenance due', due ?? '—']];
  const rows = ordered.map((p, index) => `<li class="completion-row"><span class="rank">${p.remaining !== null ? index + 1 : '—'}</span><div><h3>${escape(p.name)}</h3><p class="${p.warning ? 'warning' : p.connected ? 'ok' : 'unknown'}">${escape(p.state)}</p>${p.progress !== null ? `<p class="help">${Math.round(p.progress)}% complete</p><progress max="100" value="${p.progress}" aria-label="${escape(p.name)} print progress"></progress>` : ''}<p class="help">Last report: ${time(p.lastSeen, capturedAt)}</p></div><div><span class="help">Estimated remaining at last report</span><strong class="estimate">${p.remaining !== null ? duration(p.remaining) : p.state === 'Ready' ? 'No active print' : 'Not available'}</strong>${p.finish ? `<p class="help">Finish around ${time(p.finish)}</p>` : ''}</div><div class="print-file"><strong>Print file</strong><p class="print-filename">${escape(p.job || (p.state === 'Ready' ? 'No active print' : 'Not available'))}</p></div></li>`).join('');
  const views = cameras.map(c => `<article class="camera"><div class="camera-heading"><h3>${escape(c.name)}</h3><span class="badge ${c.state === 'clear' ? 'ok' : c.state === 'warning' ? 'error' : c.state === 'suspect' ? 'warning' : 'unknown'}">${escape(c.label)}</span></div><div class="camera-body"><figure>${typeof c.image === 'string' && PUBLIC_IMAGE.test(c.image) ? `<img src="images/${c.image}" alt="${escape(c.name)} snapshot with detection markings" loading="lazy">` : '<div class="placeholder">No current camera image available</div>'}<figcaption>Image captured: ${time(c.capturedAt, capturedAt)}</figcaption></figure><div><p>${c.checked ? `${c.positive} positive in ${c.checked} recent camera checks.` : 'Recent camera checks unavailable.'}</p></div></div></article>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="${REFRESH_SECONDS}"><meta http-equiv="Content-Security-Policy" content="${escape(PUBLIC_CSP)}"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex, nofollow"><meta name="description" content="Printer status and camera snapshots, updated once a minute."><title>3D printer health · Public snapshot</title><style>${css}</style></head>
<body><main><header><div><p class="eyebrow">Printer dashboard</p><h1>3D printer health</h1></div><div class="snapshot help"><strong>Snapshot captured at ${time(snapshot.capturedAt, capturedAt)}</strong><p>Page refreshes every minute. All readings are from the timestamps shown; this is not a live feed.</p></div></header>
${snapshot.available ? '' : '<p class="notice" role="status">Dashboard status unavailable. Waiting for the next snapshot.</p>'}
<section class="summary" aria-label="Workshop overview">${summary.map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('')}</section>
<section aria-labelledby="finishing"><h2 id="finishing">Finishing next</h2><p class="help">Shortest estimated time first. Estimates may change during printing.</p><ol class="completion-order">${rows}</ol></section>
<section aria-labelledby="cameras"><h2 id="cameras">Camera checks</h2>${views || '<p class="help">Camera checks unavailable.</p>'}</section>
<footer class="help">Snapshot times use ${escape(Intl.DateTimeFormat().resolvedOptions().timeZone)}.</footer></main><script>${TIMESTAMP_SCRIPT}</script></body></html>\n`;
}

export function dashboardOrigin(value = 'http://127.0.0.1:3000') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('The snapshot source must be the dashboard on this Mac (http://127.0.0.1:3000).');
  return url.origin;
}

async function readResponse(fetcher, url, limit, type) {
  const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith(type)) throw new Error('Snapshot input unavailable.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Snapshot input too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function optimizeCameraImage(jpeg) {
  return new Promise((resolve, reject) => {
    const python = fileURLToPath(new URL('../data/obico-venv/bin/python', import.meta.url));
    const helper = fileURLToPath(new URL('./static-image.py', import.meta.url));
    const child = execFile(python, [helper], { encoding: 'buffer', timeout: 10000, maxBuffer: 4_000_000 }, (error, stdout) => error ? reject(new Error('Public image conversion unavailable.')) : resolve(stdout));
    child.stdin.on('error', () => {}); // execFile reports a failed/early-exiting helper.
    child.stdin.end(jpeg);
  });
}

async function atomicWrite(outputDirectory, destination, content) {
  const temporary = path.join(path.dirname(outputDirectory), `.static-site-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

export async function cleanupStaticImages(imageDirectory, currentImages = new Set()) {
  const groups = new Map();
  for (const filename of await readdir(imageDirectory)) {
    if (!PUBLIC_IMAGE.test(filename)) continue;
    const info = await lstat(path.join(imageDirectory, filename));
    if (!info.isFile()) continue;
    const printer = filename.split('-')[0];
    if (!groups.has(printer)) groups.set(printer, []);
    groups.get(printer).push({ filename, modified: info.mtimeMs });
  }
  let removed = 0;
  for (const images of groups.values()) {
    // A reused content hash can be older on disk while still being the current image.
    images.sort((a, b) => Number(currentImages.has(b.filename)) - Number(currentImages.has(a.filename))
      || b.modified - a.modified || a.filename.localeCompare(b.filename));
    for (const image of images.slice(2)) {
      if (currentImages.has(image.filename)) continue;
      await rm(path.join(imageDirectory, image.filename));
      removed++;
    }
  }
  return removed;
}

export async function generateStaticSite({ outputDirectory, origin = 'http://127.0.0.1:3000', fetcher = fetch, convertImage = optimizeCameraImage, now }) {
  origin = dashboardOrigin(origin);
  let data;
  try { data = JSON.parse((await readResponse(fetcher, `${origin}/api/printers`, 8_000_000, 'application/json')).toString()); } catch { data = null; }
  const snapshot = publicSnapshot(data, now ?? Date.now());
  await mkdir(outputDirectory, { recursive: true });
  if ((await lstat(outputDirectory)).isSymbolicLink()) throw new Error('The static output directory must not be a symlink.');
  const imageDirectory = path.join(outputDirectory, 'images');
  await mkdir(imageDirectory, { recursive: true });
  if ((await lstat(imageDirectory)).isSymbolicLink()) throw new Error('The image output directory must not be a symlink.');
  let imageBytes = 0, sourceImageBytes = 0, imageFailures = 0;
  await Promise.all(snapshot.cameras.filter(c => c.current).map(async camera => {
    // Never follow URLs or paths supplied inside dashboard data.
    const route = `/api/camera/${camera.id}/${camera.source === 'tapo' ? 'tapo/' : ''}image`;
    try {
      const jpeg = await readResponse(fetcher, `${origin}${route}`, 4_000_000, 'image/jpeg');
      if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg.at(-2) !== 0xff || jpeg.at(-1) !== 0xd9) throw new Error('Invalid camera image.');
      const webp = await convertImage(jpeg);
      if (!Buffer.isBuffer(webp) || webp.length < 12 || webp.subarray(0, 4).toString() !== 'RIFF' || webp.subarray(8, 12).toString() !== 'WEBP') throw new Error('Invalid public image.');
      const filename = `${camera.id}-${camera.source}-${createHash('sha256').update(webp).digest('hex')}.webp`;
      const destination = path.join(imageDirectory, filename);
      let exists = false;
      try { const info = await lstat(destination); exists = info.isFile() && info.size === webp.length; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      // Identical content retains its name and mtime so rsync and browsers reuse it.
      if (!exists) await atomicWrite(outputDirectory, destination, webp);
      camera.image = filename;
      imageBytes += webp.length; sourceImageBytes += jpeg.length;
    } catch { imageFailures++; /* A missing image does not prevent fresh status. */ }
  }));
  // All referenced photos are complete before the new HTML becomes visible.
  const html = renderStaticHome(snapshot);
  await atomicWrite(outputDirectory, path.join(outputDirectory, 'index.html'), html);
  // Publish first, then retain only two images per printer, including the current one.
  const currentImages = new Set(snapshot.cameras.map(c => c.image).filter(Boolean));
  const removedImages = await cleanupStaticImages(imageDirectory, currentImages);
  return { available: snapshot.available, capturedAt: snapshot.capturedAt, images: currentImages.size, removedImages, imageFailures, sourceImageBytes, imageBytes, htmlBytes: Buffer.byteLength(html) };
}
