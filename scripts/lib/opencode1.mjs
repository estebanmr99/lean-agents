// `opencode1`: OpenCode 1.x side by side with 2.x (#80 part 2, P4): `--upgrade-agent opencode --opencode1`.
// Copies the 1.x binary to `<data>/lean-agents/opencode1/<version>/`, writes an owned shim `opencode1` (+ `opencode1.cmd` on Windows)
// that points XDG_DATA_HOME + XDG_STATE_HOME at the frozen copy (proven by the P1 spike) and XDG_CONFIG_HOME at its own copy of the
// 1.x config (the upgrade rewrites ~/.config/opencode to 2.x keys, which 1.x may reject), and puts the shim folder on PATH: a marked
// block in the shell rc file, or the HKCU user PATH on Windows. Files and blocks go through the engine's fsops actions; the copied
// binary and the HKCU entry are recorded in state.json (`opencode1`) and removed by `--uninstall`. The backup, the frozen copy and
// `opencode1/state` (what 1.x writes while it runs) and `opencode1/config` (the 1.x config copy) are never removed.
// `which`, `probe`, `winPath` and `shell` are passed in so tests never read the real machine or the registry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { backupLayout, sha256File } from './opencode-backup.mjs';
import { which as findOnPath } from './system.mjs';
import { plan as planActions, renameRetry } from './fsops.mjs';

const j = path.join;
const MIN_BINARY = 1 << 20; // npm ships a ~0.5 KB launcher in bin/ until its postinstall swaps in the native binary

export function layout(home) {
  const { lean, frozen } = backupLayout(home, 'x');
  const root = j(lean, 'opencode1');
  return { root, frozen, state: j(root, 'state'), config: j(root, 'config'), bin: j(root, 'bin') };
}

const sq = (s) => `'${s.replace(/'/g, "'\\''")}'`;
const MARK = 'managed by lean-agents: OpenCode 1.x on its own frozen copy of the data (#80); removed by --uninstall';

export function shimText(kind, { data, state, binary, config }) {
  if (kind === 'cmd') {
    const lines = ['@echo off', `rem ${MARK}`, 'setlocal', `set "XDG_DATA_HOME=${data}"`, `set "XDG_STATE_HOME=${state}"`, ...(config ? [`set "XDG_CONFIG_HOME=${config}"`] : []), `"${binary}" %*`, 'exit /b %errorlevel%'];
    return `${lines.join('\r\n')}\r\n`;
  }
  const fwd = (p) => p.replace(/\\/g, '/'); // Git Bash on Windows reads D:/x
  return `#!/bin/sh\n# ${MARK}\nexport XDG_DATA_HOME=${sq(fwd(data))}\nexport XDG_STATE_HOME=${sq(fwd(state))}\n${config ? `export XDG_CONFIG_HOME=${sq(fwd(config))}\n` : ''}exec ${sq(fwd(binary))} "$@"\n`;
}

// Where an `opencode` 1.x binary may be: the 2.x installer's folder (same path on Windows), what is on PATH, and npm's platform packages.
export function candidates({ home, platform = process.platform, whichPath = null, fsx = fs }) {
  const ext = platform === 'win32' ? '.exe' : '';
  const out = [j(home, '.opencode', 'bin', `opencode${ext}`)];
  if (whichPath) {
    let real = whichPath;
    try { real = fsx.realpathSync(whichPath); } catch { /* keep the path as found */ }
    out.push(real);
    const dir = path.dirname(real);
    for (const pkg of [j(dir, 'node_modules', 'opencode-ai'), path.dirname(dir)]) {
      out.push(j(pkg, 'bin', `opencode${ext}`));
      for (const base of [j(pkg, 'node_modules'), path.dirname(pkg)]) {
        let names = [];
        try { names = fsx.readdirSync(base); } catch { /* no such folder */ }
        for (const n of names) if (/^opencode-/.test(n) && n !== 'opencode-ai') out.push(j(base, n, 'bin', `opencode${ext}`));
      }
    }
  }
  const big = (f) => { try { const s = fsx.statSync(f); return s.isFile() && s.size >= MIN_BINARY; } catch { return false; } };
  return [...new Set(out)].filter((f) => !/\.(cmd|bat|ps1)$/i.test(f) && big(f));
}

