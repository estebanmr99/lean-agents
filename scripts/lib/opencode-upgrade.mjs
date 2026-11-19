// `--upgrade-agent opencode --yes` (apply) and `--undo` (#80 part 2, P6): one journal, five steps, rollback in reverse.
// Steps: backup (re-verify the stamp), opencode1 (P4), install2x, config (P5 translation + managed items), dcp (P5).
// The journal lives in state.json under `upgrade` and is saved before and after every step, so a killed run still shows what to undo.
// Apply never opens or starts OpenCode 2 itself: the live 1.x data is only read, and it must equal the backup when the run starts.
// A failed step undoes the finished steps in reverse; if the live data changed meanwhile it is restored like `--undo` does.
// Nothing here deletes the permanent backup or the frozen copy; a 2.x-migrated db is moved aside, never removed.
// Every effect outside the data (installer, state file, adapter) comes in through `d`, so tests use fakes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupLayout, listSource, copyVerified, countCopy, sha256File, stamp as stampTs, DB_FILES, DATA_DIRS } from './opencode-backup.mjs';
import { spawnSync } from 'node:child_process';
import { layout as layout1, removeOpencode1 } from './opencode1.mjs';
import { upgradeApply } from './upgrade.mjs';
import { undo as undoEntries, privateDir, renameRetry } from './fsops.mjs';
import { configHome } from './system.mjs';

const j = path.join;
const GIB = 1024 ** 3;
const first = (e) => String(e?.message ?? e).split('\n')[0];
const iso = () => new Date().toISOString();

export const STEPS = ['backup', 'opencode1', 'install2x', 'config', 'dcp'];
// A journal in one of these states means an upgrade is live (or half undone): apply refuses, `--undo` works, `--uninstall` refuses.
export const ACTIVE = ['applying', 'rolling-back', 'applied', 'undoing', 'rollback-failed', 'undo-failed'];
export const isActive = (u) => Boolean(u) && ACTIVE.includes(u.status);

// Fault injection for CI: fail right after the named step finished, so its undo is exercised too.
// Test-only on purpose: no flag, and it refuses to run unless LEAN_AGENTS_TEST=1 is set as well.
export function failAt(env = process.env) {
  const v = env.LEAN_TEST_FAIL_AT;
  if (!v) return null;
  if (env.LEAN_AGENTS_TEST !== '1') throw new Error('LEAN_TEST_FAIL_AT is a test-only setting (it needs LEAN_AGENTS_TEST=1): unset it');
  if (!STEPS.includes(v)) throw new Error(`LEAN_TEST_FAIL_AT=${v}: unknown step (${STEPS.join(', ')})`);
  return v;
}

// --- the backup, read-only ---

export function manifestOf(dir) {
  return fs.readFileSync(j(dir, 'MANIFEST.sha256'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(l);
    if (!m || path.isAbsolute(m[2]) || m[2].split('/').includes('..')) throw new Error(`bad line in ${j(dir, 'MANIFEST.sha256')}: ${l.slice(0, 80)}`);
    return { sha: m[1], rel: m[2] };
  });
}

// Problems found re-hashing the backup against its manifest ([] = every file equals its recorded sha256).
export function verifyBackup(dir) {
  const bad = [];
  try {
    for (const { sha, rel } of manifestOf(dir)) {
      const f = j(dir, ...rel.split('/'));
      if (!fs.existsSync(f)) bad.push(`${rel} is missing from the backup`);
      else if (sha256File(f) !== sha) bad.push(`${rel} differs from its recorded sha256`);
    }
  } catch (e) { bad.push(first(e)); }
  return bad;
}

// null when the live data equals the backup, else the first difference. Read-only.
export function liveDiffers(L, dir) {
  try {
    const want = new Map(manifestOf(dir).filter((m) => m.rel.startsWith('data/')).map((m) => [m.rel.slice(5), m.sha]));
    const have = listSource({ live: L.live, config: j(L.live, '.none') }).data;
    if (have.length !== want.size) return `${have.length} files now, ${want.size} in the backup`;
    for (const f of have) if (want.get(f.rel) !== sha256File(j(L.live, ...f.rel.split('/')))) return `${f.rel} changed since the backup`;
    return null;
  } catch (e) { return first(e); }
}

