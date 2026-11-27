// --upgrade-agent opencode apply and --undo (#80 part 2, P6): the journal, rollback, the data restore and the apply gate.
// Temp HOME, fake binaries (padded text files whose first line is `VERSION=x`, read by an injected probe) and a fake installer:
// no real OpenCode runs here. The real binaries are proven in CI by tests/real-upgrade-opencode.sh/.ps1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { backupOpencode, backupLayout, sha256File } from '../scripts/lib/opencode-backup.mjs';
import { readBackupStamp } from '../scripts/lib/backup-stamp.mjs';
import { failAt, applyPreflight, restoreData, runApply, runUndo, createSteps, makeCtx, liveDiffers, liveBaseline, STEPS } from '../scripts/lib/opencode-upgrade.mjs';
import { planOpencode1, installOpencode1 } from '../scripts/lib/opencode1.mjs';
import { opencodeV2Adapter } from '../scripts/lib/adapters/opencode-v2.mjs';
import { upgradeInventory } from '../scripts/lib/upgrade.mjs';
import { inventory } from '../scripts/lib/adopt.mjs';
import { apply, renameRetry } from '../scripts/lib/fsops.mjs';
import { loadCore } from '../scripts/lib/render.mjs';
import { seedWorkPc } from './fixtures/handbuilt.mjs';

const j = path.join;
const ROOT = path.resolve(import.meta.dirname, '..');
delete process.env.XDG_DATA_HOME;
delete process.env.XDG_STATE_HOME;
delete process.env.XDG_CONFIG_HOME;
const skip = process.platform === 'win32' && 'the real-upgrade-opencode job covers Windows paths';
const quiet = () => {};
const roomy = () => ({ bavail: 1e9, bsize: 4096 });
const none = () => [];
// The fake db is a number; the fake count reads it back.
const count = (db) => ({ sessions: Number.parseInt(fs.readFileSync(db, 'utf8'), 10) || 0 });
const fakeBin = (v) => `VERSION=${v}\n${'x'.repeat(1 << 20)}`;
const fakeProbe = (bin) => /^VERSION=(\S+)/.exec(fs.readFileSync(bin, 'utf8').slice(0, 64))?.[1];

// Hash of every file in HOME except lean-agents' own folders (the permanent copies and the state): what a user's tools see.
function liveTree(home) {
  const out = [];
  const walk = (rel) => {
    for (const e of fs.readdirSync(j(home, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (r === '.local/share/lean-agents' || r === '.config/lean-agents') continue;
      if (e.isDirectory()) walk(r); else if (e.isFile()) out.push(`${r} ${crypto.createHash('sha256').update(fs.readFileSync(j(home, r))).digest('hex')}`);
    }
  };
  walk('');
  return out.sort().join('\n');
}

function fixture({ withBackup = true } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'lean-upg-')));
  seedWorkPc(home);
  const L = backupLayout(home, 'x');
  fs.mkdirSync(j(L.live, 'storage'), { recursive: true });
  fs.writeFileSync(j(L.live, 'opencode.db'), '3');
  fs.writeFileSync(j(L.live, 'storage', 's1.json'), '{"id":"s1"}');
  fs.writeFileSync(j(L.live, 'auth.json'), 'synthetic secret'); // not backed up, never touched
  if (withBackup) {
    const r = backupOpencode({ home, list: none, statfs: roomy, count, log: quiet });
    assert.equal(r.ok, true);
  }
  return { home, L };
}

test('failAt is test-only: it needs LEAN_AGENTS_TEST=1, knows the step names, and is off by default', () => {
  assert.equal(failAt({}), null);
  assert.throws(() => failAt({ LEAN_TEST_FAIL_AT: 'config' }), /test-only/);
  assert.throws(() => failAt({ LEAN_TEST_FAIL_AT: 'nope', LEAN_AGENTS_TEST: '1' }), /unknown step/);
  assert.equal(failAt({ LEAN_TEST_FAIL_AT: 'dcp', LEAN_AGENTS_TEST: '1' }), 'dcp');
  assert.deepEqual(STEPS, ['backup', 'opencode1', 'install2x', 'config', 'dcp']);
});

test('the stamp: written last by --backup, absent without it, ignored for a half-made or hand-made folder', () => {
  const f = fixture({ withBackup: false });
  assert.equal(readBackupStamp(f.home), null);
  assert.equal(backupOpencode({ home: f.home, list: none, statfs: roomy, count, log: quiet }).ok, true);
  const s = readBackupStamp(f.home);
  assert.equal(s.verified, true);
  assert.equal(s.sessions, 3);
  assert.equal(s.frozen, f.L.frozen);
  fs.rmSync(j(s.dir, 'STAMP.json'));
  assert.equal(readBackupStamp(f.home), null, 'no stamp, no gate');
  fs.writeFileSync(j(s.dir, 'STAMP.json'), '{"verified":false}');
  assert.equal(readBackupStamp(f.home), null);
  fs.writeFileSync(j(s.dir, 'STAMP.json'), '{ not json');
  assert.equal(readBackupStamp(f.home), null);
});

