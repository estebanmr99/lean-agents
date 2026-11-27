// #475: child processes get their arguments unchanged, with no `shell: true` (DEP0190), on POSIX and Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { spawnArgs, quiet } from '../scripts/lib/system.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRICKY = ['a b & c', 'x"y', '50%PATH%', 'p|q', 'back\\', '(r)^s'];

test('#475: spawnArgs on Windows runs a .cmd shim through cmd.exe with every argument escaped, never with shell', () => {
  const r = spawnArgs('npx', ['-y', 'a b & c'], 'win32', () => ['C:\\Program Files\\nodejs\\npx', 'C:\\Program Files\\nodejs\\npx.cmd']);
  assert.equal(r.file.toLowerCase().endsWith('cmd.exe'), true);
  assert.deepEqual(r.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(r.args[3], '""C:\\Program Files\\nodejs\\npx.cmd" ^^^"-y^^^" ^^^"a^^^ b^^^ ^^^&^^^ c^^^""');
  assert.equal(r.opts.windowsVerbatimArguments, true);
  assert.equal('shell' in r.opts, false);
  // A real .exe and every POSIX binary run directly.
  assert.deepEqual(spawnArgs('rtk', ['x y'], 'win32', () => ['C:\\bin\\rtk.exe']), { file: 'rtk', args: ['x y'], opts: {} });
  assert.deepEqual(spawnArgs('npx', ['x y'], 'linux', () => { throw new Error('not called'); }), { file: 'npx', args: ['x y'], opts: {} });
});

test('#475: tricky arguments reach the child unchanged (a .cmd shim on Windows, a script on POSIX)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean spawn & '));
  const js = path.join(dir, 'echo.js');
  fs.writeFileSync(js, 'console.log(JSON.stringify(process.argv.slice(2)));\n');
  let bin;
  if (process.platform === 'win32') { bin = path.join(dir, 'echo.cmd'); fs.writeFileSync(bin, `@"${process.execPath}" "%~dp0echo.js" %*\r\n`); }
  else { bin = path.join(dir, 'echo'); fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`, { mode: 0o755 }); }
  const r = quiet([bin, ...TRICKY]);
  assert.equal(r.ok, true, r.out);
  assert.deepEqual(JSON.parse(r.out.trim().split(/\r?\n/).pop()), TRICKY);
});

test('#475: no DEP0190 warning from the engine', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--yes', '--dry-run', '--agents', 'claude,opencode-v2', '--all-tools', '--lang', 'en', '--profile', 'none'], { encoding: 'utf8' });
  assert.doesNotMatch(r.stderr, /DEP0190/);
});
