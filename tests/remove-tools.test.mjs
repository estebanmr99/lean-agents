// --remove-tools (#573): undo one tool's records only; temp HOME, no real tool runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENGINE = path.join(ROOT, 'scripts', 'lean.mjs');
const env = { PATH: process.env.PATH, NVM_DIR: path.join(os.tmpdir(), 'no-nvm') };

const run = (home, args) => spawnSync(process.execPath, [ENGINE, '--home', home, '--lang', 'en', '--profile', 'none', ...args], { encoding: 'utf8', env: { ...env, HOME: home } });
const stateFile = (home) => path.join(home, '.config', 'lean-agents', 'state.json');
const readState = (home) => JSON.parse(fs.readFileSync(stateFile(home), 'utf8'));

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
