// --tools rtk on Linux without Homebrew plans the pinned release tarball (#411). Temp HOME, dry run, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rtkInstall } from '../scripts/lib/system.mjs';

const LEAN = fileURLToPath(new URL('../scripts/lean.mjs', import.meta.url));
const posix = { skip: process.platform === 'win32' && 'POSIX PATH stub' };
const linux = { skip: process.platform !== 'linux' && 'the Linux install route' };
const darwin = { skip: process.platform !== 'darwin' && 'the macOS manual route' };

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const lean = (home, bin) => spawnSync(process.execPath, [LEAN, '--home', home, '--yes', '--dry-run', '--json', '--agents', 'opencode-v2', '--tools', 'rtk'], {
  encoding: 'utf8', input: '', env: { PATH: bin, NVM_DIR: path.join(home, 'no-nvm'), HOME: home },
});
const plan = (home, bin) => {
  const r = lean(home, bin);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
};
const stub = (bin, name) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

test('Linux without brew or rtk: the planned rtk step downloads the pinned tarball and verifies its sha256', linux, () => {
  const home = tmp('lean-rtk-linux-');
  const bin = tmp('lean-rtk-bin-');
  const commands = plan(home, bin).commands;
  const rtk = commands.find((c) => c.desc.startsWith('install rtk'));
  assert.ok(rtk, JSON.stringify(commands));
  const flat = rtk.run.flat().join(' ');
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  assert.match(flat, new RegExp(`curl.*github\\.com/rtk-ai/rtk/releases/download/v1\\.2\\.0/rtk-${arch}-unknown-linux-musl\\.tar\\.gz`));
  const verify = rtk.run.find((argv) => argv[0] === process.execPath && argv[2].endsWith('.tar.gz'));
  assert.ok(verify, 'no sha256 verify step');
  assert.match(verify[3], /^[0-9a-f]{64}$/);
  assert.ok(!commands.some((c) => /rtk is missing/.test(c.desc)), 'the manual row is gone');
});

test('Linux without brew: the rtk undo removes only ~/.local/bin/rtk', () => {
  const home = path.posix.join('/tmp', 'x');
  const r = rtkInstall(home, path.posix.join(home, '.config', 'lean-agents'), 'linux', 'x64');
  assert.deepEqual(r.undo, [[process.execPath, '-e', 'require("fs").rmSync(process.argv[1], { force: true })', '/tmp/x/.local/bin/rtk']]);
});

test('Linux with brew: rtk is still `brew install rtk`', Object.assign({}, posix, linux), () => {
  const home = tmp('lean-rtk-brew-');
  const bin = tmp('lean-rtk-bin-');
  stub(bin, 'brew');
  const commands = plan(home, bin).commands;
  const rtk = commands.find((c) => c.desc === 'install rtk');
  assert.ok(rtk, JSON.stringify(commands));
  assert.deepEqual(rtk.run, [['brew', 'install', 'rtk']]);
});

test('Linux with rtk already on PATH: no install step', Object.assign({}, posix, linux), () => {
  const home = tmp('lean-rtk-present-');
  const bin = tmp('lean-rtk-bin-');
  stub(bin, 'rtk');
  assert.ok(!plan(home, bin).commands.some((c) => /install rtk|rtk is missing/.test(c.desc)));
});

test('macOS without brew: rtk keeps the manual row', darwin, () => {
  const home = tmp('lean-rtk-darwin-');
  const bin = tmp('lean-rtk-bin-');
  const rtk = plan(home, bin).commands.find((c) => c.desc.includes('rtk is missing'));
  assert.ok(rtk, 'no manual rtk row');
  assert.deepEqual(rtk.run, []);
  assert.match(rtk.desc, /^rtk is missing: install it from https:\/\/github\.com\/rtk-ai\/rtk#installation$/);
});