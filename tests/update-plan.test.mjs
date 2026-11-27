// --update plan model: rows, held/major/own guards and the CHANGELOG slice, on synthetic pins and state (no binaries, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planUpdate, appUpdateRows, appAdoptQuestion, appAdoptHint, appAdoptAction, changelogNotes, formatUpdatePlan, compareAppVersions } from '../scripts/lib/update-plan.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pins = {
  caveman: { kind: 'skill', version: 'v2.0.0' },
  'claude-code': { kind: 'npm', version: '2.1.316', ciOnly: true },
  'opencode-v1': { kind: 'npm', version: '1.19.0', hold: true, ciOnly: true },
  'opencode-v2': { kind: 'npm', version: '2.2.5', ciOnly: true },
  'copilot-cli': { kind: 'npm', version: '1.0.105', ciOnly: true },
  bun: { kind: 'download', version: '1.4.4' },
  'orca-app': { kind: 'download', version: '1.4.280' },
  'warp-app': { kind: 'download', version: '0.2026.11.18.08.17.stable_06' },
};
const saved = { version: '0.7.0', pins: { caveman: 'v1.0.0', bun: '1.0.0', codeburn: '0.0.1' }, options: { tools: ['caveman'] } };
const rowOf = (rows, tool) => rows.find((r) => r.tool === tool);

test('tools in use that are behind the pin get an update row; download pins and unused tools do not', () => {
  const rows = planUpdate({ saved, pins });
  assert.deepEqual(rows, [{ tool: 'caveman', installed: 'v1.0.0', pinned: 'v2.0.0', action: 'update', reason: null }]);
});

test('OpenCode 1.x is held, whoever installed it', () => {
  for (const owned of [[], ['opencode-v2']]) {
    const r = rowOf(planUpdate({ saved, pins, owned, installed: { opencode: '1.19.0' } }), 'opencode-v1');
    assert.equal(r.action, 'held');
    assert.equal(rowOf(planUpdate({ saved, pins, owned, installed: { opencode: '1.19.0' } }), 'opencode-v2'), undefined);
  }
});

test('agent CLI: updated within its major, held across it, left alone when the user installed it', () => {
  const owned = ['claude', 'copilot-cli'];
  const rows = planUpdate({ saved, pins, owned, installed: { claude: '2.1.0', copilot: '0.9.9', opencode: '2.0.0' } });
  assert.equal(rowOf(rows, 'claude-code').action, 'update');
  assert.equal(rowOf(rows, 'copilot-cli').action, 'major');
  assert.equal(rowOf(rows, 'opencode-v2').action, 'own');
});

test('agent CLI at or above the pin, missing, or unreadable gets no row', () => {
  const rows = planUpdate({ saved, pins, owned: ['claude'], installed: { claude: '2.1.316', opencode: '9.0.0', copilot: 'unknown' } });
  assert.equal(rows.filter((r) => r.tool !== 'caveman').length, 0);
});

const log = '# Changelog\n\n## [Unreleased]\n\n- next\n\n## [0.9.0] - 2026-12-01\n\n### Added\n- nine\n\n## [0.8.0] - 2026-11-12\n- eight\n\n## [0.7.0] - 2026-11-01\n- seven\n';

test('notes: sections after the installed version up to the current one, never Unreleased', () => {
  assert.deepEqual(changelogNotes(log, '0.7.0', '0.9.0').map((n) => n.version), ['0.9.0', '0.8.0']);
  assert.deepEqual(changelogNotes(log, '0.7.0', '0.8.0').map((n) => n.version), ['0.8.0']);
  assert.equal(changelogNotes(log, '0.9.0', '0.9.0').length, 0);
  assert.equal(changelogNotes(undefined, '0.1.0', '0.9.0').length, 0);
  assert.equal(changelogNotes(log, '0.8.0', '0.9.0')[0].body, '### Added\n- nine');
});

