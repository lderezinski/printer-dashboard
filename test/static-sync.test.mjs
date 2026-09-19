// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, readFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { syncStaticSite, validateSyncDestination } from '../scripts/sync-static-site.mjs';

const destination = 'root@fixture:/var/www/status/';
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'static-sync-test-'));
  await mkdir(path.join(root, 'images'));
  const name = `ad5m-tapo-${'a'.repeat(64)}.webp`;
  await writeFile(path.join(root, 'index.html'), `<img src="images/${name}">`);
  await writeFile(path.join(root, 'images', name), 'fixture-image');
  await writeFile(path.join(root, 'images', 'private.txt'), 'DO NOT UPLOAD');
  await writeFile(path.join(root, 'private.json'), 'DO NOT UPLOAD');
  return { root, name };
}

test('sync stages only public files, keeps mtimes and uploads images before HTML before pruning', async () => {
  const { root, name } = await fixture();
  const calls = []; let staging;
  try {
    const result = await syncStaticSite({ outputDirectory: root, destination, run: async (command, args) => {
      calls.push(args); assert.equal(command, 'rsync');
      if (calls.length === 1) {
        staging = path.dirname(args.at(-2).replace(/\/$/, ''));
        assert.deepEqual((await readdir(staging)).sort(), ['images', 'index.html']);
        assert.deepEqual(await readdir(path.join(staging, 'images')), [name]);
        assert.ok(Math.abs((await stat(path.join(root, 'images', name))).mtimeMs - (await stat(path.join(staging, 'images', name))).mtimeMs) < 1);
        await writeFile(path.join(root, 'index.html'), 'changed during transfer');
      }
      if (calls.length === 2) assert.match(await readFile(args.at(-2), 'utf8'), /<img/);
      return { stdout: 'ok' };
    } });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].at(-1), `${destination}images/`);
    assert.equal(calls[1].at(-1), destination);
    assert.ok(!calls[0].includes('--delete-after'));
    assert.ok(calls[2].includes('--delete-after'));
    assert.ok(calls[2].includes('--exclude=*'));
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(stat(staging), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a failed image transfer never publishes HTML or deletes remote images', async () => {
  const { root } = await fixture(); let calls = 0, staging;
  try {
    await assert.rejects(syncStaticSite({ outputDirectory: root, destination, run: async (_command, args) => {
      calls++; staging = path.dirname(args.at(-2).replace(/\/$/, '')); throw new Error('SSH unavailable');
    } }), /SSH unavailable/);
    assert.equal(calls, 1); await assert.rejects(stat(staging), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sync rejects unsafe destinations and never uses a local shell', () => {
  assert.equal(validateSyncDestination(destination), destination);
  for (const value of ['root@fixture:/', 'root@fixture:/var/../etc/', 'root@fixture:/tmp/;touch /tmp/x', 'fixture:/var/www/status/']) assert.throws(() => validateSyncDestination(value));
});
