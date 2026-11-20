// User files change only through the fsops action kinds (file, json, block), so --uninstall can undo them (#305 S1).
// Adapters return { actions, commands } and never write. Every other direct write or delete is counted per file:
// a new one fails here until it goes through fsops, or is added below with the reason it cannot.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = /\b(?:fs|fsx)\.(?:writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|copyFileSync|cpSync|symlinkSync)\(|require\('fs'\)/g;

const ALLOWED = {
  'scripts/lib/fsops.mjs': 8, // the action kinds themselves
  'scripts/lean.mjs': 1, // removes its own scratch HOME after probing versions
  'scripts/lib/adapters/opencode-v2.mjs': 1, // inside the vendor undo script, guarded by unsafe()
  'scripts/lib/adopt.mjs': 10, // --adopt --yes: backup first, automatic undo on failure, --adopt --undo restores
  'scripts/lib/agent-lifecycle.mjs': 3, // removes the files it recorded, only while their sha256 still matches; downloaded installers
  'scripts/lib/copilot-usage.mjs': 2, // its own status-line cache file
  'scripts/lib/opencode-backup.mjs': 10, // frozen session backups lean-agents owns
  'scripts/lib/opencode-upgrade.mjs': 5, // the guided upgrade, with its own undo and rollback
  'scripts/lib/opencode1.mjs': 6, // the opencode1 side-by-side binary lean-agents installs
  'scripts/lib/parallel.mjs': 6, // its own worker state and logs under the lean-agents state dir
  'scripts/lib/plugin-health.mjs': 3, // copies config into a temp XDG dir to probe plugins, then removes it
  'scripts/lib/prereqs.mjs': 2, // inside a node -e undo script
  'scripts/lib/system.mjs': 1, // inside the Bun undo script
  'scripts/lib/verify-commit.mjs': 1, // its own temp clone
  'scripts/lib/verify-sha256.mjs': 1, // deletes a download that fails its sha256
};

function files(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? files(rel) : rel.endsWith('.mjs') ? [rel] : [];
  });
}

test('install and undo code writes user files only through the fsops action kinds (#305)', () => {
  const found = {};
  for (const f of ['scripts/lean.mjs', ...files('scripts/lib')]) {
    const n = (fs.readFileSync(path.join(ROOT, f), 'utf8').match(WRITE) ?? []).length;
    if (n) found[f] = n;
  }
  const hint = 'use a file, json or block action from scripts/lib/fsops.mjs; if it cannot be one, update ALLOWED with the reason';
  for (const [f, n] of Object.entries(found)) assert.ok(n <= (ALLOWED[f] ?? 0), `${f}: ${n} direct write or delete calls, ${ALLOWED[f] ?? 0} allowed: ${hint}`);
  for (const [f, n] of Object.entries(ALLOWED)) assert.equal(found[f] ?? 0, n, `${f}: now ${found[f] ?? 0}, lower ALLOWED to match`);
});
