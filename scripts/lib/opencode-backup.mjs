// Permanent backup and frozen copy of the OpenCode 1.x data (#80 part 2, P3): `--upgrade-agent opencode --backup`.
// Order: preflight (read-only) -> raw backup, every file sha256-checked against its source, session count on a temp copy
// -> frozen copy made from the backup and checked again. The live data is only read: never opened for writing, never
// checkpointed or VACUUMed. Both copies are built in `<name>.partial` and renamed when verified; a finished copy is never deleted.
// `home`, `list`, `statfs` and `count` are passed in so tests never read the real machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { countInChild } from './adopt.mjs';
import { configHome, envDir } from './system.mjs';
import { privateDir, renameRetry } from './fsops.mjs';

const j = path.join;
const GIB = 1024 ** 3;
export const DB_FILES = ['opencode.db', 'opencode.db-wal', 'opencode.db-shm'];
export const DATA_DIRS = ['storage', 'snapshot'];
export const STAMP_FILE = 'STAMP.json';

export const stamp = (d = new Date()) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');
// Backup + frozen copy are two full copies; keep 1 GiB spare (plan 80b, decision 2).
// The temp count copy of the db (os.tmpdir(), often the same volume) adds one more db.
export const neededBytes = (bytes, dbBytes = 0) => 2 * bytes + dbBytes + GIB;
const OPENCODE_RE = /^opencode(\.exe)?$/i;
export const opencodeRunning = (names) => names.some((n) => OPENCODE_RE.test(n.trim().split(/[\\/]/).pop()));

// One text for every refusal that meets a running OpenCode, so all four call sites say the same thing (#548).
export const OPENCODE_RUNNING = "an opencode process is running (the 1.x app or the 2.x background service): run 'opencode service stop' (safe: it stops only the background service) and close OpenCode windows, then run this again";
// #546: stopping the service from an agent's own shell kills that agent's session.
export const OPENCODE_RUNNING_INSIDE = "you are running inside OpenCode: close this OpenCode session, then run `lean-agents --update` from a terminal";
// VERIFY: OpenCode 2 sets OPENCODE for the shells its tools run (docs/compatibility.md).
export const insideOpenCode = (env = process.env) => Boolean(env?.OPENCODE);
export const OPENCODE_STOP_FAILED = '! lean-agents could not stop the OpenCode 2 background service its commands started: run `opencode service stop` by hand.';
export const opencodeRunningText = (env = process.env) => (insideOpenCode(env) ? OPENCODE_RUNNING_INSIDE : OPENCODE_RUNNING);

// #548: a row that stops the OpenCode 2 service only when this run started it: no opencode PID before, a new one after.
export function serviceStopRow({ before, agents = [], pids = opencodePids }) {
  if (!(before instanceof Set) || !agents.includes('opencode-v2')) return null;
  let after;
  try { after = new Set(pids()); } catch { return null; }
  const started = [...after].filter((p) => !before.has(p));
  return !before.size && started.length ? { desc: 'stop the OpenCode 2 background service that lean-agents started', run: [['opencode', 'service', 'stop']] } : null;
}

// #592: a lean-agents call that may auto-start the OpenCode 2 service (the --doctor probes) notes the service state first;
// stop() then runs the #548 stop only if that call started it. Nothing is listed unless OpenCode 2 is configured.
// shortcut: compares PID sets, so a service the user starts during the window looks like ours (same limit as #548); stops only when the before set was empty.
export function serviceGuard({ agents = [], pids = opencodePids } = {}) {
  if (!agents.includes('opencode-v2')) return { stop() {} };
  let before = null;
  try { before = new Set(pids()); } catch { /* cannot list: never stop what may be the user's */ }
  return {
    stop(run, say = console.log) {
      const row = serviceStopRow({ before, agents, pids });
      if (row && !run(row.run[0])?.ok) say(OPENCODE_STOP_FAILED);
    },
  };
}

