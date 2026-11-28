// --doctor tells an absent CLI, a launcher-only stub and a runnable CLI apart (#564). Temp HOME, stub dir as PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../scripts/lib/doctor.mjs';
import { preset } from '../scripts/lib/network.mjs';

const win = process.platform === 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-launcher-'));

// On win32 PATHEXT and SystemRoot stay inherited: `where` needs them to match a .cmd stub.
function withPath(dir, fn) {
  const saved = { PATH: process.env.PATH, PATHEXT: process.env.PATHEXT, SystemRoot: process.env.SystemRoot };
  process.env.PATH = dir;
  if (win) { process.env.PATHEXT = saved.PATHEXT; process.env.SystemRoot = saved.SystemRoot; }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

function stub(dir, body) {
  const file = path.join(dir, win ? 'copilot.cmd' : 'copilot');
  fs.writeFileSync(file, body);
  if (!win) fs.chmodSync(file, 0o755);
  return file;
}

function rows(home) {
  const state = { version: '0', commands: [], files: [], options: { agents: ['copilot-cli'], tools: [], privacy: 'standard', network: preset('on') } };
  const run = () => ({ ok: false, failed: false, status: 1, out: '' });
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state, exec: true, json: true, run }); } finally { process.stdout.write = write; }
  return JSON.parse(out).rows;
}

const launcherBody = win
  ? '@echo off\r\necho copilot: the Copilot CLI is not installed 1>&2\r\nexit /b 127\r\n'
  : '#!/bin/sh\necho "copilot: the Copilot CLI is not installed" >&2\nexit 127\n';

test('a launcher stub that exits 127 is launcher-only with the install fix', () => {
  const home = tmp();
  const dir = tmp();
  stub(dir, launcherBody);
  const row = withPath(dir, () => rows(home).find((r) => r.item === 'copilot on PATH'));
  assert.equal(row.status, 'error');
  assert.match(row.detail, /launcher only/);
  assert.match(row.detail, /lean-agents --install-agent copilot-cli/);
});

test('a stub that prints a version is runnable', () => {
  const home = tmp();
  const dir = tmp();
  stub(dir, win ? '@echo off\r\necho 1.2.3\r\n' : '#!/bin/sh\necho 1.2.3\n');
  const row = withPath(dir, () => rows(home).find((r) => r.item === 'copilot on PATH'));
  assert.equal(row.status, 'ok');
  assert.equal(row.detail, '1.2.3');
});

test('no stub is absent', () => {
  const home = tmp();
  const dir = tmp();
  const row = withPath(dir, () => rows(home).find((r) => r.item === 'copilot on PATH'));
  assert.equal(row.status, 'error');
  assert.equal(row.detail, 'not found');
});