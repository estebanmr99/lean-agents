// copilot-usage: --usage output, the OpenCode TUI plugin install/uninstall, and the plugin itself (fake gh, fake api).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ENGINE = path.join(ROOT, 'scripts', 'lean.mjs');
const TUI_SOURCE = path.join(ROOT, 'core', 'copilot-usage-tui.js');
const isWin = process.platform === 'win32';
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `lean-${p}-`));

const LIMITED = { quota_reset_date: '2026-12-01', quota_snapshots: { premium_interactions: { unlimited: false, entitlement: 25000, remaining: 15441, percent_remaining: 61.7 } } };
const UNLIMITED = { quota_snapshots: { premium_interactions: { unlimited: true } } };

// A `gh` on PATH that prints `json`, or fails when json is null. Returns the PATH value to use.
function fakeGh(json) {
  const dir = tmp('gh');
  const data = path.join(dir, 'out.json');
  if (json) fs.writeFileSync(data, JSON.stringify(json));
  if (isWin) fs.writeFileSync(path.join(dir, 'gh.cmd'), json ? `@type "${data}"\r\n` : '@exit /b 1\r\n');
  else {
    fs.writeFileSync(path.join(dir, 'gh'), json ? `#!/bin/sh\ncat '${data}'\n` : '#!/bin/sh\nexit 1\n');
    fs.chmodSync(path.join(dir, 'gh'), 0o755);
  }
  return dir + path.delimiter + process.env.PATH;
}

