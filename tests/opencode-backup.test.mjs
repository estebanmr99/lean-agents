// opencode-backup: permanent backup + frozen copy of the OpenCode 1.x data, against a hand-built fixture in a temp HOME.
// The count needs node:sqlite (a real db fixture); everything else runs with a stubbed count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { backupOpencode, opencodeRunning, neededBytes, stamp, sha256File } from '../scripts/lib/opencode-backup.mjs';

const j = path.join;
// Hermetic: a test runner inside an OpenCode session must not change the refusal wording.
delete process.env.OPENCODE;
let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch { /* the real-count test skips */ }
const skip = sqlite ? false : 'node:sqlite is not available on this Node';

const NOW = new Date('2026-11-18T10:20:30.456Z');
const roomy = () => ({ bavail: 1e9, bsize: 4096 });
const none = () => [];
const quiet = () => {};

function fixture({ db = null } = {}) {
  const home = fs.mkdtempSync(j(os.tmpdir(), 'lean-bkp-'));
  const data = j(home, '.local', 'share', 'opencode');
  fs.mkdirSync(j(data, 'storage', 'session'), { recursive: true });
  fs.mkdirSync(j(data, 'snapshot', 'p1'), { recursive: true });
  fs.mkdirSync(j(home, '.config', 'opencode', 'node_modules', 'x'), { recursive: true });
  if (db) {
    const d = new sqlite.DatabaseSync(j(data, 'opencode.db'));
    d.exec('CREATE TABLE session (id TEXT)');
    for (const id of db) d.prepare('INSERT INTO session VALUES (?)').run(id);
    d.close();
  } else fs.writeFileSync(j(data, 'opencode.db'), 'not a real db');
  fs.writeFileSync(j(data, 'opencode.db-wal'), 'wal bytes');
  fs.writeFileSync(j(data, 'opencode.db-shm'), 'shm bytes');
  fs.writeFileSync(j(data, 'storage', 'session', 's1.json'), '{"id":"s1"}');
  fs.writeFileSync(j(data, 'snapshot', 'p1', 'HEAD'), 'ref: refs/heads/main');
  fs.writeFileSync(j(data, 'auth.json'), 'synthetic secret');
  fs.writeFileSync(j(home, '.config', 'opencode', 'opencode.jsonc'), '{ // 1.x\n}');
  fs.writeFileSync(j(home, '.config', 'opencode', 'node_modules', 'x', 'i.js'), 'x');
  return { home, data, cfg: j(home, '.config', 'opencode'), lean: j(home, '.local', 'share', 'lean-agents') };
}

// sha256 of every file under dir, relative path -> hash.
const tree = (dir, rel = '', out = {}) => {
  for (const e of fs.readdirSync(j(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) tree(dir, r, out); else out[r] = crypto.createHash('sha256').update(fs.readFileSync(j(dir, r))).digest('hex');
  }
  return out;
};

test('opencodeRunning matches the image name, not look-alikes', () => {
  assert.equal(opencodeRunning(['node', '/opt/x/opencode', 'bash']), true);
  assert.equal(opencodeRunning(['OPENCODE.EXE']), true);
  assert.equal(opencodeRunning(['D:\\tools\\opencode.exe']), true);
  assert.equal(opencodeRunning(['opencode1', 'node', 'opencode-helper']), false);
});

test('neededBytes is 2 x size + 1 GiB; stamp is a sortable UTC time', () => {
  assert.equal(neededBytes(10), 20 + 1024 ** 3);
  assert.equal(stamp(NOW), '20261118T102030Z');
});

test('apply: backup and frozen copy equal the source, live data untouched', () => {
  const f = fixture();
  const before = tree(f.home);
  const logs = [];
  const r = backupOpencode({ home: f.home, now: NOW, list: none, statfs: roomy, count: () => ({ sessions: 3 }), log: (l) => logs.push(l) });
  assert.equal(r.ok, true, logs.join('\n'));
  assert.equal(r.sessions, 3);
  const bk = j(f.lean, 'backups', 'opencode1-sessions-20261118T102030Z');
  assert.equal(r.backup, bk);
  for (const rel of ['opencode.db', 'opencode.db-wal', 'opencode.db-shm', 'storage/session/s1.json', 'snapshot/p1/HEAD']) {
    assert.equal(sha256File(j(bk, 'data', rel)), sha256File(j(f.data, rel)), rel);
    assert.equal(sha256File(j(f.lean, 'opencode1', 'data', 'opencode', rel)), sha256File(j(f.data, rel)), `frozen ${rel}`);
  }
  assert.equal(fs.readFileSync(j(bk, 'config', 'opencode.jsonc'), 'utf8'), '{ // 1.x\n}');
  assert.equal(fs.existsSync(j(bk, 'config', 'node_modules')), false);
  assert.equal(fs.existsSync(j(bk, 'data', 'auth.json')), false, 'credentials are not copied');
  assert.match(fs.readFileSync(j(bk, 'RESTORE.md'), 'utf8'), /sha256sum -c MANIFEST\.sha256/);
  const manifest = fs.readFileSync(j(bk, 'MANIFEST.sha256'), 'utf8');
  assert.match(manifest, new RegExp(`${sha256File(j(f.data, 'opencode.db'))}  data/opencode.db`));
  if (process.platform !== 'win32') assert.equal(fs.statSync(bk).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(j(f.lean, 'backups')), ['opencode1-sessions-20261118T102030Z'], 'no .partial left');
  // everything that existed before is byte-identical
  const after = tree(f.home);
  for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, k);
  fs.rmSync(f.home, { recursive: true, force: true });
});