test('preflight: no stamp, a running opencode, a changed backup, changed live data and an active journal each refuse', () => {
  const f = fixture();
  const stamp = readBackupStamp(f.home);
  const pre = (over = {}) => applyPreflight({ home: f.home, stamp, upgrade: null, exec: true, list: none, opencodeRunning: () => false, count, ...over }).problems;
  assert.deepEqual(pre(), []);
  assert.match(pre({ stamp: null }).join(), /no verified session backup.*no stamp, no apply/);
  assert.match(pre({ exec: false }).join(), /--no-exec/);
  assert.match(pre({ opencodeRunning: () => true }).join(), /process is running/);
  assert.match(pre({ list: () => { throw new Error('ps missing'); } }).join(), /cannot list/);
  assert.match(pre({ upgrade: { status: 'applied' } }).join(), /already applied/);
  assert.deepEqual(pre({ upgrade: { status: 'rolled-back' } }), [], 'a finished rollback allows a new apply');
  fs.writeFileSync(j(f.L.live, 'storage', 's1.json'), '{"id":"s1","new":true}');
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'storage', 's1.json'), '{"id":"s1"}');
  assert.match(pre().join(), /live data changed since the backup.*storage\/s1\.json/);
  // Live data that differs from the backup but equals the frozen copy (the state --undo leaves) is fine; the baseline says which.
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'opencode.db'), '1');
  assert.match(pre().join(), /frozen copy has 1 sessions, the backup 3: the frozen copy is not trusted\. Move .* aside by hand.*--backup --yes again/, 'fewer sessions than the backup: refused, with the way out');
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'opencode.db'), '3');
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'storage', 's1.json'), '{"id":"s1","new":true}');
  assert.deepEqual(pre(), [], 'a frozen copy that differs but counts at least the backup (1.x wrote to it) is trusted');
  assert.equal(applyPreflight({ home: f.home, stamp, upgrade: null, list: none, opencodeRunning: () => false, count }).baseline, 'frozen');
  fs.writeFileSync(j(f.L.live, 'storage', 's1.json'), '{"id":"s1"}');
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'storage', 's1.json'), '{"id":"s1"}');
  assert.equal(applyPreflight({ home: f.home, stamp, upgrade: null, list: none, opencodeRunning: () => false, count }).baseline, 'backup');
  fs.writeFileSync(j(stamp.dir, 'data', 'opencode.db'), '99');
  assert.match(pre().join(), /no longer matches its manifest \(data\/opencode\.db/);
});

test('restoreData: the frozen copy comes back, the 2.x db is moved aside, backup and frozen copy are kept, other files stay', { skip }, () => {
  const f = fixture();
  const stamp = readBackupStamp(f.home);
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'opencode.db'), '4'); // a 1.x session made through opencode1
  const frozenSha = sha256File(j(f.L.frozen, 'opencode', 'opencode.db'));
  fs.writeFileSync(j(f.L.live, 'opencode.db'), 'migrated by 2.x');
  fs.writeFileSync(j(f.L.live, 'storage', 'new2x.json'), '{}');
  const r = restoreData({ home: f.home, backupDir: stamp.dir, count, statfs: roomy, log: quiet });
  assert.equal(r.sessions, 4);
  assert.equal(fs.readFileSync(j(f.L.live, 'opencode.db'), 'utf8'), '4');
  assert.equal(fs.existsSync(j(f.L.live, 'storage', 'new2x.json')), false);
  assert.equal(fs.readFileSync(j(f.L.live, 'auth.json'), 'utf8'), 'synthetic secret');
  assert.equal(fs.readFileSync(j(r.aside, 'opencode.db'), 'utf8'), 'migrated by 2.x', 'the 2.x db is kept, not deleted');
  assert.equal(fs.existsSync(j(r.aside, 'storage', 'new2x.json')), true);
  assert.equal(sha256File(j(f.L.frozen, 'opencode', 'opencode.db')), frozenSha, 'frozen copy untouched');
  assert.equal(sha256File(j(stamp.dir, 'data', 'opencode.db')), crypto.createHash('sha256').update('3').digest('hex'), 'backup untouched');
  assert.equal(fs.existsSync(`${f.L.live}.restore-partial`), false);
});

test('restoreData: a frozen copy with fewer sessions than the backup falls back to the backup', { skip }, () => {
  const f = fixture();
  const stamp = readBackupStamp(f.home);
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'opencode.db'), '1');
  fs.writeFileSync(j(f.L.live, 'opencode.db'), 'migrated');
  const logs = [];
  const r = restoreData({ home: f.home, backupDir: stamp.dir, count, statfs: roomy, log: (l) => logs.push(l) });
  assert.equal(r.sessions, 3);
  assert.equal(r.source, j(stamp.dir, 'data'));
  assert.equal(fs.readFileSync(j(f.L.live, 'opencode.db'), 'utf8'), '3');
  assert.match(logs.join('\n'), /restoring from the permanent backup/);
});

test('restoreData: a staged copy that miscounts, or too little space, moves nothing', { skip }, () => {
  const f = fixture();
  const stamp = readBackupStamp(f.home);
  fs.writeFileSync(j(f.L.live, 'opencode.db'), 'migrated');
  const before = liveTree(f.home);
  // restoreData counts the backup, the frozen copy, then the staged copy: the third answer is wrong.
  let calls = 0;
  const lying = (db) => (++calls === 3 ? { sessions: 99 } : count(db));
  assert.throws(() => restoreData({ home: f.home, backupDir: stamp.dir, count: lying, statfs: roomy, log: quiet }), /staged copy has 99 sessions.*nothing was moved/);
  assert.throws(() => restoreData({ home: f.home, backupDir: stamp.dir, count, statfs: () => ({ bavail: 1, bsize: 1 }), log: quiet }), /not enough free space/);
  assert.equal(fs.readFileSync(j(f.L.live, 'opencode.db'), 'utf8'), 'migrated');
  assert.equal(liveTree(f.home).replace(/.*restore-partial.*\n?/g, ''), before.replace(/.*restore-partial.*\n?/g, ''));
});

