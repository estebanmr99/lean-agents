import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --everything through the real engine: temp HOME, --no-exec, only PATH, NVM_DIR and HOME reach the child.
const LEAN = fileURLToPath(new URL('../scripts/lean.mjs', import.meta.url));
const lean = (home, ...args) => spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--dry-run', '--yes', '--everything', ...args], {
  encoding: 'utf8', input: '', env: { PATH: process.env.PATH, NVM_DIR: path.join(home, 'no-nvm'), HOME: home },
});
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-every-'));

test('--everything --json: prerequisites planned, default agents Claude Code + OpenCode 2, nothing written', () => {
  const home = tmpHome();
  const r = lean(home, '--json');
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.deepEqual(plan.agents, ['claude', 'opencode-v2']);
  const ids = plan.prereqs.map((s) => s.id);
  for (const id of ['nvm', 'node-24', 'uv', 'rtk', 'bun']) assert.ok(ids.includes(id), id);
  assert.equal(plan.prereqs.find((s) => s.id === 'nvm').status, 'install'); // temp HOME has no nvm
  assert.deepEqual(fs.readdirSync(home), []);
});

test('--everything text plan lists prerequisites before the agent plan; --agents still wins', () => {
  const r = lean(tmpHome(), '--agents', 'claude');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.indexOf('Prerequisites') < r.stdout.indexOf('lean-agents plan for claude\n'));
  assert.match(r.stdout, /Dry run: nothing was changed/);
});

test('--everything installs a missing agent CLI through --install-agent; without it the run still stops', { skip: process.platform === 'win32' }, () => {
  const home = tmpHome();
  const bin = path.join(home, 'bin'); // node only: no claude, no opencode
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  const run = (...args) => spawnSync(process.execPath, [LEAN, '--home', home, '--dry-run', '--yes', '--agents', 'claude,opencode-v2', ...args], {
    encoding: 'utf8', input: '', env: { PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin`, NVM_DIR: path.join(home, 'no-nvm'), HOME: home },
  });
  const every = run('--everything');
  assert.equal(every.status, 0, every.stderr);
  assert.match(every.stdout, /- install the claude CLI \(/);
  assert.match(every.stdout, /- install the opencode CLI \(/);
  assert.doesNotMatch(every.stdout, /CLI is not on PATH/);
  assert.ok(every.stdout.indexOf('install the claude CLI') < every.stdout.indexOf('Ponytail plugin'), 'the CLI comes before the steps that need it');
  assert.match(run('--all-tools').stdout, /! the claude CLI is not on PATH/); // all tools: on Node 22 the defaults have no claude step
});

test('--everything resumes: a prerequisite finished in a saved run is skipped', () => {
  const home = tmpHome();
  const dir = path.join(home, '.config', 'lean-agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ files: [], commands: [{ desc: 'prerequisite: nvm', ok: true, undo: [], resumeKey: 'prereq:nvm' }] }));
  const r = lean(home, '--json');
  assert.equal(r.status, 0, r.stderr);
  const nvm = JSON.parse(r.stdout).prereqs.find((s) => s.id === 'nvm');
  assert.equal(nvm.status, 'skip');
  assert.equal(nvm.skipIf, 'finished in an earlier run');
});

test('tools that wait for Node 24 are listed as "after nvm", not dropped silently', () => {
  const home = tmpHome();
  const r = spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--dry-run', '--yes', '--everything', '--json'], {
    encoding: 'utf8', input: '', env: { PATH: process.env.PATH, NVM_DIR: path.join(home, 'no-nvm'), HOME: home, LEAN_AGENTS_NODE: '22.20.0' },
  });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.ok(plan.afterNvm.includes('context-mode'));
  assert.ok(!plan.tools.includes('context-mode'));
});
