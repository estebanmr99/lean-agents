// The --everything PATH block for macOS and Linux shells (#335).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { posixPathBlock } from '../scripts/lib/shell-path.mjs';
import { plan, apply, undo, setBlock } from '../scripts/lib/fsops.mjs';

const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
// A POSIX feature: the tests use sh and / paths.
const skip = process.platform === 'win32' && 'POSIX shells only';
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-posix-path-'));

test('Linux plan with pending steps and PATH without folders -> one block action with id path in .profile', { skip }, () => {
  const home = tmpHome();
  const dirs = ['.local/bin', '.opencode/bin'];
  const actions = posixPathBlock({ home, platform: 'linux', envPath: '/usr/bin:/bin', dirs, shell: '/bin/bash' });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'path');
  assert.equal(actions[0].path, path.join(home, '.profile'));
  assert.equal(actions[0].body, 'export PATH="$HOME/.local/bin:$HOME/.opencode/bin:$PATH"');

  const planned = plan(actions, [home]);
  apply(planned, path.join(home, 'backups'), home);
  const written = fs.readFileSync(path.join(home, '.profile'), 'utf8');
  assert.match(written, /# lean-agents:path:start/);
  assert.match(written, /export PATH="\$HOME\/\.local\/bin:\$HOME\/\.opencode\/bin:\$PATH"/);
  assert.match(written, /# lean-agents:path:end/);

  // sh -n on the written file passes
  const check = spawnSync('sh', ['-n', path.join(home, '.profile')]);
  assert.equal(check.status, 0, check.stderr);

  // sourcing it in sh -c with PATH=/usr/bin:/bin puts those folders first
  const run = spawnSync('sh', ['-c', `. "${path.join(home, '.profile')}"; echo "$PATH"`], {
    env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), `${path.join(home, '.local', 'bin')}:${path.join(home, '.opencode', 'bin')}:/usr/bin:/bin`);
});

test('folders already on env.PATH -> no block; win32 -> no block', { skip }, () => {
  const home = tmpHome();
  const dirs = ['.local/bin', '.opencode/bin'];
  const onPath = `${path.join(home, '.local', 'bin')}/:${path.join(home, '.opencode', 'bin')}:/usr/bin:/bin`;
  assert.deepEqual(posixPathBlock({ home, platform: 'linux', envPath: onPath, dirs }), []);
  assert.deepEqual(posixPathBlock({ home, platform: 'win32', envPath: '/usr/bin:/bin', dirs }), []);
});

test('an existing .bashrc is used instead of creating .profile', { skip }, () => {
  const home = tmpHome();
  fs.writeFileSync(path.join(home, '.bashrc'), 'export FOO=1\n');
  const dirs = ['.local/bin'];
  const actions = posixPathBlock({ home, platform: 'linux', envPath: '/usr/bin:/bin', dirs });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'path');
  assert.equal(actions[0].path, path.join(home, '.bashrc'));
  assert.ok(!fs.existsSync(path.join(home, '.profile')));
});

test('path block and opencode1 block coexist in one rc file; uninstall removes only path block', { skip }, () => {
  const home = tmpHome();
  const rc = path.join(home, '.bashrc');
  fs.writeFileSync(rc, 'export USER_SETTING=1\n');

  // Add opencode1 block
  const textWithOpencode1 = setBlock(fs.readFileSync(rc, 'utf8'), 'export PATH="/opt/opencode1/bin:$PATH"', false, 'opencode1');
  fs.writeFileSync(rc, textWithOpencode1);

  // Add path block via engine fsops
  const pathActions = posixPathBlock({ home, platform: 'linux', envPath: '/usr/bin:/bin', dirs: ['.local/bin'] });
  const planned = plan(pathActions, [home]);
  const entries = apply(planned, path.join(home, 'backups'), home);

  const textBoth = fs.readFileSync(rc, 'utf8');
  assert.match(textBoth, /# lean-agents:opencode1:start/);
  assert.match(textBoth, /# lean-agents:path:start/);
  assert.match(textBoth, /export USER_SETTING=1/);

  // Uninstalling path block leaves opencode1 intact
  undo(entries, [home]);
  const textAfter = fs.readFileSync(rc, 'utf8');
  assert.doesNotMatch(textAfter, /# lean-agents:path:start/);
  assert.match(textAfter, /# lean-agents:opencode1:start/);
  assert.match(textAfter, /export PATH="\/opt\/opencode1\/bin:\$PATH"/);
  assert.match(textAfter, /export USER_SETTING=1/);
});

test('macOS with a pending Homebrew step -> the brew shellenv line', { skip }, () => {
  const home = tmpHome();
  const actions = posixPathBlock({ home, platform: 'darwin', envPath: '/usr/bin:/bin', brew: '/opt/homebrew', dirs: [] });
  assert.equal(actions.length, 1);
  assert.match(actions[0].body, /^\[ -x \/opt\/homebrew\/bin\/brew \] && eval "\$\(\/opt\/homebrew\/bin\/brew shellenv\)"$/);
});

test('engine run with private Node appends private node bin to PATH', { skip }, () => {
  const home = tmpHome();
    const actions = posixPathBlock({ home, platform: 'linux', envPath: '/usr/bin:/bin', dirs: [], privateNode: true });
  assert.equal(actions.length, 1);
  assert.equal(actions[0].body, 'export PATH="$PATH:$HOME/.config/lean-agents/node/bin"');
});

test('real engine: dry-run plans the block, apply writes it and prints notice, uninstall removes it', { skip }, () => {
  const home = tmpHome();
  const env = { PATH: '/usr/bin:/bin', HOME: home, USER: 'testuser', SHELL: '/bin/bash' };
  const runLean = (...args) => spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--yes', '--everything', ...args], {
    encoding: 'utf8', env,
  });

  fs.writeFileSync(path.join(home, '.profile'), 'export MINE=1\n');
  const dry = runLean('--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /modify\s+~\/\.profile/); // literal-tilde: POSIX-only test

  const applyRun = runLean();
  assert.equal(applyRun.status, 0, applyRun.stderr);
  assert.match(applyRun.stdout, /Open a new terminal \(or run: \. \S+\/\.profile\) so the new PATH takes effect\./);

  const profile = fs.readFileSync(path.join(home, '.profile'), 'utf8');
  assert.match(profile, /# lean-agents:path:start/);

  const unRun = spawnSync(process.execPath, [LEAN, '--home', home, '--uninstall', '--yes', '--no-exec'], {
    encoding: 'utf8', env,
  });
  assert.equal(unRun.status, 0, unRun.stderr);
  assert.equal(fs.readFileSync(path.join(home, '.profile'), 'utf8'), 'export MINE=1\n', 'uninstall leaves the user lines and removes only the block');
});