// --- the journal, with fake steps ---

function fakeSteps(calls, { failUndo = null, failRun = null } = {}) {
  return ['a', 'b', 'c'].map((id) => ({
    id, desc: id,
    run(rec) { calls.push(`run ${id}`); rec.note = id; if (failRun === id) throw new Error(`boom in ${id}`); },
    undo() { calls.push(`undo ${id}`); if (failUndo === id) throw new Error(`cannot undo ${id}`); },
  }));
}
const ctxFor = (drift = null) => ({ restoreMd: '/opt/x/RESTORE.md', step: () => null, liveDrift: () => drift });

test('runApply: all steps run in order, the journal ends applied', async () => {
  const calls = []; const saves = []; const journal = {};
  const ok = await runApply({ steps: fakeSteps(calls), journal, save: () => saves.push(JSON.stringify(journal)), ctx: ctxFor(), log: quiet, restore: async () => { throw new Error('no restore'); } });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['run a', 'run b', 'run c']);
  assert.equal(journal.status, 'applied');
  assert.deepEqual(journal.steps.map((s) => `${s.id}:${s.status}`), ['a:done', 'b:done', 'c:done']);
  assert.ok(saves.some((s) => s.includes('"status":"running"')), 'a step is journaled before it runs');
});

test('runApply: a failing step undoes itself and the finished ones in reverse, nothing after it runs', async () => {
  const calls = []; const journal = {};
  const ok = await runApply({ steps: fakeSteps(calls, { failRun: 'b' }), journal, save: quiet, ctx: ctxFor(), log: quiet, restore: async () => { throw new Error('no restore'); } });
  assert.equal(ok, false);
  assert.deepEqual(calls, ['run a', 'run b', 'undo b', 'undo a']);
  assert.equal(journal.status, 'rolled-back');
  assert.match(journal.error, /boom in b/);
  assert.deepEqual(journal.steps.map((s) => s.status), ['undone', 'undone']);
});

test('runApply: an injected failure fires after the named step, which is undone too', async () => {
  for (const id of ['a', 'b', 'c']) {
    const calls = []; const journal = {};
    const ok = await runApply({ steps: fakeSteps(calls), journal, save: quiet, ctx: ctxFor(), log: quiet, fail: id, restore: async () => {} });
    assert.equal(ok, false, id);
    assert.equal(calls.filter((c) => c.startsWith('undo')).length, calls.filter((c) => c.startsWith('run')).length, `${id}: every finished step is undone`);
    assert.equal(journal.status, 'rolled-back');
    assert.match(journal.error, /injected failure/);
  }
});

test('runApply: a failing undo stops the rollback, keeps the journal for --undo, and names RESTORE.md', async () => {
  const calls = []; const logs = []; const journal = {};
  const ok = await runApply({ steps: fakeSteps(calls, { failRun: 'c', failUndo: 'b' }), journal, save: quiet, ctx: ctxFor(), log: (l) => logs.push(l), restore: async () => {} });
  assert.equal(ok, false);
  assert.deepEqual(calls, ['run a', 'run b', 'run c', 'undo c', 'undo b'], 'a is not undone after b failed');
  assert.equal(journal.status, 'rollback-failed');
  assert.deepEqual(journal.steps.map((s) => s.status), ['done', 'done', 'undone']);
  assert.match(logs.join('\n'), /ROLLBACK STOPPED.*RESTORE\.md/s);
});

test('runApply: live data that changed during the run is restored like --undo; unchanged data is not touched', async () => {
  let restored = 0;
  const run = (drift) => runApply({ steps: fakeSteps([], { failRun: 'b' }), journal: {}, save: quiet, ctx: ctxFor(drift), log: quiet, restore: async () => { restored++; return { sessions: 3 }; } });
  assert.equal(await run(null), false);
  assert.equal(restored, 0);
  assert.equal(await run('opencode.db changed since the backup'), false);
  assert.equal(restored, 1);
});

test('runUndo: every step in reverse, then the data; a failure keeps the journal active', async () => {
  const calls = []; const journal = { steps: [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }, { id: 'c', status: 'undone' }] };
  const ok = await runUndo({ steps: fakeSteps(calls), journal, save: quiet, ctx: ctxFor(), log: quiet, restore: async () => { calls.push('restore'); return { sessions: 4, aside: '/opt/x/aside' }; } });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['undo b', 'undo a', 'restore']);
  assert.equal(journal.status, 'undone');
  assert.equal(journal.restored.sessions, 4);
  const j2 = { steps: [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }] };
  assert.equal(await runUndo({ steps: fakeSteps([], { failUndo: 'a' }), journal: j2, save: quiet, ctx: ctxFor(), log: quiet, restore: async () => { throw new Error('not reached'); } }), false);
  assert.equal(j2.status, 'undo-failed');
});

// --- the real steps against fakes (the real P4 and P5 code, a fake installer and fake binaries) ---

