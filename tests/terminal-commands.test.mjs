import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalCommands } from '../scripts/lib/terminals.mjs';

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
