// OpenCode plugin health (#212): a plugin listed in config is not proof it loads. Read-only: findings with a suggested fix, never a repair.
// Cache layout (VERIFY, upstream source not readable when written, 2026-11): `<cache>/packages/<pkg>@<spec>/node_modules/<pkg>` with the
// wrapper's package.json and lockfile beside it; older docs say `<cache>/node_modules/<pkg>`. Both are searched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { parse } from 'jsonc-parser';
import { configHome, envDir } from './system.mjs';
import { configPath } from './adapters/opencode-v2.mjs';
import { PINS } from './pins.mjs';

// Plugins whose slash command proves they registered on a fresh server.
export const COMMANDS = { '@tarquinen/opencode-dcp': 'dcp-compress' };

export function splitSpec(spec) {
  const at = spec.lastIndexOf('@');
  return at > 0 ? { name: spec.slice(0, at), version: spec.slice(at + 1) } : { name: spec, version: '' };
}

const readJson = (file, fsx) => { try { return parse(fsx.readFileSync(file, 'utf8'), [], { allowTrailingComma: true }) ?? null; } catch { return null; } };
const cacheDir = (home) => path.join(envDir(home, 'XDG_CACHE_HOME', path.join(home, '.cache')), 'opencode');

// npm plugin specs per config file: `plugin` / `plugins` entries, string or [spec, options]. Local paths are not packages.
export function readSpecs(home, fsx = fs) {
  const dir = path.join(configHome(home), 'opencode');
  const out = [];
  for (const [file, keys] of [[configPath(dir), ['plugin', 'plugins']], [path.join(dir, 'tui.json'), ['plugin']], [path.join(dir, 'tui.jsonc'), ['plugin']]]) {
    const cfg = readJson(file, fsx);
    for (const k of keys) for (const e of Array.isArray(cfg?.[k]) ? cfg[k] : []) {
      const spec = String(Array.isArray(e) ? e[0] : e);
      if (/^(file:|\.|\/|~|[A-Za-z]:[\\/])/.test(spec)) continue;
      out.push({ file: path.basename(file), ...splitSpec(spec), spec });
    }
  }
  return out;
}

// Same package with different version specs in the server config and tui.json. Each process reads its own file, so neither spec "wins".
export function reconcileSpecs(entries, pins = {}) {
  const byName = new Map();
  for (const e of entries) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  const out = [];
  for (const [name, list] of byName) {
    if (new Set(list.map((e) => e.version)).size < 2) continue;
    const seen = list.map((e) => `${e.file} ${e.version || 'unpinned'}`).join(' vs ');
    const want = pins[name] ? `${name}@${pins[name]}` : 'one exact version';
    out.push({ id: 'spec-mismatch', plugin: name, line: `${name}: ${seen}; the server and the TUI each load their own spec, so they can run different versions`,
      fix: `set both files to ${want} by hand (your pin stays yours); then restart OpenCode` });
  }
  return out;
}

// Dependencies of a package that do not resolve from it, the way Node walks node_modules up to the cache root. Optional and peer dependencies are the host's or the user's business.
function missingDeps(pkgDir, root, fsx, seen = new Set(), depth = 0) {
  const pkg = readJson(path.join(pkgDir, 'package.json'), fsx);
  if (!pkg || depth > 4) return [];
  const miss = [];
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    let found = null;
    for (let d = pkgDir; ; d = path.dirname(d)) {
      const cand = path.join(d, 'node_modules', dep);
      if (fsx.existsSync(path.join(cand, 'package.json'))) { found = cand; break; }
      if (d === root || d === path.dirname(d)) break;
    }
    if (!found) { miss.push(dep); continue; }
    if (!seen.has(found)) { seen.add(found); miss.push(...missingDeps(found, root, fsx, seen, depth + 1)); }
  }
  return [...new Set(miss)];
}

