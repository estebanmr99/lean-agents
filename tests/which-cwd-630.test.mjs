// #630: Windows `where` also searches the current folder, so which() must ignore a cwd match unless the cwd is on PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dropCwd, spawnFor } from '../scripts/lib/system.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SYSTEM = pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'system.mjs')).href;

test('dropCwd drops a cwd match when the cwd is not on PATH', () => {
  const results = ['C:\\work\\copilot.cmd', 'C:\\tools\\copilot.cmd'];
  assert.deepEqual(dropCwd(results, 'C:\\work', 'C:\\tools'), ['C:\\tools\\copilot.cmd']);
});

test('dropCwd keeps a cwd match when the cwd is on PATH', () => {
  const results = ['C:\\work\\copilot.cmd', 'C:\\tools\\copilot.cmd'];
  assert.deepEqual(dropCwd(results, 'C:\\work', 'C:\\tools;C:\\work'), results);
});

test('dropCwd compares folders and PATH entries case-insensitively', () => {
  const results = ['C:\\Work\\copilot.cmd', 'C:\\Tools\\copilot.cmd'];
  assert.deepEqual(dropCwd(results, 'c:\\work\\', 'c:\\TOOLS'), ['C:\\Tools\\copilot.cmd']);
});

test('dropCwd treats a quoted PATH entry as the same folder', () => {
  const results = ['C:\\work\\copilot.cmd'];
  assert.deepEqual(dropCwd(results, 'C:\\work', '"C:\\work"'), results);
});

test('dropCwd treats a "." PATH entry as the cwd', () => {
  const results = ['C:\\work\\copilot.cmd'];
  assert.deepEqual(dropCwd(results, 'C:\\work', '.'), results);
});

const winOnly = { skip: process.platform !== 'win32' && 'Windows-only' };

function stubSetup({ onPath }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'which-630-'));
  const here = path.join(root, 'here');
  const empty = path.join(root, 'empty');
  fs.mkdirSync(here);
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(here, 'copilot.cmd'), '@echo off\r\n');
  const child = path.join(root, 'child.mjs');
  fs.writeFileSync(child, `import { which } from ${JSON.stringify(SYSTEM)};\nconsole.log(JSON.stringify(which('copilot')));\n`);
  const system32 = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const pathVar = [onPath ? here : '', empty, system32].filter(Boolean).join(path.win32.delimiter);
  const env = { PATH: pathVar, SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT };
  const r = spawnSync(process.execPath, [child], { cwd: here, env, encoding: 'utf8' });
  return { root, here, status: r.status, out: r.stdout.trim(), err: r.stderr };
}

test('win32: a copilot.cmd in the cwd and none on PATH is ignored', winOnly, () => {
  const s = stubSetup({ onPath: false });
  assert.equal(s.status, 0, s.err);
  assert.equal(JSON.parse(s.out), null);
});

test('win32: a copilot.cmd in the cwd that is also on PATH is returned', winOnly, () => {
  const s = stubSetup({ onPath: true });
  assert.equal(s.status, 0, s.err);
  const got = JSON.parse(s.out);
  assert.ok(got);
  assert.equal(path.win32.dirname(got).toLowerCase(), s.here.toLowerCase());
});

test('win32: spawnFor runs a bare .cmd from PATH, not the copy in the cwd', winOnly, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'which-630-spawn-'));
  const here = path.join(root, 'here');
  const tools = path.join(root, 'tools');
  fs.mkdirSync(here);
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(here, 'fakebin.cmd'), '@echo off\r\necho CWDCOPY\r\n');
  fs.writeFileSync(path.join(tools, 'fakebin.cmd'), '@echo off\r\necho PATHCOPY\r\n');
  const system32 = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const env = { PATH: [tools, system32].join(path.win32.delimiter), SystemRoot: process.env.SystemRoot, PATHEXT: process.env.PATHEXT };
  const r = spawnFor(['fakebin'], { cwd: here, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'PATHCOPY');
});