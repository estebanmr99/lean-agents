// #375: Cursor CLI on Windows from the pinned cursor.com script, and the opt-in Cursor app. Pure plan checks, no downloads, no real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentTable } from '../scripts/lib/agent-lifecycle.mjs';
import { PINS } from '../scripts/lib/pins.mjs';
import { cursorAppPrereqs } from '../scripts/lib/system.mjs';

const p = PINS['cursor-installer-win'];
const plan = (env, home = 'C:\\u', realHome = 'C:\\u') => agentTable({ home, realHome, platform: 'win32', dir: 'C:\\u\\state', env, arch: 'x64' }).cursor;
const absent = () => ({ ok: false, failed: false, status: 0x8A150014, out: '' }); // winget: no applications found
const timedOut = () => ({ ok: false, failed: true, out: '' });

test('win32 plan: curl.exe, sha256 check, -File run, cursor-agent folder on PATH', () => {
  const x = plan({ LOCALAPPDATA: 'C:\\u\\AppData\\Local' });
  assert.equal(x.manual, undefined);
  assert.deepEqual(x.run[0].slice(0, 2), ['curl.exe', '-fsSL']);
  assert.equal(x.run[0].at(-1), 'https://cursor.com/install?win32=true');
  assert.equal(x.run[1].at(-1), p.sha256);
  assert.deepEqual(x.run[2].slice(0, 6), ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']);
  assert.deepEqual(x.bins, ['C:\\u\\AppData\\Local\\cursor-agent\\agent.cmd']);
  assert.deepEqual(x.dirs, ['C:\\u\\AppData\\Local\\cursor-agent']);
  assert.equal(x.pathDir, 'C:\\u\\AppData\\Local\\cursor-agent');
});

test('win32 plan: no LOCALAPPDATA, or one outside a temp --home, is a manual step', () => {
  assert.match(plan({}).manual, /cursor\.com/);
  assert.match(plan({ LOCALAPPDATA: 'C:\\real\\AppData\\Local' }, 'C:\\tmp\\h').manual, /ignores --home/);
  assert.match(plan({ LOCALAPPDATA: 'D:\\Local' }).manual, /ignores --home/, 'a relocated LOCALAPPDATA outside the real home too');
  assert.equal(plan({ LOCALAPPDATA: 'C:\\u\\..foo' }).manual, undefined, 'a folder named ..foo is inside home');
  assert.equal(plan({ LOCALAPPDATA: 'C:\\tmp\\h\\AppData\\Local' }, 'C:\\tmp\\h').manual, undefined);
});

test('winget Cursor app: missing -> install with its undo; installed -> nothing', () => {
  const [app] = cursorAppPrereqs('winget', 'win32', 'C:\\u', absent);
  assert.deepEqual(app.run, [['winget', 'install', '--id', 'Anysphere.Cursor', '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements']]);
  assert.deepEqual(app.undo, [['winget', 'uninstall', '--id', 'Anysphere.Cursor', '-e']]);
  assert.deepEqual(cursorAppPrereqs('winget', 'win32', 'C:\\u', () => ({ ok: true, failed: false, out: '' })), []);
});

test('winget list with no clear answer (timeout, or another exit code such as a source error): a note, no install, no undo', () => {
  for (const q of [timedOut, () => ({ ok: false, failed: false, status: 1, out: '' })]) {
    const rows = cursorAppPrereqs('winget', 'win32', 'C:\\u', q);
    assert.ok(rows.length && rows.every((c) => c.note && !c.run && !c.undo));
  }
});

test('brew cask on macOS installs and uninstalls the cask; a cask brew already lists is left alone; Linux is a note', () => {
  const none = () => false;
  const [app] = cursorAppPrereqs('brew', 'darwin', '/h', absent, none);
  assert.deepEqual(app.run, [['brew', 'install', '--cask', 'cursor']]);
  assert.deepEqual(app.undo, [['brew', 'uninstall', '--cask', 'cursor']]);
  assert.deepEqual(cursorAppPrereqs('brew', 'darwin', '/h', () => ({ ok: true, failed: false, status: 0, out: '' }), none), []);
  assert.ok(cursorAppPrereqs('brew', 'linux', '/h', absent).every((c) => c.note));
});
