// --preflight (#471): shadowed copies, versions below min, stale window PATH, read-only, redaction. Temp HOME, fake executables.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cmdInvocation } from '../scripts/lib/system.mjs';
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
const base = (home, dirs, extra = {}) => ({ home, env: { PATH: dirs.join(path.delimiter), USER: 'alice' }, platform: 'linux', list: () => [], statfs: () => ({ bavail: 1e9, bsize: 4096 }), ...extra });
const noFs = { statSync() { throw new Error('ENOENT'); }, accessSync() {}, realpathSync: (p) => p, existsSync: () => false };
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
  const r = preflight(base(home, [d], { pm: 'brew' }));
  const rows = r.findings.filter((x) => x.tool === 'rtk' && x.kind === 'below-min');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].blocker, true);
  const text = formatPreflight(r, { home, env: {} });
  assert.match(text, /0\.42\.0/); assert.match(text, /v1\.2\.0/); assert.match(text, /brew upgrade rtk/);
  assert.match(text, /1 blocker, 0 warnings\. Nothing was changed\./);
});

// A Windows fake: files in `files` (lower-case paths) exist.
const winFs = (files, dirs = []) => ({ statSync: (p) => { if (!files.includes(p.toLowerCase())) throw new Error('ENOENT'); return { isFile: () => true }; },
  accessSync() {}, realpathSync: (p) => p, existsSync: (p) => dirs.includes(p.toLowerCase()) || files.includes(p.toLowerCase()) });
const reg = (v) => `\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    ${v}\r\n`;

