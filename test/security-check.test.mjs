import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('..', import.meta.url));
const scanner = process.env.GITLEAKS_BIN || path.join(source, 'data/security-tools/gitleaks');

test('commit guard scans the index, redacts findings, and rejects private files or a missing scanner',
  { skip: !existsSync(scanner) && 'Install Gitleaks to exercise the commit guard' }, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'printer-hook-test-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    const run = (binary = scanner) => spawnSync(process.execPath, ['scripts/security-check.mjs', '--staged'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, GITLEAKS_BIN: binary },
    });
    try {
      mkdirSync(path.join(root, 'scripts'));
      copyFileSync(path.join(source, 'scripts/security-check.mjs'), path.join(root, 'scripts/security-check.mjs'));
      copyFileSync(path.join(source, '.gitleaks.toml'), path.join(root, '.gitleaks.toml'));
      git('init', '--quiet');
      const config = path.join(root, 'fixture.json');
      writeFileSync(config, '{}');
      git('add', 'fixture.json');
      assert.equal(run().status, 0);
      const fake = ['synthetic', 'camera', 'credential', '123456'].join('-');
      writeFileSync(config, JSON.stringify({ password: fake }));
      git('add', 'fixture.json');
      writeFileSync(config, '{}');
      const blocked = run();
      assert.notEqual(blocked.status, 0, 'secret remains staged even after clearing the worktree');
      assert.match(blocked.stderr, /value redacted/);
      assert.ok(!`${blocked.stdout}${blocked.stderr}`.includes(fake));
      git('add', 'fixture.json');
      assert.notEqual(run(path.join(root, 'missing-scanner')).status, 0);
      mkdirSync(path.join(root, 'data'));
      writeFileSync(path.join(root, 'data', 'camera.json'), '{}');
      git('add', '--force', 'data/camera.json');
      const privateFile = run();
      assert.notEqual(privateFile.status, 0);
      assert.match(privateFile.stderr, /Private files must not be committed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
