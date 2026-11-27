// #558: OpenCode 2's TUI config is cli.json once it exists; tui.json is then stale. DCP must not be registered twice,
// a hand-made #123 meter is dead there, and doctor names 1.x-shaped local plugins without printing their contents.
// Temp HOMEs and --no-exec; no real OpenCode runs here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parse } from 'jsonc-parser';
import { npmSpec } from '../scripts/lib/pins.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';
import { opencodeV2Adapter } from '../scripts/lib/adapters/opencode-v2.mjs';
import { loadCore } from '../scripts/lib/render.mjs';
import { plan, apply, undo } from '../scripts/lib/fsops.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PKG = '@tarquinen/opencode-dcp';
const PIN = npmSpec('opencode-dcp');
const CORE = loadCore(ROOT);
const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR, LEAN_AGENTS_NODE: '24.22.2' };
const lean = (home, args, expect = 0) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { ...env, HOME: home } });
  assert.equal(r.status, expect, r.stderr || r.stdout);
  return r;
};

const put = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
const setup = ({ server = [PIN], cli = null, tui = null } = {}) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-cli-json-'));
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const f = { home, dir, server: path.join(dir, 'opencode.jsonc'), cli: path.join(dir, 'cli.json'), tui: path.join(dir, 'tui.json') };
  put(f.server, `{\n  // mine\n  "plugins": ${JSON.stringify(server)}\n}\n`);
  if (cli) put(f.cli, `{\n  "plugins": ${JSON.stringify(cli)}\n}\n`);
  if (tui) put(f.tui, `{\n  "plugin": ${JSON.stringify(tui)}\n}\n`);
  return f;
};
const install = (home, tools = ['dcp'], prior = []) => {
  const { actions } = opencodeV2Adapter({ home, core: CORE, profile: null, opts: { tools, network: {}, terminals: [], platform: 'linux', env: {}, shell: 'default' }, rulesPath: path.join(home, 'rules.md') });
  return apply(plan(actions, [home], prior), path.join(home, 'backup'), home, [home], []);
};
const list = (f, key) => parse(fs.readFileSync(f, 'utf8'))[key];

test('2.x with cli.json: DCP is removed from cli.json and the stale tui.json, other TUI plugins stay, undo restores both', () => {
  const f = setup({ cli: ['some-tui-plugin', `${PKG}@3.1.15`], tui: [`${PKG}@3.1.15`] });
  const tuiBytes = fs.readFileSync(f.tui, 'utf8');
  const one = install(f.home);
  assert.deepEqual(list(f.cli, 'plugins'), ['some-tui-plugin']);
  assert.deepEqual(list(f.tui, 'plugin'), [], 'the migration would copy a TUI entry again');
  assert.ok(fs.existsSync(f.tui), 'stale tui.json file itself is never deleted');
  const two = [...one, ...install(f.home, ['dcp'], one)];
  assert.deepEqual(list(f.cli, 'plugins'), ['some-tui-plugin'], 'a rerun adds nothing');
  undo(two, [f.home]);
  assert.deepEqual(list(f.cli, 'plugins'), ['some-tui-plugin', `${PKG}@3.1.15`]);
  assert.equal(fs.readFileSync(f.tui, 'utf8'), tuiBytes);
});

test('2.x without cli.json: a DCP entry in the old tui.json is removed, so the migration cannot copy a duplicate', () => {
  const f = setup({ tui: [`${PKG}@latest`] });
  install(f.home);
  assert.deepEqual(list(f.tui, 'plugin'), []);
  assert.ok(fs.existsSync(f.tui), 'tui.json itself stays');
  // No server entry: cli/tui may be the only copy, so it stays.
  const own = setup({ server: [], tui: [PIN] });
  install(own.home);
  assert.deepEqual(list(own.tui, 'plugin'), [PIN]);
});

test('a normal --update repair (DCP not in the saved tools) drops the cli.json and tui.json entries when opencode.jsonc has DCP', () => {
  const f = setup({ cli: [PIN], tui: [PIN] });
  install(f.home, ['serena']);
  assert.deepEqual(list(f.cli, 'plugins'), []);
  assert.deepEqual(list(f.tui, 'plugin'), []);
  // No server entry: the cli.json entry may be the only copy, so it stays.
  const own = setup({ cli: [PIN], server: [] });
  install(own.home, ['serena']);
  assert.deepEqual(list(own.cli, 'plugins'), [PIN]);
});

test('doctor warns about a stale tui.json next to cli.json and never deletes it', () => {
  const f = setup({ cli: [], tui: [`${PKG}@3.1.15`] });
  const rows = [];
  doctor({ home: f.home, state: null, exec: false, collect: rows });
  const row = rows.find((r) => r.item === 'OpenCode tui.json');
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /stale: OpenCode 2 reads cli\.json/);
  assert.match(row.detail, /Fix: delete .*[\\/]\.config[\\/]opencode[\\/]tui\.json by hand/);
  assert.ok(fs.existsSync(f.tui));
});

test('doctor: a 1.x-shaped local plugin is named by path as not loaded on OpenCode 2', () => {
  const f = setup({ cli: null });
  const file = path.join(f.dir, 'plugins', 'old-tui', 'tui.js');
  put(file, 'export default (api) => { api.command.register({ name: "x" }); }\n');
  put(f.cli, { plugins: [pathToFileURL(file).href] });
  put(f.tui, { plugin: [] });
  const rows = [];
  doctor({ home: f.home, state: null, exec: false, collect: rows });
  const row = rows.find((r) => r.item === 'plugin tui.js');
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /not loaded on OpenCode 2/);
  assert.match(row.detail, /File: .*[\\/]plugins[\\/]old-tui[\\/]tui\.js/);
  assert.ok(!row.detail.includes('export default'), 'never prints plugin file contents');
});

