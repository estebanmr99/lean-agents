// --preflight (#471): one read-only report of old or duplicate tool copies and a terminal opened before a PATH change.
// It never writes a file or installs anything; the only commands it runs are `<copy> --version` probes and, on Windows, `reg.exe query`.
// A blocker is something that stops setup (rtk below its minimum, a newer copy hidden behind an older one, a tool the window cannot
// see yet). Everything else is a warning and does not change the exit code.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PINS, npmSpec } from './pins.mjs';
import { compare } from './node-runtime.mjs';
import { versionFull, prereqFor, packageManager } from './system.mjs';
import { redactText } from './redact.mjs';

// [executable name, pin key]. The pin gives `min`, the pinned version and the update source.
const TOOLS = [['claude', 'claude-code'], ['opencode', 'opencode-v2'], ['copilot', 'copilot-cli'], ['agy', 'antigravity-cask'], ['context-mode', 'context-mode'],
  ['rtk', 'rtk'], ['uv', 'uv'], ['jq', 'jq'], ['gh', 'gh'], ['bun', 'bun']];
// Only these have a pinned version that is a fair "behind" yardstick for whatever the user installed (opencode 1.x, agy and bun are not).
const BEHIND_PIN = new Set(['claude-code', 'copilot-cli', 'context-mode']);
// tool -> the prereqFor() key whose install row has the package-manager ids.
const PREREQ = { rtk: 'rtk', uv: 'serena', gh: 'gh' };
// Below `min` blocks only where lean-agents skips or fails its steps (rtk, #467); for the rest `min` is just the verified release.
const BLOCKING_MIN = new Set(['rtk']);
const PROBE_MS = 5000;
const DEADLINE_MS = 60000;

const isFile = (fsx, p, win) => {
  try {
    if (!fsx.statSync(p).isFile()) return false;
    if (!win) fsx.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
};

const pathMod = (platform) => (platform === 'win32' ? path.win32 : path.posix);
const sep = (platform) => (platform === 'win32' ? ';' : ':');
const entries = (pathVar, platform) => (pathVar ?? '').split(sep(platform)).map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);

// Absolute PATH entries only: a relative one (`.`) would make the report depend on the directory it runs in.
export const relativeEntries = (pathVar, platform = process.platform) => entries(pathVar, platform).filter((d) => !pathMod(platform).isAbsolute(d));

// Every copy of `bin` in the absolute PATH entries, in PATH order. POSIX needs the executable bit; Windows tries each PATHEXT extension.
export function findCopies(bin, { path: pathVar, platform = process.platform, env = process.env, fsx = fs }) {
  const win = platform === 'win32';
  const p = pathMod(platform);
  const exts = win ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const seen = new Set();
  const out = [];
  for (const dir of entries(pathVar, platform).filter((d) => p.isAbsolute(d))) {
    for (const ext of exts) {
      const file = p.join(dir, bin + ext);
      if (!isFile(fsx, file, win)) continue;
      let key = file;
      try { key = fsx.realpathSync(file); } catch { /* keep the path as the key */ }
      if (win) key = key.toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(file); }
      break;
    }
  }
  return out;
}

// The value of the Path entry in `reg query` output.
export const parseRegPath = (text) => text.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*?)\s*$/im)?.[1] ?? '';