test('an opencode that starts during the copy fails the backup and leaves no partial (#253)', () => {
  const f = fixture();
  const logs = [];
  let calls = 0;
  const list = () => (++calls > 1 ? ['opencode'] : []); // idle at preflight, running at the final check
  const r = backupOpencode({ home: f.home, now: NOW, list, statfs: roomy, count: () => ({ sessions: 3 }), log: (l) => logs.push(l) });
  assert.equal(r.ok, false);
  assert.match(logs.join('\n'), /started during the copy/);
  assert.deepEqual(fs.readdirSync(j(f.lean, 'backups')), [], 'no backup and no .partial');
  fs.rmSync(f.home, { recursive: true, force: true });
});

test('dry run writes nothing: the whole HOME tree hash is unchanged', () => {
  const f = fixture();
  const before = tree(f.home);
  const logs = [];
  const r = backupOpencode({ home: f.home, dryRun: true, now: NOW, list: () => ['node', 'opencode'], statfs: roomy, count: () => ({ sessions: 3 }), log: (l) => logs.push(l) });
  assert.equal(r.ok, true);
  assert.deepEqual(tree(f.home), before);
  assert.equal(fs.existsSync(f.lean), false);
  assert.match(logs.join('\n'), /dry run: would copy 5 data files \+ 1 config files.*3 sessions/);
  assert.match(logs.join('\n'), /free space:.*free,.*needed/);
  assert.match(logs.join('\n'), /blocker for apply:.*process is running/);
  assert.match(logs.join('\n'), /counting the sessions on a temp copy of the db \(\d+\.\d\d GB/);
  fs.rmSync(f.home, { recursive: true, force: true });
});

test('dry run prints unknown sessions and lists the count problem when count returns null', () => {
  const f = fixture();
  const logs = [];
  const r = backupOpencode({ home: f.home, dryRun: true, now: NOW, list: none, statfs: roomy, count: () => ({ sessions: null }), log: (l) => logs.push(l) });
  assert.equal(r.ok, true);
  assert.match(logs.join('\n'), /unknown sessions\)/);
  assert.match(logs.join('\n'), /blocker for apply: could not count the sessions/);
  fs.rmSync(f.home, { recursive: true, force: true });
});

test('dry run includes free space line and lists blocker when statfs too small', () => {
  const f = fixture();
  const logs = [];
  const r = backupOpencode({ home: f.home, dryRun: true, now: NOW, list: none, statfs: () => ({ bavail: 1000, bsize: 4096 }), count: () => ({ sessions: 3 }), log: (l) => logs.push(l) });
  assert.equal(r.ok, true);
  assert.match(logs.join('\n'), /free space:.*free,.*needed/);
  assert.match(logs.join('\n'), /blocker for apply: not enough free space/);
  fs.rmSync(f.home, { recursive: true, force: true });
});