// null when the live data equals the frozen copy (what `--undo` leaves behind: the 1.x state plus the sessions opencode1 made).
export function frozenDiffers(L) {
  try {
    const frozen = j(L.frozen, 'opencode');
    const none = j(frozen, '.none');
    const a = listSource({ live: L.live, config: none }).data;
    const b = listSource({ live: frozen, config: none }).data;
    if (a.length !== b.length) return `${a.length} files now, ${b.length} in the frozen copy`;
    const want = new Map(b.map((f) => [f.rel, f.size]));
    for (const f of a) {
      if (want.get(f.rel) !== f.size || sha256File(j(L.live, ...f.rel.split('/'))) !== sha256File(j(frozen, ...f.rel.split('/')))) return `${f.rel} differs from the frozen copy`;
    }
    return null;
  } catch (e) { return first(e); }
}

// What the live data equals right now: the backup, the frozen copy (after an earlier --undo) or neither.
export const liveBaseline = (L, dir) => (liveDiffers(L, dir) === null ? 'backup' : frozenDiffers(L) === null ? 'frozen' : null);

// Problem with the frozen copy, or null. It equals the backup until 1.x writes to it (opencode1 run/serve change only the frozen db),
// so a copy that differs is trusted only if it still counts at least the backup's sessions; fewer, or not countable, is not.
export function frozenProblem(home, dir, { count, sessions = null } = {}) {
  const L = backupLayout(home, 'x');
  const frozen = j(L.frozen, 'opencode');
  if (!fs.existsSync(j(frozen, 'opencode.db'))) return `the frozen copy has no opencode.db (${frozen})`;
  try {
    const have = new Map(listSource({ live: frozen, config: j(frozen, '.none') }).data.map((f) => [f.rel, sha256File(j(frozen, ...f.rel.split('/')))]));
    const want = manifestOf(dir).filter((m) => m.rel.startsWith('data/'));
    if (have.size === want.length && want.every((m) => have.get(m.rel.slice(5)) === m.sha)) return null;
    const need = sessions ?? countCopy(j(dir, 'data'), count);
    const got = countCopy(frozen, count);
    if (got === null || need === null) return 'the frozen copy differs from the backup and its sessions could not be counted';
    return got >= need ? null : `the frozen copy has ${got} sessions, the backup ${need}`;
  } catch (e) { return first(e); }
}

// Live config files that differ from the 1.x snapshot in the backup (reported after an undo; never overwritten here).
export function configDrift(L, dir) {
  const out = [];
  try {
    for (const { sha, rel } of manifestOf(dir).filter((m) => m.rel.startsWith('config/'))) {
      const f = j(L.config, ...rel.slice(7).split('/'));
      if (!fs.existsSync(f) || sha256File(f) !== sha) out.push(rel.slice(7));
    }
  } catch (e) { out.push(first(e)); }
  return out;
}

// What stops an apply before anything is written: { problems, baseline } (no problems = go; baseline = what the live data equals).
export function applyPreflight({ home, stamp, upgrade, exec = true, list, opencodeRunning, count }) {
  const problems = [];
  let baseline = null;
  if (!exec) problems.push('--no-exec: apply installs OpenCode 2 and runs `--version` probes, so it needs commands enabled');
  if (isActive(upgrade)) problems.push(`an upgrade is already ${upgrade.status}: run --upgrade-agent opencode --undo first`);
  if (!stamp) { problems.push('no verified session backup: run --upgrade-agent opencode --backup --yes first (no stamp, no apply)'); return { problems, baseline }; }
  try { if (opencodeRunning(list())) problems.push('an opencode process is running (the 1.x app or the 2.x background service): close it first'); } catch (e) { problems.push(`cannot list the running processes (${first(e)}): not safe to continue`); }
  const bad = verifyBackup(stamp.dir);
  if (bad.length) problems.push(`the backup no longer matches its manifest (${bad[0]}${bad.length > 1 ? ` and ${bad.length - 1} more` : ''}): not used`);
  else {
    const L = backupLayout(home, 'x');
    const bad2 = frozenProblem(home, stamp.dir, { count, sessions: stamp.sessions });
    if (bad2) problems.push(`${bad2}: the frozen copy is not trusted. Move ${stamp.frozen} aside by hand (lean-agents never deletes it), then run --backup --yes again; the permanent backup in ${stamp.dir} is untouched`);
    baseline = liveBaseline(L, stamp.dir);
    if (!baseline) problems.push(`the live data changed since the backup (${liveDiffers(L, stamp.dir)}) and differs from the frozen copy: those sessions would not be in a copy. Move ${stamp.dir} and ${stamp.frozen} aside by hand (lean-agents never deletes them) and run --backup --yes again`);
  }
  return { problems, baseline };
}

