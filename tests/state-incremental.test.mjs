// state.json is written as the engine applies, so a mid-run failure still leaves a state --uninstall can undo (#158).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.LEAN_AGENTS_NODE ??= '24.22.2';
const posix = process.platform !== 'win32';

const tmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));
const lean = (home, args, env = process.env) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env });
const state = (home) => JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
const walk = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
// Everything except lean-agents' own state dir (state, backups).
const leftovers = (home) => walk(home).filter((f) => !f.startsWith(path.join(home, '.config', 'lean-agents')));

test('a write error mid-apply leaves a state.json that --uninstall can fully undo', { skip: !posix || process.getuid?.() === 0 }, () => {
  const home = tmp('lean-state-');
  // A read-only dir makes a later write throw EACCES after the Claude files are already written.
  const locked = path.join(home, '.config', 'opencode');
  fs.mkdirSync(locked, { recursive: true });
  fs.chmodSync(locked, 0o555);
  try {
    const r = lean(home, ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--no-tools', '--lang', 'en', '--profile', 'none']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /EACCES/);
  } finally { fs.chmodSync(locked, 0o755); }
  const written = leftovers(home);
  assert.ok(written.length > 0, 'something was written before the error');
  const listed = state(home).files.map((f) => f.path);
  for (const f of written) assert.ok(listed.includes(f), `state.json lists ${f}`);

  const u = lean(home, ['--uninstall', '--yes', '--no-exec']);
  assert.equal(u.status, 0, u.stderr || u.stdout);
  assert.deepEqual(leftovers(home), []);
});

test('a failing command still leaves state.json with the applied files, and a re-run merges into it', { skip: !posix }, () => {
  const home = tmp('lean-state-');
  const bin = tmp('lean-bin-');
  // claude fails (the Context Mode plugin step is not optional); rtk is a no-op so no host tool runs.
  for (const [cmd, code] of [['claude', 1], ['npx', 1], ['rtk', 0]]) fs.writeFileSync(path.join(bin, cmd), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const args = ['--yes', '--agents', 'claude', '--tools', 'context-mode', '--no-gh', '--no-bun', '--lang', 'en', '--profile', 'none'];
  const first = lean(home, args, env);
  assert.equal(first.status, 1, first.stderr);
  const s = state(home);
  assert.ok(s.files.length > 0, 'applied files are recorded');
  assert.ok(s.commands.some((c) => !c.ok), 'the failed command is recorded');

  const again = lean(home, args, env);
  assert.equal(again.status, 1, again.stderr);
  const s2 = state(home);
  assert.equal(s2.installedAt, s.installedAt);
  assert.equal(new Set(s2.commands.map((c) => c.desc)).size, s2.commands.length, 'a re-run replaces earlier command records');
});
