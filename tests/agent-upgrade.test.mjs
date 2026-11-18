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

test('undoUpgrades reinstalls the oldest saved version per agent, reports a failure and keeps going', () => {
  const ok = [process.execPath, '-e', 'process.exit(0)'];
  const bad = [process.execPath, '-e', 'process.exit(1)'];
  const cmds = [{ desc: 'x' }, { desc: 'upgrade a 1 -> 2', from: '1', reinstall: [ok] }, { desc: 'upgrade a 2 -> 3', from: '2', reinstall: [bad] }];
  const [good, out] = quietly(() => undoUpgrades(cmds));
  assert.equal(good.ok, true);
  assert.deepEqual([...good.restored], ['a']);
  assert.match(out, /reinstall 1 \(undo of: upgrade a 1 -> 2\)/);
  assert.doesNotMatch(out, /reinstall 2/);
  const [r] = quietly(() => undoUpgrades([{ desc: 'upgrade b 1 -> 2', from: '1', reinstall: [bad] }, { desc: 'upgrade c 1 -> 2', from: '1', reinstall: [ok] }]));
  assert.equal(r.ok, false);
  assert.deepEqual([...r.restored], ['c']);
});

test('the downloaded installer is removed by a final step, and `from` keeps a pre-release tag', { skip: process.platform === 'win32' && 'POSIX installers' }, () => {
  const [c] = upgradeCommands({ rows: [row('claude-code', { installed: '2.0.1', raw: '2.0.1-beta' })], home: tmp(), dir: '/tmp/x', realHome: '/nowhere' });
  assert.ok(!c.run.some((a) => a.includes('-e')), 'no removal among the steps that stop on a failure');
  assert.deepEqual(c.always.map((a) => a.at(-1)), ['/tmp/x/claude-installer.sh']);
  assert.deepEqual(c.reinstallAlways.map((a) => a.at(-1)), ['/tmp/x/claude-installer.sh']);
  assert.equal(c.from, '2.0.1-beta');
  assert.match(argv(c, 'reinstall'), /claude-installer\.sh 2\.0\.1-beta/);
});

// Stubs (npx too, so nothing reaches the network): claude and copilot print a version; curl "downloads" a file the sha256 check rejects (the failing installer); npm logs its argv.
const POSIX = { skip: process.platform === 'win32' && 'POSIX installers and stubs' };
function stubHome(copilotVer) {
  const home = tmp();
  const bin = path.join(home, 'stub');
  const log = path.join(home, 'npm.log');
  fs.mkdirSync(bin);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub('claude', 'echo 2.1.0-beta.1');
  stub('copilot', `echo ${copilotVer}`);
  stub('curl', 'while [ $# -gt 0 ]; do [ "$1" = -o ] && echo stub > "$2"; shift; done');
  stub('npm', `echo "$@" >> '${log}'`);
  stub('npx', 'exit 0');
  const env = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`, NVM_DIR: path.join(home, '.nvm'), HOME: home };
  const lean = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env });
  assert.equal(lean(['--yes', '--no-exec', '--agents', 'claude', '--no-tools', '--no-gh', '--terminal', 'none', '--lang', 'en', '--profile', 'none']).status, 0);
  const dir = path.join(home, '.config', 'lean-agents');
  fs.writeFileSync(path.join(dir, 'agents.json'), JSON.stringify({ agents: { claude: { method: 'script', files: [], dirs: [] }, 'copilot-cli': { method: 'npm', files: [], dirs: [] } } }));
  const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  return { home, dir, log, lean, state };
}

test('--update --yes: a failing installer is recorded with from/reinstall, exits non-zero and later steps still run', POSIX, () => {
  const { dir, log, lean, state } = stubHome('1.0.1');
  const r = lean(['--update', '--yes']);
  assert.notEqual(r.status, 0, r.stdout);
  const up = state().commands.filter((c) => c.reinstall);
  assert.deepEqual(up.map((c) => c.from), ['2.1.0-beta.1', '1.0.1']);
  assert.equal(up[0].ok, false);
  assert.match(up[0].reinstall.map((a) => a.join(' ')).join('\n'), /claude-installer\.sh 2\.1\.0-beta\.1/);
  assert.ok(fs.existsSync(log) && /install -g .*@github\/copilot@1\.0\.105/.test(fs.readFileSync(log, 'utf8')), 'the npm step after the failed one ran');
  assert.ok(!fs.existsSync(path.join(dir, 'claude-installer.sh')), 'the downloaded script is removed although a step failed');
});

test('--update --undo: plan first, then the oldest version per agent; two upgrades in a row end on the first', POSIX, () => {
  const { dir, log, lean, state } = stubHome('1.0.1');
  lean(['--update', '--yes']);
  // A second upgrade run after the first: copilot 1.0.101 -> pin, recorded after the 1.0.1 one.
  const s = state();
  s.commands.push({ desc: 'upgrade copilot-cli 1.0.101 -> 1.0.105', ok: true, undo: [], from: '1.0.101', reinstall: [['npm', 'install', '-g', '@github/copilot@1.0.101']] });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
  fs.writeFileSync(log, '');
  const plan = lean(['--update', '--undo']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /copilot-cli: back to 1\.0\.1\b/);
  assert.equal(fs.readFileSync(log, 'utf8'), '', 'a plan runs nothing');
  const r = lean(['--update', '--undo', '--yes']);
  assert.notEqual(r.status, 0, 'the claude reinstall fails (stub installer), the rest still runs');
  const calls = fs.readFileSync(log, 'utf8');
  assert.match(calls, /@github\/copilot@1\.0\.1$/m);
  assert.doesNotMatch(calls, /1\.0\.101/);
  const left = state().commands.filter((c) => c.reinstall).map((c) => c.from);
  assert.deepEqual(left, ['2.1.0-beta.1'], 'copilot records are spent, the failed claude one is kept');
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