test('doctor: a hand copy of the #123 meter gets the --add-tools copilot-usage offer', () => {
  const f = setup({ cli: null });
  const file = path.join(f.dir, 'plugins', 'copilot-usage-tui', 'tui.js');
  put(file, '// GitHub Copilot AI-credit allowance in the OpenCode TUI sidebar (lean-agents#123).\nexport default (api) => { api.slots.register({}); }\n');
  put(f.cli, { plugins: [pathToFileURL(file).href] });
  put(f.tui, { plugin: [] });
  const rows = [];
  doctor({ home: f.home, state: null, exec: false, collect: rows });
  const row = rows.find((r) => r.item === 'plugin tui.js');
  assert.match(row.detail, /hand-made copilot-usage meter, not loaded on OpenCode 2/);
  assert.match(row.detail, /lean-agents --add-tools copilot-usage/);
  assert.match(row.detail, /unit|uninstall/);
});

test('doctor: a stale tui.json next to cli.json adds no DCP spec-mismatch row', () => {
  const f = setup({ cli: [PIN], tui: [`${PKG}@3.1.15`] });
  const rows = [];
  doctor({ home: f.home, state: null, exec: false, collect: rows });
  assert.ok(!JSON.stringify(rows).includes('spec-mismatch'), JSON.stringify(rows));
  const row = rows.find((r) => r.item === 'DCP');
  assert.match(row.detail, new RegExp(`TUI: ${PIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('doctor: DCP in opencode.jsonc and cli.json is one duplicate /dcp warning', () => {
  const f = setup({ cli: [PIN], tui: [PIN] });
  const rows = [];
  doctor({ home: f.home, state: null, exec: false, collect: rows });
  const row = rows.find((r) => r.item === 'DCP /dcp duplicate');
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /listed in opencode\.jsonc and cli\.json and tui\.json/);
  assert.match(row.detail, /lean-agents --update/);
});

test('copilot-usage on 2.x removes the hand-made meter entry only, and undo restores it', () => {
  const f = setup({ cli: null, server: [] });
  const file = path.join(f.dir, 'plugins', 'copilot-usage-tui', 'tui.js');
  put(file, '// lean-agents#123 hand copy\nexport default (api) => { api.command.register({}); }\n');
  const entry = pathToFileURL(file).href;
  put(f.cli, { plugins: ['keep-me', entry] });
  const one = install(f.home, ['copilot-usage']);
  assert.deepEqual(list(f.cli, 'plugins'), ['keep-me']);
  assert.ok(fs.existsSync(path.join(f.dir, 'plugins', 'lean-copilot-usage', 'tui.js')));
  undo(one, [f.home]);
  assert.deepEqual(list(f.cli, 'plugins').sort(), ['keep-me', entry].sort());
});

test('--update --yes replaces the hand-made #123 meter with the managed tool and plans it', () => {
  const f = setup({ cli: null, server: [] });
  lean(f.home, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'serena', '--lang', 'en', '--profile', 'none']);
  const file = path.join(f.dir, 'plugins', 'copilot-usage-tui', 'tui.js');
  put(file, '// lean-agents#123 hand copy\nexport default (api) => { api.command.register({}); }\n');
  const entry = pathToFileURL(file).href;
  put(f.cli, { plugins: ['keep-me', entry] });
  const r = lean(f.home, ['--update', '--yes', '--no-exec']);
  assert.deepEqual(list(f.cli, 'plugins'), ['keep-me']);
  assert.ok(fs.existsSync(path.join(f.dir, 'plugins', 'lean-copilot-usage', 'tui.js')));
  assert.match(r.stdout, /removes hand-made copilot-usage/);
});

test('--update --yes treats a copilot-usage-tui entry whose target file is missing as dead', () => {
  const f = setup({ cli: null, server: [] });
  lean(f.home, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'serena', '--lang', 'en', '--profile', 'none']);
  // The owner's layout: the folder is named copilot-usage-tui but its tui.js is gone.
  const entry = pathToFileURL(path.join(f.dir, 'plugins', 'copilot-usage-tui', 'tui.js')).href;
  put(f.cli, { plugins: ['keep-me', entry] });
  lean(f.home, ['--update', '--yes', '--no-exec']);
  assert.deepEqual(list(f.cli, 'plugins'), ['keep-me']);
  assert.ok(fs.existsSync(path.join(f.dir, 'plugins', 'lean-copilot-usage', 'tui.js')));
});

test('--add-tools copilot-usage removes the entry too, and undo restores it', () => {
  const f = setup({ cli: null, server: [] });
  lean(f.home, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'serena', '--lang', 'en', '--profile', 'none']);
  const file = path.join(f.dir, 'plugins', 'copilot-usage-tui', 'tui.js');
  put(file, '// lean-agents#123 hand copy\nexport default (api) => { api.command.register({}); }\n');
  const entry = pathToFileURL(file).href;
  put(f.cli, { plugins: [entry] });
  lean(f.home, ['--add-tools', 'copilot-usage', '--yes', '--no-exec']);
  assert.deepEqual(list(f.cli, 'plugins'), []);
  const rows = [];
  doctor({ home: f.home, state: null, exec: false, collect: rows });
  assert.ok(!rows.some((r) => r.item === 'plugin tui.js' && /hand-made copilot-usage/.test(r.detail)));
});