async function machine({ overwrite }) {
  const f = fixture();
  // 1.x binary: where the 2.x installer writes (script install, overwritten) or on a PATH folder (npm, kept).
  const ocBin = j(f.home, '.opencode', 'bin', 'opencode');
  const npmBin = j(f.home, 'npm', 'bin', 'opencode');
  const oneX = overwrite ? ocBin : npmBin;
  fs.mkdirSync(path.dirname(oneX), { recursive: true });
  fs.writeFileSync(oneX, fakeBin('1.19.0'), { mode: 0o755 });
  const inv = upgradeInventory(await inventory({ home: f.home, env: { HOME: f.home, PATH: '' }, platform: process.platform, realHome: '/nowhere' }), { home: f.home });
  const S = { options: { tools: ['ponytail', 'dcp', 'context-mode'], network: {} }, files: [] };
  const log = [];
  const d = {
    home: f.home, platform: 'linux', log: (l) => log.push(l), state: S, save: quiet, roots: [f.home], inv, stamp: readBackupStamp(f.home),
    tools: { config: ['ponytail', 'context-mode'], dcp: ['dcp'] },
    adapterFor: (tools) => opencodeV2Adapter({ home: f.home, core: loadCore(ROOT), profile: null, opts: { tools, network: {}, terminals: [], platform: 'linux', env: {}, shell: 'default', ponytailMode: 'lite' }, rulesPath: j(f.home, 'rules.md') }),
    backupDir: (n) => j(f.home, '.config', 'lean-agents', 'backups', n),
    which: () => oneX, probe: (bin) => fakeProbe(bin), manual: null,
    plan1: () => planOpencode1({ home: f.home, exec: true, platform: 'linux', which: () => oneX, probe: (bin) => fakeProbe(bin), shell: '/bin/bash', env: {} }),
    install1: (p, files, onRecord) => installOpencode1(p, { home: f.home, roots: [f.home], backupDir: j(f.home, '.config', 'lean-agents', 'backups', 'oc1'), apply, files, onRecord, platform: 'linux', probe: (bin) => fakeProbe(bin), env: {} }),
    installed: 0,
    // The real installer writes ~/.opencode/bin/opencode (over the 1.x file when it is there) and records it only when it is new.
    installAgent: async () => { d.installed++; d.newFile = !fs.existsSync(ocBin); fs.mkdirSync(path.dirname(ocBin), { recursive: true }); fs.writeFileSync(ocBin, fakeBin('2.2.5'), { mode: 0o755 }); },
    uninstallAgent: async () => { if (d.newFile && fs.existsSync(ocBin)) { fs.rmSync(ocBin); try { fs.rmdirSync(path.dirname(ocBin)); fs.rmdirSync(path.dirname(path.dirname(ocBin))); } catch { /* not empty */ } } },
  };
  return { f, d, S, log, ocBin, oneX, start: liveTree(f.home) };
}

async function applyWith(m, fail = null) {
  const steps = createSteps(m.d);
  const stamp = m.d.stamp;
  const journal = { backup: stamp.dir, baseline: liveBaseline(m.f.L, stamp.dir) };
  m.S.upgrade = journal;
  const ctx = makeCtx({ home: m.f.home, stamp, journal });
  const restore = async () => restoreData({ home: m.f.home, backupDir: stamp.dir, count, statfs: roomy, log: quiet });
  const ok = await runApply({ steps, journal, save: quiet, ctx, log: quiet, fail, restore });
  return { ok, journal, steps, ctx, restore, stamp };
}

