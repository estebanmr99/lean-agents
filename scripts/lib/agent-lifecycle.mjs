// --install-agent / --uninstall-agent: opt-in install of an agent CLI and an undo that removes only what we recorded.
// Installer scripts are pinned in core/pins.json (url + sha256, checked by verify-sha256.mjs before they run).
// Install snapshots the install dirs before and after and records the new files with their sha256 in <state>/agents.json.
// Uninstall deletes a recorded file only while its sha256 still matches, or runs `npm uninstall -g` for npm installs.
// It never runs an agent's own uninstaller (`opencode uninstall` may delete user data) and never installs OpenCode 1.x (#79).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS } from './pins.mjs';
import { sha256 } from './verify-sha256.mjs';
import { run, which, version, antigravityPrereqs, packageManager, agyCandidates, BREW_AGY_LIMIT } from './system.mjs';
import { writePrivate, privateDir } from './fsops.mjs';
import { winPathDefault } from './opencode1.mjs';
import { gitBashPath } from './terminals.mjs';

const VERIFY = fileURLToPath(new URL('./verify-sha256.mjs', import.meta.url));
export const LIFECYCLE_AGENTS = ['claude', 'opencode-v2', 'copilot-cli', 'cursor', 'antigravity', 'vscode-copilot'];
export const AGENT_CLIS = { claude: 'claude', 'opencode-v2': 'opencode', 'copilot-cli': 'copilot', cursor: 'agent', antigravity: 'agy' };
const VSCODE = 'vscode-copilot';
// VS Code owns the extension, so for vscode-copilot "install" only writes the adapter's files (the engine does it through o.vscode).
export const VSCODE_NOTE = 'VS Code owns the GitHub Copilot extension: lean-agents never installs, updates or removes it. Install the extension and update it from VS Code (Extensions view).';

// Pinned installer script: curl, verify, run. `args` go to the script (a version for Claude and OpenCode).
function script(pinKey, dir, args = [], ext = '.sh') {
  const p = PINS[pinKey];
  const file = path.join(dir, `${pinKey}${ext}`);
  return { version: null, download: file, run: [[ext === '.ps1' ? 'curl.exe' : 'curl', '-fsSL', '-o', file, p.url], [process.execPath, VERIFY, file, p.sha256], ext === '.ps1' ? ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args] : ['bash', file, ...args]] };
}

// Antigravity CLI on Windows: the pinned release zip holds antigravity.exe, installed as agy.exe where install.ps1 puts it
// (%LOCALAPPDATA%\\agy\\bin; under --home a temp folder uses <home>\\.gemini\\bin, #229). install.ps1 itself is not used: it downloads from a Cloud Run manifest.
function agyWindows({ home, dir, realHome, env, arch }) {
  const W = path.win32;
  const p = PINS['antigravity-cli-win'];
  if (arch !== 'x64' && arch !== 'arm64') return { manual: `Antigravity CLI on Windows ${arch}: no release zip; install it from https://antigravity.google/docs/getting-started` };
  const key = arch;
  const local = home === realHome && env.LOCALAPPDATA ? W.join(env.LOCALAPPDATA, 'agy') : null;
  const binDir = local ? W.join(local, 'bin') : W.join(home, '.gemini', 'bin');
  const zip = W.join(dir, `agy_cli_windows_${key}-${p.version}.zip`);
  const tmp = W.join(dir, `agy_cli_windows_${key}-${p.version}`);
  const q = (s) => s.replace(/['‘’‚‛]/g, (c) => c + c); // PowerShell also ends a '...' string at typographic quotes
  // .NET ZipFile, not Expand-Archive: powershell 5.1 started from pwsh 7 loads the 7.x Archive module and fails. Stop: any error exits non-zero.
  const ps = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path -LiteralPath '${q(tmp)}') { Remove-Item -Recurse -Force -LiteralPath '${q(tmp)}' }; [System.IO.Compression.ZipFile]::ExtractToDirectory('${q(zip)}', '${q(tmp)}'); New-Item -ItemType Directory -Force '${q(binDir)}' | Out-Null; Move-Item -Force '${q(W.join(tmp, 'antigravity.exe'))}' '${q(W.join(binDir, 'agy.exe'))}'; Remove-Item -Recurse -Force '${q(tmp)}'`;
  return {
    method: 'download', version: p.version, download: zip,
    run: [['curl.exe', '-fsSL', '-o', zip, `https://github.com/google-antigravity/antigravity-cli/releases/download/${p.version}/agy_cli_windows_${key}.zip`], [process.execPath, VERIFY, zip, p.sha256[key]], ['powershell', '-NoProfile', '-NonInteractive', '-Command', ps]],
    // agy updates itself: uninstall keeps a changed agy.exe (sha256 mismatch). VERIFY the setting that turns auto-update off.
    bins: [W.join(binDir, 'agy.exe')], dirs: local ? [binDir, local] : [binDir], pathDir: binDir,
  };
}