// --- the data: move the 2.x db aside, copy the frozen copy back ---

// Replaces the live db, storage and snapshot with the frozen copy (or the permanent backup when the frozen copy holds fewer
// sessions). Order: choose the source and check its count, copy it next to the live folder and check it, move the live items to
// `backups/opencode2-db-<ts>/`, rename the copy into place. Anything else in the live folder (auth, logs) is left alone.
export function restoreData({ home, backupDir, now = new Date(), count, statfs = fs.statfsSync, rename = renameRetry, log = console.log }) {
  const ts = stampTs(now);
  const L = backupLayout(home, ts);
  const frozenData = j(L.frozen, 'opencode');
  const backupData = j(backupDir, 'data');
  const want = countCopy(backupData, count);
  let src = frozenData;
  let n = fs.existsSync(j(frozenData, 'opencode.db')) ? countCopy(frozenData, count) : null;
  if (want === null && n !== null) log('the backup could not be counted: using the frozen copy without the comparison');
  else if (n === null || want === null || n < want) {
    log(`the frozen copy has ${n ?? 'no countable'} sessions, the backup ${want ?? '?'}: restoring from the permanent backup`);
    src = backupData;
    n = want;
  }
  if (n === null) throw new Error('could not count the sessions (no Node with node:sqlite answered: missing, too old or timed out): the data is not restored');
  const items = listSource({ live: src, config: j(src, '.none') }).data;
  const bytes = items.reduce((t, f) => t + f.size, 0);
  const dbBytes = items.filter((f) => f.rel.startsWith('opencode.db')).reduce((t, f) => t + f.size, 0);
  let probe = L.lean;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const st = statfs(probe);
  if (Number(st.bavail) * Number(st.bsize) < bytes + dbBytes + GIB) throw new Error(`not enough free space to copy ${src} back (${bytes + dbBytes + GIB} bytes needed): nothing was moved`);

  const stage = `${L.live}.restore-partial`;
  const aside = j(L.lean, 'backups', `opencode2-db-${ts}`);
  // A rename onto an existing name would replace an earlier aside copy: never reuse a folder.
  if (fs.existsSync(aside)) throw new Error(`${aside} already exists: try again in a second; nothing was moved`);
  if (fs.existsSync(stage)) log(`replacing an earlier staged copy at ${stage} (a copy of the frozen copy or the backup)`);
  fs.rmSync(stage, { recursive: true, force: true }); // our own leftover from an interrupted run
  copyVerified(src, stage, items);
  const staged = countCopy(stage, count);
  if (staged !== n) throw new Error(`the staged copy has ${staged} sessions, expected ${n}: nothing was moved`);

  const names = [...DB_FILES, ...DATA_DIRS];
  const moved = [];
  const placed = [];
  try {
    privateDir(aside, L.lean);
    for (const name of names) if (fs.existsSync(j(L.live, name))) { rename(j(L.live, name), j(aside, name)); moved.push(name); }
    fs.mkdirSync(L.live, { recursive: true });
    for (const name of names) if (fs.existsSync(j(stage, name))) { rename(j(stage, name), j(L.live, name)); placed.push(name); }
  } catch (e) {
    // Put it back the way it was; if that fails too, the aside folder and the stage still hold every byte.
    try {
      for (const name of placed) rename(j(L.live, name), j(stage, name));
      for (const name of moved) rename(j(aside, name), j(L.live, name));
    } catch (e2) { throw new Error(`${first(e)}; putting the old data back failed too (${first(e2)}). Your data is in ${aside}, ${stage} and ${L.frozen}; see ${j(backupDir, 'RESTORE.md')}`); }
    throw new Error(`${first(e)} (the old data was put back)`);
  }
  fs.rmSync(stage, { recursive: true, force: true });
  const now2 = countCopy(L.live, count);
  if (now2 !== n) throw new Error(`the restored data has ${now2} sessions, expected ${n}: see ${j(backupDir, 'RESTORE.md')}; the replaced data is in ${aside}`);
  log(`restored ${n} sessions from ${src === frozenData ? 'the frozen copy' : 'the permanent backup'}; the replaced db is kept in ${aside}`);
  return { sessions: n, aside, source: src };
}

