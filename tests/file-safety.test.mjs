// File safety: no writes through symlinks or outside home/project, owner-only backups and state, owned mark near the top.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan, apply, undo, hasMark, dropBackups, OWNED_MARK } from '../scripts/lib/fsops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'vertex-gemini', '--adhd-always', '--ponytail-mode', 'lite'];
process.env.LEAN_AGENTS_NODE ??= '24.22.2';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-safety-')));
const lean = (home, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
};
const posix = process.platform !== 'win32';

test('a symlinked target is skipped and its file stays unchanged', { skip: !posix }, () => {
  const home = tmp();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'real.md'), 'mine\n');
  fs.symlinkSync(path.join(outside, 'real.md'), path.join(home, 'link.md'));
  const planned = plan([{ kind: 'file', path: path.join(home, 'link.md'), content: `${OWNED_MARK}\n`, force: true }], [home]);
  assert.equal(planned[0].status, 'skip');
  assert.match(planned[0].note, /symlink to .*real\.md; edit by hand/);
  apply(planned, path.join(home, 'b'), home, [home]);
  assert.equal(fs.readFileSync(path.join(outside, 'real.md'), 'utf8'), 'mine\n');
});

test('a symlinked parent that leaves the roots is skipped', { skip: !posix }, () => {
  const home = tmp();
  const outside = tmp();
  fs.symlinkSync(outside, path.join(home, 'dir'));
  const planned = plan([{ kind: 'file', path: path.join(home, 'dir', 'x.md'), content: `${OWNED_MARK}\n` }], [home]);
  assert.equal(planned[0].status, 'skip');
  assert.equal(planned[0].note, 'outside home and project');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a symlinked parent that stays inside the roots still works', { skip: !posix }, () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, 'dotfiles'));
  fs.symlinkSync(path.join(home, 'dotfiles'), path.join(home, 'cfg'));
  const planned = plan([{ kind: 'file', path: path.join(home, 'cfg', 'x.md'), content: `${OWNED_MARK}\n` }], [home]);
  assert.equal(planned[0].status, 'create');
});

test('a target outside both roots is skipped, and apply throws when forced', () => {
  const home = tmp();
  const elsewhere = path.join(tmp(), 'x');
  const [skipped] = plan([{ kind: 'file', path: elsewhere, content: `${OWNED_MARK}\n` }], [home]);
  assert.equal(skipped.status, 'skip');
  assert.throws(() => apply([{ ...skipped, status: 'create', before: null, after: 'x' }], path.join(home, 'b'), home, [home]), /outside home and project/);
  assert.equal(fs.existsSync(elsewhere), false);
});

test('undo leaves a path that became a symlink', { skip: !posix }, () => {
  const home = tmp();
  const outside = path.join(tmp(), 'real');
  fs.writeFileSync(outside, 'mine\n');
  fs.symlinkSync(outside, path.join(home, 'f.md'));
  const report = undo([{ path: path.join(home, 'f.md'), kind: 'file', created: true, hash: 'x' }], [home]);
  assert.deepEqual(report, [['left (symlink)', path.join(home, 'f.md')]]);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'mine\n');
});

test('the owned mark counts only in the first 10 lines', () => {
  const home = tmp();
  const file = path.join(home, 'a.md');
  const action = { kind: 'file', path: file, content: `${OWNED_MARK}\nnew\n` };
  fs.writeFileSync(file, `${'line\n'.repeat(19)}see: ${OWNED_MARK}\n`);
  assert.equal(plan([action], [home])[0].status, 'skip');
  fs.writeFileSync(file, `---\n# ${OWNED_MARK}\n---\nbody\n`);
  assert.equal(plan([action], [home])[0].status, 'modify');
  assert.equal(hasMark(`${'x\n'.repeat(10)}${OWNED_MARK}`), false);
});

test('every file the engine owns carries the mark in its first 10 lines', () => {
  const home = tmp();
  lean(home, ALL);
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  // The i-have-adhd flag files are empty on purpose: the upstream hook only checks that they exist.
  const owned = state.files.filter((f) => f.kind === 'file' && fs.statSync(f.path).size > 0);
  assert.ok(owned.length > 5);
  for (const f of owned) assert.ok(hasMark(fs.readFileSync(f.path, 'utf8')), `${f.path} lacks the mark`);
});

test('backups and state.json are owner-only', { skip: !posix }, () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"keep":"secret"}\n');
  lean(home, ALL);
  const dir = path.join(home, '.config', 'lean-agents');
  const mode = (p) => fs.statSync(p).mode & 0o777;
  assert.equal(mode(path.join(dir, 'state.json')), 0o600);
  assert.equal(mode(dir), 0o700);
  const backups = path.join(dir, 'backups');
  assert.equal(mode(backups), 0o700);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [[path.join(d, e.name), 0o700], ...walk(path.join(d, e.name))] : [[path.join(d, e.name), 0o600]]));
  const found = walk(backups);
  assert.ok(found.some(([p]) => p.endsWith('settings.json')));
  for (const [p, want] of found) assert.equal(mode(p), want, p);
});

test('--uninstall --yes keeps the backups; dropBackups deletes them', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"keep":1}\n');
  lean(home, ALL);
  const backups = path.join(home, '.config', 'lean-agents', 'backups');
  assert.ok(fs.existsSync(backups));
  assert.match(lean(home, ['--uninstall', '--yes', '--no-exec']), /Backups are kept in/);
  assert.ok(fs.existsSync(backups));
  dropBackups(backups);
  assert.equal(fs.existsSync(backups), false);
});