test('A3 stale window PATH: a stored folder that exists but is missing is a warning; a hidden tool makes it a blocker', () => {
  assert.equal(parseRegPath(reg('%USERPROFILE%\\bin;C:\\x')), '%USERPROFILE%\\bin;C:\\x');
  const env = { USERPROFILE: 'C:\\Profiles\\bob', PATH: 'C:\\Windows;c:\\X\\' };
  const stored = { user: '"%USERPROFILE%\\bin";C:\\x;C:\\gone;%UNKNOWN%\\z;C:\\Windows\\', machine: '' };
  const dirs = ['c:\\profiles\\bob\\bin', 'c:\\x', 'c:\\windows'];
  assert.deepEqual(staleWindowPath({ env, readWinPath: () => stored, fsx: winFs([], dirs) }), ['C:\\Profiles\\bob\\bin']);
  const warn = preflight({ home: 'C:\\h', env, platform: 'win32', readWinPath: () => stored, fsx: winFs([], dirs), pm: 'winget', list: () => [], statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
  const f = warn.findings.find((x) => x.kind === 'stale-path');
  assert.equal(f.blocker, false); assert.equal(warn.ok, true);
  assert.match(formatPreflight(warn, { home: 'C:\\h', env }), /this window started before PATH changed: C:\\Profiles\\bob\\bin is missing\. Close and reopen the terminal or VS Code, then run --preflight again\./);
  const hid = preflight({ home: 'C:\\h', env, platform: 'win32', readWinPath: () => stored, fsx: winFs(['c:\\profiles\\bob\\bin\\rtk.exe'], dirs), probe: () => '1.2.0', pm: 'winget', list: () => [], statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
  const g = hid.findings.find((x) => x.kind === 'stale-path');
  assert.equal(g.blocker, true); assert.deepEqual(g.hidden, ['rtk']); assert.equal(hid.ok, false);
  const ok = preflight({ home: 'C:\\h', env: { PATH: 'C:\\a' }, platform: 'win32', readWinPath: () => ({ user: 'C:\\a', machine: '' }), fsx: noFs, pm: 'winget', list: () => [], statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
  assert.equal(ok.findings.some((x) => x.kind === 'stale-path'), false);
});

test('A2 Windows: the update command is winget upgrade with the id from the install table', () => {
  const r = preflight({ home: 'C:\\h', env: { PATH: 'C:\\old' }, platform: 'win32', readWinPath: () => ({ user: '', machine: '' }), fsx: winFs(['c:\\old\\rtk.exe']), probe: () => '0.42.0' });
  assert.equal(r.findings.find((x) => x.kind === 'below-min').fix, 'winget upgrade --id rtk-ai.rtk');
});

test('fix lines: npm CLIs use the pinned npm spec; no brew means the release or --update', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'bin');
  fake(d, 'claude', '1.0.0'); fake(d, 'rtk', '0.42.0');
  const r = preflight(base(home, [d], { pm: null }));
  const c = r.findings.find((x) => x.tool === 'claude');
  assert.equal(c.kind, 'behind-pin'); assert.equal(c.blocker, false);
  assert.match(c.fix, /^npm install -g @anthropic-ai\/claude-code@\d/);
  assert.match(r.findings.find((x) => x.tool === 'rtk' && x.kind === 'below-min').fix, /lean-agents --update/);
});

test('shadowed with equal versions is a warning with the harmless wording', { skip: win }, () => {
  const home = tmp(); const a = path.join(home, 'a'); const b = path.join(home, 'b');
  fake(a, 'rtk', '1.2.0'); fake(b, 'rtk', '1.2.0');
  const r = preflight(base(home, [a, b]));
  assert.equal(r.ok, true); assert.equal(r.warnings, 1);
  assert.match(formatPreflight(r, { home, env: {} }), /Older copies later on PATH are harmless\. Remove them if you want a clean PATH\./);
});

test('relative PATH entries are skipped and reported as a warning', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'rel');
  fake(d, 'rtk', '1.2.0');
  const r = preflight({ ...base(home, ['.', 'rel']), env: { PATH: '.:rel' }, pm: null });
  assert.equal(findCopies('rtk', { path: '.:rel' }).length, 0);
  assert.ok(r.findings.some((x) => x.kind === 'relative-path' && !x.blocker));
  assert.equal(r.findings.some((x) => x.tool === 'rtk'), false);
});

test('exec off probes nothing; the deadline leaves later copies "not checked"', { skip: win }, () => {
  const home = tmp(); const a = path.join(home, 'a'); const b = path.join(home, 'b');
  fake(a, 'rtk', '0.42.0'); fake(b, 'rtk', '1.2.0');
  let probes = 0;
  const off = preflight({ ...base(home, [a, b]), exec: false, probe: () => { probes++; return '1.0.0'; } });
  assert.equal(probes, 0);
  assert.match(formatPreflight(off, { home, env: {} }), /not checked/);
  let t = 0;
  const late = preflight({ ...base(home, [a, b]), now: () => (t += 40000), probe: () => '1.0.0' });
  assert.equal(late.findings.find((x) => x.kind === 'shadowed').copies[1].version, null);
});

test('cmdInvocation: quotes a path with spaces and refuses cmd metacharacters', () => {
  const ok = cmdInvocation('C:\\a b\\rtk.cmd', ['--version'], 'cmd.exe');
  assert.deepEqual(ok, { file: 'cmd.exe', argv: ['/d', '/s', '/c', '""C:\\a b\\rtk.cmd" --version"'] });
  for (const bad of ['C:\\a&b\\x.cmd', 'C:\\a^b\\x.cmd', 'C:\\a%PATH%\\x.cmd', 'C:\\a"b\\x.cmd', 'C:\\a|b\\x.cmd', 'C:\\a<b\\x.cmd', 'C:\\a>b\\x.cmd']) assert.equal(cmdInvocation(bad, ['--version']), null, bad);
  assert.equal(cmdInvocation('C:\\a\\x.cmd', ['--version & calc']), null);
});

test('A5 --json redacts a Windows path whose backslashes JSON would escape', () => {
  const env = { USERNAME: 'carol', PATH: 'C:\\Profiles\\carol\\a;C:\\Profiles\\carol\\b' };
  const fsx = winFs(['c:\\profiles\\carol\\a\\rtk.exe', 'c:\\profiles\\carol\\b\\rtk.exe']);
  const r = preflight({ home: 'C:\\Profiles\\carol', env, platform: 'win32', fsx, probe: (f) => (f.includes('\\a\\') ? '0.42.0' : '1.2.0'), readWinPath: () => ({ user: '', machine: '' }), pm: 'winget', list: () => [], statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
  const out = formatPreflight(r, { home: 'C:\\Profiles\\carol', env, json: true });
  assert.ok(!/carol/i.test(out), out);
  assert.match(out, /~\\\\a\\\\rtk\.EXE/);
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

test('below min blocks only for rtk; uv and gh below min are warnings with exit 0', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'bin');
  fake(d, 'uv', '0.13.5'); fake(d, 'gh', '2.103.0');
  const r = preflight(base(home, [d], { pm: 'brew' }));
  const rows = r.findings.filter((x) => x.kind === 'below-min');
  assert.deepEqual(rows.map((x) => x.tool).sort(), ['gh', 'uv']);
  assert.ok(rows.every((x) => !x.blocker && x.fix));
  assert.equal(r.ok, true);
  assert.equal(leanCli(['--home', home], { PATH: d }).status, 0);
  fake(d, 'rtk', '0.42.0');
  assert.equal(leanCli(['--home', home], { PATH: d }).status, 1);
});

const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o)); };

test('A6 config shape: managed MCP names print as-is, user names as <user-mcp-N>, never the real name (text and JSON)', { skip: win }, () => {
  const home = tmp();
  writeJson(path.join(home, '.config', 'opencode', 'opencode.jsonc'), `{ // user
    "mcp": { "servers": { "acme-secret-db": { "type": "local", "command": ["x"] }, "playwright": { "type": "local", "command": ["y"] }, "zeta-internal": { "type": "local", "command": ["z"] } } } }`);
  const r = preflight(base(home, []));
  assert.deepEqual(r.shape.mcp, ['<user-mcp-1>', 'playwright', '<user-mcp-2>']);
  for (const out of [formatPreflight(r, { home, env: {}, json: true }), formatPreflight(r, { home, env: {} })]) {
    assert.match(out, /playwright/); assert.match(out, /<user-mcp-1>/); assert.match(out, /<user-mcp-2>/);
    assert.ok(!/acme-secret-db|zeta-internal/.test(out), out);
  }
  const v1 = tmp();
  writeJson(path.join(v1, '.config', 'opencode', 'opencode.json'), { mcp: { 'my-private': { type: 'local', command: ['a'] }, 'context-mode': { type: 'local', command: ['b'] } } });
  assert.deepEqual(preflight(base(v1, [])).shape.mcp, ['<user-mcp-1>', 'context-mode']);
  const v2 = tmp();
  writeJson(path.join(v2, '.config', 'opencode', 'opencode.json'), { mcp: { servers: { 'only-one': { type: 'local', command: ['a'] } } } });
  assert.deepEqual(preflight(base(v2, [])).shape.mcp, ['<user-mcp-1>'], 'the servers container is not a server');
});

test('A6 a missing or unparseable config gives no shape and no crash', { skip: win }, () => {
  const home = tmp();
  assert.equal(preflight(base(home, [])).shape, null);
  writeJson(path.join(home, '.config', 'opencode', 'opencode.jsonc'), '{ "mcp": {{{');
  assert.equal(preflight(base(home, [])).shape, null);
});

function fakeNvm(home, nodes) {
  const nvm = path.join(home, '.nvm');
  fs.mkdirSync(nvm, { recursive: true }); fs.writeFileSync(path.join(nvm, 'nvm.sh'), '');
  for (const [v, ver] of Object.entries(nodes)) {
    const d = path.join(nvm, 'versions', 'node', `v${v}`);
    fake(path.join(d, 'bin'), 'node', v);
    if (ver) writeJson(path.join(d, 'lib', 'node_modules', 'context-mode', 'package.json'), { version: ver });
  }
  return nvm;
}

test('A7 nvm: a pinned tool under two Nodes, or only under a non-active one, is a warning listing each Node', { skip: win }, () => {
  const home = tmp();
  fakeNvm(home, { '22.20.0': '1.0.1', '24.1.0': '1.0.5' });
  const r = preflight(base(home, []));
  const f = r.findings.find((x) => x.kind === 'nvm-copies');
  assert.equal(f.blocker, false); assert.equal(f.tool, 'context-mode');
  assert.deepEqual(f.copies, [{ node: '22.20.0', version: '1.0.1' }, { node: '24.1.0', version: '1.0.5' }]);
  const text = formatPreflight(r, { home, env: {} });
  assert.match(text, /22\.20\.0 has 1\.0\.1/); assert.match(text, /24\.1\.0 has 1\.0\.5/); assert.match(text, /fix: .*--adopt/);
  const h2 = tmp(); const nvm = fakeNvm(h2, { '22.20.0': null, '24.1.0': '1.0.5' });
  assert.ok(preflight(base(h2, [path.join(nvm, 'versions', 'node', 'v22.20.0', 'bin')])).findings.some((x) => x.kind === 'nvm-copies'), 'only under a non-active Node');
  assert.ok(!preflight(base(h2, [path.join(nvm, 'versions', 'node', 'v24.1.0', 'bin')])).findings.some((x) => x.kind === 'nvm-copies'));
  assert.ok(!preflight(base(tmp(), [])).findings.some((x) => x.kind === 'nvm-copies'), 'no nvm: nothing');
  const flat = path.join(h2, 'nodejs'); fake(flat, 'node', '24.1.0'); // nvm-windows style: the active folder has no version
  assert.ok(!preflight(base(h2, [flat])).findings.some((x) => x.kind === 'nvm-copies'), 'active Node unknown: no false warning');
});

test('A8 backup space: blocker with GB figures when the disk is too small, nothing when roomy or no 1.x data', { skip: win }, () => {
  const home = tmp();
  assert.ok(!preflight(base(home, [])).findings.some((x) => x.kind === 'backup-space'), 'no opencode.db');
  writeJson(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), 'db bytes');
  assert.ok(!preflight(base(home, [])).findings.some((x) => x.kind === 'backup-space'), 'roomy');
  const r = preflight(base(home, [], { statfs: () => ({ bavail: 10, bsize: 4096 }) }));
  const f = r.findings.find((x) => x.kind === 'backup-space');
  assert.equal(f.blocker, true); assert.equal(r.ok, false);
  assert.match(formatPreflight(r, { home, env: {} }), /0\.00 GB free, 1\.00 GB needed[\s\S]*fix: free up disk space/);
});

