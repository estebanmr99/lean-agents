// The engine warns below the engines floor: read-only paths still run, writing paths stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const floor = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node.replace(/^>=/, '');

function run(node, args, extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-floor-'));
  const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home, LEAN_AGENTS_NODE: node, ...extra };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', ...args], { encoding: 'utf8', env });
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}

test('below the floor, read-only paths warn once and keep running', () => {
  for (const args of [['--help'], ['--version'], ['--doctor'], ['--upgrade-agent', 'opencode', '--dry-run'], ['--adopt']]) {
    const r = run('22.12.0', args);
    // --doctor exits 1 on an empty home (nothing installed); it must still run and report.
    if (args[0] === '--doctor') assert.match(r.stdout, /not installed/);
    else assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    const lines = r.stderr.trim().split('\n').filter((l) => l.includes('older than'));
    assert.equal(lines.length, 1, args.join(' '));
    assert.match(lines[0], new RegExp(`Node 22\\.12\\.0 is older than ${floor.replace(/\./g, '\\.')}`));
    assert.match(lines[0], /nvm/);
  }
});

test('below the floor, writing paths exit 1 unless LEAN_AGENTS_ALLOW_OLD_NODE=1', () => {
  const args = ['--yes', '--agents', 'claude'];
  const r = run('22.12.0', args);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /older than/);
  assert.equal(run('22.12.0', ['--uninstall', '--yes']).status, 1);
  const ok = run('22.12.0', args, { LEAN_AGENTS_ALLOW_OLD_NODE: '1' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /older than/);
});

test('at the floor, nothing is printed', () => {
  const r = run(floor, ['--help']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /older than/);
});