const usage = (json) => {
  const r = spawnSync(process.execPath, [ENGINE, '--home', tmp('home'), '--usage'], { encoding: 'utf8', env: { ...process.env, PATH: fakeGh(json) } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

test('--usage: limited, unlimited, failure (never zero)', () => {
  assert.equal(usage(LIMITED), '15441 of 25000 credits left (61%), about $154.41 of $250.00, resets 2026-12-01');
  assert.equal(usage(UNLIMITED), 'Unlimited premium requests');
  assert.equal(usage(null), 'unavailable');
});

const engine = (home, args) => {
  const r = spawnSync(process.execPath, [ENGINE, '--home', home, '--no-exec', '--yes', '--lang', 'en', '--profile', 'none', ...args], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '' } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
};

for (const agent of ['opencode-v1', 'opencode-v2']) {
  test(`${agent}: plugin file and tui.json entry are added, kept once, and undone`, () => {
    const home = tmp('home');
    const dir = path.join(home, '.config', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const mine = { plugin: ['@tarquinen/opencode-dcp@3.2.1', 'file:///orca/status-shim.js'] };
    fs.writeFileSync(path.join(dir, 'tui.json'), JSON.stringify(mine));
    const args = ['--agents', agent, '--tools', 'copilot-usage', '--network', 'on'];
    engine(home, args);
    engine(home, args);
    const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
    assert.match(fs.readFileSync(file, 'utf8'), /^\/\/ managed by lean-agents\n/);
    const entry = pathToFileURL(file).href;
    const tui = JSON.parse(fs.readFileSync(path.join(dir, 'tui.json'), 'utf8'));
    assert.deepEqual(tui.plugin, [...mine.plugin, entry]);
    engine(home, ['--uninstall']);
    assert.ok(!fs.existsSync(file));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tui.json'), 'utf8')).plugin, mine.plugin);
  });
}

test('--outbound off skips copilot-usage with a note and writes nothing', () => {
  const home = tmp('home');
  const out = engine(home, ['--agents', 'opencode-v1', '--tools', 'copilot-usage', '--outbound', 'off']);
  assert.match(out, /copilot-usage skipped/);
  assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode', 'plugins', 'lean-copilot-usage')));
});

// A tui.js copy next to a fake @opentui/solid, so the plugin's own import resolves.
async function loadPlugin() {
  const dir = tmp('plugin');
  const mod = path.join(dir, 'node_modules', '@opentui', 'solid');
  fs.mkdirSync(mod, { recursive: true });
  fs.writeFileSync(path.join(mod, 'package.json'), '{"name":"@opentui/solid","type":"module","main":"index.js"}');
  fs.writeFileSync(path.join(mod, 'index.js'), 'export const createElement = (type) => ({ type, props: {}, kids: [] });\nexport const setProp = (n, k, v) => { n.props[k] = v; };\nexport const insert = (p, c) => { p.kids.push(c); };\n');
  fs.copyFileSync(TUI_SOURCE, path.join(dir, 'tui.js'));
  return (await import(pathToFileURL(path.join(dir, 'tui.js')).href)).default;
}

function fakeApi({ keymap = false } = {}) {
  const calls = { toast: [], command: [], layers: [], render: 0, slots: [] };
  const api = {
    theme: { current: { text: 'T', textMuted: 'M', success: 'S', warning: 'W', error: 'E', borderSubtle: 'B' } },
    slots: { register: (s) => calls.slots.push(s) },
    renderer: { requestRender: () => { calls.render++; } },
    ui: { toast: (t) => calls.toast.push(t) },
    event: { on: () => () => {} },
    lifecycle: { onDispose: () => {} },
  };
  if (keymap) api.keymap = { registerLayer: (l) => { calls.layers.push(l); return () => {}; } };
  else api.command = { register: (f) => { calls.command.push(f()); return () => {}; } };
  // The plugin must never reach a model or a session.
  for (const name of ['client', 'session', 'sdk']) Object.defineProperty(api, name, { get() { throw new Error(`plugin touched api.${name}`); } });
  return { api, calls };
}

const texts = (box) => box.kids.flatMap((row) => (row.props.visible === false ? [] : row.kids.filter((t) => t.props.visible !== false).map((t) => t.props.content)));
// Polls: a spawned gh takes longer under a loaded CI runner.
async function until(ok) {
  for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
}

test('tui.js: limited credits paint into the mounted nodes after data arrives; no model request', async () => {
  const old = process.env.PATH;
  try {
    const plugin = await loadPlugin();
    process.env.PATH = fakeGh(LIMITED);
    const { api, calls } = fakeApi();
    await plugin.tui(api);
    const box = calls.slots[0].slots.sidebar_content();
    assert.ok(texts(box).includes('loading...'));
    await until(() => !texts(box).includes('loading...'));
    const t = texts(box).join('|');
    assert.match(t, /61% left/);
    assert.ok(t.includes('15,441'));
    assert.ok(calls.render >= 1);
    assert.equal(calls.command[0][0].slash.name, 'copilot-usage');
    assert.equal(calls.toast.length, 0); // 61% left: no startup toast while the sidebar is mounted
    await calls.command[0][0].onSelect({ clear() {} });
    assert.match(calls.toast[0].message, /Left 15,441 \(\$154\.41\)/);
  } finally { process.env.PATH = old; }
});

test('tui.js: unlimited and gh failure (unavailable, not zero)', async () => {
  const old = process.env.PATH;
  try {
    const plugin = await loadPlugin();
    process.env.PATH = fakeGh(UNLIMITED);
    let { api, calls } = fakeApi();
    await plugin.tui(api);
    let box = calls.slots[0].slots.sidebar_content();
    await until(() => !texts(box).includes('loading...'));
    assert.deepEqual(texts(box), ['Unlimited premium requests']);
    process.env.PATH = fakeGh(null);
    ({ api, calls } = fakeApi());
    await plugin.tui(api);
    box = calls.slots[0].slots.sidebar_content();
    await until(() => !texts(box).includes('loading...'));
    assert.deepEqual(texts(box), ['unavailable (gh api failed)']);
    await calls.command[0][0].onSelect();
    assert.match(calls.toast[0].message, /Unavailable/);
  } finally { process.env.PATH = old; }
});

test('tui.js: registers the command through keymap.registerLayer when api.command is missing (2.x)', async () => {
  const old = process.env.PATH;
  try {
    const plugin = await loadPlugin();
    process.env.PATH = fakeGh(LIMITED);
    const { api, calls } = fakeApi({ keymap: true });
    await plugin.tui(api);
    assert.equal(calls.layers[0].commands[0].slash.name, 'copilot-usage');
  } finally { process.env.PATH = old; }
});

test('tui.js: unusable numbers show unavailable, an out-of-range percent is clamped', async () => {
  const old = process.env.PATH;
  const quota = (p) => ({ quota_reset_date: '2026-12-01', quota_snapshots: { premium_interactions: { unlimited: false, entitlement: 100, remaining: 50, ...p } } });
  try {
    const plugin = await loadPlugin();
    for (const [data, want] of [[quota({ percent_remaining: 'x' }), /unavailable/], [quota({ percent_remaining: 250 }), /100% left/]]) {
      process.env.PATH = fakeGh(data);
      const { api, calls } = fakeApi();
      await plugin.tui(api);
      const box = calls.slots[0].slots.sidebar_content();
      await until(() => !texts(box).includes('loading...'));
      assert.match(texts(box).join('|'), want);
    }
  } finally { process.env.PATH = old; }
});

test('--usage under --outbound off prints a skip note and makes no call', () => {
  const r = spawnSync(process.execPath, [ENGINE, '--home', tmp('home'), '--usage', '--outbound', 'off'], { encoding: 'utf8', env: { ...process.env, PATH: fakeGh(LIMITED) } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage skipped/);
  assert.ok(!/credits left/.test(r.stdout));
});

test('fresh HOME: install creates tui.json, uninstall removes it (the empty plugin folder stays: fsops removes files only)', () => {
  const home = tmp('home');
  const dir = path.join(home, '.config', 'opencode');
  engine(home, ['--agents', 'opencode-v1', '--tools', 'copilot-usage', '--network', 'on']);
  assert.ok(fs.existsSync(path.join(dir, 'tui.json')));
  engine(home, ['--uninstall']);
  assert.ok(!fs.existsSync(path.join(dir, 'tui.json')));
  assert.ok(!fs.existsSync(path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js')));
});
