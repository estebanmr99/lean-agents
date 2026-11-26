// --preflight (#471): shadowed copies, versions below min, stale window PATH, read-only, redaction. Temp HOME, fake executables.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { preflight, findCopies, parseRegPath, staleWindowPath, formatPreflight } from '../scripts/lib/preflight.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-preflight-')));
function fake(dir, name, ver) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, `#!/bin/sh\necho "${name} ${ver}"\n`, { mode: 0o755 });
  return f;
}
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); h.update(p); const s = fs.lstatSync(p); if (s.isDirectory()) walk(p); else h.update(fs.readFileSync(p)); } };
  walk(dir);
  return h.digest('hex');
}
const base = (home, dirs, extra = {}) => ({ home, env: { PATH: dirs.join(path.delimiter), USER: 'alice' }, platform: 'linux', ...extra });
const noFs = { statSync() { throw new Error('ENOENT'); }, accessSync() {}, realpathSync: (p) => p };
const leanCli = (args, env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--preflight', ...args], { encoding: 'utf8', env });

test('A1 shadowed copy: old rtk first on PATH, newer later; both listed, old wins, fix line', { skip: win }, () => {
  const home = tmp();
  const oldDir = path.join(home, 'old'); const newDir = path.join(home, 'new');
  fake(oldDir, 'rtk', '0.42.0'); fake(newDir, 'rtk', '1.2.0');
  const r = preflight(base(home, [oldDir, newDir]));
  const f = r.findings.find((x) => x.tool === 'rtk' && x.kind === 'shadowed');
  assert.ok(f, 'shadowed finding');
  assert.equal(f.blocker, true);
  assert.equal(f.copies.length, 2);
  assert.equal(f.copies[0].version, '0.42.0');
  const text = formatPreflight(r, { home, env: { USER: 'alice' } });
  assert.match(text, /~\/old\/rtk/); assert.match(text, /~\/new\/rtk/);
  assert.match(text, /wins/); assert.match(text, /remove .*or put/i);
  assert.equal(r.blockers, r.findings.filter((x) => x.blocker).length);
});

test('A1 every known CLI is walked, and the same copy twice is one copy', { skip: win }, () => {
  const home = tmp();
  const a = path.join(home, 'a'); const b = path.join(home, 'b');
  const names = ['claude', 'opencode', 'copilot', 'agy', 'context-mode', 'uv', 'jq', 'gh', 'bun'];
  for (const n of names) { fake(a, n, '9.9.9'); fake(b, n, '9.9.9'); }
  const r = preflight(base(home, [a, b, a]));
  for (const n of names) {
    const f = r.findings.find((x) => x.tool === n && x.kind === 'shadowed');
    assert.equal(f?.copies.length, 2, n);
    assert.equal(f.blocker, false, 'same versions: warning, not blocker');
  }
});

test('A1 Windows: PATHEXT is honored and the walk is case-insensitive', () => {
  const files = new Set(['c:\\old\\rtk.cmd', 'c:\\new\\rtk.exe']);
  const fsx = { statSync: (p) => { if (!files.has(p.toLowerCase())) throw new Error('ENOENT'); return { isFile: () => true }; }, accessSync() {}, realpathSync: (p) => p };
  const c = findCopies('rtk', { path: 'C:\\old;C:\\new;C:\\gone', platform: 'win32', env: { PATHEXT: '.EXE;.CMD' }, fsx });
  assert.deepEqual(c, ['C:\\old\\rtk.CMD', 'C:\\new\\rtk.EXE']);
});

test('A2 below min: one row with version, min and update command', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'bin');
  fake(d, 'rtk', '0.42.0');
  const r = preflight(base(home, [d]));
  const rows = r.findings.filter((x) => x.tool === 'rtk' && x.kind === 'below-min');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].blocker, true);
  const text = formatPreflight(r, { home, env: {} });
  assert.match(text, /0\.42\.0/); assert.match(text, /v1\.2\.0/); assert.match(text, /brew upgrade rtk/);
});

test('A3 stale window PATH: stored PATH has an entry the process lacks (reader injected, any OS)', () => {
  const reg = (v) => `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    ${v}\r\n`;
  assert.equal(parseRegPath(reg('%USERPROFILE%\\bin;C:\\x')), '%USERPROFILE%\\bin;C:\\x');
  const env = { USERPROFILE: 'C:\\Users\\bob', PATH: 'C:\\Windows;c:\\X\\' };
  const missing = staleWindowPath({ env, readWinPath: () => ({ user: '%USERPROFILE%\\bin;C:\\x', machine: 'C:\\Windows' }) });
  assert.deepEqual(missing, ['C:\\Users\\bob\\bin']);
  const r = preflight({ home: tmp(), env, platform: 'win32', readWinPath: () => ({ user: '%USERPROFILE%\\bin', machine: '' }), fsx: noFs });
  const f = r.findings.find((x) => x.kind === 'stale-path');
  assert.ok(f && f.blocker);
  assert.match(formatPreflight(r, { home: 'C:\\h', env }), /restart .*terminal or VS Code/i);
  const ok = preflight({ home: tmp(), env: { PATH: 'C:\\a' }, platform: 'win32', readWinPath: () => ({ user: 'C:\\a', machine: '' }), fsx: noFs });
  assert.equal(ok.findings.some((x) => x.kind === 'stale-path'), false);
});

test('A4 read-only: the HOME tree hash is identical after a preflight run (CLI)', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'bin'); const d2 = path.join(home, 'bin2');
  fake(d, 'rtk', '0.42.0'); fake(d2, 'rtk', '1.2.0');
  fs.writeFileSync(path.join(home, 'keep.txt'), 'x');
  const before = treeHash(home);
  const r = leanCli(['--home', home], { PATH: `${d}:${d2}` });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(treeHash(home), before);
});

test('A5 redaction: home prints as ~ and the user name never appears (text and JSON)', { skip: win }, () => {
  const root = tmp(); const home = path.join(root, 'alice');
  const d1 = path.join(home, 'x'); const d2 = path.join(home, 'y');
  fake(d1, 'rtk', '0.42.0'); fake(d2, 'rtk', '1.2.0');
  const env = { PATH: `${d1}:${d2}`, USER: 'alice' };
  for (const args of [[], ['--json']]) {
    const r = leanCli([...args, '--home', home], env);
    assert.ok(!r.stdout.includes('alice'), r.stdout);
    assert.match(r.stdout, /~/, r.stderr);
    if (args.length) { const j = JSON.parse(r.stdout); assert.equal(j.ok, false); assert.ok(j.blockers >= 1); }
  }
});

test('exit 0 when there are no blockers', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'bin');
  fake(d, 'rtk', '1.2.0');
  const r = leanCli(['--home', home], { PATH: `${d}` });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