// Cursor CLI on Windows: the pinned cursor.com script (it fixes the CLI version, downloads a 267 MB zip and installs to %LOCALAPPDATA%\\cursor-agent
// with agent.cmd shims and a user PATH entry), so it runs as is. It ignores --home: only a real home or a LOCALAPPDATA inside --home (CI) is planned.
// The Cursor installer deletes an existing folder first, so lean-agents stops if it exists; --install-agent runs only when `agent` is missing.
function cursorWindows({ home, dir, realHome, env }) {
  const W = path.win32;
  const la = env.LOCALAPPDATA;
  const rel = la && W.relative(home, la);
  // LOCALAPPDATA must sit inside home (also for the real one): --uninstall-agent only removes files under home.
  if (!la || rel === '..' || rel.startsWith('..\\') || W.isAbsolute(rel)) return { manual: 'Cursor CLI on Windows: install it from https://cursor.com/docs/cli/installation (the installer ignores --home)' };
  const root = W.join(la, 'cursor-agent');
  if (fs.existsSync(root)) return { manual: `Cursor CLI on Windows: ${root} already exists and the Cursor installer deletes it first; install it from https://cursor.com/docs/cli/installation` };
  const sc = script('cursor-installer-win', dir, [], '.ps1');
  sc.run[2].splice(2, 0, '-NonInteractive');
  return { method: 'script', ...sc, bins: [W.join(root, 'agent.cmd')], dirs: [root], pathDir: root };
}

