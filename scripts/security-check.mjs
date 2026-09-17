// Copyright (C) 2026 Flashforge Health contributors
// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = process.argv.includes('--staged');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'];
const files = [...new Set(git(args).toString().split('\0').filter(Boolean))];
const forbidden = files.filter(file => (file.startsWith('data/') && file !== 'data/printers.example.json')
  || /(^|\/)(?:\.env(?:\..+)?|printers\.json|.*\.(?:pem|key|p12|pfx|log))$/.test(file) && !file.endsWith('.env.example')
  || /^(?:node_modules|\.venv|venv|\.agents|\.codex)\//.test(file));
if (forbidden.length) {
  console.error('Private files must not be committed:', forbidden.map(file => JSON.stringify(file)).join(', '));
  process.exit(1);
}
const bundled = path.join(root, 'data', 'security-tools', 'gitleaks');
const scanner = process.env.GITLEAKS_BIN || (existsSync(bundled) ? bundled : 'gitleaks');
const common = ['--redact', '--no-banner', '--ignore-gitleaks-allow', '--config', path.join(root, '.gitleaks.toml')];
function scan(args) {
  const report = path.join(snapshot, 'gitleaks-findings.json');
  const result = spawnSync(scanner, [...args, ...common, '--report-format=json', '--report-path', report], { cwd: root, stdio: 'inherit' });
  if (result.error) throw new Error('Gitleaks is required. Run python3 scripts/install-gitleaks.py first.');
  if (result.status !== 0) {
    if (existsSync(report)) for (const finding of JSON.parse(readFileSync(report, 'utf8'))) console.error(`${finding.RuleID}: ${finding.File}:${finding.StartLine} (value redacted)`);
    throw new Error('Secret scan failed; review redacted findings before committing.');
  }
}
const snapshot = mkdtempSync(path.join(tmpdir(), 'printer-secret-check-'));
try {
  for (const file of files) {
    const original = path.join(root, file);
    if (!staged && !existsSync(original)) continue;
    const content = staged ? git(['show', `:${file}`]) : lstatSync(original).isSymbolicLink() ? readlinkSync(original) : readFileSync(original);
    const destination = path.join(snapshot, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, content, { mode: 0o600 });
  }
  scan(['dir', snapshot]);
  if (!staged) scan(['git', '--log-opts=--branches --remotes --tags', root]);
  console.log(staged ? 'Staged files passed the security check.' : 'Working files and Git history passed the security check.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { rmSync(snapshot, { recursive: true, force: true }); }
