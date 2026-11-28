// #575: inside an OpenCode session --update applies files-only steps, defers the OpenCode-touching ones, and the next run finishes them.
// POSIX shell stubs (ps, opencode, npx); the engine never reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAN = path.join(ROOT, 'scripts', 'lean.mjs');
const posix = { skip: process.platform === 'win32' && 'POSIX shell stubs' };

const PS = '#!/bin/sh\necho opencode\n';
const OPENCODE = '#!/bin/sh\n[ "$1" = --version ] && echo 2.2.7\nexit 0\n';
const NPX = '#!/bin/sh\nexit 0\n';

function fixture({ ps = PS } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-defer-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [name, body] of [['ps', ps], ['opencode', OPENCODE], ['npx', NPX], ['git', NPX]]) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  // Synthetic nvm with a Node 24 so the gsd step plans on any machine (CI has no real nvm).
  const nvm = path.join(home, '.nvm');
  const n24 = path.join(nvm, 'versions', 'node', 'v24.15.0');
  fs.mkdirSync(path.join(n24, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(n24, 'lib', 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(nvm, 'nvm.sh'), '');
  fs.writeFileSync(path.join(n24, 'bin', 'node'), NPX, { mode: 0o755 });
  const base = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, HOME: home, NVM_DIR: nvm };
  const lean = (args, extra = {}) => spawnSync(process.execPath, [LEAN, '--home', home, ...args], { encoding: 'utf8', env: { ...base, ...extra }, input: '' });
  const stateFile = path.join(home, '.config', 'lean-agents', 'state.json');
  return { home, lean, state: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')), stateFile };
}

const INSTALL = ['--yes', '--agents', 'opencode-v2', '--no-core', '--tools', 'gsd', '--lang', 'en', '--profile', 'none', '--no-exec'];

// Install with exec off: --update then plans the GSD step (it runs `gsd --opencode`, an OpenCode step).
function installed(f) {
  const r = f.lean(INSTALL);
  assert.equal(r.status, 0, r.stderr);
}

test('inside OpenCode: the blocked step is deferred and recorded, exit 0, two message lines', posix, () => {
  const f = fixture();
  installed(f);
  const r = f.lean(['--update', '--yes', '--json'], { OPENCODE: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /you are running inside OpenCode/);
  assert.match(r.stderr, /^deferred \(OpenCode is running this session\): .+/m);
  assert.match(r.stderr, /^Close OpenCode, then run `lean-agents --update` in a terminal to finish \d+ deferred steps?\.$/m);
  assert.equal(JSON.parse(r.stdout).ok, true);
  const pending = f.state().pending;
  const ran = f.state().commands.map((c) => c.desc);
  assert.ok(ran.some((d) => /lean-update skill/.test(d)), 'the files-only step ran');
  assert.ok(!ran.some((d) => /GSD/.test(d)), 'the OpenCode step did not');
  assert.ok(pending.steps.some((s) => /GSD/.test(s.desc)));
  assert.ok(pending.steps.every((s) => s.desc && s.tool));
});

test('the next run outside OpenCode plans the deferred step and clears the record', posix, () => {
  const f = fixture({ ps: '#!/bin/sh\nexit 0\n' });
  installed(f);
  const s = f.state();
  s.pending = { since: '2026-11-27T00:00:00.000Z', steps: [{ tool: 'gsd', desc: 'x' }] };
  fs.writeFileSync(f.stateFile, JSON.stringify(s));
  const r = f.lean(['--update', '--yes', '--json', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).commands.some((c) => /opencode|dcp/i.test(JSON.stringify(c))), 'the plugin step is planned again');
  // The GSD step runs a real npx by absolute path (not the stub): drop the tool so the real run only runs stubbed steps.
  const t = f.state();
  t.options.tools = t.options.tools.filter((x) => x !== 'gsd');
  fs.writeFileSync(f.stateFile, JSON.stringify(t));
  const real = f.lean(['--update', '--yes', '--json']);
  assert.equal(real.status, 0, real.stderr);
  assert.equal(f.state().pending, undefined);
});

test('outside OpenCode a running user OpenCode still refuses', posix, () => {
  const f = fixture();
  installed(f);
  const r = f.lean(['--update', '--yes', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /an opencode process is running/);
  assert.equal(f.state().pending, undefined);
});

test('--doctor shows the pending row', posix, () => {
  const f = fixture({ ps: '#!/bin/sh\nexit 0\n' });
  installed(f);
  const s = f.state();
  s.pending = { since: '2026-11-27T00:00:00.000Z', steps: [{ tool: 'gsd', desc: 'x' }] };
  fs.writeFileSync(f.stateFile, JSON.stringify(s));
  const r = f.lean(['--doctor', '--no-exec']);
  assert.match(r.stdout, /pending.*1 OpenCode steps deferred from 2026-11-27; close OpenCode, then run `lean-agents --update` in a terminal/);
  assert.match(r.stdout, /lean-agents --update/);
});

const BOTH = ['--yes', '--agents', 'opencode-v2,claude', '--no-core', '--tools', 'dcp', '--lang', 'en', '--profile', 'none', '--no-exec'];
// Swap the ps stub so no OpenCode process shows: the "outside OpenCode" half of a test.
const quiet = (f) => fs.writeFileSync(path.join(path.dirname(f.home), 'bin', 'ps'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const setPins = (f, edit) => { const s = f.state(); edit(s.pins); fs.writeFileSync(f.stateFile, JSON.stringify(s)); };
const ocFiles = (home) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[p] = fs.readFileSync(p, 'utf8'); } };
  walk(path.join(home, '.config', 'opencode'));
  return out;
};

test('a deferred OpenCode step keeps its old pin and is planned again outside OpenCode', posix, () => {
  const f = fixture();
  assert.equal(f.lean(INSTALL).status, 0);
  setPins(f, (p) => { p['gsd-core'] = 'v0.0.1'; });
  // No exit-code check: a behind gsd also plans the npx prerequisite step, which reads as missing under the stubs (#605).
  const r = f.lean(['--update', '--yes', '--json'], { OPENCODE: '1' });
  assert.ok(f.state().pending?.steps.some((s) => /GSD/.test(s.desc)), r.stderr);
  assert.equal(f.state().pins['gsd-core'], 'v0.0.1');
  quiet(f);
  const again = f.lean(['--update', '--yes', '--json', '--dry-run']);
  const j = JSON.parse(again.stdout);
  assert.ok(j.commands.some((c) => /GSD/.test(c.desc)), 'the step is planned again');
  assert.deepEqual(j.behind?.map((b) => b.tool), ['gsd-core']);
});

test('a deferred step with no previous pin still counts as behind', posix, () => {
  const f = fixture();
  assert.equal(f.lean(INSTALL).status, 0);
  setPins(f, (p) => { delete p['gsd-core']; });
  const r = f.lean(['--update', '--yes', '--json'], { OPENCODE: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(f.state().pins['gsd-core'], undefined);
  quiet(f);
  const j = JSON.parse(f.lean(['--update', '--yes', '--json', '--dry-run']).stdout);
  assert.ok(j.commands.some((c) => /GSD/.test(c.desc)), 'planned again');
  assert.deepEqual(j.behind?.map((b) => b.tool), ['gsd-core'], 'reported as behind');
});

test('inside OpenCode no file under the OpenCode config folder changes; other agents still update', posix, () => {
  const f = fixture();
  assert.equal(f.lean(BOTH).status, 0);
  const claudeRules = path.join(f.home, '.claude', 'CLAUDE.md');
  fs.writeFileSync(path.join(f.home, '.config', 'opencode', 'agents', 'debug.md'), '# managed by lean-agents\nstale\n');
  fs.writeFileSync(claudeRules, '# managed by lean-agents\nstale\n');
  const before = ocFiles(f.home);
  const r = f.lean(['--update', '--yes', '--json'], { OPENCODE: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(ocFiles(f.home), before);
  assert.notEqual(fs.readFileSync(claudeRules, 'utf8'), '# managed by lean-agents\nstale\n');
  assert.match(r.stderr, /^deferred \(OpenCode is running this session\): update ~\/\.config\/opencode\/agents\/debug\.md$/m);
  assert.ok(f.state().pending.steps.some((s) => /opencode\/agents\/debug\.md/.test(s.desc)));
});