// One row per agent for this OS: how it is installed, where its binary lands and which dirs the install may write to.
// `manual` is a reason, not a command: that agent/OS route is not proven yet (VERIFY in docs/compatibility.md).
// `ver`: version per pin key to install instead of the release pin (the saved previous version, for an undo).
// gitBash: plan as if Git Bash were there (--everything installs Git first; the run builds the table again with the real path).
export function agentTable({ home, platform, dir, realHome, ver = {}, env = process.env, gitBash, arch = process.arch }) {
  const at = (key) => ver[key] ?? PINS[key].version;
  const posix = platform !== 'win32';
  const cmds = AGENT_CLIS;
  const local = path.join(home, '.local');
  const bin = (...n) => n.map((x) => path.join(local, 'bin', x));
  const prefix = home === realHome ? [] : ['--prefix', local];
  const t = {};
  t.claude = posix
    ? { method: 'script', ...script('claude-installer', dir, [at('claude-code')]), bins: bin('claude'), dirs: [path.join(local, 'bin'), path.join(local, 'share', 'claude'), path.join(home, '.claude', 'downloads')] }
    : { method: 'script', ...script('claude-installer-win', dir, [at('claude-code')], '.ps1'), bins: bin('claude.exe'), dirs: [path.join(local, 'bin'), path.join(local, 'share', 'claude'), path.join(home, '.claude', 'downloads')], pathDir: path.join(local, 'bin') };
  const bashExe = gitBashPath({ platform, env }) ?? gitBash;
  t['opencode-v2'] = posix
    // --no-modify-path: the installer must not edit ~/.bashrc, which we could not undo.
    ? { method: 'script', ...script('opencode-installer', dir, ['--version', at('opencode-v2'), '--no-modify-path']), bins: [path.join(home, '.opencode', 'bin', 'opencode')], dirs: [path.join(home, '.opencode')] }
    : (bashExe ? (() => {
        const sc = script('opencode-installer', dir, ['--version', at('opencode-v2'), '--no-modify-path']);
        sc.run[0][0] = 'curl.exe';
        sc.run[2][0] = bashExe;
        // Git Bash takes HOME from the environment, which can differ from --home: the installer writes to $HOME/.opencode.
        return { method: 'script', ...sc, env: { HOME: home }, bins: [path.join(home, '.opencode', 'bin', 'opencode.exe')], dirs: [path.join(home, '.opencode')], pathDir: path.join(home, '.opencode', 'bin'), pathFirst: true };
      })() : { manual: 'OpenCode 2 on Windows needs Git for Windows (Git Bash): install it, then run this again' });
  t['copilot-cli'] = {
    method: 'npm', version: at('copilot-cli'),
    run: [['npm', 'install', '-g', ...prefix, `${PINS['copilot-cli'].source}@${at('copilot-cli')}`]], uninstall: [['npm', 'uninstall', '-g', ...prefix, PINS['copilot-cli'].source]],
    bins: prefix.length ? (posix ? [path.join(local, 'bin', 'copilot')] : [path.join(local, 'copilot.cmd')]) : [], dirs: [],
  };
  t.cursor = posix
    ? { method: 'script', ...script('cursor-installer', dir), bins: bin('agent', 'cursor-agent'), dirs: [path.join(local, 'bin'), path.join(local, 'share', 'cursor-agent'), path.join(home, '.cursor')] }
    : cursorWindows({ home, dir, realHome, env });
  if (platform === 'darwin' && packageManager() === 'brew') {
    // The engine's own Antigravity install (antigravityPrereqs); brew removes what it installed.
    const c = antigravityPrereqs('brew', platform, home, false).find((x) => x.run.length);
    t.antigravity = { method: 'brew', version: null, run: c?.run ?? [], uninstall: [['brew', 'uninstall', '--cask', 'antigravity-cli']], bins: [], dirs: [], unpinned: BREW_AGY_LIMIT };
  } else {
    t.antigravity = posix
      ? { method: 'script', ...script('antigravity-installer', dir), bins: bin('agy'), dirs: [path.join(local, 'bin'), path.join(local, 'share'), path.join(home, '.antigravity'), path.join(home, '.gemini')] }
      : agyWindows({ home, dir, realHome, env, arch });
  }
  for (const [a, row] of Object.entries(t)) row.cmd = cmds[a];
  return t;
}

// {files: Map(path -> {sha256} | {link}), dirs: Set} of everything under the given roots.
export function snapshot(roots) {
  const files = new Map();
  const dirs = new Set();
  const walk = (p) => {
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (!st) return;
    if (st.isSymbolicLink()) files.set(p, { link: fs.readlinkSync(p) });
    else if (st.isDirectory()) { dirs.add(p); for (const n of fs.readdirSync(p)) walk(path.join(p, n)); } else if (st.isFile()) files.set(p, { sha256: sha256(p) });
  };
  for (const r of roots) walk(r);
  return { files, dirs };
}

const inside = (home, p) => { const r = path.relative(home, p); return r && !r.startsWith('..') && !path.isAbsolute(r); };
const same = (a, b) => a && b && a.sha256 === b.sha256 && a.link === b.link;

export function diffSnapshots(before, after) {
  return {
    files: [...after.files].filter(([p]) => !before.files.has(p)).map(([p, v]) => ({ path: p, ...v })),
    dirs: [...after.dirs].filter((d) => !before.dirs.has(d)),
  };
}

// Removes the recorded files that still match, then the recorded dirs that are now empty. Returns [what, path] rows.
export function removeRecorded(home, rec) {
  const rows = [];
  for (const f of rec.files) {
    if (!inside(home, f.path)) { rows.push(['skipped (outside home)', f.path]); continue; }
    const st = fs.lstatSync(f.path, { throwIfNoEntry: false });
    if (!st) { rows.push(['already gone', f.path]); continue; }
    const now = st.isSymbolicLink() ? { link: fs.readlinkSync(f.path) } : st.isFile() ? { sha256: sha256(f.path) } : null;
    if (!same(now, f)) { rows.push(['kept (changed)', f.path]); continue; }
    fs.unlinkSync(f.path);
    rows.push(['removed', f.path]);
  }
  for (const d of [...rec.dirs].sort((a, b) => b.length - a.length)) {
    if (inside(home, d) && fs.existsSync(d) && !fs.readdirSync(d).length) fs.rmdirSync(d);
  }
  return rows;
}