for (const overwrite of [true, false]) {
  const where = overwrite ? '1.x in ~/.opencode/bin (overwritten by the installer)' : '1.x on PATH (kept)';

  test(`full apply, then --undo: the machine is back (${where})`, { skip }, async () => {
    const m = await machine({ overwrite });
    fs.mkdirSync(j(m.f.home, '.config', 'opencode'), { recursive: true });
    fs.writeFileSync(j(m.f.home, '.config', 'opencode', 'tui.json'), '{\n  // my comment\n  "plugin": ["@tarquinen/opencode-dcp@latest", "other"]\n}\n');
    m.start = liveTree(m.f.home);
    const r = await applyWith(m);
    assert.equal(r.ok, true, m.log.join('\n'));
    assert.equal(r.journal.status, 'applied');
    assert.deepEqual(r.journal.steps.map((s) => s.id), STEPS);
    assert.equal(fakeProbe(m.ocBin), '2.2.5');
    const cfg = fs.readFileSync(j(m.f.home, '.config', 'opencode', 'opencode.jsonc'), 'utf8');
    assert.match(cfg, /opencode-dcp/);
    assert.ok(fs.existsSync(j(m.f.home, '.config', 'opencode', 'dcp.jsonc')));
    // 2.x no longer reads tui.json: the apply leaves it exactly as it was and DCP goes only to opencode.jsonc (#558).
    const tui = fs.readFileSync(j(m.f.home, '.config', 'opencode', 'tui.json'), 'utf8');
    assert.match(tui, /@tarquinen\/opencode-dcp@latest/);
    assert.match(tui, /\/\/ my comment/);
    assert.ok(m.S.opencode1.binary, 'opencode1 is recorded');
    assert.equal(liveDiffers(m.f.L, r.stamp.dir), null, 'apply never touches the live data');
    // The user starts 2.x and it migrates the db; then they use opencode1 once.
    fs.writeFileSync(j(m.f.L.live, 'opencode.db'), 'migrated by 2.x');
    fs.writeFileSync(j(m.f.L.frozen, 'opencode', 'opencode.db'), '4');
    const un = await runUndo({ steps: r.steps, journal: r.journal, save: quiet, ctx: r.ctx, log: quiet, restore: r.restore });
    assert.equal(un, true, m.log.join('\n'));
    assert.equal(r.journal.status, 'undone');
    assert.equal(fs.readFileSync(j(m.f.L.live, 'opencode.db'), 'utf8'), '4');
    const tuiUndo = fs.readFileSync(j(m.f.home, '.config', 'opencode', 'tui.json'), 'utf8');
    assert.match(tuiUndo, /@tarquinen\/opencode-dcp@latest/);
    assert.match(tuiUndo, /\/\/ my comment/);
    assert.equal(fakeProbe(m.oneX), '1.19.0', 'the 1.x binary is back');
    assert.equal(m.S.opencode1, undefined);
    // Everything but the db (now the frozen copy's 4 sessions) is what it was.
    const strip = (t) => t.replace(/.*local\/share\/opencode\/opencode\.db .*\n?/, '');
    assert.equal(strip(liveTree(m.f.home)), strip(m.start));
    assert.equal(fs.readFileSync(j(r.stamp.dir, 'data', 'opencode.db'), 'utf8'), '3', 'the backup is kept');
    assert.equal(fs.readFileSync(j(m.f.L.frozen, 'opencode', 'opencode.db'), 'utf8'), '4', 'the frozen copy is kept');
  });

  test(`apply with no tui.json keeps it absent (${where})`, { skip }, async () => {
    const m = await machine({ overwrite });
    const r = await applyWith(m);
    assert.equal(r.ok, true, m.log.join('\n'));
    assert.equal(fs.existsSync(j(m.f.home, '.config', 'opencode', 'tui.json')), false, 'no tui.json stays absent');
  });

  test(`apply with tui.json without dcp keeps it unchanged (${where})`, { skip }, async () => {
    const m = await machine({ overwrite });
    fs.mkdirSync(j(m.f.home, '.config', 'opencode'), { recursive: true });
    const original = '{\n  // my comment\n  "plugin": ["other"]\n}\n';
    fs.writeFileSync(j(m.f.home, '.config', 'opencode', 'tui.json'), original);
    const r = await applyWith(m);
    assert.equal(r.ok, true, m.log.join('\n'));
    assert.equal(fs.readFileSync(j(m.f.home, '.config', 'opencode', 'tui.json'), 'utf8'), original, 'tui.json stays byte-for-byte unchanged');
  });

  for (const step of STEPS) {
    test(`an injected failure after ${step} rolls back to the start state (${where})`, { skip }, async () => {
      const m = await machine({ overwrite });
      const r = await applyWith(m, step);
      assert.equal(r.ok, false);
      assert.equal(r.journal.status, 'rolled-back', m.log.join('\n'));
      assert.equal(liveTree(m.f.home), m.start, 'the whole live tree is byte-identical');
      assert.equal(liveDiffers(m.f.L, r.stamp.dir), null);
      assert.equal(m.S.opencode1, undefined);
    });
  }
}

test('apply on Windows-like manual 2.x install fails at install2x and rolls back; a 2.x already there is kept', { skip }, async () => {
  const m = await machine({ overwrite: false });
  m.d.manual = 'OpenCode 2 on Windows: not proven yet';
  const r = await applyWith(m);
  assert.equal(r.ok, false);
  assert.match(r.journal.error, /not proven yet.*--opencode1 --yes.*install OpenCode 2 by hand, then run this again/);
  assert.equal(liveTree(m.f.home), m.start);
  const n = await machine({ overwrite: false });
  n.d.manual = 'OpenCode 2 on Windows: not proven yet';
  fs.mkdirSync(path.dirname(n.ocBin), { recursive: true });
  fs.writeFileSync(n.ocBin, fakeBin('2.2.5'), { mode: 0o755 });
  const s = await applyWith(n);
  assert.equal(s.ok, true, n.log.join('\n'));
  assert.equal(s.journal.steps.find((x) => x.id === 'install2x').method, 'existing');
});