test('#488 a running opencode (blocker with 1.x data, else warning) has a stop line; --no-exec does not list processes', () => {
  const home = tmp();
  writeJson(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), 'db');
  const f = preflight(base(home, [], { list: () => ['node', '/usr/bin/opencode'] })).findings.find((x) => x.kind === 'opencode-running');
  assert.equal(f.blocker, true); assert.match(f.fix, /opencode service stop/);
  assert.ok(!preflight(base(home, [], { list: () => ['launchd'] })).findings.some((x) => x.kind === 'opencode-running'));
  assert.ok(!preflight(base(home, [], { list: () => { throw new Error('ps failed'); } })).findings.some((x) => x.kind === 'opencode-running'));
  let calls = 0;
  preflight(base(home, [], { exec: false, list: () => { calls++; return ['opencode']; } }));
  assert.equal(calls, 0);
  const warn = preflight(base(tmp(), [], { list: () => ['opencode.exe'] }));
  assert.equal(warn.findings.find((x) => x.kind === 'opencode-running').blocker, false, 'no 1.x db: warning');
  writeJson(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), 'db');
  assert.equal(preflight(base(home, [], { list: () => ['C:\\x\\opencode.exe'] })).findings.find((x) => x.kind === 'opencode-running').blocker, true);
});

test('jq fix line on win32 is winget (pure logic)', () => {
  const env = { PATH: 'C:\\b' };
  const fsx = { statSync: () => ({ isFile: () => true }), accessSync() {}, realpathSync: (p) => p, existsSync: () => false };
  const r = preflight({ home: 'C:\\h', env, platform: 'win32', fsx, probe: () => '1.6.0', readWinPath: () => ({ user: '', machine: '' }), pm: 'winget', list: () => [], statfs: () => ({ bavail: 1e9, bsize: 4096 }) });
  assert.equal(r.findings.find((x) => x.tool === 'jq' && x.kind === 'below-min').fix, 'winget upgrade --id jqlang.jq');
});

