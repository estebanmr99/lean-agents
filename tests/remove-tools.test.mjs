// --remove-tools (#573): undo one tool's records only; temp HOME, no real tool runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENGINE = path.join(ROOT, 'scripts', 'lean.mjs');
const env = { PATH: process.env.PATH, NVM_DIR: path.join(os.tmpdir(), 'no-nvm'), LEAN_AGENTS_NODE: '24.22.2' };

const run = (home, args) => spawnSync(process.execPath, [ENGINE, '--home', home, '--lang', 'en', '--profile', 'none', ...args], { encoding: 'utf8', env: { ...env, HOME: home } });
const stateFile = (home) => path.join(home, '.config', 'lean-agents', 'state.json');
const readState = (home) => JSON.parse(fs.readFileSync(stateFile(home), 'utf8'));
const writeState = (home, state) => fs.writeFileSync(stateFile(home), JSON.stringify(state, null, 2));
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

// Installs gsd + caveman, then records a harmless gsd undo (a node no-op) as the real install would record npx.
function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-rm-'));
  const r = run(home, ['--no-exec', '--yes', '--agents', 'claude', '--tools', 'rtk,context-mode,gsd,caveman']);
  assert.equal(r.status, 0, r.stderr);
  const s = readState(home);
  s.commands.push({ tool: 'gsd', desc: 'GSD Core (claude)', run: [], undo: [[process.execPath, '-e', '0', '--', '--global', '--uninstall']], ok: true });
  s.commands.push({ tool: 'caveman', desc: 'caveman', run: [], undo: [[process.execPath, '-e', '0', '--', 'keep-me']], ok: true });
  fs.writeFileSync(stateFile(home), JSON.stringify(s, null, 2));
  return home;
}
const defaults = (home) => path.join(home, '.gsd', 'defaults.json');

