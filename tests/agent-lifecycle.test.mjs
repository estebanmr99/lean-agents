// --install-agent / --uninstall-agent in a temp HOME: the plan, the record, a changed file is kept, not-ours does nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentLifecycle, agentTable, LIFECYCLE_AGENTS } from '../scripts/lib/agent-lifecycle.mjs';
import { PINS } from '../scripts/lib/pins.mjs';

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
const asClaude = (home, mode, extra) => ({ ...opts(home, mode, extra), agents: ['claude'], table: extra?.table ?? { claude: fake(home).fake } });

test('dry run prints the pinned plan for every agent and changes nothing', { skip: process.platform === 'win32' && 'Windows offers only Copilot CLI' }, () => {
  const home = tmp();
  const r = lean(home, '--install-agent', LIFECYCLE_AGENTS.join(','), '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /verify-sha256\.mjs/);
  const claudePin = PINS['claude-code'].version.replace(/\./g, '\\.');
  assert.match(r.stdout, new RegExp(`claude-installer\\.sh ${claudePin}`));
  const v2Pin = PINS['opencode-v2'].version.replace(/\./g, '\\.');
  const copilotPin = PINS['copilot-cli'].version.replace(/\./g, '\\.');
  assert.match(r.stdout, new RegExp(`--version ${v2Pin} --no-modify-path`));
  assert.match(r.stdout, new RegExp(`npm install -g --prefix .*@github/copilot@${copilotPin}`));
  // `opencode --version` (the 1.x guard) may make its own cache dirs; lean-agents writes no state.
  assert.ok(!fs.existsSync(path.join(home, '.config', 'lean-agents')), 'dry run wrote state');
});

test('OpenCode 1.x is never installed or removed', () => {
  const r = lean(tmp(), '--install-agent', 'opencode-v1', '--dry-run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /never installed or removed/);
});

test('agentTable win32 claude', () => {
  const home = '/tmp/fakehome';
  const row = agentTable({ home, platform: 'win32', dir: home, realHome: home }).claude;
  assert.equal(row.method, 'script');
  assert.ok(!row.manual, 'should not be manual');
  assert.deepEqual(row.bins, [path.join(home, '.local', 'bin', 'claude.exe')]);
  assert.deepEqual(row.dirs, [path.join(home, '.local', 'bin'), path.join(home, '.local', 'share', 'claude'), path.join(home, '.claude', 'downloads')]);
  assert.equal(row.run[0][0], 'curl.exe', 'downloader is curl.exe');
  assert.equal(row.run[2][0], 'powershell', 'runner is powershell');
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

// Engine runs get only PATH, NVM_DIR and HOME; --home keeps every write in the temp dir.
const leanEnv = (home) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', '--yes', '--agents', 'claude', '--tools', 'caveman'], { encoding: 'utf8', env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home } });
const engine = (home, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home } });

test('vscode-copilot is a lifecycle agent; VS Code keeps the extension', () => {
  assert.ok(LIFECYCLE_AGENTS.includes('vscode-copilot'));
  const r = engine(tmp(), '--upgrade-agent', 'vscode-copilot');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /VS Code owns the GitHub Copilot extension/);
});

test('vscode-copilot install and uninstall go through the lifecycle with a stub', async () => {
  const calls = [];
  let on = false;
  const vscode = { configured: () => on, install: async () => { calls.push('install'); on = true; }, uninstall: async () => { calls.push('uninstall'); on = false; } };
  const base = { agents: ['vscode-copilot'], home: tmp(), realHome: '/nowhere', stateDir: tmp(), dryRun: false, exec: false, yes: true, ask: async (_q, d) => d, yesNo, vscode };
  assert.match(await quietly(() => agentLifecycle({ ...base, mode: 'uninstall' })), /not configured by lean-agents/);
  assert.match(await quietly(() => agentLifecycle({ ...base, mode: 'install' })), /never installs, updates or removes it/);
  assert.match(await quietly(() => agentLifecycle({ ...base, mode: 'install' })), /already configured/);
  await quietly(() => agentLifecycle({ ...base, mode: 'uninstall' }));
  assert.deepEqual(calls, ['install', 'uninstall']);
});

test('--install-agent vscode-copilot writes the adapter files; --uninstall-agent removes only those', () => {
  const home = tmp();
  assert.equal(leanEnv(home).status, 0);
  const rules = path.join(home, '.config', 'lean-agents', 'AGENTS.md');
  assert.ok(fs.existsSync(rules));
  const r = engine(home, '--install-agent', 'vscode-copilot', '--no-exec', '--yes', '--tools', 'serena');
  assert.equal(r.status, 0, r.stderr);
  const state = () => JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.ok(state().options.agents.includes('vscode-copilot') && state().options.agents.includes('claude'));
  const mcp = state().files.find((f) => f.path.endsWith(path.join('Code', 'User', 'mcp.json')));
  assert.ok(mcp && fs.existsSync(mcp.path));
  const u = engine(home, '--uninstall-agent', 'vscode-copilot', '--no-exec', '--yes');
  assert.equal(u.status, 0, u.stderr);
  assert.ok(!fs.existsSync(mcp.path), 'mcp.json left');
  assert.deepEqual(state().options.agents, ['claude']);
  assert.ok(fs.existsSync(rules), 'removed a file that is not vscode-copilot');
});

test('--doctor says VS Code owns the Copilot extension', () => {
  const home = tmp();
  assert.equal(engine(home, '--install-agent', 'vscode-copilot', '--no-exec', '--yes', '--tools', 'caveman').status, 0);
  assert.match(engine(home, '--doctor', '--no-exec').stdout, /Copilot extension.*managed by VS Code/);
});

test('win32 path entry: absent before, present after -> recorded and removed', async () => {
  const home = tmp();
  const dir = path.join(home, '.local', 'bin');
  let has = false;
  const winPath = (op, d) => {
    if (d !== dir) return 'absent';
    if (op === 'has') return has ? 'present' : 'absent';
    if (op === 'remove') { has = false; return 'changed'; }
    return 'absent';
  };
  const row = {
    method: 'script', version: '1', run: [],
    bins: [], dirs: [dir]
  };
  row.run.every = (cb) => { has = true; return cb([process.execPath, '-e', 'process.exit(0)']); };
  const opts = asClaude(home, 'install', { platform: 'win32', winPath, table: { claude: row } });
  
  const out = await quietly(() => agentLifecycle(opts));
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents.claude;
  assert.equal(state.pathEntryDir, dir, 'recorded pathEntryDir');

  
  const rmOpts = asClaude(home, 'uninstall', { platform: 'win32', winPath });
  const rmOut = await quietly(() => agentLifecycle(rmOpts));
  assert.match(rmOut, /removed from PATH/);
  assert.equal(has, false, 'removed from winPath');
});

test('win32 path entry: installer leaves it off PATH -> lean-agents adds, records and removes it', async () => {
  const home = tmp();
  const dir = path.join(home, '.local', 'bin');
  let has = false;
  const winPath = (op, d) => {
    if (d !== dir) return 'absent';
    if (op === 'has') return has ? 'present' : 'absent';
    if (op === 'add') { has = true; return 'changed'; }
    if (op === 'remove') { has = false; return 'changed'; }
    return 'absent';
  };
  const row = {
    method: 'script', version: '1', run: [],
    bins: [], dirs: [dir]
  };
  row.run.every = (cb) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'claude.exe'), 'x');
    return cb([process.execPath, '-e', 'process.exit(0)']);
  };
  const opts = asClaude(home, 'install', { platform: 'win32', winPath, table: { claude: row } });

  const out = await quietly(() => agentLifecycle(opts));
  assert.match(out, /added to PATH/);
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents.claude;
  assert.equal(state.pathEntryDir, dir, 'recorded pathEntryDir');
  assert.equal(has, true, 'added to winPath');

  const rmOpts = asClaude(home, 'uninstall', { platform: 'win32', winPath });
  const rmOut = await quietly(() => agentLifecycle(rmOpts));
  assert.match(rmOut, /removed from PATH/);
  assert.equal(has, false, 'removed from winPath');
});

