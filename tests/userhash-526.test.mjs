// #526: a repo ignore hides only the marketplace source, and --update keeps a user-edited keepIfChanged value visible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'scripts', 'lean.mjs');
const SETUP = ['--no-exec', '--yes', '--agents', 'claude', '--tools', 'ponytail', '--privacy', 'standard', '--lang', 'en', '--profile', 'none'];

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const settings = path.join(home, '.claude', 'settings.json');
  const env = { PATH: process.env.PATH, NVM_DIR: path.join(home, '.nvm'), HOME: home };
  const run = (...args) => spawnSync(process.execPath, [MAIN, '--home', home, ...args], { encoding: 'utf8', env });
  const inst = run(...SETUP);
  assert.equal(inst.status, 0, inst.stdout + inst.stderr);
  const stateFile = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = () => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const read = () => JSON.parse(fs.readFileSync(settings, 'utf8'));
  const write = (j) => fs.writeFileSync(settings, `${JSON.stringify(j, null, 2)}\n`);
  const row = () => run('--doctor').stdout.split('\n').find((l) => /^(ok|changed|error)\s+\S*\.claude[\\/]settings\.json/.test(l));
  return { home, settings, run, state, read, write, row };
}

test('a repo ignore hides only the marketplace source, so an edit in the entry still shows (#526)', () => {
  const t = setup();
  const cfg = t.read();
  cfg.extraKnownMarketplaces.ponytail.autoUpdate = false;
  t.write(cfg);
  assert.match(t.row(), /edited since install/, 'autoUpdate inside the ignored marketplace entry is a user edit');
});

test('--update does not bless a user key when the file is modified in the same run (#526)', () => {
  const t = setup();
  const cfg = t.read();
  cfg.myOwnKey = 1;
  delete cfg.model; // forces the planned JSON to `modify`
  t.write(cfg);
  const upd = t.run('--update', '--no-exec', '--yes');
  assert.equal(upd.status, 0, upd.stdout + upd.stderr);
  assert.match(t.row(), /edited since install/, 'the user key stays an edit after --update');
});

test('--update keeps a user-edited keepIfChanged value as an edit (#526)', () => {
  const t = setup();
  const ours = { type: 'command', command: 'node ours' };
  const st = t.state();
  st.files.find((f) => f.path === t.settings).applied.push({ path: ['statusLine'], value: ours, mode: 'setIfAbsent', keepIfChanged: true });
  fs.writeFileSync(path.join(t.home, '.config', 'lean-agents', 'state.json'), JSON.stringify(st));
  const cfg = t.read();
  cfg.statusLine = { type: 'command', command: 'node mine' };
  delete cfg.model; // forces the planned JSON to `modify`
  t.write(cfg);
  const upd = t.run('--update', '--no-exec', '--yes');
  assert.equal(upd.status, 0, upd.stdout + upd.stderr);
  assert.match(t.row(), /edited since install/, 'the kept statusLine stays an edit after --update');
});