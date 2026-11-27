import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAN = path.join(ROOT, 'scripts', 'lean.mjs');
const lonelyEnv = (home) => ({ PATH: process.env.PATH, HOME: home, ...(process.env.NVM_DIR ? { NVM_DIR: process.env.NVM_DIR } : {}) });
const lean = (home, args) => spawnSync(process.execPath, [LEAN, '--home', home, ...args], { input: '', encoding: 'utf8', env: lonelyEnv(home) });
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