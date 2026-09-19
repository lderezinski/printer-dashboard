// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readdir, readFile, copyFile, lstat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PUBLIC_IMAGE } from './static-home.mjs';

const execute = promisify(execFile);
export function validateSyncDestination(destination) {
  if (typeof destination !== 'string' || !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+:\/[a-zA-Z0-9_./-]+\/$/.test(destination)
    || destination.split(':')[1].split('/').includes('..') || destination.endsWith(':/')) throw new Error('Invalid static sync destination.');
  return destination;
}

export async function syncStaticSite({ outputDirectory, destination, run = execute }) {
  validateSyncDestination(destination);
  const staging = await mkdtemp(path.join(tmpdir(), 'flashforge-static-sync-'));
  try {
    await mkdir(path.join(staging, 'images'));
    const copy = async relative => {
      const source = path.join(outputDirectory, relative);
      const info = await lstat(source);
      if (!info.isFile()) throw new Error('Only generated regular files may be synced.');
      const target = path.join(staging, relative);
      await copyFile(source, target);
      await utimes(target, info.atime, info.mtime);
    };
    // Freeze one complete export, so another renderer cannot change it mid-upload.
    await copy('index.html');
    const html = await readFile(path.join(staging, 'index.html'), 'utf8');
    for (const filename of await readdir(path.join(outputDirectory, 'images'))) {
      if (PUBLIC_IMAGE.test(filename)) await copy(path.join('images', filename));
    }
    for (const match of html.matchAll(/src="images\/([^"]+)"/g)) {
      if (!PUBLIC_IMAGE.test(match[1])) throw new Error('Unexpected image reference.');
      await lstat(path.join(staging, 'images', match[1]));
    }
    const common = ['-avzh', '-e', 'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes', '--timeout=30'];
    const options = { timeout: 45000, maxBuffer: 1024 * 1024 };
    const outputs = [];
    // Default rsync temp-file/rename behavior keeps each destination file complete.
    outputs.push(await run('rsync', [...common, `${staging}/images/`, `${destination}images/`], options));
    outputs.push(await run('rsync', [...common, `${staging}/index.html`, destination], options));
    // Only prune this application's generated photos, after new HTML is published.
    const filters = ['ad5m-tapo', 'a5mp-integrated', 'c5-integrated', 'c5p-integrated'].map(prefix => `--include=${prefix}-*.webp`);
    outputs.push(await run('rsync', [...common, '--delete-after', ...filters, '--exclude=*', `${staging}/images/`, `${destination}images/`], options));
    return { sha256: createHash('sha256').update(html).digest('hex'), output: outputs.map(result => result.stdout || '').join('\n') };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
