// Undo scope (#157): Bun undo keeps what the user put in ~/.bun, vendor undo refuses a path it did not derive itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bunInstall } from '../scripts/lib/system.mjs';
import { opencodeShared } from '../scripts/lib/adapters/opencode-v2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-undo-scope-')));
const posix = process.platform !== 'win32';
const touch = (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); };
const runUndo = (argv, home) => spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') } });

const bunUndo = (home, platform) => bunInstall(home, path.join(home, 'state'), platform, null, 'x64').undo[0];
const vendorCommand = (home) => {
  const dir = path.join(home, '.config', 'opencode');
  const { commands } = opencodeShared({ home, dir, core: { agents: [] }, profile: {}, opts: { tools: ['i-have-adhd'] }, v2: true });
  return commands[0];
};

for (const platform of ['linux', 'win32']) {
  const exe = platform === 'win32' ? 'bun.exe' : 'bun';
  test(`Bun undo (${platform}) removes only the binary and keeps the user's ~/.bun content`, () => {
    const home = tmp();
    touch(path.join(home, '.bun', 'bin', exe));
    touch(path.join(home, '.bun', 'install', 'cache', 'x'));
    assert.equal(runUndo(bunUndo(home, platform), home).status, 0);
    assert.ok(!fs.existsSync(path.join(home, '.bun', 'bin')));
    assert.ok(fs.existsSync(path.join(home, '.bun', 'install', 'cache', 'x')));
  });

  test(`Bun undo (${platform}) removes the dirs it created once they are empty`, () => {
    const home = tmp();
    touch(path.join(home, '.bun', 'bin', exe));
    assert.equal(runUndo(bunUndo(home, platform), home).status, 0);
    assert.ok(!fs.existsSync(path.join(home, '.bun')));
  });
}

test('Bun undo refuses a hand-edited dir that is not ~/.bun', () => {
  const home = tmp();
  const outside = tmp();
  touch(path.join(outside, 'bin', 'bun'));
  const argv = bunUndo(home, 'linux').slice(0, -1).concat(outside);
  assert.notEqual(runUndo(argv, home).status, 0);
  assert.ok(fs.existsSync(path.join(outside, 'bin', 'bun')));
});

test('vendor undo removes the vendor dir it installed', () => {
  const home = tmp();
  const vendor = path.join(home, '.config', 'opencode', 'vendor', 'i-have-adhd');
  touch(path.join(vendor, 'plugin.mjs'));
  const r = runUndo(vendorCommand(home).undo[0], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(vendor));
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode')));
});

// A real --uninstall with a state.json whose recorded vendor path was edited.
function uninstallWith(home, mutate) {
  const command = vendorCommand(home);
  command.undo[0][command.undo[0].length - 1] = mutate(command.undo[0].at(-1));
  fs.mkdirSync(path.join(home, '.config', 'lean-agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), JSON.stringify({ files: [], commands: [{ desc: command.desc, ok: true, undo: command.undo }] }));
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--uninstall', '--yes'], { encoding: 'utf8' });
}

test('--uninstall refuses a hand-edited vendor path outside home', () => {
  const home = tmp();
  const outside = tmp();
  touch(path.join(outside, 'keep.txt'));
  touch(path.join(home, '.config', 'opencode', 'vendor', 'i-have-adhd', 'plugin.mjs'));
  const r = uninstallWith(home, () => outside);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /refusing to remove/);
  assert.ok(fs.existsSync(path.join(outside, 'keep.txt')));
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'vendor', 'i-have-adhd', 'plugin.mjs')));
});

test('--uninstall refuses a vendor dir that is a symlink out of home', { skip: !posix }, () => {
  const home = tmp();
  const outside = tmp();
  touch(path.join(outside, 'keep.txt'));
  const vendor = path.join(home, '.config', 'opencode', 'vendor', 'i-have-adhd');
  fs.mkdirSync(path.dirname(vendor), { recursive: true });
  fs.symlinkSync(outside, vendor);
  const r = uninstallWith(home, (v) => v);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /refusing to remove/);
  assert.ok(fs.existsSync(path.join(outside, 'keep.txt')));
});

test('--uninstall removes the vendor dir at the path it installed', () => {
  const home = tmp();
  const vendor = path.join(home, '.config', 'opencode', 'vendor', 'i-have-adhd');
  touch(path.join(vendor, 'plugin.mjs'));
  const r = uninstallWith(home, (v) => v);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(vendor));
});
