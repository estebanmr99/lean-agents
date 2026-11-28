// #636: on Windows a bare name with no PATH match must never reach libuv, which would search the child's cwd first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import * as system from '../scripts/lib/system.mjs';

const { spawnArgs, sys32 } = system;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('#636: spawnArgs never returns a bare Windows name that has no PATH match', () => {
  const missing = spawnArgs('copilot', [], 'win32', () => []);
  assert.equal(missing.missing, true);
  assert.deepEqual(missing, { file: 'copilot', args: [], opts: {}, missing: true });
});

test('#636: spawnArgs resolves a name that already ends in .exe', () => {
  const r = spawnArgs('rtk.exe', [], 'win32', () => ['D:\\tools\\rtk.exe']);
  assert.equal(r.file, 'D:\\tools\\rtk.exe');
  assert.equal(r.missing, undefined);
});

test('#636: a relative Windows name with a separator is treated as missing', () => {
  const r = spawnArgs('.\\x.exe', [], 'win32', () => []);
  assert.deepEqual(r, { file: '.\\x.exe', args: [], opts: {}, missing: true });
});

test('#636: sys32 builds an absolute System32 path on Windows path rules', () => {
  const p = sys32('tasklist.exe');
  assert.equal(p, path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tasklist.exe'));
  assert.equal(p.endsWith('System32\\tasklist.exe'), true);
});

const winOnly = { skip: process.platform !== 'win32' && 'Windows-only' };

// Run a child by path with `cwd = dir`, an empty PATH folder and System32 only, as a clean Windows shell.
function runIn(dir, childText) {
  const empty = path.join(dir, 'empty-path');
  fs.mkdirSync(empty);
  const system32 = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const child = path.join(dir, 'child.mjs');
  const systemUrl = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'system.mjs')).href;
  fs.writeFileSync(child, `import { spawnFor } from ${JSON.stringify(systemUrl)};\n${childText}\n`);
  return spawnSync(process.execPath, [child], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: [empty, system32].join(path.win32.delimiter), SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT },
  });
}

test('#636: spawnFor reports ENOENT for a .cmd in the cwd', winOnly, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-636-'));
  fs.writeFileSync(path.join(dir, 'fakebin.cmd'), '@echo off\r\nexit /b 0\r\n');
  const r = runIn(dir, "console.log(spawnFor(['fakebin']).error?.code);");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'ENOENT');
});

test('#636: spawnFor reports ENOENT for a .exe in the cwd and never runs it', winOnly, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-636-exe-'));
  fs.copyFileSync(process.execPath, path.join(dir, 'fakebin.exe'));
  const r = runIn(dir, "const s = spawnFor(['fakebin', '-e', 'console.log(\"CWDRAN\")']); console.log(JSON.stringify({ status: s.status, code: s.error?.code }));");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.includes('CWDRAN'), false);
  assert.deepEqual(JSON.parse(r.stdout.trim()), { status: null, code: 'ENOENT' });
});
