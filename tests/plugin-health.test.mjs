// #212: plugin health is read-only. Synthetic cache trees and configs in a temp HOME; the serve probe runs against stubs, no real opencode.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDepTree, safePluginName, reconcileSpecs, readSpecs, pluginHealth, probePlugins } from '../scripts/lib/plugin-health.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';

const DCP = '@tarquinen/opencode-dcp';
const w = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); };
const pkg = (dir, name, version, dependencies = {}) => w(path.join(dir, 'node_modules', name, 'package.json'), { name, version, dependencies });

// wrapper with the plugin, its host SDK (needs zod) and optionally the missing libs
function home({ full = false, server = [`${DCP}@latest`], tui = [`${DCP}@3.1.15`] } = {}) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-ph-'));
  const wrap = path.join(h, '.cache', 'opencode', 'packages', DCP.split('/')[0], `opencode-dcp@latest`);
  pkg(wrap, DCP, '3.2.1', { tiktoken: '1.0.22', '@opencode-ai/plugin': '1.0.0' });
  pkg(wrap, '@opencode-ai/plugin', '1.0.0', { zod: '4.0.0' });
  if (full) { pkg(wrap, 'tiktoken', '1.0.22'); pkg(wrap, 'zod', '4.0.0'); }
  w(path.join(h, '.config', 'opencode', 'opencode.jsonc'), `{ // user\n "plugin": ${JSON.stringify(server)} }`);
  w(path.join(h, '.config', 'opencode', 'tui.json'), { plugin: tui });
  return h;
}

test('incomplete cached tree names the missing dependencies, transitive ones included', () => {
  const f = checkDepTree(home(), DCP);
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'deps-incomplete');
  assert.match(f[0].line, /missing tiktoken, zod/);
  assert.match(f[0].fix, /move that cache folder aside/);
});

test('a leftover @latest wrapper is not reported when the config pins an exact version (it is not loaded)', () => {
  const h = home({ server: [`${DCP}@3.1.15`], tui: [`${DCP}@3.1.15`] });
  assert.deepEqual(pluginHealth(h, { pins: {} }).filter((x) => x.id === 'deps-incomplete'), []);
  const live = home({ server: [DCP], tui: [`${DCP}@latest`] });
  assert.equal(pluginHealth(live, { pins: {} }).filter((x) => x.id === 'deps-incomplete').length, 1);
});

test('complete tree and absent cache give no finding', () => {
  assert.deepEqual(checkDepTree(home({ full: true }), DCP), []);
  assert.deepEqual(checkDepTree(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-ph-')), DCP), []);
});

test('server @latest vs tui exact pin is a mismatch; equal specs, array form and local paths are not', () => {
  const f = reconcileSpecs(readSpecs(home()), { [DCP]: '3.2.0' });
  assert.equal(f.length, 1);
  assert.match(f[0].line, /opencode\.jsonc latest vs tui\.json 3\.1\.15/);
  assert.match(f[0].fix, new RegExp(`${DCP}@3\\.2\\.0`));
  const same = home({ server: [[`${DCP}@3.1.15`, { x: 1 }], 'file:///opt/x/plugin.js'], tui: [`${DCP}@3.1.15`] });
  assert.deepEqual(reconcileSpecs(readSpecs(same)), []);
});

test('pluginHealth never writes: config and cache are byte-identical after', () => {
  const h = home();
  const snap = () => JSON.stringify(fs.readdirSync(h, { recursive: true }).sort().map((p) => [p, fs.statSync(path.join(h, p)).isFile() ? fs.readFileSync(path.join(h, p), 'utf8') : '']));
  const before = snap();
  assert.equal(pluginHealth(h).length, 2);
  assert.equal(snap(), before);
});

test('doctor shows a finding row with a fix and starts nothing without the flag', () => {
  const h = home();
  const calls = [];
  const run = (argv) => { calls.push(argv); return { ok: true, out: '' }; };
  const state = { version: '0', commands: [], files: [], options: { agents: ['opencode-v1'], tools: [], privacy: 'standard', network: { outbound: 'off' } } };
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home: h, state, exec: false, json: true, run }); } finally { process.stdout.write = write; }
  const rows = JSON.parse(out).rows.filter((r) => r.item.startsWith('plugin '));
  assert.deepEqual(rows.map((r) => r.item).sort(), [`plugin ${DCP} deps-incomplete`, `plugin ${DCP} spec-mismatch`]);
  assert.deepEqual(rows.map((r) => r.status).sort(), ['changed', 'error']); // a spec mismatch alone must not fail the doctor
  assert.ok(rows.every((r) => r.detail.includes('Fix: ')));
  assert.equal(calls.some((a) => a.includes('serve')), false);
});

function stubs(commands) {
  const spawned = [];
  const spawnFn = (bin, args, opts) => { const c = { bin, args, opts, killed: false, kill() { c.killed = true; }, on() {} }; spawned.push(c); return c; };
  const fetchFn = async (url) => (url.endsWith('/command') ? { ok: true, json: async () => commands.map((name) => ({ name })) } : { ok: false });
  return { spawned, spawnFn, fetchFn };
}

test('probe: command listed is healthy, missing is reported; throwaway dirs and server are cleaned up', async () => {
  const h = home({ full: true });
  const good = stubs(['dcp-compress']);
  assert.deepEqual(await probePlugins(h, { ...good, timeoutMs: 2000, platform: 'linux' }), []);
  const bad = stubs(['init']);
  const f = await probePlugins(h, { ...bad, timeoutMs: 600, platform: 'linux' });
  assert.equal(f[0].id, 'command-missing');
  const c = bad.spawned[0];
  assert.ok(c.killed);
  assert.deepEqual(c.args.slice(0, 3), ['serve', '--hostname', '127.0.0.1']);
  assert.equal(fs.existsSync(c.opts.cwd), false);
  assert.ok(!Object.keys(c.opts.env).some((k) => !['PATH', 'HOME', 'USERPROFILE', 'OPENCODE_SERVER_PASSWORD'].includes(k) && !k.startsWith('XDG_')));
});