export function probeVersion(bin, env) {
  const out = execFileSync(bin, ['--version'], { env, encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return out.trim().split(/\r?\n/).pop().trim();
}

// First candidate that runs and reports a 1.x version: { path, version }, or { tried: [...] }.
export function findBinary({ home, platform, whichPath, probe, env, fsx = fs }) {
  const tried = [];
  for (const c of candidates({ home, platform, whichPath, fsx })) {
    try {
      const v = probe(c, env);
      if (/^1\.\d+\.\d+$/.test(v)) return { path: c, version: v };
      tried.push(`${c} (version ${v || '?'}, not 1.x)`);
    } catch (e) { tried.push(`${c} (does not run: ${String(e.message).split('\n')[0]})`); }
  }
  return { tried };
}

const rcFiles = (home, shell, fsx) => {
  const have = ['.zshrc', '.bashrc', '.bash_profile'].filter((f) => fsx.existsSync(j(home, f)));
  return (have.length ? have : [/zsh$/.test(shell ?? '') ? '.zshrc' : '.profile']).map((f) => j(home, f));
};

// User PATH on Windows, read and written unexpanded like install.ps1 does. Prints present | absent | changed.
const WIN_PATH_PS = `
$ErrorActionPreference = 'Stop'
$dir = $env:LEAN_PATH_DIR
function Open-Env($w) { [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $w) }
function Get-Norm($p) { [Environment]::ExpandEnvironmentVariables($p).TrimEnd('\\') }
$k = Open-Env $false
try { $raw = [string]$k.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $k.Close() }
$parts = @($raw -split ';' | Where-Object { $_ })
$has = @($parts | Where-Object { (Get-Norm $_) -eq (Get-Norm $dir) }).Count -gt 0
if ($env:LEAN_PATH_OP -eq 'has') { if ($has) { 'present' } else { 'absent' }; exit 0 }
if ($env:LEAN_PATH_OP -eq 'add') {
  if ($has) { 'present'; exit 0 }
  if (-not $raw) { $new = $dir } elseif ($raw.EndsWith(';')) { $new = "$raw$dir" } else { $new = "$raw;$dir" }
} else {
  if (-not $has) { 'absent'; exit 0 }
  $new = @($parts | Where-Object { (Get-Norm $_) -ne (Get-Norm $dir) }) -join ';'
}
$k = Open-Env $true
try { $k.SetValue('Path', $new, [Microsoft.Win32.RegistryValueKind]::ExpandString) } finally { $k.Close() }
[Environment]::SetEnvironmentVariable('LEAN_AGENTS_PATH_REFRESH', '1', 'User')
[Environment]::SetEnvironmentVariable('LEAN_AGENTS_PATH_REFRESH', $null, 'User')
'changed'
`;
export const winPathDefault = (op, dir) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_PATH_PS], {
  encoding: 'utf8', windowsHide: true, env: { ...process.env, LEAN_PATH_DIR: dir, LEAN_PATH_OP: op },
}).trim().split(/\r?\n/).pop();