// Cached wrapper folders of a package: flat `packages/<name>@<spec>` or, for a scoped name, `packages/<scope>/<base>@<spec>` (VERIFY which one OpenCode writes).
function wrapperDirs(root, name, fsx) {
  const [scope, base] = name.startsWith('@') ? name.split('/') : [null, name];
  const out = [];
  for (const [dir, prefix] of [[path.join(root, 'packages'), `${name}@`], ...(scope ? [[path.join(root, 'packages', scope), `${base}@`]] : [])]) {
    try {
      for (const e of fsx.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory() && e.name.startsWith(prefix)) out.push(path.join(dir, e.name));
    } catch { /* no such folder */ }
  }
  return out;
}

// Cached wrapper(s) of `name` whose dependency tree is incomplete. No cached copy: nothing to report.
// A name from config is joined into a path: no `..` segment and nothing absolute (POSIX or drive letter).
export const safePluginName = (name) => !path.posix.isAbsolute(name) && !path.win32.isAbsolute(name) && !name.split(/[\\/]/).includes('..');

export function checkDepTree(home, name, fsx = fs) {
  if (!safePluginName(name)) return [];
  const root = cacheDir(home);
  const wrappers = [path.join(root, 'node_modules'), ...wrapperDirs(root, name, fsx).map((d) => path.join(d, 'node_modules'))];
  const out = [];
  for (const nm of wrappers) {
    const pkgDir = path.join(nm, ...name.split('/'));
    const pkg = readJson(path.join(pkgDir, 'package.json'), fsx);
    if (!pkg) continue;
    const miss = missingDeps(pkgDir, root, fsx);
    if (miss.length) out.push({ id: 'deps-incomplete', plugin: name, line: `${name}@${pkg.version ?? '?'} cached in ${path.relative(root, path.dirname(nm)) || '.'}: missing ${miss.join(', ')}; the plugin cannot load even though config lists it`,
      fix: 'close OpenCode, move that cache folder aside (do not delete it yet), start OpenCode so it installs again; or pin an exact version in both config files' });
  }
  return out;
}

// Static findings (no process started) for every npm plugin in the user's OpenCode config.
const PIN_VERSIONS = Object.fromEntries(Object.values(PINS).filter((p) => p.kind === 'npm').map((p) => [p.source, p.version]));

