// Orca status shim for OpenCode 1.x (#78) and the Orca NO_PROXY / Ctrl+P notes. Temp HOME, no external commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stillNeeded } from '../scripts/lib/terminals.mjs';
import { orcaShimActions } from '../scripts/lib/adapters/opencode-v1.mjs';

const lean = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lean.mjs');
const shimOf = (h) => path.join(h, '.config', 'opencode', 'plugins', 'lean-orca-status-shim.js');

function run(home, args) {
  const r = spawnSync(process.execPath, [lean, '--home', home, '--yes', '--no-exec', '--no-tools', ...args], { encoding: 'utf8', env: { ...process.env, XDG_CONFIG_HOME: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-orca-shim-'));

test('shim actions: Windows with Orca only', () => {
  const dir = '/cfg/opencode';
  const [a, ...rest] = orcaShimActions({ dir, terminals: ['orca'], platform: 'win32' });
  assert.equal(rest.length, 0);
  assert.equal(a.kind, 'file');
  assert.equal(a.path, path.join(dir, 'plugins', 'lean-orca-status-shim.js'));
  assert.match(a.content, /managed by lean-agents/);
  assert.match(a.content, /Bun\.isMainThread/);
  assert.match(a.content, /orca-opencode-status\.js/);
  assert.deepEqual(orcaShimActions({ dir, terminals: ['orca'], platform: 'linux' }), [], 'Linux would run the plugin twice');
  assert.deepEqual(orcaShimActions({ dir, terminals: ['orca'], platform: 'darwin' }), []);
  assert.deepEqual(orcaShimActions({ dir, terminals: ['warp'], platform: 'win32' }), [], 'no Orca, no shim');
  assert.deepEqual(orcaShimActions({ dir, terminals: undefined, platform: 'win32' }), []);
});

test('shim: the installer writes it on Windows only, never for 2.x, and --uninstall removes it', () => {
  const win = process.platform === 'win32';
  const v1 = fresh();
  run(v1, ['--agents', 'opencode-v1', '--terminal', 'orca']);
  assert.equal(fs.existsSync(shimOf(v1)), win);

  const v2 = fresh();
  run(v2, ['--agents', 'opencode-v2', '--terminal', 'orca']);
  assert.equal(fs.existsSync(shimOf(v2)), false, 'never for 2.x');

  run(v1, ['--uninstall']);
  assert.equal(fs.existsSync(shimOf(v1)), false, 'uninstall removes it');
});

test('shim: a user file with the same name is not overwritten', () => {
  const h = fresh();
  fs.mkdirSync(path.dirname(shimOf(h)), { recursive: true });
  fs.writeFileSync(shimOf(h), '// mine\n');
  run(h, ['--agents', 'opencode-v1', '--terminal', 'orca']);
  assert.equal(fs.readFileSync(shimOf(h), 'utf8'), '// mine\n');
});

test('doctor note: Windows with a proxy asks for loopback in NO_PROXY and an Orca restart; Ctrl+P rebind listed', () => {
  const args = { home: '/nonexistent-lean-home', terminals: ['orca'], agents: ['opencode-v1'], platform: 'win32', exec: true, env: { HTTPS_PROXY: 'http://proxy.invalid:8080' } };
  const find = (items) => items.find((t) => /NO_PROXY/.test(t.text));
  const bad = find(stillNeeded({ ...args, readEnv: () => 'corp.invalid' }));
  assert.match(bad.text, /restart/i);
  assert.equal(bad.check(), false, 'loopback missing');
  assert.equal(find(stillNeeded({ ...args, readEnv: () => 'localhost,127.0.0.1,::1' })).check(), true);
  assert.equal(find(stillNeeded({ ...args, exec: false })).check, undefined, 'no PowerShell call without exec');
  assert.equal(find(stillNeeded({ ...args, env: {} })), undefined, 'no proxy, no note');
  assert.equal(find(stillNeeded({ ...args, platform: 'linux' })), undefined, 'Windows only');
  assert.ok(stillNeeded(args).some((t) => t.text.includes('"worktree.quickOpen":["Ctrl+Shift+P"]')));
});
