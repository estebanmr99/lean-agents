// opencode1: the 1.x binary copy, the shim, the PATH entry and their undo, against a hand-built layout in a temp HOME.
// The shim test runs a fake binary (a padded sh script), so it is skipped on Windows; the real binary is proven in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { shimText, candidates, findBinary, planOpencode1, installOpencode1, removeOpencode1, probeVersion, layout } from '../scripts/lib/opencode1.mjs';
import { apply, undo, plan } from '../scripts/lib/fsops.mjs';

const j = path.join;
delete process.env.XDG_DATA_HOME; // layout() follows it: keep every fixture inside the temp HOME
delete process.env.XDG_STATE_HOME;
const win = process.platform === 'win32';
const FAKE = (v) => `#!/bin/sh\nif [ "$1" = --version ]; then echo ${v}; else echo "$XDG_DATA_HOME|$XDG_STATE_HOME"; fi\n#${'x'.repeat(1 << 20)}\n`;

function fixture({ version = '1.19.0', frozen = true } = {}) {
  const home = fs.mkdtempSync(j(os.tmpdir(), 'lean-oc1-'));
  const L = layout(home);
  if (frozen) { fs.mkdirSync(j(L.frozen, 'opencode'), { recursive: true }); fs.writeFileSync(j(L.frozen, 'opencode', 'opencode.db'), 'db'); }
  // npm layout: <prefix>/bin/opencode -> <prefix>/lib/node_modules/opencode-ai/bin/opencode.exe
  const pkg = j(home, 'npm', 'lib', 'node_modules', 'opencode-ai');
  fs.mkdirSync(j(pkg, 'bin'), { recursive: true });
  fs.mkdirSync(j(home, 'npm', 'bin'), { recursive: true });
  fs.writeFileSync(j(pkg, 'bin', 'opencode.exe'), FAKE(version), { mode: 0o755 });
  if (!win) fs.symlinkSync(j(pkg, 'bin', 'opencode.exe'), j(home, 'npm', 'bin', 'opencode'));
  return { home, L, pkg, onPath: win ? j(pkg, 'bin', 'opencode.exe') : j(home, 'npm', 'bin', 'opencode') };
}
const planFor = (f, extra = {}) => planOpencode1({ home: f.home, which: () => f.onPath, shell: '/bin/bash', ...extra });
const doInstall = (p, f, extra = {}) => installOpencode1(p, { home: f.home, roots: [f.home], backupDir: j(f.home, 'bk'), apply, ...extra });