const stateFile = (stateDir) => path.join(stateDir, 'agents.json');
// agent -> installedAt of its agents.json entry: the stamp an upgrade record is tied to (#284).
export const agentStamps = (stateDir) => Object.fromEntries(Object.entries(readAgents(stateDir).agents).map(([a, r]) => [a, r.installedAt ?? '']));
// --install-agent / --uninstall-agent end the version history of an agent: its upgrade records would undo onto a stale install.
function dropUpgradeRecords(stateDir, a) {
  const file = path.join(stateDir, 'state.json');
  if (!fs.existsSync(file)) return;
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!s.commands?.some((c) => c.reinstall && agentOf(c) === a)) return;
  s.commands = s.commands.filter((c) => !(c.reinstall && agentOf(c) === a));
  writePrivate(file, `${JSON.stringify(s, null, 2)}\n`);
}
const readAgents = (stateDir) => (fs.existsSync(stateFile(stateDir)) ? JSON.parse(fs.readFileSync(stateFile(stateDir), 'utf8')) : { agents: {} });

// vscode-copilot: configure or remove the adapter's files only. o.vscode = { configured(), install(), uninstall() } comes from the engine.
async function vscodeLifecycle(o) {
  const log = console.log;
  log(`${VSCODE}: ${VSCODE_NOTE}`);
  if (o.mode === 'install') {
    if (o.vscode.configured()) log(`${VSCODE}: already configured by lean-agents; run --update to refresh it. Nothing done.`);
    else await o.vscode.install();
  } else if (!o.vscode.configured()) log(`${VSCODE}: not configured by lean-agents; nothing done.`);
  else await o.vscode.uninstall();
}

