// Quiet step output (#491): one line per step, child output in a per-run log, short plan and notes, ~ for the home dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe } from '../scripts/lib/fsops.mjs';
import { formatUpdatePlan } from '../scripts/lib/update-plan.mjs';
import { run } from '../scripts/lib/system.mjs';

const LEAN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lean.mjs');
const posix = process.platform !== 'win32';

// A temp HOME and a bin dir whose stubs write to stderr (A1). `claude plugin ...` fails when bin/fail exists (the engine passes children no custom env).
function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-quiet-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['claude', 'rtk', 'npx']) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "stub-stderr-${name} $*" >&2\necho "stub-stdout-${name}"\n[ -e "$(dirname "$0")/fail" ] && [ "${name}" = claude ] && [ "$1" = plugin ] && exit 3\nexit 0\n`, { mode: 0o755 });
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
  assert.doesNotMatch(r.stdout + r.stderr, /stub-std(err|out)-(claude|npx)/);
  assert.match(logOf(s), /stub-stderr-claude plugin/);
});

test('A1: a failing step prints its last lines and the log path', { skip: !posix }, () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.bin, 'fail'), '');
  const r = lean(s, []);
  assert.match(r.stdout, /✗/);
  assert.match(r.stdout, /stub-stderr-claude plugin/);
  assert.match(r.stdout, /full log: ~\/\.config\/lean-agents\/logs\//);
  assert.ok(!r.stdout.split('Done.')[0].split('Commands:')[1].split('\n\n')[1].includes(s.home), 'home printed as ~');
});

test('A5: --verbose keeps the full child output on the terminal', { skip: !posix }, () => {
  const s = sandbox();
  const r = lean(s, ['--verbose']);
  assert.match(r.stdout + r.stderr, /stub-stderr-claude plugin/);
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
  const planned = [{ status: 'create', path: '/h/a' }, { status: 'unchanged', path: '/h/b' }, { status: 'unchanged', path: '/h/c' }, { status: 'modify', path: '/h/d' }];
  const text = describe(planned, '/h', true);
  assert.doesNotMatch(text, /\/b|\/c/);
  assert.match(text, /^ {2}create {4}~\/a\n {2}modify {4}~\/d\n {2}2 unchanged$/);
  assert.match(describe(planned, '/h'), /unchanged +~\/b/);
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

test('A4: plan command lines print the home dir as ~', { skip: !posix }, () => {
  const s = sandbox();
  const r = lean(s, ['--dry-run']);
  assert.ok(!r.stdout.includes(s.home), 'no full home path in the plan');
});
