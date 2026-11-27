import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAN = path.join(ROOT, 'scripts', 'lean.mjs');
// LEAN_AGENTS_TEST/LEAN_TTY inject the tty probe: CI has no pty and a local terminal must not decide the test.
const lonelyEnv = (home, extra = {}) => ({ PATH: process.env.PATH, HOME: home, LEAN_AGENTS_TEST: '1', LEAN_TTY: '0', ...(process.env.NVM_DIR ? { NVM_DIR: process.env.NVM_DIR } : {}), ...extra });
const lean = (home, args, extra = {}) => spawnSync(process.execPath, [LEAN, '--home', home, ...args], { input: extra.input ?? '', encoding: 'utf8', env: lonelyEnv(home, extra.env) });
const lastLine = (text) => text.trimEnd().split(/\r?\n/).at(-1);

test('dry run without TTY picks defaults and ends with the --yes hint', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dry-run-'));
  const r = lean(home, ['--no-exec', '--dry-run', '--agents', 'claude', '--all-tools']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: nothing was changed/);
  assert.equal(lastLine(r.stdout), 'to apply from a non-interactive shell, add --yes');
  assert.doesNotMatch(r.stderr, /no terminal to ask on/);
});

test('dry run without TTY and no --agents picks defaults', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dry-run-no-agents-'));
  const r = lean(home, ['--no-exec', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: nothing was changed/);
  assert.equal(lastLine(r.stdout), 'to apply from a non-interactive shell, add --yes');
});

test('--update without a TTY and without --yes fails before printing the plan', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-update-no-tty-'));
  assert.equal(lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'serena']).status, 0);
  const r = lean(home, ['--update', '--no-exec']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), '', 'the plan and release notes must not come first');
  assert.match(r.stderr, /no terminal to ask on: pass --yes/);
});

test('--update --dry-run without a TTY ends with the --yes hint', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-update-dry-no-tty-'));
  assert.equal(lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'serena']).status, 0);
  const r = lean(home, ['--update', '--no-exec', '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lastLine(r.stdout), 'to apply from a non-interactive shell, add --yes');
});

test('piped stdin with a terminal available still asks (#548: curl ... | bash)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-update-tty-'));
  assert.equal(lean(home, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']).status, 0);
  const r = lean(home, ['--update', '--no-exec'], { env: { LEAN_TTY: '1' }, input: 'n\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lean-agents plan for opencode-v2/);
  assert.match(r.stdout, /Cancelled\./);
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /no terminal to ask on/);
});

test('--update --dry-run with a terminal available does not print the --yes hint', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-update-dry-tty-'));
  assert.equal(lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'serena']).status, 0);
  const r = lean(home, ['--update', '--no-exec', '--dry-run'], { env: { LEAN_TTY: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /to apply from a non-interactive shell/);
});