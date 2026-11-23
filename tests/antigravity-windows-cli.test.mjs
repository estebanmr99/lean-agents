// #374: Antigravity CLI on Windows from the pinned release zip (no install.ps1). Pure plan checks, no downloads, no real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTable } from '../scripts/lib/agent-lifecycle.mjs';
import { PINS } from '../scripts/lib/pins.mjs';
import { antigravityPrereqs } from '../scripts/lib/system.mjs';

const p = PINS['antigravity-cli-win'];
const plan = (arch, env = {}) => agentTable({ home: 'C:\\u', realHome: 'C:\\u', platform: 'win32', dir: 'C:\\u\\state', env, arch }).antigravity;

test('win32 plan: pinned zip, sha256 check, agy.exe extract, PATH folder', () => {
  const x64 = plan('x64', { LOCALAPPDATA: 'C:\\u\\AppData\\Local' });
  assert.equal(x64.manual, undefined);
  assert.equal(x64.run[0][0], 'curl.exe');
  assert.match(x64.run[0].at(-1), new RegExp(`/download/${p.version}/agy_cli_windows_x64\\.zip$`));
  assert.equal(x64.run[1].at(-1), p.sha256.x64);
  assert.match(x64.run[2].at(-1), /^\$ErrorActionPreference = 'Stop';.*ZipFile\]::ExtractToDirectory.*antigravity\.exe.*agy\.exe/s);
  assert.deepEqual(x64.bins, ['C:\\u\\AppData\\Local\\agy\\bin\\agy.exe']);
  assert.equal(x64.pathDir, 'C:\\u\\AppData\\Local\\agy\\bin');
});

test('win32 plan: arm64 picks the arm64 sha256; no LOCALAPPDATA uses the #229 folder', () => {
  assert.equal(plan('arm64').run[1].at(-1), p.sha256.arm64);
  assert.match(plan('arm64').run[0].at(-1), /agy_cli_windows_arm64\.zip$/);
  assert.deepEqual(plan('x64').bins, ['C:\\u\\.gemini\\bin\\agy.exe']);
});

test('the winget app install carries its undo', () => {
  const absent = () => ({ ok: false, failed: false, out: '' });
  const app = antigravityPrereqs('winget', 'win32', 'C:\\u', true, absent).find((c) => c.run?.[0]?.[1] === 'install');
  assert.ok(app);
  assert.deepEqual(app.undo, [['winget', 'uninstall', '--id', 'Google.Antigravity', '-e']]);
});

test('winget list that did not finish: no app install, so no undo that could remove the user app', () => {
  const timedOut = () => ({ ok: false, failed: true, out: '' });
  const rows = antigravityPrereqs('winget', 'win32', 'C:\\u', true, timedOut);
  assert.ok(!rows.some((c) => c.undo));
  assert.ok(rows.some((c) => c.note && /could not check/.test(c.desc)));
});

test('win32 plan: ia32 gets a manual step, not the x64 zip', () => {
  assert.match(plan('ia32').manual, /no release zip/);
});
