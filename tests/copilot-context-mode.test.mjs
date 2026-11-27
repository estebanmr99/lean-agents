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