const refused = (name, over, re) => test(`refuses: ${name}`, () => {
  const f = fixture();
  if (over.setup) over.setup(f);
  const before = tree(f.home);
  const logs = [];
  const r = backupOpencode({ home: f.home, now: NOW, list: none, statfs: roomy, count: () => ({ sessions: 3 }), log: (l) => logs.push(l), ...over.args });
  assert.equal(r.ok, false);
  assert.match(logs.join('\n'), re);
  assert.deepEqual(tree(f.home), before, 'nothing written');
  fs.rmSync(f.home, { recursive: true, force: true });
});
refused('an opencode process runs', { args: { list: () => ['node', 'opencode'] } }, /process is running/);
refused('the process list fails', { args: { list: () => { throw new Error('ps missing'); } } }, /cannot list/);
refused('free space is under 2 x size + 1 GB', { args: { statfs: () => ({ bavail: 1000, bsize: 4096 }) } }, /not enough free space/);
refused('the sessions cannot be counted', { args: { count: () => ({ tried: ['Node'] }) } }, /could not count/);
refused('a frozen copy exists', { setup: (f) => fs.mkdirSync(j(f.lean, 'opencode1', 'data'), { recursive: true }) }, /frozen copy already exists/);
refused('there is no db', { setup: (f) => fs.rmSync(j(f.data, 'opencode.db')) }, /nothing to back up/);

test('a count that differs after the copy stops before the frozen copy; the backup stays', () => {
  const f = fixture();
  let n = 0;
  const r = backupOpencode({ home: f.home, now: NOW, list: none, statfs: roomy, count: () => ({ sessions: n++ === 0 ? 3 : 2 }), log: quiet });
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(j(f.lean, 'backups', 'opencode1-sessions-20261118T102030Z', 'RESTORE.md')), true);
  assert.equal(fs.existsSync(j(f.lean, 'opencode1')), false);
  fs.rmSync(f.home, { recursive: true, force: true });
});

test('real db: the count on a temp copy equals the live count, live db is not opened', { skip }, () => {
  const f = fixture({ db: ['a', 'b', 'c'] });
  fs.rmSync(j(f.data, 'opencode.db-wal')); fs.rmSync(j(f.data, 'opencode.db-shm'));
  const live = sha256File(j(f.data, 'opencode.db'));
  const logs = [];
  const r = backupOpencode({ home: f.home, now: NOW, list: none, statfs: roomy, log: (l) => logs.push(l) });
  assert.equal(r.ok, true, logs.join('\n'));
  assert.equal(r.sessions, 3);
  assert.equal(sha256File(j(f.data, 'opencode.db')), live);
  assert.deepEqual(fs.readdirSync(f.data).filter((x) => x.startsWith('opencode.db')), ['opencode.db']);
  fs.rmSync(f.home, { recursive: true, force: true });
});

test('refuses: a symlink in the data is not followed', (t) => {
  const f = fixture();
  try { fs.symlinkSync(j(f.data, 'opencode.db'), j(f.data, 'storage', 'ln')); } catch { return t.skip('cannot create symlinks here'); }
  const logs = [];
  const r = backupOpencode({ home: f.home, now: NOW, list: none, statfs: roomy, count: () => ({ sessions: 3 }), log: (l) => logs.push(l) });
  assert.equal(r.ok, false);
  assert.match(logs.join('\n'), /not a regular file/);
  assert.equal(fs.existsSync(f.lean), false);
  fs.rmSync(f.home, { recursive: true, force: true });
});

// Only PATH, NVM_DIR and HOME reach lean.mjs; an empty HOME has no db, so the refusal comes before any process is listed.
const lean = (home, args) => spawnSync(process.execPath, [path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs'), '--home', home, '--no-exec', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home } });

test('lean.mjs: --backup on an empty home refuses (exit 1) and writes nothing; --backup alone is an error', () => {
  const home = fs.mkdtempSync(j(os.tmpdir(), 'lean-bkp-'));
  const r = lean(home, ['--upgrade-agent', 'opencode', '--backup', '--yes']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /nothing to back up/);
  assert.deepEqual(fs.readdirSync(home), []);
  const bad = lean(home, ['--backup']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /goes with --upgrade-agent/);
  const undo = lean(home, ['--upgrade-agent', 'opencode', '--backup', '--undo']);
  assert.match(undo.stderr, /no --undo/);
  fs.rmSync(home, { recursive: true, force: true });
});