// o: { mode: 'install'|'uninstall', fromUpgrade (only --upgrade-agent may install 2.x next to 1.x), agents, home, realHome, platform, stateDir, dryRun, exec, yes, ask, yesNo, vscode }
export async function agentLifecycle(o) {
  // Quiet install: chatter goes to the step log, only warnings ("  !") reach the terminal.
  const log = o.logFile ? (l) => { fs.appendFileSync(o.logFile, `${l}\n`); if (/^\s*!/.test(l)) console.log(l); } : console.log;
  const winPath = o.winPath ?? winPathDefault;
  for (const a of o.agents) {
    if (a === 'opencode-v1') throw new Error('opencode-v1 is never installed or removed by lean-agents (work PCs run 1.x on purpose, #79)');
    if (!LIFECYCLE_AGENTS.includes(a)) throw new Error(`cannot ${o.mode} "${a}" (available: ${LIFECYCLE_AGENTS.join(', ')})`);
  }
  if (o.agents.includes(VSCODE)) await vscodeLifecycle(o);
  const agents = o.agents.filter((a) => a !== VSCODE);
  const state = readAgents(o.stateDir);
  const platform = o.platform ?? process.platform;
  const table = o.table ?? agentTable({ home: o.home, platform, dir: o.stateDir, realHome: o.realHome, env: o.env ?? process.env });
  const todo = [];
  for (const a of agents) {
    const row = table[a];
    const mine = state.agents[a];
    if (o.mode === 'install') {
      if (mine) log(`${a}: already installed by lean-agents (${mine.method}); nothing to do.`);
      // #211: a working agy outside PATH (Windows installer folders) counts too; never installed over.
      else if (a === 'antigravity' && agyCandidates(o.home, platform, o.home === o.realHome ? process.env : {}).some((c) => fs.existsSync(c))) log(`${a}: already installed, not by lean-agents; left alone.`);
      else if (row.manual) log(`${a}: ${row.manual}`);
      // --upgrade-agent installs 2.x over a 1.x it already copied out and sha256-checked, so the 1.x binary being there is expected.
      else if (!(o.fromUpgrade && a === 'opencode-v2') && (row.bins.some((b) => fs.existsSync(b)) || ((o.home === o.realHome || row.method === 'brew') && which(row.cmd)))) log(`${a}: already installed, not by lean-agents; left alone.`);
      else if (a === 'opencode-v2' && !o.fromUpgrade && version('opencode')?.startsWith('1.')) log('opencode-v2: OpenCode 1.x is on PATH; lean-agents never installs 2.x next to it here (#79). Nothing done.');
      else todo.push(a);
    } else if (!mine) log(`${a}: not installed by lean-agents; nothing done.`);
    else todo.push(a);
  }
  if (!todo.length) return;
  log(`\nlean-agents ${o.mode}-agent plan:`);
  for (const a of todo) {
    log(`  - ${a}${o.mode === 'install' ? ` (${table[a].method}${table[a].version ? ` ${table[a].version}` : ''})` : ` (${state.agents[a].files.length} recorded files${state.agents[a].uninstall ? ', npm/brew uninstall' : ''})`}`);
    for (const argv of o.mode === 'install' ? table[a].run : state.agents[a].uninstall ?? []) log(`      $ ${argv.join(' ')}`);
  }
  for (const a of todo) if (o.mode === 'install' && table[a].unpinned) log(`  ! ${a}: ${table[a].unpinned}`);
  if (o.dryRun || !o.exec) { log(o.dryRun ? 'Dry run: nothing was changed.' : '--no-exec: nothing was run.'); return; }
  const unpinned = o.mode === 'install' && todo.some((a) => table[a].unpinned);
  if (!o.yesNo(await o.ask(o.mode === 'install' ? `Download and run these installers${unpinned ? ' (some are not pinned, see above)' : ''}?` : 'Remove these agents?', o.yes ? 'y' : 'n'))) { log('Cancelled.'); return; }
  privateDir(o.stateDir, o.stateDir);
  fs.mkdirSync(o.stateDir, { recursive: true });
  const env = {};
  for (const a of todo) {
    if (o.mode === 'install') {
      const row = table[a];
      const before = snapshot(row.dirs);
      let pathDir = null;
      let pathAbsent = false;
      if (platform === 'win32' && row.pathDir) {
        pathDir = row.pathDir;
        pathAbsent = winPath('has', pathDir) === 'absent';
      }
      const ok = row.run.every((argv) => run(argv, { dryRun: false, log, env: { ...env, ...row.env }, logFile: o.logFile }));
      if (row.download) fs.rmSync(row.download, { force: true });
      const rec = diffSnapshots(before, snapshot(row.dirs));
      let pathEntry = false;
      if (pathDir && pathAbsent && winPath('has', pathDir) === 'present') {
        pathEntry = true;
      // The Windows installers (Claude bootstrap.ps1, OpenCode under Git Bash) do not put their bin folder on PATH (#179, 2026-11-19).
      } else if (ok && pathDir && pathAbsent && row.bins.some((b) => fs.existsSync(b))) {
        let added = false;
        try { added = winPath(row.pathFirst ? 'prepend' : 'add', pathDir) === 'changed'; } catch (e) { log(`  ! could not add ${pathDir} to your user PATH (${e.message.split('\n')[0]}); add it by hand`); }
        if (added) {
          pathEntry = true;
          log(`  ${'added to PATH'.padEnd(24)} ${pathDir} (open a new terminal)`);
        }
      }
      if (!ok) {
        log(`  ! ${a}: install failed. Run the commands above by hand.`);
        process.exitCode = 1;
        // Keep what a half-run installer left, so --uninstall-agent can clean it.
        if (!rec.files.length && !rec.dirs.length && !pathEntry) continue;
      }
      state.agents[a] = { method: row.method, version: row.version, installedAt: new Date().toISOString(), uninstall: row.uninstall ?? null, ...rec };
      if (pathEntry) state.agents[a].pathEntryDir = pathDir;
      log(`${a}: installed; ${rec.files.length} files recorded.`);
    } else {
      const rec = state.agents[a];
      if (rec.uninstall && !rec.uninstall.every((argv) => run(argv, { dryRun: false, log, env }))) { log(`  ! ${a}: uninstall failed. Run the command above by hand.`); process.exitCode = 1; continue; }
      for (const [what, file] of removeRecorded(o.home, rec)) log(`  ${what.padEnd(24)} ${file}`);
      if (rec.pathEntryDir && platform === 'win32') {
        if (winPath('remove', rec.pathEntryDir) === 'changed') log(`  ${'removed from PATH'.padEnd(24)} ${rec.pathEntryDir}`);
      }
      delete state.agents[a];
      log(`${a}: removed. Your config and data were not touched.`);
    }
    writePrivate(stateFile(o.stateDir), `${JSON.stringify(state, null, 2)}\n`);
    dropUpgradeRecords(o.stateDir, a);
  }
}