// --- the journal ---

// A state.json that cannot be written (a Windows rename refused, a full disk) must not hide the way out: say so and go on.
const safeSave = (save, log) => () => { try { save(); } catch (e) { log(`could not save the journal (${first(e)}): the steps above are still undone in this run`); } };

async function unwind({ steps, journal, keep, ctx, log }) {
  if (!Array.isArray(journal.steps)) throw new Error('the journal has no step list');
  for (const rec of [...journal.steps].reverse()) {
    if (rec.status === 'undone') continue;
    const step = steps.find((s) => s.id === rec.id);
    if (!step) throw new Error(`the journal names an unknown step "${rec.id}"`);
    try {
      await step.undo(rec, ctx);
    } catch (e) { throw new Error(`could not undo step ${rec.id}: ${first(e)}`); }
    rec.status = 'undone';
    keep();
    log(`  undone: ${rec.id}`);
  }
}

// Returns true when every step ran. On failure: undo finished steps in reverse; restore the data too if it changed. Never throws.
export async function runApply({ steps, journal, save, ctx, log = console.log, fail = null, restore }) {
  const keep = safeSave(save, log);
  try {
    Object.assign(journal, { status: 'applying', startedAt: iso(), finishedAt: null, error: null, steps: [] });
    save();
    for (const s of steps) {
      const rec = { id: s.id, status: 'running' };
      journal.steps.push(rec);
      save();
      log(`step ${s.id}: ${s.desc}`);
      await s.run(rec, ctx);
      rec.status = 'done';
      save();
      if (fail === s.id) throw new Error(`injected failure after step ${s.id} (LEAN_TEST_FAIL_AT)`);
    }
    Object.assign(journal, { status: 'applied', finishedAt: iso() });
    save();
    return true;
  } catch (e) {
    Object.assign(journal, { status: 'rolling-back', error: first(e) });
    keep();
    log(`failed: ${first(e)}\nrolling back the finished steps (the backup and the frozen copy are kept)`);
    try {
      await unwind({ steps, journal, keep, ctx, log });
      const drift = ctx.liveDrift();
      if (drift) {
        log(`the live data changed during the upgrade (${drift}): restoring it like --undo does`);
        await restore();
      }
      Object.assign(journal, { status: 'rolled-back', finishedAt: iso() });
      keep();
      log('rolled back: everything this run changed was undone');
    } catch (e2) {
      Object.assign(journal, { status: 'rollback-failed', error: `${journal.error}; rollback: ${first(e2)}` });
      keep();
      log(`ROLLBACK STOPPED: ${first(e2)}\nNothing was deleted. Follow ${ctx.restoreMd} to put the 1.x data back by hand; then run --undo again.`);
    }
    return false;
  }
}

// `--undo`: every step in reverse, then the data. Returns true when the 1.x state is back.
export async function runUndo({ steps, journal, save, ctx, log = console.log, restore }) {
  const keep = safeSave(save, log);
  try {
    Object.assign(journal, { status: 'undoing', error: null });
    keep();
    await unwind({ steps, journal, keep, ctx, log });
    const r = await restore();
    Object.assign(journal, { status: 'undone', finishedAt: iso(), restored: { sessions: r.sessions, aside: r.aside } });
    keep();
    return true;
  } catch (e) {
    Object.assign(journal, { status: 'undo-failed', error: first(e) });
    keep();
    log(`UNDO STOPPED: ${first(e)}\nNothing was deleted. Follow ${ctx.restoreMd} to put the 1.x data back by hand; then run --undo again.`);
    return false;
  }
}

