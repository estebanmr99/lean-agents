// The Copilot context-mode helper never registers a context-mode copy found relative to the cwd (1.2.3 audit).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'copilot-context-mode.mjs');
const skip = process.platform === 'win32' && 'POSIX stub';

// files: paths under the cwd to create (an entry ending in '*' is an executable). Runs the helper with only a fake copilot.
function run(t, files, pathFor) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-cwd-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bin-'));
  t.after(() => { fs.rmSync(cwd, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); });
  for (const f of files) {
    const at = path.join(cwd, f.replace(/\*$/, ''));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, f.endsWith('*') ? '#!/bin/sh\n' : '', { mode: f.endsWith('*') ? 0o755 : 0o644 });
  }
  const log = path.join(bin, 'calls');
  fs.writeFileSync(path.join(bin, 'copilot'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8', env: { PATH: pathFor(bin), HOME: cwd } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', /mcp add/);
}

test('npm missing: a ./context-mode/server.mjs in the cwd is not registered', { skip }, (t) =>
  run(t, ['context-mode/server.mjs'], (bin) => bin));

// The real `copilot mcp list --json` reads mcp-config.json, so the stub does too.
function update(t, entry) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-update-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-bin-'));
  const pkg = path.join(home, 'pkg');
  t.after(() => { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(bin, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
  fs.mkdirSync(pkg);
  fs.writeFileSync(path.join(pkg, 'server.mjs'), '');
  fs.writeFileSync(path.join(home, '.copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { 'context-mode': entry } }));
  const log = path.join(bin, 'calls');
  fs.writeFileSync(path.join(bin, 'copilot'), `#!/bin/sh\nif [ "$1" = mcp ] && [ "$2" = list ]; then cat "$HOME/.copilot/mcp-config.json"; exit 0; fi\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: home, LEAN_CONTEXT_MODE_DIR: pkg } });
  return { r, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

test('an old lean-agents entry without --agent is removed and re-added with --agent', { skip }, (t) => {
  const { r, calls } = update(t, { type: 'local', command: process.execPath, args: [path.join('x', 'context-mode', 'server.mjs')] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(calls, /mcp remove context-mode/);
  assert.match(calls, /mcp add context-mode -- .* --agent copilot-cli/);
  assert.ok(calls.indexOf('mcp remove') < calls.indexOf('mcp add'), 'remove first');
});

test('a context-mode entry the user wrote differently is left alone', { skip }, (t) => {
  const { r, calls } = update(t, { type: 'local', command: 'my-own-ctx', args: [] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(calls, '');
  assert.match(r.stdout, /Kept your existing Context Mode entry: it has different args/);
});

test('a context-mode entry that already has --agent is left alone', { skip }, (t) => {
  const { r, calls } = update(t, { type: 'local', command: process.execPath, args: [path.join('x', 'context-mode', 'server.mjs'), '--agent', 'copilot-cli'] });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(calls, '');
});

