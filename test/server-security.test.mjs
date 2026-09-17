// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, copyFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';

test('server rejects viewer writes, private settings, proxies and private files', { timeout: 20000 }, async () => {
  const source = fileURLToPath(new URL('..', import.meta.url));
  const root = await mkdtemp(path.join(tmpdir(), 'printer-security-server-'));
  let child;
  try {
    for (const name of await readdir(source)) if (name.endsWith('.mjs')) await copyFile(path.join(source, name), path.join(root, name));
    await symlink(path.join(source, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    await mkdir(path.join(root, 'data'));
    await mkdir(path.join(root, 'dist'));
    await writeFile(path.join(root, 'dist', 'index.html'), '<!doctype html><title>Fixture</title>');
    const ids = ['ad5m', 'a5mp', 'c5', 'c5p', 'mfc_l2710dw', 'hl_l3270cdw'];
    await writeFile(path.join(root, 'data', 'printers.json'), JSON.stringify(Object.fromEntries(ids.map(id => [id, { host: '' }]))));
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    child = spawn(process.execPath, ['server.mjs'], { cwd: root,
      env: { ...process.env, PORT: String(port), FLASHFORGE_CLOUD: 'off', FLASHFORGE_CAMERA: 'off', FLASHFORGE_GAP: 'off', FLASHFORGE_LAN: 'off', FLASHFORGE_ALLOW_INSECURE_MQTT: 'off' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture server did not start')), 8000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Fixture server exited before listening')); });
      child.stdout.on('data', chunk => { if (chunk.toString().includes('Flashforge Health on this Mac:')) { clearTimeout(timeout); resolve(); } });
    });
    const request = (route, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: { Host: `localhost:${port}`, ...headers } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal((await request('/')).status, 200);
    const viewer = { Host: `127.0.0.1:${port}` };
    assert.equal(JSON.parse((await request('/api/printers', viewer)).body).capabilities.localTools, false);
    assert.equal((await request('/api/printers/a5mp/settings', viewer)).status, 403);
    assert.equal((await request('/api/printers/a5mp/settings')).status, 200);
    for (const [route, method] of [['/api/cloud/reconnect', 'POST'], ['/api/history', 'POST'], ['/api/printers/a5mp/settings', 'PUT'], ['/api/printers/a5mp/maintenance', 'PUT']]) {
      assert.equal((await request(route, viewer, method)).status, 403);
    }
    for (const route of ['/data/printers.json', '/.git/config', '/security.mjs']) assert.equal((await request(route)).status, 404);
    for (const headers of [{ Origin: 'https://audit.example' }, { Host: 'audit.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Forwarded: 'for=127.0.0.1' }]) assert.equal((await request('/', headers)).status, 403);
    assert.equal((await request('/')).headers['referrer-policy'], 'no-referrer');
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    await rm(root, { recursive: true, force: true });
  }
});