// #179 PC run: the hand install overwrites the 1.x binary, so the message's order (--opencode1 first) is the only way through.
test('Windows-like manual route in the refusal\'s order: --opencode1, hand install over the 1.x binary, then apply succeeds', { skip }, async () => {
  const m = await machine({ overwrite: true });
  m.d.manual = 'OpenCode 2 on Windows: not proven yet';
  m.S.opencode1 = m.d.install1(m.d.plan1(), [], () => {});
  fs.writeFileSync(m.ocBin, fakeBin('2.2.5'), { mode: 0o755 });
  const r = await applyWith(m);
  assert.equal(r.ok, true, m.log.join('\n'));
  assert.equal(r.journal.steps.find((x) => x.id === 'opencode1').preexisting, true);
  assert.equal(r.journal.steps.find((x) => x.id === 'install2x').method, 'existing');
  // --undo puts the 1.x binary back where the hand install wrote 2.x, and moves 2.x aside (#179 PC run: it used to stay)
  const oneSha = sha256File(m.S.opencode1.binary);
  assert.equal(await runUndo({ steps: r.steps, journal: r.journal, save: quiet, ctx: r.ctx, log: quiet, restore: r.restore }), true);
  assert.equal(sha256File(m.ocBin), oneSha);
  assert.equal(r.journal.steps.find((x) => x.id === 'install2x').kept2x, undefined);
  assert.ok(fs.readdirSync(j(m.f.L.lean, 'backups')).some((n) => n.startsWith('opencode2-bin-')));
  // a second put-back (journal not saved) leaves 1.x alone; with ocBin gone (2.x moved, copy failed) 1.x still comes back
  const asides = () => fs.readdirSync(j(m.f.L.lean, 'backups')).filter((n) => n.startsWith('opencode2-bin-')).length;
  const before = asides();
  const install2x = r.steps.find((x) => x.id === 'install2x');
  r.journal.status = 'undoing'; // as a retried --undo
  await install2x.undo(r.journal.steps.find((x) => x.id === 'install2x'), r.ctx);
  assert.equal(asides(), before);
  fs.rmSync(m.ocBin);
  await install2x.undo(r.journal.steps.find((x) => x.id === 'install2x'), r.ctx);
  assert.equal(sha256File(m.ocBin), oneSha);
  // a rollback is "as before the run": the hand-installed 2.x stays
  const k = await machine({ overwrite: true });
  k.d.manual = 'OpenCode 2 on Windows: not proven yet';
  k.S.opencode1 = k.d.install1(k.d.plan1(), [], () => {});
  fs.writeFileSync(k.ocBin, fakeBin('2.2.5'), { mode: 0o755 });
  const twoSha = sha256File(k.ocBin);
  assert.equal((await applyWith(k, 'config')).ok, false);
  assert.equal(sha256File(k.ocBin), twoSha);
  // without --opencode1 first there is no 1.x binary left, and the step names that on one line
  const n = await machine({ overwrite: true });
  n.d.manual = 'OpenCode 2 on Windows: not proven yet';
  fs.writeFileSync(n.ocBin, fakeBin('2.2.5'), { mode: 0o755 });
  const s2 = await applyWith(n);
  assert.equal(s2.ok, false);
  assert.match(s2.journal.error, /^opencode1: no OpenCode 1\.x binary found[^\n]*$/);
});

test('apply after an earlier --undo (live data equals the frozen copy, not the backup): same rollback, no data move', { skip }, async () => {
  const m = await machine({ overwrite: false });
  fs.writeFileSync(j(m.f.L.live, 'storage', 's1.json'), '{"id":"s1","after":"undo"}');
  fs.writeFileSync(j(m.f.L.frozen, 'opencode', 'storage', 's1.json'), '{"id":"s1","after":"undo"}');
  const start = liveTree(m.f.home);
  const r = await applyWith(m, 'dcp');
  assert.equal(r.journal.baseline, 'frozen');
  assert.equal(r.ok, false);
  assert.equal(r.journal.status, 'rolled-back', m.log.join('\n'));
  assert.equal(liveTree(m.f.home), start);
  assert.equal(fs.existsSync(j(m.f.L.lean, 'backups', 'opencode2-db-x')), false);
  assert.deepEqual(fs.readdirSync(j(m.f.L.lean, 'backups')).filter((n) => n.startsWith('opencode2-')), [], 'no db was moved aside');
});

test('a failure in the opencode1 step leaves a pre-existing opencode1 alone', { skip }, async () => {
  const m = await machine({ overwrite: false });
  const p = m.d.plan1();
  const files = [];
  const record = m.d.install1(p, files, () => {});
  m.S.opencode1 = record;
  const withOne = liveTree(m.f.home);
  const r = await applyWith(m, 'dcp');
  assert.equal(r.ok, false);
  assert.equal(liveTree(m.f.home), withOne, 'what --opencode1 made earlier is still there');
  assert.equal(r.journal.steps[1].preexisting, true);
});

// --- the command line: only PATH, NVM_DIR and HOME reach lean.mjs (plus the test guard where it is the point) ---

const lean = (home, args, extra = {}) => spawnSync(process.execPath, [j(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home, ...extra } });

test('lean.mjs: apply without a backup stamp refuses (exit 1) and writes nothing; --undo with no upgrade says so', () => {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'lean-upg-')));
  seedWorkPc(home);
  const before = liveTree(home);
  const r = lean(home, ['--upgrade-agent', 'opencode', '--yes']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /no verified session backup.*no stamp, no apply/);
  assert.equal(liveTree(home), before);
  assert.equal(fs.existsSync(j(home, '.config', 'lean-agents')), false);
  const u = lean(home, ['--upgrade-agent', 'opencode', '--undo', '--yes']);
  assert.equal(u.status, 0);
  assert.match(u.stdout, /nothing to undo/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('lean.mjs: LEAN_TEST_FAIL_AT without LEAN_AGENTS_TEST=1 is refused before anything runs', () => {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'lean-upg-')));
  const r = lean(home, ['--upgrade-agent', 'opencode', '--yes'], { LEAN_TEST_FAIL_AT: 'config' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /test-only/);
  const ok = lean(home, ['--upgrade-agent', 'opencode', '--yes'], { LEAN_TEST_FAIL_AT: 'config', LEAN_AGENTS_TEST: '1' });
  assert.match(ok.stdout, /no verified session backup/, 'with the guard it gets as far as the stamp check');
  assert.match(lean(home, ['--help']).stdout, /--upgrade-agent opencode --undo/);
  assert.doesNotMatch(lean(home, ['--help']).stdout, /LEAN_TEST_FAIL_AT/, 'never a user-visible option');
  fs.rmSync(home, { recursive: true, force: true });
});