// Read-only. Returns { ok, problems, version, source, binary, actions, pathDir } for `installOpencode1`.
// `configSnapshot`: the 1.x config folder saved by --backup (copied for the shim); without one the shim gets an empty config folder.
export function planOpencode1({ home, configSnapshot = null, exec = true, platform = process.platform, env = process.env, which = findOnPath, probe = probeVersion, shell = process.env.SHELL, fsx = fs }) {
  const L = layout(home);
  const win = platform === 'win32';
  const problems = [];
  if (!fsx.existsSync(j(L.frozen, 'opencode', 'opencode.db'))) problems.push(`no frozen copy at ${L.frozen}: run --upgrade-agent opencode --backup --yes first`);
  // The binary is run once (`--version`) to name its folder and to prove the copy works: not under --no-exec.
  if (!exec) problems.push('--no-exec: the 1.x binary has to run `--version`, so this step needs commands enabled');
  if (problems.length) return { ok: false, problems };
  // Candidates may be 2.x (it migrates a db it finds): probe them on an empty throwaway data dir, never on the frozen copy.
  const scratch = fsx.mkdtempSync(j(os.tmpdir(), 'lean-probe-'));
  let found;
  try { found = findBinary({ home, platform, whichPath: which('opencode'), probe, env: { ...env, XDG_DATA_HOME: scratch, XDG_STATE_HOME: scratch }, fsx }); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  if (!found.path) problems.push(`no OpenCode 1.x binary found${found.tried.length ? `; tried:\n      ${found.tried.join('\n      ')}` : ' (none on PATH or in ~/.opencode/bin)'}`);
  if (problems.length) return { ok: false, problems };

  const binary = j(L.root, found.version, `opencode${win ? '.exe' : ''}`);
  const text = { data: L.frozen, state: L.state, binary, config: L.config };
  const actions = win
    ? [{ kind: 'file', path: j(L.bin, 'opencode1.cmd'), content: shimText('cmd', text) }, { kind: 'file', path: j(L.bin, 'opencode1'), content: shimText('sh', text) }]
    : [{ kind: 'file', path: j(L.bin, 'opencode1'), content: shimText('sh', text) },
      ...rcFiles(home, shell, fsx).map((p) => ({ kind: 'block', path: p, body: `export PATH=${sq(L.bin)}:"$PATH"` }))];
  return { ok: true, problems, version: found.version, source: found.path, binary, actions, pathDir: L.bin, root: L.root, configSnapshot, configDir: j(L.config, 'opencode') };
}

// Writes. `files` collects the fsops entries (the caller saves them in state.json); `onRecord(record)` fires after each step that
// `--uninstall` must undo, so an error midway still leaves a state to undo. Returns the record (state.json `opencode1`).
export function installOpencode1(p, { home, roots, backupDir, apply, files = [], platform = process.platform, probe = probeVersion, env = process.env, winPath = winPathDefault, onRecord = () => {} }) {
  const win = platform === 'win32';
  const record = { version: p.version, dir: path.dirname(p.binary), binary: p.binary, binDir: p.pathDir, pathEntry: false };
  const planned = planActions(p.actions, roots);
  const refused = planned.filter((a) => a.status === 'skip');
  if (refused.length) throw new Error(refused.map((a) => `${a.path}: ${a.note}`).join('; '));

  if (fs.existsSync(p.binary)) {
    if (sha256File(p.binary) !== sha256File(p.source)) throw new Error(`${p.binary} exists and differs from ${p.source}: not overwritten`);
  } else {
    fs.mkdirSync(record.dir, { recursive: true, mode: 0o700 });
    const part = `${p.binary}.partial`;
    fs.copyFileSync(p.source, part);
    if (!win) fs.chmodSync(part, 0o755);
    if (sha256File(part) !== sha256File(p.source)) throw new Error('sha256 differs after copying the binary');
    const scratch = fs.mkdtempSync(j(os.tmpdir(), 'lean-probe-'));
    let v;
    try { v = probe(part, { ...env, XDG_DATA_HOME: scratch, XDG_STATE_HOME: scratch }); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    if (v !== p.version) throw new Error(`the copied binary reports "${v}", expected ${p.version}`);
    renameRetry(part, p.binary);
  }
  // 1.x gets its own copy of the config it knew; an existing copy (the user may have edited it) is never overwritten.
  const cfg = p.configDir ?? j(layout(home).config, 'opencode');
  if (!fs.existsSync(cfg)) {
    // Copy beside it and rename: a copy that fails midway must not leave a partial folder that later runs would keep.
    const part = `${cfg}.partial`;
    fs.rmSync(part, { recursive: true, force: true });
    fs.mkdirSync(part, { recursive: true, mode: 0o700 });
    if (p.configSnapshot && fs.existsSync(p.configSnapshot)) fs.cpSync(p.configSnapshot, part, { recursive: true, filter: (f) => path.basename(f) !== 'node_modules' });
    renameRetry(part, cfg);
  }
  onRecord(record);
  try { apply(planned, backupDir, home, roots, files); } finally { onRecord(record); }
  if (!win) fs.chmodSync(p.actions[0].path, 0o755);
  if (win) {
    // Recorded before the registry write (a kill in between must not leave an HKCU entry --uninstall does not know about), but
    // only when the entry was absent: removing one the user already had would be ours to answer for.
    record.pathEntry = winPath('has', p.pathDir) === 'absent';
    onRecord(record);
    if (record.pathEntry) {
      record.pathEntry = winPath('add', p.pathDir) === 'changed';
      onRecord(record);
    }
  }
  return record;
}

// Undo what `record` holds (the shim files and rc blocks are undone by fsops from state.files). Returns [what, path] lines.
export function removeOpencode1(record, { home, winPath = winPathDefault, platform = process.platform } = {}) {
  const report = [];
  const L = layout(home);
  // Only ever inside <data>/lean-agents/opencode1: a hand-edited state.json cannot point this at anything else.
  const inside = (p) => path.dirname(p) === L.root && p !== L.frozen && p !== L.state && p !== L.config && p !== L.bin;
  // Only the copied binary, then the folder if nothing else is in it.
  if (record.dir && inside(record.dir) && record.binary && path.dirname(record.binary) === record.dir && fs.existsSync(record.binary)) {
    fs.rmSync(record.binary);
    report.push(['removed', record.binary]);
    try { fs.rmdirSync(record.dir); report.push(['removed', record.dir]); } catch { /* not empty: left */ }
  }
  try { if (fs.readdirSync(L.bin).length === 0) { fs.rmdirSync(L.bin); report.push(['removed', L.bin]); } } catch { /* absent or not empty */ }
  if (record.pathEntry && platform === 'win32' && record.binDir === L.bin) {
    if (winPath('remove', L.bin) === 'changed') report.push(['removed from user PATH', L.bin]);
  }
  return report;
}