test('--remove-tools gsd: plan shows its undo, apply reverts it, other records stay', () => {
  const home = setup();
  const before = readState(home);
  assert.ok(fs.existsSync(defaults(home)));
  const dry = run(home, ['--remove-tools', 'gsd', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /--global --uninstall/);
  assert.doesNotMatch(dry.stdout, /keep-me/);
  assert.deepEqual(readState(home), before, 'dry run changes nothing');
  assert.ok(fs.existsSync(defaults(home)));

  const r = run(home, ['--remove-tools', 'gsd', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!fs.existsSync(defaults(home)), 'json edit reverted');
  const after = readState(home);
  assert.ok(!after.options.tools.includes('gsd'));
  assert.deepEqual(after.options.tools, before.options.tools.filter((t) => t !== 'gsd'));
  assert.deepEqual(after.files, before.files.filter((f) => f.tool !== 'gsd'));
  assert.deepEqual(after.commands, before.commands.filter((c) => c.tool !== 'gsd'));

  const upd = run(home, ['--update', '--no-exec', '--yes', '--dry-run']);
  assert.equal(upd.status, 0, upd.stderr);
  assert.doesNotMatch(upd.stdout, /gsd/i);

  // round trip: add back, then uninstall undoes the rest
  assert.equal(run(home, ['--add-tools', 'gsd', '--no-exec', '--yes']).status, 0);
  assert.ok(fs.existsSync(defaults(home)));
  assert.ok(readState(home).options.tools.includes('gsd'));
  const u = run(home, ['--uninstall', '--yes']);
  assert.equal(u.status, 0, u.stderr + u.stdout);
  assert.ok(!fs.existsSync(defaults(home)));
  assert.ok(!fs.existsSync(stateFile(home)), 'uninstall archived the state');
});

test('--remove-tools rtk: core tool refused, exit 2, nothing changed', () => {
  const home = setup();
  const before = fs.readFileSync(stateFile(home), 'utf8');
  const r = run(home, ['--remove-tools', 'rtk', '--yes']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /rtk is a core tool; use --uninstall to remove everything, or --no-core on a fresh install/);
  assert.equal(fs.readFileSync(stateFile(home), 'utf8'), before);
});

test('--remove-tools nope: unknown tool lists valid names, exit 2', () => {
  const home = setup();
  const r = run(home, ['--remove-tools', 'nope', '--yes']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown tools: nope \(available: .*gsd/);
});

test('--remove-tools ponytail: its own file is reverted, other tools stay', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-rm-pony-'));
  const i = run(home, ['--no-exec', '--yes', '--agents', 'opencode-v2', '--tools', 'ponytail']);
  assert.equal(i.status, 0, i.stderr);
  const pony = path.join(home, '.config', 'ponytail', 'config.json');
  const agent = path.join(home, '.config', 'opencode', 'agents', 'debug.md');
  assert.ok(fs.existsSync(pony));
  assert.ok(fs.existsSync(agent));

  const r = run(home, ['--remove-tools', 'ponytail', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(!fs.existsSync(pony), 'ponytail config reverted');
  assert.ok(fs.existsSync(agent), 'another tool\'s file stays');
  assert.ok(!readState(home).options.tools.includes('ponytail'));
  assert.match(r.stdout, /Removed: ponytail\./);
});

test('--remove-tools gsd: a 1.3.0 untagged file record is attributed and reverted', () => {
  const home = setup();
  const s = readState(home);
  const rec = s.files.find((f) => f.tool === 'gsd');
  assert.ok(rec, 'setup has a gsd file record');
  delete rec.tool;
  writeState(home, s);

  // The command keeps its `tool` tag, as a real 1.3.0 install records it.
  const r = run(home, ['--remove-tools', 'gsd', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Removed: gsd/);
  assert.doesNotMatch(r.stdout, /earlier install/);
  assert.ok(!fs.existsSync(defaults(home)), 'untagged gsd file reverted');
  const after = readState(home);
  assert.ok(!after.options.tools.includes('gsd'), 'gsd no longer saved');
  assert.ok(!after.files.some((f) => f.tool === 'gsd' || f.path === defaults(home)), 'no gsd file record left');
  assert.ok(!after.commands.some((c) => c.tool === 'gsd'), 'no gsd command record left');
});

test('--remove-tools gsd: tagged and untagged gsd files are both reverted', () => {
  const home = setup();
  const extra = path.join(home, '.gsd', 'extra.txt');
  fs.mkdirSync(path.dirname(extra), { recursive: true });
  fs.writeFileSync(extra, 'extra\n');
  const s = readState(home);
  s.files.push({ kind: 'file', path: extra, created: true, hash: sha('extra\n') });
  writeState(home, s);

  const r = run(home, ['--remove-tools', 'gsd', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Removed: gsd/);
  assert.ok(!fs.existsSync(defaults(home)), 'tagged gsd file reverted');
  assert.ok(!fs.existsSync(extra), 'untagged gsd file reverted');
  const after = readState(home);
  assert.ok(!after.options.tools.includes('gsd'), 'gsd no longer saved');
  assert.ok(!after.files.some((f) => f.tool === 'gsd' || f.path === extra), 'no gsd file record left');
});

test('--remove-tools: a saved tool with no record warns and stays saved', () => {
  const home = setup();
  const s = readState(home);
  s.files = s.files.filter((f) => f.tool !== 'caveman');
  s.commands = s.commands.filter((c) => c.tool !== 'caveman');
  writeState(home, s);

  const r = run(home, ['--remove-tools', 'caveman', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /caveman: files from an earlier install stay until --uninstall \(no per-tool record\)/);
  assert.doesNotMatch(r.stdout, /Removed: caveman/);
  assert.ok(readState(home).options.tools.includes('caveman'), 'caveman stays saved');
});

test('--remove-tools gsd: a file left because the user edited it keeps its record', () => {
  const home = setup();
  const file = path.join(home, '.gsd', 'keep.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const original = 'installed\n';
  fs.writeFileSync(file, original);
  const s = readState(home);
  s.files.push({ tool: 'gsd', kind: 'file', path: file, created: true, hash: sha(original) });
  writeState(home, s);
  const edited = 'my own edit\n';
  fs.writeFileSync(file, edited);

  const r = run(home, ['--remove-tools', 'gsd', '--yes']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), edited, 'the edit survives byte for byte');
  assert.ok(readState(home).files.some((f) => f.path === file), 'the record stays for --uninstall');
});

test('--remove-tools: a failed undo command stays recorded and fails the run', () => {
  const home = setup();
  const s = readState(home);
  s.commands.push({ tool: 'caveman', desc: 'failing caveman undo', run: [], undo: [[process.execPath, '-e', 'process.exit(1)']], ok: true });
  writeState(home, s);

  const dry = run(home, ['--remove-tools', 'caveman', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /undo: failing caveman undo/);
  assert.doesNotMatch(dry.stdout, /Apply these changes\?/);

  const r = run(home, ['--remove-tools', 'caveman', '--yes']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Not finished: 1 undo command\(s\) failed/);
  const after = readState(home);
  assert.ok(after.commands.some((c) => c.desc === 'failing caveman undo'), 'failed undo stays recorded');
  assert.ok(after.options.tools.includes('caveman'), 'tool stays saved');
});
