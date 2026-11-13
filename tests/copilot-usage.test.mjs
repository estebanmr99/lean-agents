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

test('opencode-v1: plugin file and tui.json entry are added, kept once, and undone', () => {
  const home = tmp('home');
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const mine = { plugin: ['@tarquinen/opencode-dcp@3.2.1', 'file:///orca/status-shim.js'] };
  fs.writeFileSync(path.join(dir, 'tui.json'), JSON.stringify(mine));
  const args = ['--agents', 'opencode-v1', '--tools', 'copilot-usage', '--network', 'on'];
  engine(home, args);
  engine(home, args);
  const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
  assert.match(fs.readFileSync(file, 'utf8'), /^\/\/ managed by lean-agents\n/);
  const tui = JSON.parse(fs.readFileSync(path.join(dir, 'tui.json'), 'utf8'));
  assert.deepEqual(tui.plugin, [...mine.plugin, pathToFileURL(file).href]);
  engine(home, ['--uninstall']);
  assert.ok(!fs.existsSync(file));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'tui.json'), 'utf8')).plugin, mine.plugin);
});

// 2.x discovers plugins/<dir>/tui.js on its own: the file is written and tui.json is left alone.
test('opencode-v2: plugin file only (no tui.json entry), undone by --uninstall', () => {
  const home = tmp('home');
  const dir = path.join(home, '.config', 'opencode');
  const args = ['--agents', 'opencode-v2', '--tools', 'copilot-usage', '--network', 'on'];
  engine(home, args);
  const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
  assert.match(fs.readFileSync(file, 'utf8'), /^\/\/ managed by lean-agents\n/);
  assert.ok(!fs.existsSync(path.join(dir, 'tui.json')));
  engine(home, ['--uninstall']);
  assert.ok(!fs.existsSync(file));
});

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

function fakeApi() {
  const calls = { toast: [], command: [], render: 0, slots: [] };
  const api = {
    theme: { current: { text: 'T', textMuted: 'M', success: 'S', warning: 'W', error: 'E', borderSubtle: 'B' } },
    slots: { register: (s) => calls.slots.push(s) },
    renderer: { requestRender: () => { calls.render++; } },
    ui: { toast: (t) => calls.toast.push(t) },
    event: { on: () => () => {} },
    lifecycle: { onDispose: () => {} },
  };
  api.command = { register: (f) => { calls.command.push(f()); return () => {}; } };
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

test('tui.js on 2.x: setup registers the sidebar slot and the /copilot-usage layer, and toasts through ui.toast.show', async () => {
  const old = process.env.PATH;
  try {
    const plugin = await loadPlugin();
    process.env.PATH = fakeGh(LIMITED);
    const calls = { slots: [], layers: [], toasts: [] };
    const tok = (name) => ({ name });
    const context = {
      theme: { text: { base: tok('T'), muted: tok('M') }, border: { base: tok('B') } },
      ui: { slot: (s) => calls.slots.push(s), toast: { show: (t) => calls.toasts.push(t) } },
      keymap: { layer: (f) => calls.layers.push(f()) },
    };
    for (const name of ['client', 'data', 'app']) Object.defineProperty(context, name, { get() { throw new Error(`plugin touched context.${name}`); } });
    await plugin.setup(context);
    assert.equal(calls.slots[0].append, 'sidebar.content');
    const box = calls.slots[0].render({ sessionID: 's' });
    await until(() => !texts(box).includes('loading...'));
    assert.ok(texts(box).join('|').includes('15,441'));
    const cmd = calls.layers[0].commands[0];
    assert.equal(cmd.slash.name, 'copilot-usage');
    assert.equal(cmd.palette, true);
    await cmd.run();
    assert.match(calls.toasts[0].message, /Left 15,441 \(\$154\.41\)/);
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

// Claude Code status line: written only when the user has none, removed by --uninstall only while it is still ours.
const claudeArgs = ['--agents', 'claude', '--tools', 'copilot-usage', '--network', 'on'];
const settingsOf = (home) => path.join(home, '.claude', 'settings.json');
const script = (home) => path.join(home, '.claude', 'lean-copilot-usage-statusline.mjs');

test('claude statusLine: none set -> written, runs, and uninstall removes it', () => {
  const home = tmp('home');
  engine(home, claudeArgs);
  const s = JSON.parse(fs.readFileSync(settingsOf(home), 'utf8')).statusLine;
  assert.equal(s.type, 'command');
  assert.ok(s.command.includes(script(home).replaceAll('\\', '/')));
  assert.match(fs.readFileSync(script(home), 'utf8'), /^\/\/ managed by lean-agents\n/);
  // The shipped script, run with a fake gh and its own cache dir: same text as --usage, behind a label.
  const run = (json) => {
    const r = spawnSync(process.execPath, [script(home)], { encoding: 'utf8', env: { ...process.env, PATH: fakeGh(json), TMPDIR: tmp('cache'), TEMP: tmp('cache') } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(run(LIMITED), 'Copilot: 15441 of 25000 credits left (61%), about $154.41 of $250.00, resets 2026-12-01');
  assert.equal(run(UNLIMITED), 'Copilot: Unlimited premium requests');
  assert.equal(run(null), 'Copilot: unavailable');
  engine(home, ['--uninstall']);
  assert.ok(!fs.existsSync(script(home)));
  assert.ok(!fs.existsSync(settingsOf(home)) || !('statusLine' in JSON.parse(fs.readFileSync(settingsOf(home), 'utf8'))));
});

test('claude statusLine: the user\'s own value is kept, with a note, and survives uninstall', () => {
  const home = tmp('home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const mine = { type: 'command', command: 'echo mine' };
  fs.writeFileSync(settingsOf(home), JSON.stringify({ statusLine: mine }));
  assert.match(engine(home, claudeArgs), /kept your values for:.*statusLine/);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsOf(home), 'utf8')).statusLine, mine);
  engine(home, ['--uninstall']);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsOf(home), 'utf8')).statusLine, mine);
});

test('claude statusLine: a value the user changed after install stays on uninstall', () => {
  const home = tmp('home');
  engine(home, claudeArgs);
  const j = JSON.parse(fs.readFileSync(settingsOf(home), 'utf8'));
  j.statusLine = { type: 'command', command: 'echo later' };
  fs.writeFileSync(settingsOf(home), JSON.stringify(j));
  engine(home, ['--uninstall']);
  assert.equal(JSON.parse(fs.readFileSync(settingsOf(home), 'utf8')).statusLine.command, 'echo later');
});

test('claude statusLine: not installed without the copilot-usage tool or under --outbound off', () => {
  for (const args of [['--agents', 'claude', '--no-tools', '--network', 'on'], ['--agents', 'claude', '--tools', 'copilot-usage', '--outbound', 'off']]) {
    const home = tmp('home');
    engine(home, args);
    assert.ok(!('statusLine' in JSON.parse(fs.readFileSync(settingsOf(home), 'utf8'))));
    assert.ok(!fs.existsSync(script(home)));
  }
});
