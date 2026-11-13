// --install-agent / --uninstall-agent in a temp HOME: the plan, the record, a changed file is kept, not-ours does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentLifecycle, agentTable, LIFECYCLE_AGENTS } from '../scripts/lib/agent-lifecycle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lean = (home, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8' });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-lifecycle-'));
const yesNo = (a) => /^y/i.test(a);

// A fake installer: writes a file and a symlink into ~/.local/bin and a data dir.
function fake(home) {
  const bin = path.join(home, '.local', 'bin');
  const code = `const fs=require('fs'),p=require('path');const b=${JSON.stringify(bin)};const d=p.join(${JSON.stringify(home)},'.local','share','fake');fs.mkdirSync(b,{recursive:true});fs.mkdirSync(d,{recursive:true});fs.writeFileSync(p.join(d,'fake-1'),'v1');fs.symlinkSync(p.join(d,'fake-1'),p.join(b,'fake'));`;
  return { fake: { method: 'script', version: '1', run: [[process.execPath, '-e', code]], bins: [path.join(bin, 'fake')], dirs: [bin, path.join(home, '.local', 'share', 'fake')] } };
}
const opts = (home, mode, extra = {}) => ({ mode, agents: ['fake'], home, realHome: '/nowhere', stateDir: path.join(home, '.config', 'lean-agents'), dryRun: false, exec: true, yes: true, ask: async (_q, d) => d, yesNo, table: fake(home), ...extra });
const quietly = async (fn) => { const log = console.log; const out = []; console.log = (...a) => out.push(a.join(' ')); try { await fn(); } finally { console.log = log; } return out.join('\n'); };
// 'fake' is not in the public list; the module checks it, so tests name a real agent and swap its table row.
const asClaude = (home, mode, extra) => ({ ...opts(home, mode, extra), agents: ['claude'], table: { claude: fake(home).fake } });

test('dry run prints the pinned plan for every agent and changes nothing', () => {
  const home = tmp();
  const r = lean(home, '--install-agent', LIFECYCLE_AGENTS.join(','), '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /verify-sha256\.mjs/);
  assert.match(r.stdout, /claude-installer\.sh 2\.1\.312/);
  assert.match(r.stdout, /--version 2\.2\.5 --no-modify-path/);
  assert.match(r.stdout, /npm install -g --prefix .*@github\/copilot@1\.0\.105/);
  // `opencode --version` (the 1.x guard) may make its own cache dirs; lean-agents writes no state.
  assert.ok(!fs.existsSync(path.join(home, '.config', 'lean-agents')), 'dry run wrote state');
});

test('OpenCode 1.x is never installed or removed', () => {
  const r = lean(tmp(), '--install-agent', 'opencode-v1', '--dry-run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /never installed or removed/);
});

test('every script installer has a pinned url and sha256 in core/pins.json', () => {
  const home = tmp();
  for (const [a, row] of Object.entries(agentTable({ home, platform: 'linux', dir: home, realHome: '/nowhere' }))) {
    if (row.method !== 'script') continue;
    assert.match(row.run[0][4], /^https:\/\//, a);
    assert.match(row.run[1][3], /^[0-9a-f]{64}$/, a);
  }
});

test('install records new files with their sha; uninstall removes them and leaves user files', async () => {
  const home = tmp();
  const mine = path.join(home, '.local', 'bin', 'mine');
  fs.mkdirSync(path.dirname(mine), { recursive: true });
  fs.writeFileSync(mine, 'user');
  await quietly(() => agentLifecycle(asClaude(home, 'install')));
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents.claude;
  assert.deepEqual(state.files.map((f) => path.basename(f.path)).sort(), ['fake', 'fake-1']);
  assert.match(state.files.find((f) => f.path.endsWith('fake-1')).sha256, /^[0-9a-f]{64}$/);
  assert.ok(state.files.find((f) => f.path.endsWith('fake')).link);
  assert.ok(!state.files.some((f) => f.path === mine), 'recorded a file that was already there');
  await quietly(() => agentLifecycle(asClaude(home, 'uninstall')));
  assert.ok(!fs.existsSync(path.join(home, '.local', 'bin', 'fake')) && !fs.lstatSync(path.join(home, '.local', 'bin'), {}).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(home, '.local', 'share', 'fake')), 'empty data dir left');
  assert.equal(fs.readFileSync(mine, 'utf8'), 'user');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents, {});
});

test('a file whose sha changed since install is kept', async () => {
  const home = tmp();
  await quietly(() => agentLifecycle(asClaude(home, 'install')));
  const data = path.join(home, '.local', 'share', 'fake', 'fake-1');
  fs.writeFileSync(data, 'edited by the user');
  const out = await quietly(() => agentLifecycle(asClaude(home, 'uninstall')));
  assert.match(out, /kept \(changed\)/);
  assert.equal(fs.readFileSync(data, 'utf8'), 'edited by the user');
});

test('an agent lean-agents did not install is reported and nothing is done', async () => {
  const home = tmp();
  const bin = path.join(home, '.local', 'bin', 'fake');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, 'user binary');
  assert.match(await quietly(() => agentLifecycle(asClaude(home, 'uninstall'))), /not installed by lean-agents/);
  assert.match(await quietly(() => agentLifecycle(asClaude(home, 'install'))), /already installed, not by lean-agents/);
  assert.equal(fs.readFileSync(bin, 'utf8'), 'user binary');
  const r = lean(home, '--uninstall-agent', 'copilot-cli', '--yes');
  assert.match(r.stdout, /not installed by lean-agents/);
});