export function pluginHealth(home, { pins = PIN_VERSIONS, fsx = fs } = {}) {
  const entries = readSpecs(home, fsx);
  const names = [...new Set(entries.map((e) => e.name))];
  return [...reconcileSpecs(entries, pins), ...names.flatMap((n) => checkDepTree(home, n, fsx))];
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().on('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// Copies of the user's config and cache are capped: a runaway node_modules must not fill the disk of a read-only check.
const COPY_CAP_BYTES = 256 * 1024 * 1024;
const capped = (fsx) => { let bytes = 0; return (src) => { try { bytes += fsx.lstatSync(src).size; } catch { /* the copy reports it */ } if (bytes > COPY_CAP_BYTES) throw new Error('copy exceeds the size cap'); return true; }; };

// Windows children need these to start at all; the rest points at the throwaway dir. SystemRoot and ComSpec are the OS's, not the user's.
const winEnv = (tmp, env) => ({ SystemRoot: env.SystemRoot, ComSpec: env.ComSpec, APPDATA: tmp, LOCALAPPDATA: tmp, TEMP: tmp, TMP: tmp });

// Opt-in (--probe-plugins): a short-lived `opencode serve` on loopback with a throwaway state dir. It gets COPIES of the user's OpenCode config and
// of the cached wrapper of each plugin we know a command for, so nothing of the user's is written. GET /command (1.x) or /api/command (2.x) must list it.
// Windows: `cmd /c` runs an npm `.cmd` shim, and taskkill /T ends the grandchildren that child.kill() would leave.
export async function probePlugins(home, { bin = 'opencode', fsx = fs, spawnFn = spawn, spawnSyncFn = spawnSync, fetchFn = fetch, timeoutMs = 30000, env = process.env, platform = process.platform } = {}) {
  const wanted = [...new Set(readSpecs(home, fsx).map((e) => e.name))].filter((n) => COMMANDS[n]);
  if (!wanted.length) return [];
  const win = platform === 'win32';
  const tmp = fsx.mkdtempSync(path.join(os.tmpdir(), 'lean-probe-'));
  const xdg = { XDG_CONFIG_HOME: path.join(tmp, 'config'), XDG_CACHE_HOME: path.join(tmp, 'cache'), XDG_DATA_HOME: path.join(tmp, 'data'), XDG_STATE_HOME: path.join(tmp, 'state') };
  const stop = (c) => {
    if (win && c.pid) { try { const r = spawnSyncFn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); if (!r?.error && !r?.status) return; } catch { /* fall back to kill */ } }
    c.kill();
  };
  let child;
  try {
    try {
      const filter = capped(fsx);
      fsx.cpSync(path.join(configHome(home), 'opencode'), path.join(xdg.XDG_CONFIG_HOME, 'opencode'), { recursive: true, filter });
      const root = cacheDir(home);
      for (const n of wanted) for (const d of wrapperDirs(root, n, fsx)) fsx.cpSync(d, path.join(xdg.XDG_CACHE_HOME, 'opencode', path.relative(root, d)), { recursive: true, filter });
    } catch (e) {
      return [{ id: 'probe-failed', plugin: '', line: `could not copy the config or plugin cache for the probe (${e.code ?? e.message}), so the command check was skipped`, fix: 'check for broken symlinks or a very large node_modules in the OpenCode cache; then run --doctor --probe-plugins again' }];
    }
    const port = await freePort();
    const password = `probe-${process.pid}-${port}`;
    const serve = ['serve', '--hostname', '127.0.0.1', '--port', String(port)];
    child = spawnFn(win ? env.ComSpec ?? 'cmd.exe' : bin, win ? ['/d', '/c', bin, ...serve] : serve, {
      cwd: tmp, stdio: 'ignore', env: { PATH: env.PATH, HOME: tmp, USERPROFILE: tmp, ...(win ? winEnv(tmp, env) : {}), ...xdg, OPENCODE_SERVER_PASSWORD: password },
    });
    let spawnError = null;
    child.on?.('error', (e) => { spawnError = e; }); // opencode not on PATH: a finding, not a crash
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
    const names = async () => {
      for (const route of ['/command', '/api/command']) {
        try {
          const r = await fetchFn(`http://127.0.0.1:${port}${route}`, { headers: { authorization: auth } });
          if (!r.ok) continue;
          const j = await r.json();
          return (Array.isArray(j) ? j : j.data ?? []).map((c) => c.name);
        } catch { /* not up yet, or the other route */ }
      }
      return null;
    };
    // The first answer can come before plugins register, so keep asking until every command is listed or the deadline passes.
    const end = Date.now() + timeoutMs;
    let got = null;
    for (;;) {
      const now = await names();
      if (now !== null) got = now;
      if ((got !== null && wanted.every((n) => got.includes(COMMANDS[n]))) || spawnError || Date.now() >= end) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (got === null) return [{ id: 'probe-failed', plugin: '', line: spawnError ? `could not start ${bin}: ${spawnError.code ?? spawnError.message}, so the command check was skipped` : 'a short-lived `opencode serve` did not answer in time, so the command check was skipped', fix: 'run --doctor --probe-plugins again; if it repeats, start `opencode serve` by hand and GET /command' }];
    return wanted.filter((n) => !got.includes(COMMANDS[n])).map((n) => ({ id: 'command-missing', plugin: n, line: `${n}: a fresh server does not list /${COMMANDS[n]}; the plugin is configured but not operational`,
      fix: 'check the dependency finding above, or pin an exact older version in both config files; then restart OpenCode' }));
  } finally {
    // wait for the exit so the server cannot write into the folder while it is removed
    if (child?.on && child.exitCode === null && child.signalCode === null) {
      await new Promise((r) => { child.on('exit', r); setTimeout(r, 3000); try { stop(child); } catch { r(); } });
    } else { try { if (child) stop(child); } catch { /* already gone */ } }
    try { fsx.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