// --update (#182): the commands that move an agent CLI lean-agents installed to the release pin, one per plan row with
// action 'update' (planUpdate already holds OpenCode 1.x, other majors and CLIs the user installed). `reinstall` is the same
// installer at the version it had, saved in state.json next to the command; undoUpgrades() runs it.
// Cursor and Antigravity have no version pin, so they never get a row and are not moved (VERIFY in docs/compatibility.md).
const UPGRADE = { 'claude-code': 'claude', 'opencode-v2': 'opencode-v2', 'copilot-cli': 'copilot-cli' };
export function upgradeCommands({ rows, home, platform = process.platform, dir, realHome, stamps = {}, env = process.env }) {
  const out = [];
  for (const r of rows) {
    const a = UPGRADE[r.tool];
    if (!a || r.action !== 'update') continue;
    const argvs = (ver) => { const row = agentTable({ home, platform, dir, realHome, ver: { [r.tool]: ver }, env })[a]; return row.manual ? null : row; };
    const to = argvs(r.pinned);
    const raw = r.raw ?? r.installed;
    const from = { raw, row: argvs(raw) };
    if (!to) { console.log(`! ${a}: ${agentTable({ home, platform, dir, realHome, env })[a].manual}`); continue; }
    // The downloaded installer is removed by a final step that runs even when an earlier step failed.
    const cleanup = (row) => (row.download ? [[process.execPath, '-e', "require('fs').rmSync(process.argv[1],{force:true})", row.download]] : []);
    out.push({ tool: r.tool, desc: `upgrade ${a} ${from.raw} -> ${r.pinned}`, run: to.run, always: cleanup(to), undo: [], from: from.raw, owner: stamps[a] ?? null, reinstall: from.row.run, reinstallAlways: cleanup(from.row) });
  }
  return out;
}

// --update --undo: the first saved reinstall per agent. Commands are in run order, so that is the version before the oldest
// upgrade; replaying every record forward would end on the newest "previous" version. The agent is the 2nd word of the desc.
export const agentOf = (c) => c.desc.split(' ')[1];
// `stamps`: agentStamps(). A record keeps `owner`, the agents.json stamp when it was made (null: the user's own install). It
// replays only while that is still true: an agent lean-agents uninstalled or reinstalled since must not be brought back, but an
// upgrade of a CLI the user already had stays undoable. Records from before `owner` existed fall back to membership.
export function undoPlan(commands, stamps = null) {
  const seen = new Set();
  const current = (c) => (!stamps || ('owner' in c ? (c.owner ?? null) === (stamps[agentOf(c)] ?? null) : agentOf(c) in stamps));
  return commands.filter((c) => c.reinstall && current(c) && !seen.has(agentOf(c)) && seen.add(agentOf(c)));
}

// Runs each plan step (a failed one is reported and the rest still run). Returns { ok, restored: agents back on their old version }.
export function undoUpgrades(commands, env = {}, stamps = null) {
  const restored = new Set();
  const plan = undoPlan(commands, stamps);
  for (const c of plan) {
    console.log(`- reinstall ${c.from} (undo of: ${c.desc})`);
    const ok = c.reinstall.every((argv) => run(argv, { dryRun: false, log: console.log, env }));
    for (const argv of c.reinstallAlways ?? []) run(argv, { dryRun: false, log: console.log, env });
    if (ok) restored.add(agentOf(c)); else console.log('  ! failed. Run the command above by hand.');
  }
  return { ok: plan.every((c) => restored.has(agentOf(c))), restored };
}