test('jq below its minimum gets a package-manager fix line', { skip: win }, () => {
  const home = tmp(); const d = path.join(home, 'bin'); fake(d, 'jq', '1.6.0');
  const fix = (pm) => preflight(base(home, [d], { pm })).findings.find((x) => x.tool === 'jq' && x.kind === 'below-min').fix;
  assert.equal(fix('brew'), 'brew upgrade jq');
  assert.match(fix(null), /^install .* or newer from https:\/\/github\.com\/jqlang\/jq/);
});

test('A4/A5 the new findings are read-only and redacted through the CLI', { skip: win }, () => {
  const root = tmp(); const home = path.join(root, 'alice'); const d = path.join(home, 'bin');
  fake(d, 'rtk', '1.2.0');
  writeJson(path.join(home, '.config', 'opencode', 'opencode.jsonc'), { mcp: { 'alice-vpn': { type: 'local', command: ['a'] } } });
  fakeNvm(home, { '22.20.0': '1.0.1', '24.1.0': '1.0.5' });
  writeJson(path.join(home, '.local', 'share', 'opencode', 'opencode.db'), 'db');
  const before = treeHash(home);
  const text = leanCli(['--no-exec', '--home', home], { PATH: d, USER: 'alice' }).stdout;
  assert.match(text, /nvm Nodes/);
  for (const out of [text, leanCli(['--json', '--no-exec', '--home', home], { PATH: d, USER: 'alice' }).stdout]) {
    assert.ok(!out.includes('alice'), out);
    assert.match(out, /<user-mcp-1>/);
  }
  assert.equal(treeHash(home), before);
});