test('probe: no known plugin means no process', async () => {
  const s = stubs([]);
  assert.deepEqual(await probePlugins(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-ph-')), s), []);
  assert.equal(s.spawned.length, 0);
});

test('adopt lists the findings under health and leaves ok and plan to the other items', async () => {
  const { inventory } = await import('../scripts/lib/adopt.mjs');
  const h = home();
  const r = await inventory({ home: h, env: { PATH: process.env.PATH }, realHome: h });
  assert.deepEqual(r.health.map((f) => f.id).sort(), ['deps-incomplete', 'spec-mismatch']);
  assert.ok(r.plan.every((p) => !/deps-incomplete|spec-mismatch/.test(p)));
});

test('probe: a missing binary is a finding, not a crash; scoped cache wrapper is copied', async () => {
  const { EventEmitter } = await import('node:events');
  const h = home({ full: true });
  const spawnFn = () => { const c = new EventEmitter(); c.kill = () => {}; setImmediate(() => c.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' }))); return c; };
  const f = await probePlugins(h, { spawnFn, fetchFn: async () => ({ ok: false }), timeoutMs: 2000 });
  assert.equal(f[0].id, 'probe-failed');
  assert.match(f[0].line, /could not start opencode: ENOENT/);
  let copied = null;
  const s = stubs(['init']);
  const real = fs.cpSync;
  const fsx = { ...fs, cpSync: (a, b, o) => { if (String(a).includes('opencode-dcp@')) copied = b; return real(a, b, o); } };
  await probePlugins(h, { ...s, fsx, timeoutMs: 2000 });
  assert.match(copied, /packages[\\/]@tarquinen[\\/]opencode-dcp@latest$/);
});

test('checkDepTree rejects plugin names that climb out of node_modules or are absolute', () => {
  const h = home({ full: true });
  fs.writeFileSync(path.join(h, '.cache', 'opencode', 'package.json'), JSON.stringify({ name: 'outside', version: '1.0.0', dependencies: { nope: '1' } }));
  for (const bad of ['../..', '@x/../..', '/opt/x', 'D:\\tools\\x', '..\\..']) {
    assert.equal(safePluginName(bad), false, bad);
    assert.deepEqual(checkDepTree(h, bad), [], bad);
  }
  assert.equal(safePluginName(DCP), true);
  assert.equal(safePluginName('left-pad'), true);
});

test('probe: a failing copy (dangling symlink) is a probe-failed finding, not a crash; the folder is still removed', async () => {
  const h = home({ full: true });
  const s = stubs(['dcp-compress']);
  const fsx = { ...fs, cpSync: () => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); } };
  const f = await probePlugins(h, { ...s, fsx, timeoutMs: 600 });
  assert.equal(f.length, 1);
  assert.equal(f[0].id, 'probe-failed');
  assert.match(f[0].line, /could not copy.*ENOENT/);
  assert.equal(s.spawned.length, 0);
});

test('probe: a copy past the size cap is stopped by the filter', async () => {
  const h = home({ full: true });
  const s = stubs(['dcp-compress']);
  const fsx = { ...fs, lstatSync: () => ({ size: 300 * 1024 * 1024 }) };
  const f = await probePlugins(h, { ...s, fsx, timeoutMs: 600 });
  assert.equal(f[0].id, 'probe-failed');
  assert.match(f[0].line, /size cap/);
});

test('probe: a first answer without the command is retried until it shows up', async () => {
  const h = home({ full: true });
  let calls = 0;
  const s = stubs([]);
  const fetchFn = async (url) => (url.endsWith('/command') ? { ok: true, json: async () => (++calls < 2 ? [{ name: 'init' }] : [{ name: 'init' }, { name: 'dcp-compress' }]) } : { ok: false });
  assert.deepEqual(await probePlugins(h, { ...s, fetchFn, timeoutMs: 5000, platform: 'linux' }), []);
  assert.ok(calls >= 2);
});

test('probe on Windows: cmd /c runs the shim, env points at the throwaway dir, taskkill /T ends the tree', async () => {
  const h = home({ full: true });
  const s = stubs(['init']);
  const killed = [];
  const spawnFn = (bin, args, opts) => { const c = { bin, args, opts, pid: 4242, kill() { killed.push('kill'); }, on() {} }; s.spawned.push(c); return c; };
  const spawnSyncFn = (cmd, args) => { killed.push([cmd, ...args].join(' ')); return { status: 0 }; };
  const env = { PATH: 'D:\\tools\\bin', SystemRoot: 'D:\\Windows', ComSpec: 'D:\\Windows\\cmd.exe' };
  await probePlugins(h, { ...s, spawnFn, spawnSyncFn, env, timeoutMs: 600, platform: 'win32' });
  const c = s.spawned[0];
  assert.equal(c.bin, 'D:\\Windows\\cmd.exe');
  assert.deepEqual(c.args.slice(0, 4), ['/d', '/c', 'opencode', 'serve']);
  const tmp = c.opts.cwd;
  assert.deepEqual([c.opts.env.APPDATA, c.opts.env.LOCALAPPDATA, c.opts.env.TEMP, c.opts.env.TMP], [tmp, tmp, tmp, tmp]);
  assert.equal(c.opts.env.SystemRoot, 'D:\\Windows');
  assert.deepEqual(killed, ['taskkill /pid 4242 /T /F']);
});
