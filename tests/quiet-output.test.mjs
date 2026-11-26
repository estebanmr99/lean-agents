// Quiet step output (#491): one line per step, child output in a per-run log, short plan and notes, ~ for the home dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, tilde } from '../scripts/lib/fsops.mjs';
import { formatUpdatePlan } from '../scripts/lib/update-plan.mjs';
import { run } from '../scripts/lib/system.mjs';

const LEAN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lean.mjs');
const posix = process.platform !== 'win32';

// A temp HOME and a bin dir whose stubs write to stderr (A1). `claude` and `npx` fail when bin/fail exists (the engine passes children no custom env).
function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-quiet-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['claude', 'rtk', 'npx']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "stub-stderr-${name} $*" >&2\necho "stub-stdout-${name}"\n[ -e "$(dirname "$0")/fail" ] && [ "${name}" != rtk ] && exit 3\nexit 0\n`, { mode: 0o755 });
  }
  return { home, bin };
}
const lean = (s, args, env = {}) => spawnSync(process.execPath, [LEAN, '--home', s.home, '--yes', '--agents', 'claude', '--tools', 'context-mode', ...args], {
  encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: `${s.bin}${path.delimiter}${process.env.PATH}`, ...env },
});
const logOf = (s) => { const d = path.join(s.home, '.config', 'lean-agents', 'logs'); return fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8')).join(''); };

test('A1: steps print one line each, child output goes to the log, none on the terminal', { skip: !posix }, () => {
  const s = sandbox();
  const r = lean(s, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[\d+\/\d+\] .* ✓/);
  assert.doesNotMatch(r.stdout + r.stderr, /stub-std(err|out)-npx/);
  assert.match(logOf(s), /stub-stderr-npx -y skills/);
});

test('A1: a failing step prints its last lines and the log path', { skip: !posix }, () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.bin, 'fail'), '');
  const r = lean(s, []);
  assert.match(r.stdout, /✗/);
  assert.match(r.stdout, /stub-stderr-npx -y skills/);
  assert.match(r.stdout, /full output: ~\/\.config\/lean-agents\/logs\//);
  assert.ok(!r.stdout.split('Done.')[0].split('Commands:')[1].split('\n\n')[1].includes(s.home), 'home printed as ~');
});

test('A5: --verbose keeps the full child output on the terminal', { skip: !posix }, () => {
  const s = sandbox();
  const r = lean(s, ['--verbose']);
  assert.match(r.stdout + r.stderr, /stub-stderr-npx -y skills/);
  assert.doesNotMatch(r.stdout, /\[\d+\/\d+\]/);
});

test('A5: --json --dry-run output is one JSON object with the usual keys', { skip: !posix }, () => {
  const s = sandbox();
  const j = JSON.parse(lean(s, ['--dry-run', '--json']).stdout);
  assert.deepEqual(Object.keys(j), ['agents', 'tools', 'privacy', 'lang', 'profile', 'terminals', 'gh', 'bun', 'network', 'migrate', 'files', 'commands']);
  assert.ok(j.commands.length > 0);
});

test('prompts never hang: a child that reads stdin gets EOF', { skip: !posix }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-stdin-'));
  const log = path.join(dir, 'x.log');
  const t = Date.now();
  const ok = run(['sh', '-c', 'read a; echo got-${a:-default}'], { log() {}, logFile: log, tail: [] });
  assert.ok(ok && Date.now() - t < 5000);
  assert.match(fs.readFileSync(log, 'utf8'), /got-default/);
});

test('A2: the file list shows only changes, then one "N unchanged" line', () => {
  const h = path.join(os.tmpdir(), 'h');
  const f = (n) => path.join(h, n);
  const planned = [{ status: 'create', path: f('a') }, { status: 'unchanged', path: f('b') }, { status: 'unchanged', path: f('c') }, { status: 'modify', path: f('d') }];
  assert.equal(describe(planned, h, true), `  create    ~${path.sep}a\n  modify    ~${path.sep}d\n  2 unchanged`);
  assert.match(describe(planned, h), /unchanged +~.b/);
});

test('A3: brief release notes keep the first sentence of each entry and link the changelog', () => {
  const body = '### Added\n- First thing works (#1). More detail here.\n- Second one is v1.2.3 compatible. Extra.';
  const text = formatUpdatePlan([], [{ version: '1.0.0', body }], true);
  assert.match(text, /^- First thing works \(#1\)\.$/m);
  assert.match(text, /^- Second one is v1\.2\.3 compatible\.$/m);
  assert.doesNotMatch(text, /More detail|Extra/);
  assert.match(text, /Full notes: https:\/\/github\.com\/estebanmr99\/lean-agents\/blob\/main\/CHANGELOG\.md/);
  assert.match(formatUpdatePlan([], [{ version: '1.0.0', body }]), /More detail here/);
});

test('a chatty child (over 1 MB) is not killed and the tail is the last lines', { skip: !posix }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-chatty-'));
  const log = path.join(dir, 'x.log');
  const tail = [];
  const ok = run(['sh', '-c', 'i=0; while [ $i -lt 30000 ]; do echo line-$i-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done; exit 4'], { log() {}, logFile: log, tail });
  assert.equal(ok, false);
  assert.ok(fs.statSync(log).size > 1024 * 1024);
  assert.equal(tail.length, 20);
  assert.match(tail.at(-1), /line-29999-/);
  assert.equal(fs.statSync(log).mode & 0o777, 0o600);
});

test('the log dir is owner-only', { skip: !posix }, () => {
  const s = sandbox();
  lean(s, []);
  assert.equal(fs.statSync(path.join(s.home, '.config', 'lean-agents', 'logs')).mode & 0o777, 0o700);
});

test('a log that cannot be written falls back to the terminal and the install goes on', { skip: !posix }, () => {
  const s = sandbox();
  fs.mkdirSync(path.join(s.home, '.config', 'lean-agents'), { recursive: true });
  fs.writeFileSync(path.join(s.home, '.config', 'lean-agents', 'logs'), 'a file where the dir should be');
  const r = lean(s, []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /cannot write the step log/);
  assert.match(r.stdout + r.stderr, /stub-stderr-npx/);
});

test('tilde only replaces a whole home folder, never an empty home or /', () => {
  assert.equal(tilde('$ cp /h/u/a /h/user2/b', '/h/u'), '$ cp ~/a /h/user2/b');
  assert.equal(tilde('D:\\work\\x D:/work/y', 'D:\\work'), '~\\x ~/y');
  assert.equal(tilde('/usr/bin', '/'), '/usr/bin');
  assert.equal(tilde('/usr/bin', ''), '/usr/bin');
});

test('A3: brief notes do not cut at e.g. or in a version, and mark a long cut with an ellipsis', () => {
  const body = `- Works with tools, e.g. rtk v1.2.0 and later. Next.\n- ${'word '.repeat(60)}end.`;
  const lines = formatUpdatePlan([], [{ version: '1.0.0', body }], true).split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines[0], '- Works with tools, e.g. rtk v1.2.0 and later.');
  assert.ok(lines[1].endsWith('…') && lines[1].length <= 162);
});

test('A4: plan command lines print the home dir as ~', { skip: !posix }, () => {
  const s = sandbox();
  const r = lean(s, ['--dry-run']);
  assert.ok(!r.stdout.includes(s.home), 'no full home path in the plan');
});

// #489: the parent keeps stdin open (a terminal nobody types into); a planned command that reads stdin must still finish, in quiet and verbose mode.
for (const quietMode of [true, false]) {
  test(`#489: a command that reads stdin does not wait (${quietMode ? 'quiet' : 'verbose'})`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-stdin-'));
    const sys = path.join(path.dirname(LEAN), 'lib', 'system.mjs');
    const reader = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))";
    const wrapper = `import { run } from ${JSON.stringify(new URL(`file://${sys.replace(/\\/g, '/')}`).href)};
const ok = run([process.execPath, '-e', ${JSON.stringify(reader)}], { log() {}, ${quietMode ? `logFile: ${JSON.stringify(path.join(dir, 'run.log'))}, tail: []` : ''} });
process.exit(ok ? 0 : 1);`;
    fs.writeFileSync(path.join(dir, 'w.mjs'), wrapper);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, [path.join(dir, 'w.mjs')], { stdio: ['pipe', 'ignore', 'inherit'] });
    const code = await new Promise((res) => {
      const t = setTimeout(() => { child.kill(); res('timeout'); }, 15000);
      child.on('exit', (c) => { clearTimeout(t); res(c); });
    });
    child.stdin.destroy();
    assert.equal(code, 0, 'the stdin reader got EOF and exited instead of waiting');
  });
}