// #488: --update must not swap the OpenCode binary or rewrite its plugins while the 1.x app or the 2.x service runs.
// A step touches OpenCode when its description or any argv word names it (the CLI upgrade, rtk init --opencode, gsd --opencode).
// #546: a Skills CLI add/remove only copies skill files (read on the next session), so `filesOnly` keeps it out of this check.
export const touchesOpenCode = (c) => !c.filesOnly && /opencode/i.test([c.desc, ...(c.run ?? []).flat()].join(' '));
export function runningBlocker(commands, list = listProcesses, env = process.env) {
  if (!commands.some(touchesOpenCode)) return null;
  let names;
  try { names = list(); } catch (e) { return `cannot list the running processes (${String(e.message).split('\n')[0]}): not safe to update OpenCode; close it, then run this again`; }
  return opencodeRunning(names) ? opencodeRunningText(env) : null;
}

// Image names of every running process. shortcut: found by image name only (the 2.x service, and 1.19's platform binary, which npm's node wrapper spawns: VERIFY), not by command line.
export function listProcesses(platform = process.platform) {
  const win = platform === 'win32';
  const out = execFileSync(win ? 'tasklist' : 'ps', win ? ['/FO', 'CSV', '/NH'] : ['-A', '-o', 'comm='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split(/\r?\n/).map((l) => (win ? /^"([^"]*)"/.exec(l)?.[1] ?? '' : l)).filter(Boolean);
}

// PIDs of the running OpenCode processes, so a run can tell the service it started from the user's (#548).
export function opencodePids(platform = process.platform) {
  const win = platform === 'win32';
  return parseOpencodePids(execFileSync(win ? 'tasklist' : 'ps', win ? ['/FO', 'CSV', '/NH'] : ['-A', '-o', 'pid=,comm='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), win);
}

// The PID column of `tasklist /FO CSV /NH` (win) or `ps -A -o pid=,comm=`, kept for OpenCode's image names.
export function parseOpencodePids(out, win) {
  const pids = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    const m = win ? /^"([^"]*)","(\d+)"/.exec(line) : /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(win ? m[2] : m[1]);
    const name = (win ? m[1] : m[2]).trim().split(/[\\/]/).pop();
    if (OPENCODE_RE.test(name)) pids.push(pid);
  }
  return pids;
}

// Written last, atomically, once every check passed: backup-stamp.mjs reads it to open the apply gate.
function writeStamp(dir, info) {
  const tmp = j(dir, `${STAMP_FILE}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, verified: true, ...info }, null, 2)}\n`, { mode: 0o600 });
  renameRetry(tmp, j(dir, STAMP_FILE));
}

export function backupLayout(home, ts) {
  const dataRoot = envDir(home, 'XDG_DATA_HOME', j(home, '.local', 'share'));
  const lean = j(dataRoot, 'lean-agents');
  // `frozen` is what `opencode1` will use as XDG_DATA_HOME: 1.x reads `<frozen>/opencode`.
  return { live: j(dataRoot, 'opencode'), config: j(configHome(home), 'opencode'), lean, backup: j(lean, 'backups', `opencode1-sessions-${ts}`), frozen: j(lean, 'opencode1', 'data') };
}