const REG_KEYS = { user: 'HKCU\\Environment', machine: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment' };
export function readWinPathFromRegistry(env = process.env) {
  const reg = path.win32.join(env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows', 'System32', 'reg.exe');
  const get = (key) => { const r = spawnSync(reg, ['query', key, '/v', 'Path'], { encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? parseRegPath(r.stdout) : ''; };
  return { user: get(REG_KEYS.user), machine: get(REG_KEYS.machine) };
}

const EXPAND = ['USERPROFILE', 'SystemRoot', 'LOCALAPPDATA', 'ProgramFiles'];
const envGet = (env, name) => env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase()) ?? ''];
// Only the variables above are expanded; an entry that still has `%` afterwards is dropped (its folder cannot be known).
const expand = (s, env) => s.replace(/%([^%]+)%/g, (m, n) => (EXPAND.some((e) => e.toLowerCase() === n.toLowerCase()) ? envGet(env, n) ?? m : m));
const norm = (s) => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

// Folders of the stored user and machine PATH that exist but are missing from the running process PATH: a window opened before the change.
export function staleWindowPath({ env, readWinPath = readWinPathFromRegistry, fsx = fs }) {
  const have = new Set(entries(envGet(env, 'PATH'), 'win32').map(norm));
  const { user, machine } = readWinPath(env);
  const missing = [];
  for (const raw of [...user.split(';'), ...machine.split(';')]) {
    const d = expand(raw.trim().replace(/^"|"$/g, ''), env);
    if (!d || d.includes('%') || have.has(norm(d)) || missing.some((m) => norm(m) === norm(d))) continue;
    if (fsx.existsSync(d)) missing.push(d);
  }
  return missing;
}

// How to update a tool, from the pins and the install table in system.mjs (no ids of its own).
function updateFix(pinKey, platform, pm) {
  const p = PINS[pinKey];
  if (p.kind === 'npm') return `npm install -g ${npmSpec(pinKey)}`;
  const inst = PREREQ[pinKey] && prereqFor(PREREQ[pinKey], platform === 'win32' ? 'winget' : pm)?.install?.[0];
  if (inst?.[0] === 'winget') return `winget upgrade --id ${inst[inst.indexOf('--id') + 1]}`;
  if (inst?.[0] === 'brew') return `brew upgrade ${inst.at(-1)}`;
  return `install ${p.min ?? p.version} or newer from https://github.com/${p.source}/releases, or run lean-agents --update`;
}

export function preflight({ home, env = process.env, platform = process.platform, fsx = fs, exec = true, now = Date.now,
  pm = platform === 'win32' ? 'winget' : packageManager(), probe = (f) => versionFull(f, ['--version'], {}, PROBE_MS), readWinPath }) {
  const findings = [];
  const add = (f) => findings.push(f);
  const pathVar = envGet(env, 'PATH') ?? '';
  const start = now();
  const known = (v) => v && /^\d/.test(v);
  const rel = relativeEntries(pathVar, platform);
  if (rel.length) add({ tool: 'PATH', kind: 'relative-path', blocker: false, entries: rel, fix: 'relative PATH entries were skipped; use full paths' });
  for (const [tool, pinKey] of TOOLS) {
    const paths = findCopies(tool, { path: pathVar, platform, env, fsx });
    if (!paths.length) continue;
    const copies = paths.map((file) => ({ path: file, version: !exec ? null : now() - start > DEADLINE_MS ? null : probe(file) }));
    const [win] = copies;
    const pin = PINS[pinKey];
    if (known(win.version) && pin.min && compare(win.version, pin.min) < 0) {
      add({ tool, kind: 'below-min', blocker: BLOCKING_MIN.has(pinKey), version: win.version, min: pin.min, path: win.path, fix: updateFix(pinKey, platform, pm) });
    } else if (known(win.version) && BEHIND_PIN.has(pinKey) && compare(win.version, pin.version) < 0) {
      add({ tool, kind: 'behind-pin', blocker: false, version: win.version, pinned: pin.version, path: win.path, fix: updateFix(pinKey, platform, pm) });
    }
    if (copies.length > 1) {
      const newer = copies.slice(1).some((c) => known(win.version) && known(c.version) && compare(c.version, win.version) > 0);
      add({ tool, kind: 'shadowed', blocker: newer, copies,
        fix: newer ? `remove the copy that wins (${win.path}) or put the newer one's folder earlier on PATH, then reopen the terminal`
          : 'Older copies later on PATH are harmless. Remove them if you want a clean PATH.' });
    }
  }
  if (platform === 'win32' && exec) {
    const missing = staleWindowPath({ env, readWinPath, fsx });
    if (missing.length) {
      const hidden = TOOLS.map(([t]) => t).filter((t) => !findCopies(t, { path: pathVar, platform, env, fsx }).length
        && findCopies(t, { path: missing.join(';'), platform, env, fsx }).length);
      add({ tool: 'PATH', kind: 'stale-path', blocker: hidden.length > 0, missing, hidden,
        fix: `this window started before PATH changed: ${missing.join('; ')} ${missing.length > 1 ? 'are' : 'is'} missing. Close and reopen the terminal or VS Code, then run --preflight again.` });
    }
  }
  const blockers = findings.filter((f) => f.blocker).length;
  return { ok: blockers === 0, blockers, warnings: findings.length - blockers, findings };
}

function line(f) {
  const tag = f.blocker ? 'BLOCKER' : 'warning';
  const v = (x) => x ?? 'not checked';
  if (f.kind === 'below-min') return [`${tag}  ${f.tool} ${f.version} at ${f.path} is older than the minimum ${f.min}`, `  fix: ${f.fix}`];
  if (f.kind === 'behind-pin') return [`${tag}  ${f.tool} ${f.version} at ${f.path} is older than the pinned ${f.pinned}`, `  fix: ${f.fix}`];
  if (f.kind === 'relative-path') return [`${tag}  relative PATH entries skipped: ${f.entries.join('; ')}`, `  fix: ${f.fix}`];
  if (f.kind === 'stale-path') return [`${tag}  ${f.fix}`, ...(f.hidden.length ? [`    not visible in this window: ${f.hidden.join(', ')}`] : [])];
  return [`${tag}  ${f.tool}: ${f.copies.length} copies on PATH, the first one wins`,
    ...f.copies.map((c, i) => `    ${i === 0 ? 'wins ' : '     '} ${c.path} (${v(c.version)})`), `  fix: ${f.fix}`];
}

// Redact every string before it is serialized: JSON escapes a backslash path, which the text redaction would no longer match.
const deep = (x, fn) => (typeof x === 'string' ? fn(x) : Array.isArray(x) ? x.map((y) => deep(y, fn)) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, deep(y, fn)])) : x);

// Text or JSON for a report; home paths print as ~ and the user name never gets through.
export function formatPreflight(report, { home, env = process.env, json = false }) {
  const red = (s) => redactText(s, { home, env });
  if (json) return JSON.stringify(deep(report, red), null, 2);
  const s = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return red([...report.findings.flatMap(line), `${s(report.blockers, 'blocker')}, ${s(report.warnings, 'warning')}. Nothing was changed.`].join('\n'));
}
