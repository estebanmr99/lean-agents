import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-preflight-')));
const engine = (args, env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), ...args], { encoding: 'utf8', env });

test('preflight: PATH without claude: --dry-run warns and exits 0, --yes exits 1', () => {
  const home = tmp();
  const env = { PATH: '', HOME: home };

  const dry = engine(['--home', home, '--yes', '--dry-run', '--agents', 'claude'], env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /! the claude CLI is not on PATH: \d steps need it/);

  const exec = engine(['--home', home, '--yes', '--agents', 'claude'], env);
  assert.equal(exec.status, 1, exec.stderr);
  assert.match(exec.stdout, /! the claude CLI is not on PATH: \d steps need it/);
  assert.match(exec.stdout, /nothing changed/);
  assert.equal(fs.existsSync(path.join(home, '.config', 'lean-agents', 'state.json')), false);
});

test('preflight: PATH with a stub claude: no warning', () => {
  const home = tmp();
  const stubDir = tmp();
  const stubPath = path.join(stubDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  fs.writeFileSync(stubPath, process.platform === 'win32' ? 'exit 0' : '#!/bin/sh\nexit 0');
  fs.chmodSync(stubPath, 0o755);
  const env = { PATH: stubDir, HOME: home };

  const dry = engine(['--home', home, '--yes', '--dry-run', '--agents', 'claude'], env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(dry.stdout, /! the claude CLI is not on PATH/);
});