test('shimText: sh exports the isolation env and execs the copy; cmd scopes it with setlocal and uses CRLF', () => {
  const sh = shimText('sh', { data: '/opt/x/data', state: '/opt/x/state', binary: "/opt/x/1.19.0/o'c" });
  assert.match(sh, /^#!\/bin\/sh\n# managed by lean-agents/);
  assert.match(sh, /export XDG_DATA_HOME='\/opt\/x\/data'\nexport XDG_STATE_HOME='\/opt\/x\/state'\nexec '\/opt\/x\/1\.19\.0\/o'\\''c' "\$@"/);
  const cmd = shimText('cmd', { data: 'D:\\tools\\data', state: 'D:\\tools\\state', binary: 'D:\\tools\\1.19.0\\opencode.exe' });
  assert.match(cmd, /^@echo off\r\nrem managed by lean-agents/);
  assert.match(cmd, /setlocal\r\nset "XDG_DATA_HOME=D:\\tools\\data"\r\nset "XDG_STATE_HOME=D:\\tools\\state"\r\n"D:\\tools\\1\.19\.0\\opencode\.exe" %\*\r\nexit \/b %errorlevel%\r\n$/);
  assert.match(shimText('sh', { data: '/d', state: '/s', binary: '/b', config: '/opt/x/config' }), /export XDG_STATE_HOME='\/s'\nexport XDG_CONFIG_HOME='\/opt\/x\/config'\nexec/);
  assert.match(shimText('cmd', { data: 'd', state: 's', binary: 'b', config: 'D:\\tools\\config' }), /set "XDG_STATE_HOME=s"\r\nset "XDG_CONFIG_HOME=D:\\tools\\config"\r\n"b" %\*/);
  assert.match(shimText('sh', { data: 'D:\\tools\\data', state: 's', binary: 'b' }), /XDG_DATA_HOME='D:\/tools\/data'/);
});

test('candidates: finds the native binary through the npm symlink, ignores launchers and small files', () => {
  const f = fixture();
  fs.mkdirSync(j(f.home, '.opencode', 'bin'), { recursive: true });
  fs.writeFileSync(j(f.home, '.opencode', 'bin', 'opencode'), '#!/bin/sh\n'); // a launcher, not the binary
  const c = candidates({ home: f.home, platform: 'linux', whichPath: f.onPath });
  assert.deepEqual(c.map((x) => fs.realpathSync(x)), [fs.realpathSync(j(f.pkg, 'bin', 'opencode.exe'))]);
  // Windows npm: <prefix>\opencode.cmd next to <prefix>\node_modules\opencode-ai\bin\opencode.exe
  const prefix = j(f.home, 'wnpm');
  fs.mkdirSync(j(prefix, 'node_modules', 'opencode-ai', 'bin'), { recursive: true });
  fs.writeFileSync(j(prefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'), Buffer.alloc(1 << 21));
  fs.writeFileSync(j(prefix, 'opencode.cmd'), '@echo off\r\n');
  assert.deepEqual(candidates({ home: f.home, platform: 'win32', whichPath: j(prefix, 'opencode.cmd') }).map((x) => fs.realpathSync(x)), [fs.realpathSync(j(prefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'))]);
});

test('findBinary: skips a 2.x binary and reports what it tried', () => {
  const f = fixture({ version: '2.2.5' });
  const r = findBinary({ home: f.home, platform: 'linux', whichPath: f.onPath, probe: (b) => (b.includes('opencode-ai') ? '2.2.5' : (() => { throw new Error('boom'); })()), env: {} });
  assert.equal(r.path, undefined);
  assert.match(r.tried.join('\n'), /2\.2\.5, not 1\.x/);
});

test('plan refuses without a frozen copy, without a 1.x binary, and under --no-exec; changes nothing', () => {
  const f = fixture({ frozen: false });
  const p = planFor(f, { exec: false });
  assert.equal(p.ok, false);
  assert.match(p.problems.join('\n'), /no frozen copy[\s\S]*--no-exec/);
  const g = fixture({ version: '2.2.5' });
  assert.match(planFor(g).problems.join('\n'), /no OpenCode 1\.x binary found/);
  assert.equal(fs.existsSync(j(g.L.root, '1.19.0')), false);
});

test('install: copies the binary, writes the shim and one rc block; the shim runs the copy on the frozen data', { skip: win && 'sh shim' }, () => {
  const f = fixture();
  const p = planFor(f);
  assert.equal(p.ok, true, p.problems.join('\n'));
  assert.equal(p.version, '1.19.0');
  let saved = null;
  const files = [];
  const rec = doInstall(p, f, { files, onRecord: (r) => { saved = { ...r }; } });
  assert.deepEqual(saved, rec);
  assert.equal(p.binary, j(f.L.root, '1.19.0', 'opencode'));
  assert.equal(probeVersion(p.binary, {}), '1.19.0');
  const shim = j(f.L.bin, 'opencode1');
  assert.ok(fs.statSync(shim).mode & 0o100, 'shim is executable');
  const out = spawnSync(shim, ['x'], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: f.home } });
  assert.equal(out.stdout.trim(), `${f.L.frozen}|${f.L.state}`);
  assert.equal(spawnSync(shim, ['--version'], { encoding: 'utf8' }).stdout.trim(), '1.19.0');
  const rc = fs.readFileSync(j(f.home, '.profile'), 'utf8');
  assert.match(rc, new RegExp(`export PATH='${f.L.bin.replace(/[\\/]/g, '.')}':"\\$PATH"`));
  assert.equal(rec.pathEntry, false);
  assert.deepEqual(files.map((e) => path.basename(e.path)).sort(), ['.profile', 'opencode1']);
});

test('undo: removes the shim, the rc block, the copy and the bin dir; keeps the frozen data and the state dir', { skip: win && 'sh shim' }, () => {
  const f = fixture();
  fs.writeFileSync(j(f.home, '.bashrc'), 'alias a=b\n');
  const p = planFor(f);
  const files = [];
  const rec = doInstall(p, f, { files });
  assert.equal(fs.existsSync(j(f.home, '.profile')), false, 'an existing .bashrc is used instead of creating .profile');
  assert.match(fs.readFileSync(j(f.home, '.bashrc'), 'utf8'), /^alias a=b\n\n<!-- lean-agents:start -->/);
  fs.mkdirSync(f.L.state, { recursive: true });
  fs.writeFileSync(j(f.L.state, 'kv.json'), '{}');
  const report = [...undo(files, [f.home]), ...removeOpencode1(rec, { home: f.home })];
  assert.equal(fs.readFileSync(j(f.home, '.bashrc'), 'utf8'), 'alias a=b\n');
  assert.equal(fs.existsSync(j(f.L.root, '1.19.0')), false);
  assert.equal(fs.existsSync(f.L.bin), false);
  assert.ok(fs.existsSync(j(f.L.frozen, 'opencode', 'opencode.db')), 'frozen copy stays');
  assert.ok(fs.existsSync(j(f.L.state, 'kv.json')), 'what 1.x wrote stays');
  assert.ok(report.length >= 3);
});

test('a second install is idempotent; a user file named opencode1 is never overwritten', { skip: win && 'sh shim' }, () => {
  const f = fixture();
  const p = planFor(f);
  doInstall(p, f, { files: [] });
  const again = doInstall(planFor(f), f, { files: [] });
  assert.equal(again.version, '1.19.0');
  const g = fixture();
  fs.mkdirSync(g.L.bin, { recursive: true });
  fs.writeFileSync(j(g.L.bin, 'opencode1'), '#!/bin/sh\necho mine\n');
  assert.throws(() => doInstall(planFor(g), g, { files: [] }), /not managed by lean-agents/);
  assert.equal(fs.readFileSync(j(g.L.bin, 'opencode1'), 'utf8'), '#!/bin/sh\necho mine\n');
  assert.equal(fs.existsSync(j(g.L.root, '1.19.0', 'opencode')), false, 'no copy made when the shim is refused');
});

test('a copy that reports another version is not kept', () => {
  const f = fixture();
  const p = planFor(f, { probe: () => '1.19.0' });
  assert.equal(p.ok, true, p.problems.join('\n'));
  assert.throws(() => doInstall(p, f, { probe: () => '1.18.0', files: [] }), /expected 1\.19\.0/);
  assert.equal(fs.existsSync(p.binary), false);
});

test('install: opencode1 gets its own copy of the 1.x config snapshot (without node_modules) and the shim points XDG_CONFIG_HOME at it', { skip: win && 'sh shim' }, () => {
  const f = fixture();
  const snap = j(f.home, 'snap');
  fs.mkdirSync(j(snap, 'node_modules'), { recursive: true });
  fs.writeFileSync(j(snap, 'opencode.jsonc'), '{ "agent": {} }');
  fs.writeFileSync(j(snap, 'node_modules', 'x.js'), 'x');
  const p = planFor(f, { configSnapshot: snap });
  doInstall(p, f);
  const cfg = j(f.L.config, 'opencode');
  assert.equal(fs.readFileSync(j(cfg, 'opencode.jsonc'), 'utf8'), '{ "agent": {} }');
  assert.equal(fs.existsSync(j(cfg, 'node_modules')), false);
  assert.match(fs.readFileSync(j(f.L.bin, 'opencode1'), 'utf8'), new RegExp(`export XDG_CONFIG_HOME='${f.L.config.replace(/[\\/]/g, '.')}'`));
  fs.writeFileSync(j(cfg, 'opencode.jsonc'), 'edited');
  doInstall(planFor(f, { configSnapshot: snap }), f);
  assert.equal(fs.readFileSync(j(cfg, 'opencode.jsonc'), 'utf8'), 'edited', 'an existing copy is never overwritten');
  const rec = JSON.parse(JSON.stringify({ binary: p.binary, dir: path.dirname(p.binary), binDir: f.L.bin }));
  removeOpencode1(rec, { home: f.home });
  assert.ok(fs.existsSync(cfg), 'the config copy is kept on undo');
});

test('install: an empty config folder when there is no snapshot, so 1.x never reads the live 2.x config', { skip: win && 'sh shim' }, () => {
  const f = fixture();
  doInstall(planFor(f), f);
  assert.deepEqual(fs.readdirSync(j(f.L.config, 'opencode')), []);
});

test('Windows: the PATH entry is recorded before the registry write', () => {
  const f = fixture();
  const p = planOpencode1({ home: f.home, platform: 'win32', which: () => f.onPath, probe: () => '1.19.0', shell: '' });
  const winPath = (op) => { if (op === 'has') return 'absent'; throw new Error('killed'); };
  let last = null;
  assert.throws(() => installOpencode1(p, { home: f.home, roots: [f.home], backupDir: j(f.home, 'bk'), apply, platform: 'win32', probe: () => '1.19.0', winPath, onRecord: (r) => { last = { ...r }; } }), /killed/);
  assert.equal(last.pathEntry, true, 'state already names the entry when the write dies');
});

test('Windows: an HKCU entry the user already had is neither re-added nor recorded as ours', () => {
  const f = fixture();
  const p = planOpencode1({ home: f.home, platform: 'win32', which: () => f.onPath, probe: () => '1.19.0', shell: '' });
  const calls = [];
  const winPath = (op) => { calls.push(op); return 'present'; };
  const rec = installOpencode1(p, { home: f.home, roots: [f.home], backupDir: j(f.home, 'bk'), apply, platform: 'win32', probe: () => '1.19.0', winPath });
  assert.equal(rec.pathEntry, false);
  assert.deepEqual(calls, ['has']);
});

test('Windows: cmd + sh shims, no rc block, the HKCU entry is added once and removed only if we added it', () => {
  const f = fixture();
  const p = planOpencode1({ home: f.home, platform: 'win32', which: () => f.onPath, probe: () => '1.19.0', shell: '' });
  assert.equal(p.ok, true, p.problems.join('\n'));
  assert.deepEqual(p.actions.map((a) => path.basename(a.path)), ['opencode1.cmd', 'opencode1']);
  assert.equal(path.basename(p.binary), 'opencode.exe');
  const calls = [];
  const winPath = (op, dir) => { calls.push([op, dir]); return op === 'has' ? 'absent' : 'changed'; };
  const files = [];
  const rec = installOpencode1(p, { home: f.home, roots: [f.home], backupDir: j(f.home, 'bk'), apply, files, platform: 'win32', probe: () => '1.19.0', winPath });
  assert.equal(rec.pathEntry, true);
  assert.deepEqual(calls, [['has', f.L.bin], ['add', f.L.bin]]);
  assert.match(fs.readFileSync(j(f.L.bin, 'opencode1.cmd'), 'utf8'), /\r\n"[^"]*opencode\.exe" %\*/);
  const report = removeOpencode1(rec, { home: f.home, winPath, platform: 'win32' });
  assert.deepEqual(calls[2], ['remove', f.L.bin]);
  assert.ok(report.some(([w]) => w === 'removed from user PATH'));
  const kept = removeOpencode1({ ...rec, pathEntry: false }, { home: f.home, winPath, platform: 'win32' });
  assert.equal(calls.length, 3);
  assert.equal(kept.length, 0);
});

test('removeOpencode1 never deletes outside <data>/lean-agents/opencode1', () => {
  const f = fixture();
  const victim = fs.mkdtempSync(j(os.tmpdir(), 'lean-oc1-victim-'));
  fs.writeFileSync(j(victim, 'keep'), '1');
  removeOpencode1({ dir: victim, binDir: f.L.bin, pathEntry: false }, { home: f.home });
  removeOpencode1({ dir: f.L.frozen, binDir: f.L.bin, pathEntry: false }, { home: f.home });
  assert.ok(fs.existsSync(j(victim, 'keep')));
  assert.ok(fs.existsSync(j(f.L.frozen, 'opencode', 'opencode.db')));
});

test('lean.mjs: dry run writes nothing; --yes sets up opencode1; --uninstall removes it and keeps the frozen copy', { skip: win && 'sh shim' }, () => {
  const f = fixture();
  const bin = j(f.home, 'fakebin');
  fs.mkdirSync(bin);
  fs.writeFileSync(j(bin, 'opencode'), FAKE('1.19.0'), { mode: 0o755 });
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: f.home };
  const lean = (...a) => spawnSync(process.execPath, [new URL('../scripts/lean.mjs', import.meta.url).pathname, '--home', f.home, ...a], { encoding: 'utf8', env });
  const tree = () => fs.readdirSync(f.home, { recursive: true }).sort().join('\n');
  const before = tree();
  const dry = lean('--upgrade-agent', 'opencode', '--opencode1', '--dry-run');
  assert.equal(dry.status, 0, dry.stdout + dry.stderr);
  assert.match(dry.stdout, /dry run: would set up opencode1 \(OpenCode 1\.19\.0/);
  assert.equal(tree(), before);
  const noExec = lean('--no-exec', '--upgrade-agent', 'opencode', '--opencode1', '--yes');
  assert.equal(noExec.status, 1);
  assert.equal(tree(), before);
  const run = lean('--upgrade-agent', 'opencode', '--opencode1', '--yes');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const state = JSON.parse(fs.readFileSync(j(f.home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.equal(state.opencode1.version, '1.19.0');
  assert.equal(state.files.length, 2);
  assert.equal(spawnSync(j(f.L.bin, 'opencode1'), ['--version'], { encoding: 'utf8' }).stdout.trim(), '1.19.0');
  const un = lean('--uninstall', '--yes', '--no-exec');
  assert.equal(un.status, 0, un.stdout + un.stderr);
  assert.equal(fs.existsSync(j(f.L.root, '1.19.0')), false);
  assert.equal(fs.existsSync(f.L.bin), false);
  assert.equal(fs.existsSync(j(f.home, '.profile')), false);
  assert.ok(fs.existsSync(j(f.L.frozen, 'opencode', 'opencode.db')));
});
