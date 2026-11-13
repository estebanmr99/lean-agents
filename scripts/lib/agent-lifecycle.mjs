// --install-agent / --uninstall-agent: opt-in install of an agent CLI and an undo that removes only what we recorded.
// Installer scripts are pinned in core/pins.json (url + sha256, checked by verify-sha256.mjs before they run).
// Install snapshots the install dirs before and after and records the new files with their sha256 in <state>/agents.json.
// Uninstall deletes a recorded file only while its sha256 still matches, or runs `npm uninstall -g` for npm installs.
// It never runs an agent's own uninstaller (`opencode uninstall` may delete user data) and never installs OpenCode 1.x (#79).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS, npmSpec } from './pins.mjs';
import { sha256 } from './verify-sha256.mjs';
import { run, which, version, antigravityPrereqs, packageManager } from './system.mjs';
import { writePrivate, privateDir } from './fsops.mjs';

const VERIFY = fileURLToPath(new URL('./verify-sha256.mjs', import.meta.url));
export const LIFECYCLE_AGENTS = ['claude', 'opencode-v2', 'copilot-cli', 'cursor', 'antigravity'];

// Pinned installer script: curl, verify, run. `args` go to the script (a version for Claude and OpenCode).
function script(pinKey, dir, args = []) {
  const p = PINS[pinKey];
  const file = path.join(dir, `${pinKey}.sh`);
  return { version: null, download: file, run: [['curl', '-fsSL', '-o', file, p.url], [process.execPath, VERIFY, file, p.sha256], ['bash', file, ...args]] };
}

