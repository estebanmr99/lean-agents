// RTK plugin only for OpenCode 1.x: rtk writes a 1.x plugin that OpenCode 2 refuses to load (#179). Temp HOME, dry run.
import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lean(home, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}

test('opencode-v1 adapter installs the RTK plugin, but opencode-v2 does not (#179)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));

  const out1 = lean(home, ['--dry-run', '--yes', '--no-exec', '--agents', 'opencode-v1', '--tools', 'rtk']);
  assert.match(out1, /rtk init -g --opencode/);

  const out2 = lean(home, ['--dry-run', '--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'rtk']);
  assert.ok(!out2.includes('rtk init -g --opencode'), 'opencode-v2 should not install the 1.x RTK plugin');
});