test('win32 path entry: present before -> not recorded, not removed', async () => {
  const home = tmp();
  const dir = path.join(home, '.local', 'bin');
  let has = true;
  const winPath = (op, d) => {
    if (d !== dir) return 'absent';
    if (op === 'has') return has ? 'present' : 'absent';
    if (op === 'remove') { has = false; return 'changed'; }
    return 'absent';
  };
  const row = {
    method: 'script', version: '1', run: [],
    bins: [], dirs: [dir]
  };
  row.run.every = (cb) => cb([process.execPath, '-e', 'process.exit(0)']);
  const opts = asClaude(home, 'install', { platform: 'win32', winPath, table: { claude: row } });
  
  await quietly(() => agentLifecycle(opts));
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents.claude;
  assert.ok(!state.pathEntryDir, 'did not record pathEntryDir');
  
  const rmOpts = asClaude(home, 'uninstall', { platform: 'win32', winPath });
  const rmOut = await quietly(() => agentLifecycle(rmOpts));
  assert.doesNotMatch(rmOut, /removed from PATH/);
  assert.equal(has, true, 'did not remove from winPath');
});

test('win32 path entry: failed install that added the entry -> still recorded', async () => {
  const home = tmp();
  const dir = path.join(home, '.local', 'bin');
  let has = false;
  const winPath = (op, d) => {
    if (d !== dir) return 'absent';
    if (op === 'has') return has ? 'present' : 'absent';
    if (op === 'remove') { has = false; return 'changed'; }
    return 'absent';
  };
  const row = {
    method: 'script', version: '1', run: [],
    bins: [], dirs: [dir]
  };
  row.run.every = (cb) => { has = true; return cb([process.execPath, '-e', 'process.exitCode = 1; process.exit(1)']); };
  const opts = asClaude(home, 'install', { platform: 'win32', winPath, table: { claude: row } });
  
  await quietly(() => agentLifecycle(opts));
  process.exitCode = 0; // reset
  
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents.claude;
  assert.equal(state.pathEntryDir, dir, 'recorded pathEntryDir despite failure');
});