test('lean.mjs: --uninstall refuses while an upgrade is half done, and proceeds with a warning once it is applied', () => {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'lean-upg-')));
  const dir = j(home, '.config', 'lean-agents');
  fs.mkdirSync(dir, { recursive: true });
  const put = (upgrade) => fs.writeFileSync(j(dir, 'state.json'), JSON.stringify({ version: '0', files: [], commands: [], options: {}, upgrade }));
  put({ status: 'rollback-failed', steps: [] });
  const r = lean(home, ['--no-exec', '--uninstall', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /upgrade is rollback-failed: run --upgrade-agent opencode --undo first/);
  assert.ok(fs.existsSync(j(dir, 'state.json')), 'the journal is not archived');
  put({ status: 'applied', backup: '/opt/x/backups/opencode1-sessions-20260101T000000Z', steps: [] });
  const dry = lean(home, ['--no-exec', '--uninstall', '--dry-run', '--yes']);
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /OpenCode 2 upgrade stays/);
  assert.ok(fs.existsSync(j(dir, 'state.json')), 'a dry run changes nothing');
  const ok = lean(home, ['--no-exec', '--uninstall', '--yes']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /--undo is no longer available afterwards/);
  assert.equal(fs.existsSync(j(dir, 'state.json')), false);
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('state.uninstalled-')), 'the journal is archived');
  fs.rmSync(home, { recursive: true, force: true });
});

test('lean.mjs: --uninstall after an applied upgrade removes the shim, the PATH block and the managed 2.x config; data, backup, frozen copy and 2.x stay', { skip }, async () => {
  const m = await machine({ overwrite: false });
  const r = await applyWith(m);
  assert.equal(r.ok, true, m.log.join('\n'));
  const home = m.f.home;
  const shim = j(home, '.local', 'share', 'lean-agents', 'opencode1', 'bin', 'opencode1');
  const cfg = j(home, '.config', 'opencode');
  const dcp = j(cfg, 'dcp.jsonc');
  const rcs = ['.bashrc', '.zshrc', '.profile', '.bash_profile'].map((n) => j(home, n)).filter((f) => fs.existsSync(f) && /lean-agents/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(fs.existsSync(shim) && fs.existsSync(dcp) && rcs.length, 'the apply wrote the shim, dcp.jsonc and a PATH block');
  fs.writeFileSync(j(m.f.L.live, 'opencode.db'), 'migrated by 2.x');
  const dir = j(home, '.config', 'lean-agents');
  fs.writeFileSync(j(dir, 'state.json'), JSON.stringify({ version: '0', files: [], commands: [], options: m.S.options, upgrade: r.journal, opencode1: m.S.opencode1 }));
  const ok = lean(home, ['--no-exec', '--uninstall', '--yes']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Removed: what the upgrade added/);
  assert.equal(fs.existsSync(shim), false, 'the shim is gone');
  assert.equal(fs.existsSync(dcp), false, 'dcp.jsonc is gone');
  assert.doesNotMatch(fs.existsSync(j(cfg, 'opencode.jsonc')) ? fs.readFileSync(j(cfg, 'opencode.jsonc'), 'utf8') : '', /opencode-dcp/);
  for (const f of rcs) assert.doesNotMatch(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '', /lean-agents/, 'the marked PATH block is gone');
  assert.equal(fs.readFileSync(j(m.f.L.live, 'opencode.db'), 'utf8'), 'migrated by 2.x', 'live 2.x data untouched');
  assert.ok(fs.existsSync(r.stamp.dir), 'the backup stays');
  assert.ok(fs.existsSync(j(m.f.L.frozen, 'opencode', 'opencode.db')), 'the frozen copy stays');
  assert.equal(fakeProbe(m.ocBin), '2.2.5', 'the 2.x install stays');
  assert.ok(fs.readdirSync(dir).some((n) => n.startsWith('state.uninstalled-')), 'the journal is archived');
  fs.rmSync(home, { recursive: true, force: true });
});

test('undo stops, and keeps the opencode1 copy, when the overwritten 1.x binary cannot be restored (review 1)', { skip }, async () => {
  const m = await machine({ overwrite: true });
  const r = await applyWith(m);
  assert.equal(r.ok, true, m.log.join('\n'));
  const copy = m.S.opencode1.binary;
  fs.appendFileSync(copy, 'tampered');
  const un = await runUndo({ steps: r.steps, journal: r.journal, save: quiet, ctx: r.ctx, log: quiet, restore: async () => ({ sessions: 3 }) });
  assert.equal(un, false);
  assert.equal(r.journal.status, 'undo-failed');
  assert.match(r.journal.error, /not restored; the opencode1 copy is kept/);
  assert.ok(fs.existsSync(copy));
});

test('restoreData: a session made by opencode1 run (only the frozen db changed, no state files) comes back from the frozen copy, not the older backup', { skip }, () => {
  const f = fixture();
  const stamp = readBackupStamp(f.home);
  fs.writeFileSync(j(f.L.frozen, 'opencode', 'opencode.db'), '4');
  assert.equal(fs.existsSync(j(f.L.lean, 'opencode1', 'state')), false);
  fs.writeFileSync(j(f.L.live, 'opencode.db'), 'migrated');
  const r = restoreData({ home: f.home, backupDir: stamp.dir, count, statfs: roomy, log: quiet });
  assert.equal(r.sessions, 4);
  assert.equal(r.source, j(f.L.frozen, 'opencode'));
  assert.equal(fs.readFileSync(j(f.L.live, 'opencode.db'), 'utf8'), '4');
});

test('runUndo: a journal saved to disk with a step still running is read back and undone (kill midway)', async () => {
  const calls = [];
  const onDisk = JSON.parse(JSON.stringify({ status: 'applying', backup: '/opt/x/b', steps: [{ id: 'a', status: 'done' }, { id: 'b', status: 'running' }] }));
  const ok = await runUndo({ steps: fakeSteps(calls), journal: onDisk, save: quiet, ctx: ctxFor(), log: quiet, restore: async () => ({ sessions: 3, aside: '/opt/x/aside' }) });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['undo b', 'undo a']);
  assert.equal(onDisk.status, 'undone');
});