// What the steps and the rollback share: the journal lookup, the drift check and where the by-hand restore notes are.
export function makeCtx({ home, stamp, journal }) {
  return {
    restoreMd: j(stamp.dir, 'RESTORE.md'),
    step: (id) => journal.steps.find((s) => s.id === id),
    // The live data must still equal what it equaled when the apply started (the backup, or the frozen copy after an earlier --undo).
    liveDrift: () => (journal.baseline === 'frozen' ? frozenDiffers(backupLayout(home, 'x')) : liveDiffers(backupLayout(home, 'x'), stamp.dir)),
  };
}

// --- the real steps ---

// Runs `bin --version` with throwaway data and state dirs: a 2.x binary migrates a db it finds, so never the real or frozen one.
// A 2.x binary may print its version on stderr (the CI log of the first run showed no stdout version): read both, and keep what it
// printed when it fails, so the error names the cause. Returns the first x.y.z found.
export function probeBoth(bin, env) {
  const r = spawnSync(bin, ['--version'], { env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const m = /(\d+\.\d+\.\d+)/.exec(out);
  if (m) return m[1];
  throw new Error(r.error ? first(r.error) : `exit ${r.status}, printed: ${out.slice(0, 120) || 'nothing'}`);
}

export function versionIn(bin, { probe = probeBoth, env = process.env } = {}) {
  const scratch = fs.mkdtempSync(j(os.tmpdir(), 'lean-probe-'));
  try { return probe(bin, { ...env, XDG_DATA_HOME: scratch, XDG_STATE_HOME: scratch, XDG_CACHE_HOME: scratch, XDG_CONFIG_HOME: scratch }); } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

// d: { home, platform, log, state, save, inv, stamp, roots, adapterFor(tools), tools, backupDir(name), which(cmd), probe, manual,
//      plan1(), install1(plan, files, onRecord), installAgent(), uninstallAgent() }
export function createSteps(d) {
  const win = (d.platform ?? process.platform) === 'win32';
  const ocBin = j(d.home, '.opencode', 'bin', `opencode${win ? '.exe' : ''}`);
  const cfgRoot = configHome(d.home);
  const tried = [];
  const find2x = () => {
    tried.length = 0;
    for (const c of [ocBin, d.which?.('opencode')].filter((x) => x && fs.existsSync(x))) {
      try {
        const v = versionIn(c, { probe: d.probe });
        if (/^2\./.test(v)) return { path: c, version: v };
        tried.push(`${c}: version ${v}, not 2.x`);
      } catch (e) { tried.push(`${c}: ${first(e)}`); }
    }
    return null;
  };

  // Saved before each write (fsops pushes the entry first), so a kill midway still leaves entries --undo can revert.
  const journaled = (rec) => Object.assign([], { push: (...e) => { Array.prototype.push.apply(rec.entries, e); d.save(); return rec.entries.length; } });
  const config = (id, desc, tools, translate) => ({
    id, desc,
    run(rec) {
      rec.entries = journaled(rec);
      const r = upgradeApply({ home: d.home, inv: translate ? d.inv : { items: [] }, adapter: d.adapterFor(tools), backupDir: d.backupDir(id), stamp: d.stamp, entries: rec.entries });
      d.log(r.text);
    },
    undo(rec) {
      for (const [what, file] of undoEntries(rec.entries ?? [], [cfgRoot])) d.log(`  ${what.padEnd(20)} ${file}`);
    },
  });

  return [
    {
      id: 'backup', desc: 'the verified backup and frozen copy (checked again, not copied)',
      run(rec) { rec.dir = d.stamp.dir; rec.sessions = d.stamp.sessions; },
      undo() { /* permanent: lean-agents never deletes it */ },
    },
    {
      id: 'opencode1', desc: 'OpenCode 1.x side by side (binary copy, shim, PATH), reading only the frozen copy',
      run(rec) {
        // Set up earlier by `--opencode1 --yes`: kept as it is, and not ours to undo.
        if (d.state.opencode1 && fs.existsSync(d.state.opencode1.binary)) { rec.preexisting = true; rec.opencode1 = d.state.opencode1; d.log(`  already set up (${d.state.opencode1.binary}): kept`); return; }
        const p = d.plan1();
        if (!p.ok) throw new Error(`opencode1: ${p.problems.join('; ').replace(/\n\s*/g, ' ')}`); // one line: the step log prints only the first
        rec.source = p.source;
        rec.entries = journaled(rec);
        d.install1(p, rec.entries, (record) => { rec.opencode1 = record; d.state.opencode1 = record; d.save(); });
      },
      undo(rec) {
        if (rec.preexisting) return;
        for (const [what, file] of undoEntries(rec.entries ?? [], [...d.roots, layout1(d.home).root])) d.log(`  ${what.padEnd(20)} ${file}`);
        if (rec.opencode1) for (const [what, file] of removeOpencode1(rec.opencode1, { home: d.home })) d.log(`  ${what.padEnd(20)} ${file}`);
        delete d.state.opencode1;
      },
    },
    {
      id: 'install2x', desc: 'OpenCode 2 (the installer may overwrite the 1.x binary; the copy from the step above is the way back)',
      async run(rec) {
        rec.preSha = fs.existsSync(ocBin) ? sha256File(ocBin) : null;
        const have = find2x();
        if (have) { rec.method = 'existing'; rec.version = have.version; d.log(`  OpenCode ${have.version} is already there (${have.path}): kept`); return; }
        // The hand install overwrites ~/.opencode/bin/opencode.exe, and the rollback removes this run's 1.x copy: --opencode1 keeps it (#179 PC run).
        if (d.manual) throw new Error(`${d.manual}. In this order: run --upgrade-agent opencode --opencode1 --yes (keeps the 1.x binary), install OpenCode 2 by hand, then run this again`);
        rec.method = 'installer';
        rec.installAttempted = true;
        d.save();
        await d.installAgent();
        const now = find2x();
        if (!now) throw new Error(`the OpenCode 2 install did not leave a working 2.x binary at ${ocBin}${tried.length ? ` (${tried.join('; ')})` : ''}`);
        rec.version = now.version;
      },
      async undo(rec, ctx) {
        if (rec.installAttempted) await d.uninstallAgent();
        await restore1x(rec, ctx);
        // The uninstall only logs when it fails: check that no 2.x is left before the opencode1 copy is removed.
        if (rec.installAttempted && find2x()) throw new Error('OpenCode 2 is still installed after the uninstall: remove it by hand, then run --undo again (the 1.x copy is kept)');
      },
    },
    config('config', 'the 2.x config: managed items and the translation of your 1.x keys (user-manual keys stay)', d.tools.config, true),
    config('dcp', 'DCP on 2.x (plugin and dcp.jsonc; your own dcp.jsonc values are kept)', d.tools.dcp, false),
  ];

  // The installer writes the same path 1.x lived in (Windows, script installs): put the copied 1.x binary back, 2.x aside.
  async function restore1x(rec, ctx) {
    {
        if (!rec.preSha || rec.method === 'existing') return;
        if (fs.existsSync(ocBin) && sha256File(ocBin) === rec.preSha) return;
        const copy = ctx.step('opencode1')?.opencode1?.binary;
        // Overwritten and no verified copy to put back: stop, the opencode1 copy stays.
        if (!copy || !fs.existsSync(copy) || sha256File(copy) !== rec.preSha) throw new Error(`the file at ${ocBin} was replaced and the 1.x copy that matches it is missing or differs: not restored; the opencode1 copy is kept`);
        if (fs.existsSync(ocBin)) {
          const lean = backupLayout(d.home, 'x').lean;
          const aside = j(lean, 'backups', `opencode2-bin-${stampTs()}`);
          privateDir(aside, lean);
          if (fs.existsSync(j(aside, path.basename(ocBin)))) throw new Error(`${aside} already holds a 2.x binary: not replaced`);
          renameRetry(ocBin, j(aside, path.basename(ocBin)));
          d.log(`  moved the 2.x binary to ${aside}`);
        }
        fs.mkdirSync(path.dirname(ocBin), { recursive: true });
        const part = `${ocBin}.partial`;
        fs.copyFileSync(copy, part);
        if (!win) fs.chmodSync(part, 0o755);
        if (sha256File(part) !== rec.preSha) { fs.rmSync(part, { force: true }); throw new Error('sha256 differs after copying the 1.x binary back'); }
        renameRetry(part, ocBin);
        d.log(`  restored the 1.x binary at ${ocBin} (sha256 checked)`);
    }
  }
}
