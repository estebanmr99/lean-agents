import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAN = path.join(ROOT, 'scripts', 'lean.mjs');

test('dry run without TTY picks defaults', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dry-run-'));
  const r = spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--dry-run', '--agents', 'claude', '--all-tools'], {
    input: '',
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...(process.env.NVM_DIR ? { NVM_DIR: process.env.NVM_DIR } : {}) }
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: nothing was changed/);
  assert.doesNotMatch(r.stderr, /no terminal to ask on/);
});

test('dry run without TTY and no --agents picks defaults', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-dry-run-no-agents-'));
  const r = spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--dry-run'], {
    input: '',
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...(process.env.NVM_DIR ? { NVM_DIR: process.env.NVM_DIR } : {}) }
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: nothing was changed/);
});
