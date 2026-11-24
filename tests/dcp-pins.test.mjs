// #212: DCP is pinned in the server and the TUI config on OpenCode 1.x and 2.x; --doctor has one DCP row. Temp HOME, --no-exec.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { npmSpec } from '../scripts/lib/pins.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';
import { dcpRow } from '../scripts/lib/plugin-health.mjs';
import { opencodeV2Adapter } from '../scripts/lib/adapters/opencode-v2.mjs';
import { loadCore } from '../scripts/lib/render.mjs';
import { plan, apply, undo, applyJsonEdits, revertJsonEdits } from '../scripts/lib/fsops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = '@tarquinen/opencode-dcp';
const PIN = npmSpec('opencode-dcp');
const AGENTS = { 'opencode-v1': 'plugin', 'opencode-v2': 'plugins' };
const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR, LEAN_AGENTS_NODE: '24.22.2' };
const lean = (home, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { ...env, HOME: home } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
};
// 1.x: the real CLI. 2.x installs DCP only through the upgrade's dcp step, which applies the adapter's actions, so the test does the same.
const states = new Map();
const install = (home, agent) => {
  if (agent === 'opencode-v1') return lean(home, ['--yes', '--no-exec', '--agents', agent, '--tools', 'dcp', '--lang', 'en', '--profile', 'none']);
  const { actions } = opencodeV2Adapter({ home, core: loadCore(ROOT), profile: null, opts: { tools: ['dcp'], network: {}, terminals: [], platform: 'linux', env: {}, shell: 'default' }, rulesPath: path.join(home, 'rules.md') });
  const prior = states.get(home) ?? [];
  const entries = apply(plan(actions, [home], prior), path.join(home, 'b'), home, [home], []);
  states.set(home, [...prior, ...entries]);
};
const uninstall = (home, agent) => (agent === 'opencode-v1' ? lean(home, ['--yes', '--no-exec', '--uninstall']) : undo(states.get(home), [home]));

function setup(agent, server, tui) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dcp-'));
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const f = { home, dir, server: path.join(dir, 'opencode.jsonc'), tui: path.join(dir, 'tui.json') };
  fs.writeFileSync(f.server, `{\n  // mine\n  "${AGENTS[agent]}": ${JSON.stringify(server)}\n}\n`);
  if (tui) fs.writeFileSync(f.tui, `{\n  "plugin": ${JSON.stringify(tui)}\n}\n`);
  return f;
}
const list = (file, key) => parse(fs.readFileSync(file, 'utf8'))[key].filter((v) => !v.startsWith('context-mode')); // the default tool set adds it
const bytes = (f) => [fs.readFileSync(f.server, 'utf8'), fs.readFileSync(f.tui, 'utf8')];

for (const agent of Object.keys(AGENTS)) {
  const key = AGENTS[agent];
  test(`${agent}: @latest in server and TUI becomes the pin, --uninstall restores it byte for byte`, () => {
    const f = setup(agent, [`${PKG}@latest`], [`${PKG}@latest`]);
    const before = bytes(f);
    install(f.home, agent);
    assert.deepEqual(list(f.server, key), [PIN]);
    assert.deepEqual(list(f.tui, 'plugin'), [PIN]);
    const again = bytes(f);
    install(f.home, agent); // second run: nothing changes, no duplicate
    assert.deepEqual(bytes(f), again);
    uninstall(f.home, agent);
    assert.deepEqual(bytes(f), before);
  });

  test(`${agent}: bare name becomes the pin, an exact user version stays`, () => {
    const bare = setup(agent, [PKG], [PKG]);
    install(bare.home, agent);
    assert.deepEqual([list(bare.server, key), list(bare.tui, 'plugin')], [[PIN], [PIN]]);
    const mine = setup(agent, [`${PKG}@3.1.0`], [`${PKG}@3.1.0`]);
    install(mine.home, agent);
    assert.deepEqual([list(mine.server, key), list(mine.tui, 'plugin')], [[`${PKG}@3.1.0`], [`${PKG}@3.1.0`]]);
  });

  test(`${agent}: no TUI file is created; dcp.jsonc autoUpdate is set off only when absent`, () => {
    const f = setup(agent, ['other']);
    install(f.home, agent);
    assert.ok(!fs.existsSync(f.tui));
    assert.deepEqual(list(f.server, key), ['other', PIN]);
    assert.equal(parse(fs.readFileSync(path.join(f.dir, 'dcp.jsonc'), 'utf8')).autoUpdate, false);
    const own = setup(agent, ['other']);
    fs.writeFileSync(path.join(own.dir, 'dcp.jsonc'), '{ "autoUpdate": true }\n');
    install(own.home, agent);
    assert.equal(parse(fs.readFileSync(path.join(own.dir, 'dcp.jsonc'), 'utf8')).autoUpdate, true);
  });
}

test('doctor DCP row: @latest is changed; pinned with resolved deps and no probe is ok with the probe hint', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dcp-row-'));
  const dir = path.join(h, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(dcpRow(h), null);
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), JSON.stringify({ plugin: [`${PKG}@latest`] }));
  const latest = dcpRow(h);
  assert.equal(latest.status, 'changed');
  assert.match(latest.detail, /run lean-agents again to pin it/);
  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), JSON.stringify({ plugin: [PIN] }));
  fs.writeFileSync(path.join(dir, 'tui.json'), JSON.stringify({ plugin: [PIN] }));
  const nm = path.join(h, '.cache', 'opencode', 'packages', `${PKG}@3.2.0`, 'node_modules', ...PKG.split('/'));
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: PKG, version: '3.2.0' }));
  const ok = dcpRow(h);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.detail, `registered: ${PIN} (TUI: ${PIN}) ; resolved: 3.2.0 ; loads: not probed, run --doctor --probe-plugins`);
  assert.match(dcpRow(h, { probed: true }).detail, /loads: yes \(probe\)/);
  assert.match(dcpRow(h, { probed: true, probe: [{ id: 'probe-failed', plugin: '' }] }).detail, /loads: unknown \(probe failed\)/);
  assert.match(dcpRow(h, { probed: true, probe: [{ id: 'command-missing', plugin: 'other' }] }).detail, /loads: yes \(probe\)/);
  assert.equal(dcpRow(h, { probed: true, probe: [{ id: 'command-missing', plugin: PKG }] }).status, 'error');
});

test('a pin bump keeps the user entry: uninstall after two installs with different pins restores the bare name', () => {
  const edit = (v) => ({ path: ['plugin'], value: `${PKG}@${v}`, mode: 'arrayAdd', legacy: [`${PKG}@latest`, PKG], restore: true });
  const original = `{ "plugin": ["${PKG}"] }`;
  const one = applyJsonEdits(original, [edit('3.2.0')]);
  const two = applyJsonEdits(one.text, [edit('3.3.0')], one.applied);
  assert.deepEqual(parse(two.text).plugin, [`${PKG}@3.3.0`]);
  // --uninstall reverts state entries newest first.
  assert.equal(revertJsonEdits(revertJsonEdits(two.text, two.applied), one.applied), original);
});

test('doctor DCP row on unmanaged machines', () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dcp-unmanaged-'));
  const dir = path.join(h, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });

  let rows = [];
  doctor({ home: h, state: null, exec: false, collect: rows });
  assert.ok(!rows.some(r => r.item === 'DCP'));

  fs.writeFileSync(path.join(dir, 'opencode.jsonc'), JSON.stringify({ plugin: [`${PKG}@3.2.0`] }));
  rows = [];
  doctor({ home: h, state: null, exec: false, collect: rows });
  assert.ok(rows.some(r => r.item === 'DCP'));
});