test('format: moves, then what is not updated, then notes', () => {
  const text = formatUpdatePlan(planUpdate({ saved, pins, installed: { opencode: '1.19.0' } }), changelogNotes(log, '0.8.0', '0.9.0'));
  assert.match(text, /^Pins that will change \(old -> new\):\ncaveman: v1\.0\.0 -> v2\.0\.0\nNot updated:\nopencode-v1: 1\.19\.0 \(OpenCode 1\.x/);
  assert.match(text, /Release notes since your version \(0\.9\.0\):\n## 0\.9\.0\n### Added/);
  assert.equal(formatUpdatePlan([], []), '');
});

test('app versions compare every numeric part, not only x.y.z', () => {
  assert.equal(compareAppVersions('v1.4.280', '1.4.264'), 1);
  assert.equal(compareAppVersions('0.2026.11.18.08.17.stable_06', '0.2026.11.04.08.17.stable_01'), 1);
  assert.equal(compareAppVersions('0.2026.11.18.08.17.stable_06', 'v0.2026.11.18.08.17.stable_06'), 0);
  assert.equal(compareAppVersions('1.4.264', '1.4.280'), -1);
});

test('app rows: managed behind the pin updates, user-installed behind the pin is left alone, equal or newer is skipped', () => {
  const rows = appUpdateRows({ pins, platform: 'win32', installed: { orca: '1.4.264', warp: '0.2026.11.04.08.17.stable_01' }, managed: ['orca'] });
  assert.deepEqual(rows.map(({ tool, app, installed, pinned, action }) => ({ tool, app, installed, pinned, action })), [
    { tool: 'orca-app', app: 'orca', installed: '1.4.264', pinned: '1.4.280', action: 'update' },
    { tool: 'warp-app', app: 'warp', installed: '0.2026.11.04.08.17.stable_01', pinned: '0.2026.11.18.08.17.stable_06', action: 'own' },
  ]);
  assert.deepEqual(appUpdateRows({ pins, platform: 'win32', installed: { orca: '1.4.280' }, managed: ['orca'] }), []);
  assert.deepEqual(appUpdateRows({ pins, platform: 'win32', installed: { orca: '1.4.300' }, managed: ['orca'] }), []);
});

test('macOS Warp rows follow the Homebrew cask, and a remembered no is not asked again', () => {
  const [warp] = appUpdateRows({ pins, platform: 'darwin', installed: { warp: '0.2026.11.04.08.17.stable_01' }, managed: ['warp'] });
  assert.equal(warp.via, 'homebrew cask');
  assert.match(formatUpdatePlan([warp], []), /warp app 0\.2026\.11\.04\.08\.17\.stable_01 -> the latest Homebrew cask \(not the pin\)/);
  assert.match(appAdoptQuestion(warp), /latest Homebrew cask/);

  const row = { app: 'orca', label: 'Orca', installed: '1.4.264', pinned: '1.4.280' };
  assert.equal(appAdoptAction({ row, canAsk: true }), 'ask');
  assert.equal(appAdoptAction({ row, canAsk: true, declined: ['orca'] }), 'hint', 'a remembered no is not asked again');
  assert.equal(appAdoptAction({ row, canAsk: true, declined: ['orca'], requested: ['orca'] }), 'adopt', '--install-terminal overrides the no');
  assert.equal(appAdoptAction({ row, canAsk: false }), 'hint');
});

test('app plan lines: dry run shows the app old -> pin, and the user-installed row names why it is left alone', () => {
  const rows = appUpdateRows({ pins, platform: 'win32', installed: { orca: '1.4.264', warp: '0.2026.11.04.08.17.stable_01' }, managed: ['orca'] });
  const text = formatUpdatePlan(rows, []);
  assert.match(text, /orca app 1\.4\.264 -> 1\.4\.280/);
  assert.match(text, /warp app 0\.2026\.11\.04\.08\.17\.stable_01 -> 0\.2026\.11\.18\.08\.17\.stable_06 \(installed by you, left alone\)/);
});

test('app adopt prompt and non-interactive hint name the app, versions and the exact flag', () => {
  const [orca] = appUpdateRows({ pins, platform: 'win32', installed: { orca: '1.4.264' }, managed: [] });
  assert.equal(appAdoptQuestion(orca), 'Orca 1.4.264 was not installed by lean-agents. Update it to 1.4.280 and manage it?');
  assert.equal(appAdoptHint(orca), '! Orca app 1.4.264 -> 1.4.280 is not managed: run --update --install-terminal orca to update it');
});

test('--update --dry-run --json carries update.rows and update.notes (temp HOME, PATH only)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  // PATH holds only node: no real claude/opencode/copilot may be probed.
  const env = { PATH: path.dirname(process.execPath), HOME: home, ...(process.env.NVM_DIR && { NVM_DIR: process.env.NVM_DIR }) };
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', '--yes', ...args], { encoding: 'utf8', env });
  assert.equal(run(['--agents', 'claude', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']).status, 0);
  const file = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.version = '0.0.1';
  state.pins.caveman = 'v0.0.1';
  fs.writeFileSync(file, JSON.stringify(state));
  const r = run(['--update', '--dry-run', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const { update } = JSON.parse(r.stdout);
  assert.equal(rowOf(update.rows, 'caveman').action, 'update');
  assert.ok(update.notes.length > 0 && update.notes.every((n) => /^\d+\.\d+\.\d+$/.test(n.version)));
});

test('--update --dry-run on a hand-built machine without state.json says run --adopt --yes, then install', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"enabledPlugins": {"context-mode@latest": true}}');
  // NVM_DIR inside the temp HOME: a real one would make --adopt find the runner's Node
  const env = { PATH: path.dirname(process.execPath), HOME: home, NVM_DIR: path.join(home, '.nvm') };
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', '--yes', ...args], { encoding: 'utf8', env });

  const r = run(['--update', '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lean-agents is not installed; run --adopt --yes, then install \(--everything --yes\)/);

  // after an adopt-only run (#179 PC): name --adopt, not --migrate, and the install that comes next
  const st = path.join(home, '.config', 'lean-agents');
  fs.mkdirSync(st, { recursive: true });
  fs.writeFileSync(path.join(st, 'state.json'), JSON.stringify({ version: '1.0.0', adoptOnly: true, options: { migrateOnly: true, agents: [], tools: [] }, files: [], commands: [], adopt: {} }));
  const a = run(['--update', '--dry-run']);
  assert.equal(a.status, 1);
  assert.match(a.stderr, /nothing to update: only --adopt ran here; install first \(--everything --yes\)/);
  // the install it names keeps the adopt record (--adopt --undo reads it) and makes --update work
  assert.equal(run(['--agents', 'claude']).status, 0);
  const after = JSON.parse(fs.readFileSync(path.join(st, 'state.json'), 'utf8'));
  assert.deepEqual([after.adopt, after.adoptOnly, after.options.migrateOnly], [{}, undefined, undefined]);
  assert.equal(run(['--update', '--dry-run']).status, 0);
  fs.rmSync(st, { recursive: true, force: true });

  // also check that with nothing to adopt, it just says not installed
  fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
  const r2 = run(['--update', '--dry-run']);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /nothing to update: lean-agents is not installed$/m);

  fs.rmSync(home, { recursive: true, force: true });
});

test('#489: --update reuses a saved profile none and does not ask for it again', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const env = { PATH: path.dirname(process.execPath), HOME: home, ...(process.env.NVM_DIR && { NVM_DIR: process.env.NVM_DIR }) };
  const lean = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', ...args], { encoding: 'utf8', env, input: '' });
  assert.equal(lean(['--yes', '--agents', 'opencode-v2', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']).status, 0);
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.equal(state.options.profile, null, 'none is saved as null');
  // No --dry-run: a dry run without a terminal takes the defaults and would hide the question. The plan question then fails on empty stdin.
  const r = lean(['--update']);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /OpenCode model profile/);
  assert.match(r.stdout, /profile: none/);
});

test('#489: an older saved state with OpenCode but no profile key is reused as none', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const env = { PATH: path.dirname(process.execPath), HOME: home, ...(process.env.NVM_DIR && { NVM_DIR: process.env.NVM_DIR }) };
  const lean = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', ...args], { encoding: 'utf8', env, input: '' });
  assert.equal(lean(['--yes', '--agents', 'claude', '--tools', 'caveman', '--lang', 'en']).status, 0);
  const file = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete state.options.profile;
  state.options.agents = ['opencode-v2'];
  fs.writeFileSync(file, JSON.stringify(state));
  const r = lean(['--update']);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /OpenCode model profile/);
  assert.match(r.stdout, /profile: none/);
});

test('#488: runningBlocker stops only OpenCode steps while opencode runs', async () => {
  const { runningBlocker } = await import('../scripts/lib/opencode-backup.mjs');
  const rtk = { tool: 'rtk', desc: 'RTK plugin for OpenCode', run: [['rtk', 'init', '-g', '--opencode']] };
  const up = { tool: 'opencode-v2', desc: 'upgrade opencode-v2 2.2.5 -> 2.2.7', run: [['npm', 'i', '-g', 'opencode-ai@2.2.7']] };
  const other = { tool: 'caveman', desc: 'Caveman skill', run: [['npx', 'skills', 'add', 'x']] };
  assert.match(runningBlocker([other, rtk], () => ['bash', 'opencode.exe']), /opencode service stop/);
  assert.match(runningBlocker([up], () => ['/usr/local/bin/opencode']), /opencode process is running/);
  assert.equal(runningBlocker([rtk, up], () => ['bash', 'node']), null);
  assert.equal(runningBlocker([other], () => ['opencode']), null);
  assert.equal(runningBlocker([up], () => []), null);
  assert.match(runningBlocker([up], () => { throw new Error('no ps'); }), /cannot list the running processes \(no ps\)/);
  assert.equal(runningBlocker([other], () => { throw new Error('no ps'); }), null);
});

// POSIX: a fake `ps` on PATH stands in for a running 2.x service.
test('#488: --update refuses before any command while opencode runs; --dry-run shows the blocker', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  const mark = path.join(bin, 'ran');
  fs.writeFileSync(path.join(bin, 'ps'), '#!/bin/sh\nprintf "bash\\nopencode\\n"\n', { mode: 0o755 });
  for (const b of ['rtk', 'npx', 'npm', 'opencode']) fs.writeFileSync(path.join(bin, b), `#!/bin/sh\necho "$0 $*" >> "${mark}"\n`, { mode: 0o755 });
  const env = { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, ...(process.env.NVM_DIR && { NVM_DIR: process.env.NVM_DIR }) };
  const lean = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env, input: '' });
  assert.equal(lean(['--no-exec', '--yes', '--agents', 'opencode-v2', '--tools', 'rtk', '--lang', 'en', '--profile', 'none']).status, 0);
  const dry = lean(['--update', '--dry-run', '--yes']);
  assert.match(dry.stdout, /opencode process is running/);
  assert.match(dry.stdout, /Dry run: nothing was changed/);
  const json = lean(['--update', '--dry-run', '--yes', '--json']);
  assert.doesNotThrow(() => JSON.parse(json.stdout), 'stdout stays JSON');
  assert.match(json.stderr, /blocker: an opencode process is running/);
  const r = lean(['--update', '--yes']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(`${r.stdout}${r.stderr}`, /opencode service stop/);
  const ran = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').split('\n').filter((l) => l && !l.endsWith(' --version')) : [];
  assert.deepEqual(ran, [], 'only version probes ran');
});
