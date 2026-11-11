import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPipes } from '../scripts/lint-workflows.mjs';
import { sha256 } from '../scripts/lib/verify-sha256.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lint = (...files) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-workflows.mjs'), ...files], { cwd: ROOT, encoding: 'utf8' });

test('lint-workflows: the fixture with curl | bash, curl | sh and irm | iex fails', () => {
  assert.equal(findPipes(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'curl-pipe.yml'), 'utf8')).length, 3);
  const r = lint('tests/fixtures/curl-pipe.yml');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /3 piped download/);
});

test('lint-workflows: the real workflows and actions pass', () => {
  const r = lint();
  assert.equal(r.status, 0, r.stdout);
});

test('ci-downloads.json bun entries match core/pins.json', () => {
  const dl = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'ci-downloads.json'), 'utf8'));
  const { version, sha256 } = JSON.parse(fs.readFileSync(path.join(ROOT, 'core', 'pins.json'), 'utf8')).pins.bun;
  for (const [k, plat] of [['bun-linux-x64', 'linux-x64'], ['bun-windows-x64', 'windows-x64']]) {
    assert.equal(dl[k].sha256, sha256[plat], k);
    assert.ok(dl[k].url.includes(`bun-v${version}/`), k);
  }
});

test('ci-download.sh: a matching SHA256 passes, a mismatch fails and deletes the file', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dl-'));
  const src = path.join(dir, 'src.txt');
  fs.writeFileSync(src, 'hello');
  const good = sha256(src);
  const table = path.join(dir, 'downloads.json');
  const run = (sha) => {
    fs.writeFileSync(table, JSON.stringify({ x: { url: `file://${src}`, sha256: sha } }));
    const dest = path.join(dir, 'out.txt');
    const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'ci-download.sh'), 'x', dest], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI_DOWNLOADS: table, CI_LATEST: '' } });
    return { r, dest };
  };
  const ok = run(good);
  assert.equal(ok.r.status, 0, ok.r.stderr);
  assert.ok(fs.existsSync(ok.dest));
  fs.rmSync(ok.dest);
  const bad = run('0'.repeat(64));
  assert.equal(bad.r.status, 1);
  assert.match(bad.r.stderr, /does not match the pinned/);
  assert.ok(!fs.existsSync(bad.dest));
});

test('verify-commit: a checkout at another commit is removed and fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-git-'));
  const git = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'one');
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const script = path.join(ROOT, 'scripts', 'lib', 'verify-commit.mjs');
  assert.equal(spawnSync(process.execPath, [script, dir, head], { encoding: 'utf8' }).status, 0);
  const bad = spawnSync(process.execPath, [script, dir, 'a'.repeat(40)], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /tag moved/);
  assert.ok(!fs.existsSync(dir));
});
