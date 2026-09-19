// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { publicSnapshot, renderStaticHome, generateStaticSite, dashboardOrigin, timestampTone, TIMESTAMP_SCRIPT, PUBLIC_CSP, cleanupStaticImages } from '../scripts/static-home.mjs';

const now = Date.parse('2026-09-18T12:00:00Z');
const webp = Buffer.from('RIFF0000WEBPfixture');

test('image cleanup retains two per printer, protects reused current images and ignores unrelated files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'static-image-cleanup-'));
  const names = (printer, i) => `${printer}-${i.toString(16).padStart(64, '0')}.webp`;
  try {
    const printers = ['ad5m-tapo', 'a5mp-integrated', 'c5-integrated', 'c5p-integrated'];
    for (const printer of printers) for (let i = 1; i <= 4; i++) {
      const file = path.join(directory, names(printer, i));
      await writeFile(file, webp);
      await utimes(file, i, i);
    }
    await writeFile(path.join(directory, 'notes.txt'), 'leave alone');
    await symlink('notes.txt', path.join(directory, names('ad5m-tapo', 5)));
    assert.equal(await cleanupStaticImages(directory, new Set([names('ad5m-tapo', 1)])), 8);
    const retained = await readdir(directory);
    for (const printer of printers) {
      assert.ok(retained.includes(names(printer, 4)));
      assert.ok(retained.includes(names(printer, printer === 'ad5m-tapo' ? 1 : 3)));
      assert.ok(!retained.includes(names(printer, 2)));
    }
    assert.ok(retained.includes('notes.txt'));
    assert.ok(retained.includes(names('ad5m-tapo', 5)));
    assert.equal(await cleanupStaticImages(directory), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
const fixture = () => ({ checkedAt: new Date(now).toISOString(), dashboardHeading: 'PRIVATE-HEADING',
  printers: [{ id: 'ad5m', connected: true, rawState: 'printing', state: '<script>PRIVATE-STATE</script>', lastSeen: new Date(now - 5000).toISOString(), progress: 42, remaining: 3600,
    host: 'PRIVATE-IP', serialNumber: 'PRIVATE-SERIAL', checkCode: 'must-not-escape', job: '/PRIVATE-DIRECTORY/sample-print.3mf', message: 'PRIVATE-MESSAGE',
    maintenance: { schedules: [{ due: true, name: 'PRIVATE-TASK' }], baseline: { serialNumber: 'PRIVATE-BASELINE' } } }],
  externalCameras: { ad5m: { enabled: true, state: 'clear', capturedAt: now - 1000, imageUrl: 'https://private.invalid/PRIVATE-URL', frames: 2, history: [{ state: 'clear' }, { state: 'suspect' }], message: 'PRIVATE-CAMERA' } },
  laserPrinters: [{ id: 'mfc_l2710dw', queue: { available: true, checkedAt: new Date(now).toISOString(), jobs: [{ name: 'PRIVATE-DOCUMENT', owner: 'PRIVATE-OWNER' }] } }],
  cloud: { message: 'PRIVATE-CLOUD' }, history: [{ name: 'PRIVATE-HISTORY' }], authToken: 'PRIVATE-TOKEN' });

test('public Home uses an allowlist and has no private fields, navigation, controls, or API references', () => {
  const snapshot = publicSnapshot(fixture(), now);
  const html = renderStaticHome(snapshot);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE-'));
  assert.ok(!html.includes('PRIVATE-'));
  assert.ok(!JSON.stringify(snapshot).includes('must-not-escape'));
  assert.ok(!html.includes('must-not-escape'));
  assert.doesNotMatch(html, /<(?:a|button|form|input|nav|iframe|link)\b/i);
  assert.doesNotMatch(html, /\/api\/|fetch\(|role="tab|src="https?:/i);
  assert.match(html, /http-equiv="refresh" content="60"/);
  assert.match(html, /connect-src &#39;none&#39;/);
  assert.match(html, /42% complete/);
  assert.match(html, /class="print-filename">sample-print\.3mf/);
  assert.doesNotMatch(html.match(/<ol class="completion-order">([\s\S]*?)<\/ol>/)[1], /Maintenance|tasks due/);
  assert.doesNotMatch(html, /Laserjet|queued job|MFC-L2710DW|HL-L3270CDW/);
  assert.equal(Object.hasOwn(snapshot, 'queues'), false);
  assert.match(html, /1 positive in 2 recent camera checks/);
  assert.doesNotMatch(html, /Looks for visible spaghetti|Camera results describe the captured image/);
});

test('timestamp colors respect exact age boundaries and leave missing/future values neutral', () => {
  for (const [age, expected] of [[0, 'green'], [70000, 'green'], [70001, 'yellow'], [300000, 'yellow'], [300001, 'red'], [-1, 'unknown']]) {
    assert.equal(timestampTone(new Date(now - age).toISOString(), now), expected);
  }
  assert.equal(timestampTone('invalid', now), 'unknown');
  const data = fixture();
  data.externalCameras.ad5m.capturedAt = now - 300001;
  const snapshot = publicSnapshot(data, now);
  const html = renderStaticHome(snapshot);
  assert.match(html, /data-age="red"/);
  assert.equal(snapshot.cameras[0].current, false);
  const freshHtml = renderStaticHome(publicSnapshot(fixture(), now));
  assert.match(freshHtml, /Finish around <time datetime="[^"]+">/);
  assert.match(freshHtml, /Last report: <time datetime="[^"]+" data-age="green">/);
});

test('the hash-approved clock script ages timestamps in an old page without network requests', () => {
  const element = { dateTime: new Date(now).toISOString(), dataset: {} };
  let clock = now, tick;
  runInNewContext(TIMESTAMP_SCRIPT, {
    Date: { now: () => clock, parse: Date.parse },
    document: { querySelectorAll: selector => { assert.equal(selector, 'time[data-age]'); return [element]; } },
    setInterval: (callback, delay) => { assert.equal(delay, 1000); tick = callback; },
  });
  assert.equal(element.dataset.age, 'green');
  clock = now + 70001; tick(); assert.equal(element.dataset.age, 'yellow');
  clock = now + 300001; tick(); assert.equal(element.dataset.age, 'red');
  const html = renderStaticHome(publicSnapshot(fixture(), now));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][1], TIMESTAMP_SCRIPT);
  const hash = createHash('sha256').update(scripts[0][1]).digest('base64');
  assert.ok(PUBLIC_CSP.includes(`script-src 'sha256-${hash}'`));
  assert.ok(PUBLIC_CSP.includes("connect-src 'none'"));
});

test('camera totals use all retained checks, limited to the current detection sequence', () => {
  const data = fixture();
  const camera = data.externalCameras.ad5m;
  camera.frames = 25;
  camera.history = Array.from({ length: 12 }, (_, i) => ({ state: i >= 5 ? 'suspect' : 'clear' }));
  let snapshot = publicSnapshot(data, now);
  assert.equal(snapshot.cameras[0].checked, 12);
  assert.equal(snapshot.cameras[0].positive, 7);
  assert.match(renderStaticHome(snapshot), /7 positive in 12 recent camera checks/);
  camera.frames = 2;
  snapshot = publicSnapshot(data, now);
  assert.equal(snapshot.cameras[0].checked, 2);
  assert.equal(snapshot.cameras[0].positive, 0);
});

test('expired and future printer readings hide progress, estimates and camera results', () => {
  for (const age of [15001, -1]) {
    const data = fixture(); data.printers[0].lastSeen = new Date(now - age).toISOString();
    const snapshot = publicSnapshot(data, now);
    assert.equal(snapshot.printers[0].connected, false);
    assert.equal(snapshot.printers[0].progress, null);
    assert.equal(snapshot.printers[0].job, '');
    assert.equal(snapshot.printers[0].remaining, null);
    assert.equal(snapshot.cameras[0].current, false);
    assert.equal(snapshot.cameras[0].checked, 0);
  }
  const data = fixture(); data.checkedAt = new Date(now - 15001).toISOString();
  assert.equal(publicSnapshot(data, now).available, false);
  data.checkedAt = new Date(now).toISOString(); data.externalCameras.ad5m.capturedAt = now - 60001;
  assert.equal(publicSnapshot(data, now).cameras[0].current, false);
});

test('public page distinguishes reconnecting from unavailable without showing stale print measurements', () => {
  const data = fixture(); Object.assign(data.printers[0], { connected: false, recovering: true, lastSeen: new Date(now - 20000).toISOString() });
  const printer = publicSnapshot(data, now).printers[0];
  assert.equal(printer.state, 'Reconnecting'); assert.equal(printer.progress, null); assert.equal(printer.remaining, null);
  data.printers[0].lastSeen = new Date(now - 70001).toISOString();
  assert.equal(publicSnapshot(data, now).printers[0].state, 'Unavailable');
});

test('renderer escapes text rather than permitting markup or attribute injection', () => {
  const snapshot = publicSnapshot(fixture(), now);
  snapshot.printers[0].name = '<img src=x onerror="alert(1)">';
  snapshot.printers[0].job = '<script>alert(1)</script>.3mf';
  const html = renderStaticHome(snapshot);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;\.3mf/);
});

test('export uses fixed routes and separate images, reuses identical assets and replaces failed status', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'static-home-'));
  const outputDirectory = path.join(root, 'static-site');
  const requests = [];
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const fetcher = async (url, options) => {
    requests.push(url);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    return url.endsWith('/api/printers') ? Response.json(fixture()) : new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });
  };
  try {
    const result = await generateStaticSite({ outputDirectory, fetcher, now, convertImage: async () => webp });
    assert.equal(result.available, true); assert.equal(result.images, 1);
    assert.deepEqual(requests, ['http://127.0.0.1:3000/api/printers', 'http://127.0.0.1:3000/api/camera/ad5m/tapo/image']);
    let html = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
    assert.match(html, /src="images\/ad5m-tapo-[a-f0-9]{64}\.webp"/);
    assert.doesNotMatch(html, /data:image/);
    assert.doesNotMatch(html, /PRIVATE-/);
    assert.deepEqual((await readdir(outputDirectory)).sort(), ['images', 'index.html']);
    assert.deepEqual(await readdir(root), ['static-site']);
    const names = await readdir(path.join(outputDirectory, 'images'));
    assert.equal(names.length, 1);
    const imagePath = path.join(outputDirectory, 'images', names[0]);
    const before = await stat(imagePath);
    await generateStaticSite({ outputDirectory, fetcher, now, convertImage: async () => webp });
    assert.equal((await stat(imagePath)).mtimeMs, before.mtimeMs);
    assert.deepEqual(await readFile(imagePath), webp);
    const failed = await generateStaticSite({ outputDirectory, now, fetcher: async () => { throw new Error('PRIVATE-error'); } });
    assert.equal(failed.available, false);
    html = await readFile(path.join(outputDirectory, 'index.html'), 'utf8');
    assert.match(html, /Dashboard status unavailable/);
    assert.doesNotMatch(html, /<img\b|42% complete|PRIVATE-/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public photos are internal cameras only, except the AD5M C120; no external fallback', async () => {
  const data = fixture();
  const camera = data.externalCameras.ad5m;
  data.cameras = {};
  for (const id of ['a5mp', 'c5', 'c5p']) {
    data.printers.push({ ...data.printers[0], id });
    data.cameras[id] = { ...camera };
    data.externalCameras[id] = { ...camera };
  }
  data.cameras.ad5m = { ...camera };
  const snapshot = publicSnapshot(data, now);
  assert.deepEqual(snapshot.cameras.map(c => `${c.id}-${c.source}`), ['a5mp-integrated', 'ad5m-tapo', 'c5-integrated', 'c5p-integrated']);
  data.cameras.c5.enabled = false;
  assert.equal(publicSnapshot(data, now).cameras.some(c => c.id === 'c5'), false);
  data.cameras.c5.enabled = true;
  const root = await mkdtemp(path.join(tmpdir(), 'static-camera-selection-'));
  const routes = [];
  try {
    await generateStaticSite({ outputDirectory: path.join(root, 'static-site'), now, convertImage: async () => webp,
      fetcher: async url => {
        routes.push(new URL(url).pathname);
        return url.endsWith('/api/printers') ? Response.json(data) : new Response(Buffer.from([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } });
      } });
    assert.deepEqual(routes.sort(), ['/api/printers', '/api/camera/ad5m/tapo/image', '/api/camera/a5mp/image', '/api/camera/c5/image', '/api/camera/c5p/image'].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a broken camera does not block the page or embed non-JPEG content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'static-home-camera-'));
  try {
    const result = await generateStaticSite({ outputDirectory: path.join(root, 'static-site'), now,
      fetcher: async url => url.endsWith('/api/printers') ? Response.json(fixture()) : new Response('<svg onload="PRIVATE-attack"/>', { headers: { 'Content-Type': 'image/jpeg' } }) });
    assert.equal(result.available, true); assert.equal(result.images, 0);
    const html = await readFile(path.join(root, 'static-site/index.html'), 'utf8');
    assert.match(html, /No current camera image available/); assert.doesNotMatch(html, /PRIVATE-/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source is restricted to a local dashboard origin without redirects or credential-bearing URLs', () => {
  for (const value of ['https://example.com', 'http://192.168.1.2', 'http://localhost:3000/api', 'http://user:pass@localhost:3000', 'http://localhost:3000/?token=x']) assert.throws(() => dashboardOrigin(value));
  assert.equal(dashboardOrigin('http://localhost:3001'), 'http://localhost:3001');
});