test('runApply: a state.json that fails on EVERY save after the first step still rolls back completely and restores the data', async () => {
  const logs = []; const calls = []; let broken = false; let restored = 0;
  const steps = fakeSteps(calls);
  const b = steps[1].run;
  steps[1].run = (rec) => { b(rec); broken = true; };
  const save = () => { if (broken) throw new Error('EPERM: rename'); };
  const ok = await runApply({ steps, journal: {}, save, ctx: ctxFor('live data changed'), log: (l) => logs.push(l), restore: async () => { restored++; return { sessions: 3 }; } });
  const out = logs.join('\n');
  assert.equal(ok, false);
  assert.deepEqual(calls, ['run a', 'run b', 'undo b', 'undo a'], 'the failing save after step b is itself the failure that starts the rollback');
  assert.equal(restored, 1, 'the data is restored');
  assert.match(out, /could not save the journal \(EPERM/);
  assert.match(out, /rolled back: everything this run changed was undone/);
  assert.doesNotMatch(out, /ROLLBACK STOPPED/);
});

test('runUndo: a state.json that fails on EVERY save still undoes every step and restores the data', async () => {
  const logs = []; const calls = [];
  const journal = { steps: [{ id: 'a', status: 'done' }, { id: 'b', status: 'done' }] };
  const ok = await runUndo({ steps: fakeSteps(calls), journal, save: () => { throw new Error('EPERM: rename'); }, ctx: ctxFor(), log: (l) => logs.push(l), restore: async () => { calls.push('restore'); return { sessions: 3, aside: '/opt/x/aside' }; } });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['undo b', 'undo a', 'restore']);
  assert.equal(journal.status, 'undone');
  assert.doesNotMatch(logs.join('\n'), /UNDO STOPPED/);
});

test('restoreData: a rename that fails on the second item puts the old data back (put-back branch)', { skip }, () => {
  const f = fixture();
  const stamp = readBackupStamp(f.home);
  fs.writeFileSync(j(f.L.live, 'opencode.db'), 'migrated');
  fs.writeFileSync(j(f.L.live, 'storage', 'only2x.json'), '{}');
  let calls = 0;
  const rename = (a, b) => { if (++calls === 4) throw Object.assign(new Error('EPERM: rename'), { code: 'EPERM' }); fs.renameSync(a, b); };
  assert.throws(() => restoreData({ home: f.home, backupDir: stamp.dir, count, statfs: roomy, rename, log: quiet }), /EPERM.*the old data was put back/);
  assert.equal(fs.readFileSync(j(f.L.live, 'opencode.db'), 'utf8'), 'migrated');
  assert.equal(fs.existsSync(j(f.L.live, 'storage', 'only2x.json')), true);
  assert.equal(fs.readFileSync(j(f.L.live, 'auth.json'), 'utf8'), 'synthetic secret');
  assert.equal(fs.readFileSync(j(f.L.frozen, 'opencode', 'opencode.db'), 'utf8'), '3', 'frozen copy untouched');
});

test('the opencode1 step saves its entries on every push, before the step ends (a kill after the shim write leaves them in the journal)', { skip }, async () => {
  const m = await machine({ overwrite: false });
  const lens = [];
  m.d.save = () => lens.push(m.S.upgrade?.steps?.find((x) => x.id === 'opencode1')?.entries?.length ?? -1);
  const real = m.d.install1;
  let atFirstPush = null;
  m.d.install1 = (p, files, onRecord) => {
    const push = files.push;
    files.push = (...e) => { const n = lens.length; const r = push(...e); atFirstPush ??= { saved: lens.length > n, len: lens.at(-1) }; return r; };
    return real(p, files, onRecord);
  };
  await applyWith(m, 'opencode1');
  assert.deepEqual(atFirstPush, { saved: true, len: 1 }, 'the first push saved a journal that already holds the entry');
});

test('renameRetry: waits out EBUSY twice then succeeds; a permanent lock fails clearly with its code; other errors are not retried', () => {
  const slept = [];
  let n = 0;
  const flaky = (a, b) => { if (++n <= 2) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); return `${a}->${b}`; };
  assert.equal(renameRetry('/opt/x/a.partial', '/opt/x/a', { rename: flaky, sleep: (ms) => slept.push(ms) }), '/opt/x/a.partial->/opt/x/a');
  assert.deepEqual(slept, [250, 250]);
  let m = 0;
  const locked = () => { m++; throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); };
  assert.throws(() => renameRetry('/opt/x/a', '/opt/x/b', { rename: locked, sleep: () => {} }), (e) => e.code === 'EPERM' && /still locked after 8 tries.*another program holds it/.test(e.message));
  assert.equal(m, 8);
  let k = 0;
  const missing = () => { k++; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  assert.throws(() => renameRetry('/opt/x/a', '/opt/x/b', { rename: missing, sleep: () => {} }), /ENOENT/);
  assert.equal(k, 1);
});
