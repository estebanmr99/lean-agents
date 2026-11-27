import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { terminalCommands, installedAppVersions, appUpdateTarget } from '../scripts/lib/terminals.mjs';

test('terminalCommands: installTerminals with system false gives no install commands', () => {
  const commands = terminalCommands({
    home: '/tmp/x',
    terminals: [],
    installTerminals: ['warp', 'orca'],
    agents: [],
    platform: 'win32',
    system: false,
  });

  assert.deepEqual(commands, []);
});

test('terminalCommands: installTerminals with system true on win32 gives install commands with skipIfExists', () => {
  const commands = terminalCommands({
    home: '/tmp/x',
    terminals: [],
    installTerminals: ['warp', 'orca'],
    agents: [],
    platform: 'win32',
    system: true,
    env: { LOCALAPPDATA: 'D:\\localappdata', TEMP: 'D:\\temp' },
  });

  const warp = commands.find((c) => c.tool === 'warp');
  const orca = commands.find((c) => c.tool === 'orca');

  assert.ok(warp);
  assert.equal(warp.manual, undefined);
  assert.deepEqual(warp.skipIfExists, ['D:\\localappdata\\Programs\\Warp']);
  assert.ok(warp.run.length > 0);
  const undo = warp.undo[0].at(-1);
  assert.match(undo, /Get-Process -Name warp/);
  assert.match(undo, /exit 1/);
  assert.match(undo, /unins000\.exe/);

  assert.ok(orca);
  assert.equal(orca.manual, undefined);
  assert.deepEqual(orca.skipIfExists, ['D:\\localappdata\\Programs\\Orca']);
  assert.ok(orca.run.length > 0);
  // The NSIS uninstaller returns before it is done: the undo waits for it.
  assert.match(orca.undo[0].at(-1), /-Wait; for \(\$i = 0; \$i -lt 60 -and \(Test-Path \$u\)/);
});

test('terminalCommands: installTerminals with system true on linux gives no install commands', () => {
  const commands = terminalCommands({
    home: '/tmp/x',
    terminals: [],
    installTerminals: ['warp', 'orca'],
    agents: [],
    platform: 'linux',
    system: true,
  });

  assert.deepEqual(commands, []);
});

test('terminalCommands: a managed app behind its pin reinstalls even when present', () => {
  const commands = terminalCommands({
    home: '/tmp/x',
    terminals: [],
    installTerminals: ['orca'],
    updateApps: ['orca'],
    agents: [],
    platform: 'win32',
    system: true,
    env: { LOCALAPPDATA: 'D:\\localappdata', TEMP: 'D:\\temp' },
  });

  const orca = commands.find((c) => c.tool === 'orca');
  assert.equal(orca.skipIfExists, undefined);
});

test('terminalCommands: an adopted app keeps its install command but has no undo', () => {
  const commands = terminalCommands({
    home: '/tmp/x',
    terminals: [],
    installTerminals: ['orca'],
    updateApps: ['orca'],
    adoptedTerminals: ['orca'],
    agents: [],
    platform: 'win32',
    system: true,
    env: { LOCALAPPDATA: 'D:\\localappdata', TEMP: 'D:\\temp' },
  });

  const orca = commands.find((c) => c.tool === 'orca');
  assert.deepEqual(orca.undo, []);
});

test('terminalCommands: Warp on macOS installs with brew install and updates with brew upgrade', () => {
  const base = { home: '/opt/x', terminals: [], installTerminals: ['warp'], agents: [], platform: 'darwin', system: true };
  const install = terminalCommands(base).find((c) => c.tool === 'warp');
  assert.match(install.run[0].join(' '), /brew install --cask warp/);
  assert.doesNotMatch(install.run[0].join(' '), /brew upgrade/);

  const update = terminalCommands({ ...base, updateApps: ['warp'] }).find((c) => c.tool === 'warp');
  // `brew install` is a silent no-op when Warp is already there; an update needs `brew upgrade`.
  assert.match(update.run[0].join(' '), /brew upgrade --cask warp/);
  assert.doesNotMatch(update.run[0].join(' '), /brew install/);
  assert.equal(update.skipIfExists, undefined);
});

test('terminalCommands: an Orca update replaces the app where it was found and refuses while it runs', () => {
  const home = '/opt/x';
  const install = terminalCommands({ home, terminals: [], installTerminals: ['orca'], agents: [], platform: 'darwin', system: true }).find((c) => c.tool === 'orca');
  const installScript = install.run[0].at(-1);
  assert.ok(installScript.includes(path.join(home, 'Applications', 'Orca.app')));
  assert.doesNotMatch(installScript, /pgrep -x Orca/);

  const found = path.join('/Applications', 'Orca.app');
  const update = terminalCommands({ home, terminals: [], installTerminals: ['orca'], updateApps: ['orca'], appPaths: { orca: found }, agents: [], platform: 'darwin', system: true }).find((c) => c.tool === 'orca');
  const script = update.run[0].at(-1);
  assert.ok(script.includes(found), 'the stale /Applications copy is replaced in place');
  assert.ok(!script.includes(path.join(home, 'Applications', 'Orca.app')), 'no second copy in ~/Applications');
  assert.match(script, /pgrep -x Orca/);
  assert.deepEqual(update.undo, [['rm', '-rf', found]]);
});

test('appUpdateTarget: home app updates in place, /Applications needs write access, running Orca is refused', () => {
  const local = path.join('/opt/x', 'Applications', 'Orca.app');
  assert.deepEqual(appUpdateTarget({ home: '/opt/x', app: 'orca', platform: 'darwin', system: false, exists: (p) => p === local }), { path: local });

  const systemApp = path.join('/Applications', 'Orca.app');
  const at = (extra) => appUpdateTarget({ home: '/opt/x', app: 'orca', platform: 'darwin', system: true, exists: (p) => p === systemApp, ...extra });
  assert.deepEqual(at({ writable: () => true }), { path: systemApp });
  const blocked = at({ writable: () => false });
  assert.equal(blocked.path, systemApp);
  assert.match(blocked.blocked, /\/Applications.*needs sudo/);
  assert.match(at({ writable: () => true, running: true }).blocked, /Orca is running/);
});

test('installedAppVersions: reads CFBundleShortVersionString, and a missing app or system:false reads nothing', () => {
  const home = '/opt/x';
  const app = path.join(home, 'Applications', 'Orca.app');
  const calls = [];
  const versions = installedAppVersions({
    home, platform: 'darwin', system: false, exists: (p) => p === app,
    run: (argv) => { calls.push(argv); return { ok: true, out: '1.4.257\n' }; },
  });
  assert.deepEqual(versions, { orca: '1.4.257' });
  assert.deepEqual(calls[0].slice(0, 2), ['defaults', 'read']);
  assert.ok(calls[0][2].endsWith(path.join('Contents', 'Info.plist')));

  assert.deepEqual(installedAppVersions({ home, platform: 'darwin', exists: () => false, run: () => assert.fail('no probe') }), {});
  assert.deepEqual(installedAppVersions({ home, platform: 'win32', system: false, run: () => assert.fail('no registry read') }), {});
  // system:false skips /Applications too.
  assert.deepEqual(installedAppVersions({ home, platform: 'darwin', system: false, exists: (p) => p === path.join('/Applications', 'Orca.app'), run: () => assert.fail('no /Applications read') }), {});
});
