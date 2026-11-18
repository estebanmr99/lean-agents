// --update agent CLI upgrades (#182 PR3): argv per agent, saved previous version, held/major/own never moved, undo reinstalls it.
// Synthetic rows and a temp HOME; nothing is downloaded or run except node itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { upgradeCommands, undoUpgrades } from '../scripts/lib/agent-lifecycle.mjs';
import { PINS } from '../scripts/lib/pins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-upgrade-'));
const row = (tool, extra = {}) => ({ tool, installed: '1.0.0', pinned: PINS[tool].version, action: 'update', reason: null, ...extra });
const argv = (c, key) => c[key].map((a) => a.join(' ')).join('\n');
const quietly = (fn) => { const log = console.log; const out = []; console.log = (...a) => out.push(a.join(' ')); try { return [fn(), out.join('\n')]; } finally { console.log = log; } };

test('Copilot CLI: npm install at the pin, reinstall saved at the previous version', () => {
  const home = tmp();
  const [c] = upgradeCommands({ rows: [row('copilot-cli', { installed: '1.0.1' })], home, dir: home, realHome: '/nowhere' });
  assert.match(argv(c, 'run'), new RegExp(`npm install -g --prefix .*@github/copilot@${PINS['copilot-cli'].version.replace(/\./g, '\\.')}`));
  assert.match(argv(c, 'reinstall'), /@github\/copilot@1\.0\.1$/);
  assert.equal(c.from, '1.0.1');
  assert.deepEqual(c.undo, [], '--uninstall must not reinstall an old agent');
});

test('Claude and OpenCode 2: the pinned installer gets the version argument', { skip: process.platform === 'win32' && 'POSIX installers' }, () => {
  const home = tmp();
  const [cl, oc] = upgradeCommands({ rows: [row('claude-code'), row('opencode-v2', { installed: '2.0.1' })], home, dir: home, realHome: '/nowhere' });
  assert.match(argv(cl, 'run'), /verify-sha256\.mjs/);
  assert.match(argv(cl, 'run'), new RegExp(`claude-installer\\.sh ${PINS['claude-code'].version.replace(/\./g, '\\.')}`));
  assert.match(argv(cl, 'reinstall'), /claude-installer\.sh 1\.0\.0/);
  assert.match(argv(oc, 'run'), new RegExp(`--version ${PINS['opencode-v2'].version.replace(/\./g, '\\.')} --no-modify-path`));
  assert.match(argv(oc, 'reinstall'), /--version 2\.0\.1 --no-modify-path/);
});

test('held, major, own and unknown rows get no command; Cursor and Antigravity are never moved', () => {
  const rows = [row('copilot-cli', { action: 'held' }), row('claude-code', { action: 'major' }), row('opencode-v2', { action: 'own' }), { tool: 'opencode-v1', installed: '1.19.0', action: 'held' }, row('cursor-installer')];
  assert.deepEqual(upgradeCommands({ rows, home: tmp(), dir: tmp(), realHome: '/nowhere' }), []);
});

test('undoUpgrades runs each saved reinstall and reports a failure; commands without one are skipped', () => {
  const ok = [process.execPath, '-e', 'process.exit(0)'];
  const bad = [process.execPath, '-e', 'process.exit(1)'];
  const cmds = [{ desc: 'x' }, { desc: 'upgrade a 1 -> 2', from: '1', reinstall: [ok] }];
  const [good, out] = quietly(() => undoUpgrades(cmds));
  assert.equal(good, true);
  assert.match(out, /reinstall 1 \(undo of: upgrade a 1 -> 2\)/);
  assert.equal(quietly(() => undoUpgrades([{ desc: 'upgrade b 1 -> 2', from: '1', reinstall: [bad] }, { desc: 'upgrade c 1 -> 2', from: '1', reinstall: [ok] }]))[0], false);
});

test('--update --dry-run lists the Copilot CLI upgrade for an agent lean-agents installed (PATH, NVM_DIR, HOME only)', { skip: process.platform === 'win32' && 'POSIX stub' }, () => {
  const home = tmp();
  const bin = path.join(home, 'stub');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'copilot'), '#!/bin/sh\necho 1.0.1\n', { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, NVM_DIR: path.join(home, '.nvm'), HOME: home };
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--yes', ...args], { encoding: 'utf8', env });
  assert.equal(run(['--no-exec', '--agents', 'claude', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']).status, 0);
  const dir = path.join(home, '.config', 'lean-agents');
  fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify({ agents: { 'copilot-cli': { method: 'npm', files: [], dirs: [] } } }));
  const r = run(['--update', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /copilot-cli: 1\.0\.1 -> /);
  assert.match(r.stdout, /upgrade copilot-cli 1\.0\.1 -> /);
});