// Regular files under `root` (relative, '/'-separated); anything else (a symlink) stops the backup instead of being followed.
function walk(root, skip, rel = '', out = []) {
  for (const e of fs.readdirSync(j(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (skip && e.name === skip) continue;
    if (e.isDirectory()) walk(root, skip, r, out);
    else if (e.isFile()) out.push({ rel: r, size: fs.statSync(j(root, r)).size });
    else throw new Error(`${j(root, r)} is not a regular file (a link?); not copied`);
  }
  return out;
}

export function listSource({ live, config }) {
  const data = DB_FILES.filter((f) => fs.existsSync(j(live, f))).map((f) => ({ rel: f, size: fs.statSync(j(live, f)).size }));
  for (const d of DATA_DIRS) if (fs.existsSync(j(live, d))) data.push(...walk(live, null, d));
  // node_modules is rebuilt by OpenCode; the rest of the config dir (plugins, commands, AGENTS.md) is the snapshot.
  return { data, config: fs.existsSync(config) ? walk(config, 'node_modules') : [] };
}

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(1 << 20);
  const fd = fs.openSync(file, 'r');
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

// Copy `entries` from `src` to `dst` (0700 dirs), then compare sha256 of every source and copied file. Returns [{rel, sha}].
export function copyVerified(src, dst, entries) {
  for (const { rel } of entries) {
    fs.mkdirSync(path.dirname(j(dst, rel)), { recursive: true, mode: 0o700 });
    fs.copyFileSync(j(src, rel), j(dst, rel));
  }
  return entries.map(({ rel }) => {
    const sha = sha256File(j(src, rel));
    if (sha256File(j(dst, rel)) !== sha) throw new Error(`sha256 differs after copying ${rel}`);
    return { rel, sha };
  });
}

// Session count on a temp copy of the db (+wal/shm), never on `dir` itself: opening a db can write its wal. null = not counted.
// shortcut: the copy goes to os.tmpdir(); a small tmpfs /tmp cannot hold a multi-GB db. Upgrade when someone hits it.
export function countCopy(dir, count = countInChild) {
  const tmp = fs.mkdtempSync(j(os.tmpdir(), 'lean-count-'));
  try {
    for (const f of DB_FILES) if (fs.existsSync(j(dir, f))) fs.copyFileSync(j(dir, f), j(tmp, f));
    return count(j(tmp, 'opencode.db'), null).sessions ?? null;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export const nearest = (p) => { while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p); return p; };
export const gb = (n) => `${(n / GIB).toFixed(2)} GB`;

function restoreText(L, ts, sessions) {
  return `# Restore the OpenCode 1.x data (backup ${ts}, ${sessions} sessions)

Made by lean-agents (\`--upgrade-agent opencode --backup\`). lean-agents never deletes this folder.
Close every OpenCode first. \`data/\` is a raw copy of \`${L.live}\` (db, -wal, -shm, storage, snapshot); \`config/\` is \`${L.config}\` without node_modules.

Check the files (macOS, Linux; from this folder): \`sha256sum -c MANIFEST.sha256\` (macOS: \`shasum -a 256 -c MANIFEST.sha256\`)

macOS, Linux (set the current data aside, then copy the backup back):

    mv "${L.live}" "${L.live}.aside"
    cp -a "${j(L.backup, 'data')}" "${L.live}"

Windows (PowerShell):

    Move-Item "${L.live}" "${L.live}.aside"
    Copy-Item -Recurse "${j(L.backup, 'data')}" "${L.live}"

The config: copy the files in \`config/\` over \`${L.config}\` the same way.
`;
}

// Returns { ok, sessions, backup, frozen }. dryRun: preflight and the plan only, nothing is written.
export function backupOpencode({ home, dryRun = false, log = console.log, now = new Date(), list = listProcesses, statfs = fs.statfsSync, count = countInChild }) {
  const ts = stamp(now);
  const L = backupLayout(home, ts);
  const refuse = (problems) => { log(`refused, nothing changed:\n${problems.map((p) => `  - ${p}`).join('\n')}`); return { ok: false }; };
  if (!fs.existsSync(j(L.live, 'opencode.db'))) return refuse([`no opencode.db in ${L.live}: nothing to back up`]);

  const problems = [];
  try {
    if (opencodeRunning(list())) problems.push(opencodeRunningText(process.env));
  } catch (e) { problems.push(`cannot list the running processes (${String(e.message).split('\n')[0]}): not safe to copy`); }
  let src;
  try { src = listSource(L); } catch (e) { return refuse([e.message]); }
  const bytes = [...src.data, ...src.config].reduce((n, f) => n + f.size, 0);
  const st = statfs(nearest(L.lean));
  const dbBytes = src.data.filter((f) => f.rel.startsWith('opencode.db')).reduce((n, f) => n + f.size, 0);
  const free = Number(st.bavail) * Number(st.bsize);
  if (free < neededBytes(bytes, dbBytes)) problems.push(`not enough free space: ${gb(free)} free, ${gb(neededBytes(bytes, dbBytes))} needed (2 x ${gb(bytes)} + the db once more for the count copy + 1 GB)`);
  if (fs.existsSync(L.frozen)) problems.push(`a frozen copy already exists at ${L.frozen}: lean-agents does not overwrite it`);
  if (fs.existsSync(L.backup)) problems.push(`${L.backup} already exists: try again in a second`);
  let sessions = null;
  let countCopied = true;
  log(`counting the sessions on a temp copy of the db (${gb(dbBytes)}; minutes on a large db)`);
  try { sessions = countCopy(L.live, count); } catch (e) { countCopied = false; problems.push(`could not copy the db to count sessions (${String(e.message).split('\n')[0]})`); }
  if (sessions === null && countCopied && (dryRun || !problems.length)) problems.push('could not count the sessions (no Node with node:sqlite answered: missing, too old or timed out): the backup could not be checked');
  if (dryRun) {
    log(`dry run: would copy ${src.data.length} data files + ${src.config.length} config files (${gb(bytes)}, ${sessions === null ? 'unknown' : sessions} sessions)`);
    log(`  free space:       ${gb(free)} free, ${gb(neededBytes(bytes, dbBytes))} needed (2 x data + db + 1 GB)`);
    log(`  permanent backup: ${L.backup}`);
    log(`  frozen copy:      ${L.frozen}`);
    if (problems.length) log(`blocker for apply: ${problems.join('; ')}`);
    log('dry run: nothing was written');
    return { ok: true, sessions, backup: L.backup, frozen: L.frozen };
  }

  if (problems.length) return refuse(problems);

  log(`copying ${src.data.length} data files + ${src.config.length} config files (${gb(bytes)}, ${sessions} sessions)`);
  log(`  permanent backup: ${L.backup}`);
  log(`  frozen copy:      ${L.frozen}`);

  const part = `${L.backup}.partial`;
  const fpart = `${L.frozen}.partial`;
  let manifestCount = 0;
  try {
    fs.rmSync(part, { recursive: true, force: true });
    fs.rmSync(fpart, { recursive: true, force: true });
    privateDir(part, L.lean);
    const manifest = [
      ...copyVerified(L.live, j(part, 'data'), src.data).map((m) => ({ ...m, rel: `data/${m.rel}` })),
      ...copyVerified(L.config, j(part, 'config'), src.config).map((m) => ({ ...m, rel: `config/${m.rel}` })),
    ];
    manifestCount = manifest.length;
    fs.writeFileSync(j(part, 'MANIFEST.sha256'), manifest.map((m) => `${m.sha}  ${m.rel}`).join('\n') + '\n', { mode: 0o600 });
    fs.writeFileSync(j(part, 'RESTORE.md'), restoreText(L, ts, sessions), { mode: 0o600 });
    // OpenCode may have started during the copy, which then can miss its last writes (#253).
    if (opencodeRunning(list())) throw new Error('an opencode process started during the copy: close it and run this again');
    renameRetry(part, L.backup);
    log('backup: every file sha256 equals its source');
  } catch (e) {
    fs.rmSync(part, { recursive: true, force: true });
    log(`backup failed: ${e.message}\nnothing else was changed (the live data was only read)`);
    return { ok: false };
  }
  try {
    const after = countCopy(j(L.backup, 'data'), count);
    if (after !== sessions) throw new Error(`session count differs: ${sessions} live, ${after} in the backup`);
    log(`backup: ${after} sessions on a temp copy, equal to the live count`);
    privateDir(j(fpart, 'opencode'), L.lean);
    copyVerified(j(L.backup, 'data'), j(fpart, 'opencode'), src.data);
    const frozen = countCopy(j(fpart, 'opencode'), count);
    if (frozen !== sessions) throw new Error(`session count differs: ${sessions} live, ${frozen} in the frozen copy`);
    renameRetry(fpart, L.frozen);
    log(`frozen copy: every file sha256 equals the backup, ${frozen} sessions`);
    writeStamp(L.backup, { ts, sessions, files: manifestCount });
  } catch (e) {
    fs.rmSync(fpart, { recursive: true, force: true });
    log(`failed: ${e.message}\nthe permanent backup is kept at ${L.backup}; the live data was only read`);
    return { ok: false, backup: L.backup };
  }
  return { ok: true, sessions, backup: L.backup, frozen: L.frozen };
}