// One row per agent for this OS: how it is installed, where its binary lands and which dirs the install may write to.
// `manual` is a reason, not a command: that agent/OS route is not proven yet (VERIFY in docs/compatibility.md).
export function agentTable({ home, platform, dir, realHome }) {
  const posix = platform !== 'win32';
  const cmds = { claude: 'claude', 'opencode-v2': 'opencode', 'copilot-cli': 'copilot', cursor: 'agent', antigravity: 'agy' };
  const local = path.join(home, '.local');
  const bin = (...n) => n.map((x) => path.join(local, 'bin', x));
  const prefix = home === realHome ? [] : ['--prefix', local];
  const t = {};
  t.claude = posix
    ? { method: 'script', ...script('claude-installer', dir, [PINS['claude-code'].version]), bins: bin('claude'), dirs: [path.join(local, 'bin'), path.join(local, 'share', 'claude'), path.join(home, '.claude', 'downloads')] }
    : { manual: 'Claude Code on Windows (claude.ai/install.ps1): not proven yet. VERIFY' };
  t['opencode-v2'] = posix
    // --no-modify-path: the installer must not edit ~/.bashrc, which we could not undo.
    ? { method: 'script', ...script('opencode-installer', dir, ['--version', PINS['opencode-v2'].version, '--no-modify-path']), bins: [path.join(home, '.opencode', 'bin', 'opencode')], dirs: [path.join(home, '.opencode')] }
    : { manual: 'OpenCode 2 on Windows (Git Bash installer): install-dir and PATH not proven yet. VERIFY' };
  t['copilot-cli'] = {
    method: 'npm', version: PINS['copilot-cli'].version,
    run: [['npm', 'install', '-g', ...prefix, npmSpec('copilot-cli')]], uninstall: [['npm', 'uninstall', '-g', ...prefix, PINS['copilot-cli'].source]],
    bins: prefix.length ? (posix ? [path.join(local, 'bin', 'copilot')] : [path.join(local, 'copilot.cmd')]) : [], dirs: [],
  };
  t.cursor = posix
    ? { method: 'script', ...script('cursor-installer', dir), bins: bin('agent', 'cursor-agent'), dirs: [path.join(local, 'bin'), path.join(local, 'share', 'cursor-agent'), path.join(home, '.cursor')] }
    : { manual: 'Cursor CLI on Windows (cursor.com/install): not proven yet. VERIFY' };
  if (platform === 'darwin' && packageManager() === 'brew') {
    // The engine's own Antigravity install (antigravityPrereqs); brew removes what it installed.
    const c = antigravityPrereqs('brew', platform, home, false).find((x) => x.run.length);
    t.antigravity = { method: 'brew', version: null, run: c?.run ?? [], uninstall: [['brew', 'uninstall', '--cask', 'antigravity-cli']], bins: [], dirs: [] };
  } else {
    t.antigravity = posix
      ? { method: 'script', ...script('antigravity-installer', dir), bins: bin('agy'), dirs: [path.join(local, 'bin'), path.join(local, 'share'), path.join(home, '.antigravity'), path.join(home, '.gemini')] }
      : { manual: 'Antigravity CLI on Windows (Google.AntigravityCLI): no documented scope, install it from https://antigravity.google/docs/getting-started. VERIFY' };
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
const readAgents = (stateDir) => (fs.existsSync(stateFile(stateDir)) ? JSON.parse(fs.readFileSync(stateFile(stateDir), 'utf8')) : { agents: {} });

// o: { mode: 'install'|'uninstall', agents, home, realHome, platform, stateDir, dryRun, exec, yes, ask, yesNo }
export async function agentLifecycle(o) {
  const log = console.log;
  for (const a of o.agents) {
    if (a === 'opencode-v1') throw new Error('opencode-v1 is never installed or removed by lean-agents (work PCs run 1.x on purpose, #79)');
    if (!LIFECYCLE_AGENTS.includes(a)) throw new Error(`cannot ${o.mode} "${a}" (available: ${LIFECYCLE_AGENTS.join(', ')})`);
  }
  const state = readAgents(o.stateDir);
  const table = o.table ?? agentTable({ home: o.home, platform: o.platform ?? process.platform, dir: o.stateDir, realHome: o.realHome });
  const todo = [];
  for (const a of o.agents) {
    const row = table[a];
    const mine = state.agents[a];
    if (o.mode === 'install') {
      if (mine) log(`${a}: already installed by lean-agents (${mine.method}); nothing to do.`);
      else if (row.manual) log(`${a}: ${row.manual}`);
      else if (row.bins.some((b) => fs.existsSync(b)) || ((o.home === o.realHome || row.method === 'brew') && which(row.cmd))) log(`${a}: already installed, not by lean-agents; left alone.`);
      else if (a === 'opencode-v2' && version('opencode')?.startsWith('1.')) log('opencode-v2: OpenCode 1.x is on PATH; lean-agents never installs 2.x next to it here (#79). Nothing done.');
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
  if (o.dryRun || !o.exec) { log(o.dryRun ? 'Dry run: nothing was changed.' : '--no-exec: nothing was run.'); return; }
  if (!o.yesNo(await o.ask(o.mode === 'install' ? 'Download and run these installers?' : 'Remove these agents?', o.yes ? 'y' : 'n'))) { log('Cancelled.'); return; }
  privateDir(o.stateDir, o.stateDir);
  fs.mkdirSync(o.stateDir, { recursive: true });
  const env = {};
  for (const a of todo) {
    if (o.mode === 'install') {
      const row = table[a];
      const before = snapshot(row.dirs);
      const ok = row.run.every((argv) => run(argv, { dryRun: false, log, env }));
      if (row.download) fs.rmSync(row.download, { force: true });
      const rec = diffSnapshots(before, snapshot(row.dirs));
      if (!ok) {
        log(`  ! ${a}: install failed. Run the commands above by hand.`);
        process.exitCode = 1;
        // Keep what a half-run installer left, so --uninstall-agent can clean it.
        if (!rec.files.length && !rec.dirs.length) continue;
      }
      state.agents[a] = { method: row.method, version: row.version, installedAt: new Date().toISOString(), uninstall: row.uninstall ?? null, ...rec };
      log(`${a}: installed; ${rec.files.length} files recorded.`);
    } else {
      const rec = state.agents[a];
      if (rec.uninstall && !rec.uninstall.every((argv) => run(argv, { dryRun: false, log, env }))) { log(`  ! ${a}: uninstall failed. Run the command above by hand.`); process.exitCode = 1; continue; }
      for (const [what, file] of removeRecorded(o.home, rec)) log(`  ${what.padEnd(24)} ${file}`);
      delete state.agents[a];
      log(`${a}: removed. Your config and data were not touched.`);
    }
    writePrivate(stateFile(o.stateDir), `${JSON.stringify(state, null, 2)}\n`);
  }
}
