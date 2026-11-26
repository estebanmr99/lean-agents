// --preflight (#471): one read-only report of setup blockers. It never writes a file or installs anything;
// the only commands it runs are `<copy> --version` probes and, on Windows, `reg query` reads.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PINS } from './pins.mjs';
import { compare } from './node-runtime.mjs';
import { versionFull } from './system.mjs';
import { redactText } from './redact.mjs';

// [executable name, pin key]. The pin gives `min` and the update source.
const TOOLS = [['claude', 'claude-code'], ['opencode', 'opencode-v2'], ['copilot', 'copilot-cli'], ['agy', 'antigravity-cask'], ['context-mode', 'context-mode'],
  ['rtk', 'rtk'], ['uv', 'uv'], ['uvx', 'uv'], ['jq', 'jq'], ['gh', 'gh'], ['bun', 'bun']];

const isFile = (fsx, p, win) => {
  try {
    if (!fsx.statSync(p).isFile()) return false;
    if (!win) fsx.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
};

// Every copy of `bin` on PATH, in PATH order. POSIX needs the executable bit; Windows tries each PATHEXT extension.
export function findCopies(bin, { path: pathVar, platform = process.platform, env = process.env, fsx = fs }) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const exts = win ? [...(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)] : [''];
  const seen = new Set();
  const out = [];
  for (const dir of (pathVar ?? '').split(win ? ';' : ':').filter(Boolean)) {
    for (const ext of exts) {
      const file = p.join(dir.replace(/^"|"$/g, ''), bin + ext);
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
export function readWinPathFromRegistry() {
  const get = (key) => { const r = spawnSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', timeout: 10000 }); return r.status === 0 ? parseRegPath(r.stdout) : ''; };
  return { user: get(REG_KEYS.user), machine: get(REG_KEYS.machine) };
}

const expand = (s, env) => s.replace(/%([^%]+)%/g, (m, n) => env[Object.keys(env).find((k) => k.toLowerCase() === n.toLowerCase()) ?? ''] ?? m);
const norm = (s) => s.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();

// Entries of the stored user and machine PATH that the running process PATH lacks: a window opened before the change.
export function staleWindowPath({ env, readWinPath = readWinPathFromRegistry }) {
  const have = new Set((env.PATH ?? env.Path ?? '').split(';').filter(Boolean).map((d) => norm(d)));
  const { user, machine } = readWinPath();
  const missing = [];
  for (const d of [...expand(user, env).split(';'), ...expand(machine, env).split(';')].filter(Boolean)) {
    if (!have.has(norm(d)) && !missing.some((m) => norm(m) === norm(d))) missing.push(d);
  }
  return missing;
}

const updateFix = (tool, pinKey, platform) => {
  const p = PINS[pinKey];
  if (p?.via === 'brew' && platform !== 'win32') return `update it: brew upgrade ${pinKey}`;
  return `update it to ${p?.min ?? p?.version} or newer (${tool}, see https://github.com/${p?.source ?? ''}/releases) and make that copy first on PATH`;
};

export function preflight({ home, env = process.env, platform = process.platform, fsx = fs, probe = (f) => versionFull(f, ['--version'], {}), readWinPath }) {
  const findings = [];
  const add = (f) => findings.push(f);
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const [tool, pinKey] of TOOLS) {
    const paths = findCopies(tool, { path: pathVar, platform, env, fsx });
    if (!paths.length) continue;
    const copies = paths.map((file) => ({ path: file, version: probe(file) }));
    const [win] = copies;
    const min = PINS[pinKey]?.min;
    const known = (v) => v && /^\d/.test(v);
    if (min && known(win.version) && compare(win.version, min) < 0) {
      add({ tool, kind: 'below-min', blocker: true, version: win.version, min, path: win.path, fix: updateFix(tool, pinKey, platform) });
    }
    if (copies.length > 1) {
      const newer = copies.slice(1).filter((c) => known(win.version) && known(c.version) && compare(c.version, win.version) > 0);
      add({ tool, kind: 'shadowed', blocker: newer.length > 0, copies,
        fix: `remove the copy that wins (${win.path}) or put the newer one's folder earlier on PATH, then restart the terminal` });
    }
  }
  if (platform === 'win32') {
    const missing = staleWindowPath({ env, readWinPath });
    if (missing.length) add({ tool: 'PATH', kind: 'stale-path', blocker: true, missing, fix: 'restart the terminal or VS Code so it reads the current PATH' });
  }
  return { ok: !findings.some((f) => f.blocker), blockers: findings.filter((f) => f.blocker).length, findings };
}

function line(f) {
  const tag = f.blocker ? 'BLOCKER' : 'warning';
  if (f.kind === 'below-min') return [`${tag}  ${f.tool} ${f.version} at ${f.path} is older than the minimum ${f.min}`, `  fix: ${f.fix}`];
  if (f.kind === 'stale-path') return [`${tag}  this window's PATH lacks ${f.missing.length} folder(s) the stored PATH has: ${f.missing.join('; ')}`, `  fix: ${f.fix}`];
  return [`${tag}  ${f.tool}: ${f.copies.length} copies on PATH, the first one wins`,
    ...f.copies.map((c, i) => `    ${i === 0 ? 'wins ' : '     '} ${c.path} (${c.version ?? 'unknown'})`), `  fix: ${f.fix}`];
}

// Text or JSON for a report; home paths print as ~ and the user name never gets through.
export function formatPreflight(report, { home, env = process.env, json = false }) {
  const raw = json ? JSON.stringify(report, null, 2)
    : [...report.findings.flatMap(line), report.blockers ? `${report.blockers} blocker(s). Nothing was changed.` : 'No blockers found. Nothing was changed.'].join('\n');
  return redactText(raw, { home, env });
}
