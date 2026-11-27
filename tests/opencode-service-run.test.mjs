// #548: a real run that starts the OpenCode 2 service stops it, and --json keeps stdout to the one JSON object.
// POSIX shell stubs (ps, opencode, npx); the engine never reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAN = path.join(ROOT, 'scripts', 'lean.mjs');
const posix = { skip: process.platform === 'win32' && 'POSIX shell stubs; real-opencode covers Windows service stop' };

// `ps -A -o comm=` (names) says no opencode first; every later call (pid=,comm= for the service check) says pid 42.
const PS = `#!/bin/sh
n=0
[ -f "$PS_COUNTER" ] && read -r n < "$PS_COUNTER"
echo $((n+1)) > "$PS_COUNTER"
if [ "$n" -ge 1 ]; then
  case "$*" in *pid=*) echo "   42 opencode" ;; *) echo opencode ;; esac
fi
`;
const OPENCODE = `#!/bin/sh
echo "$*" >> "$OPENCODE_LOG"
[ "$1" = --version ] && echo 2.2.7
exit 0
`;
const NPX = '#!/bin/sh\nexit 0\n';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-service-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [name, body] of [['ps', PS], ['opencode', OPENCODE], ['npx', NPX]]) {
    const file = path.join(bin, name);
    fs.writeFileSync(file, body, { mode: 0o755 });
  }
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const env = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, HOME: home, PS_COUNTER: path.join(dir, 'ps.count'), OPENCODE_LOG: path.join(dir, 'opencode.log') };
  if (process.env.NVM_DIR) env.NVM_DIR = process.env.NVM_DIR;
  const lean = (args) => spawnSync(process.execPath, [LEAN, '--home', home, ...args], { encoding: 'utf8', env, input: '' });
  return { dir, home, lean, log: () => (fs.existsSync(env.OPENCODE_LOG) ? fs.readFileSync(env.OPENCODE_LOG, 'utf8') : '') };
}

test('--json --yes: stdout is one JSON object and the stop lines go to stderr', posix, () => {
  const f = fixture();
  const r = f.lean(['--yes', '--json', '--agents', 'opencode-v2', '--no-core', '--no-tools', '--lang', 'en', '--profile', 'none']);
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, true);
  assert.doesNotMatch(r.stdout, /background service/);
  assert.match(r.stderr, /- stop the OpenCode 2 background service that lean-agents started/);
  assert.match(r.stderr, /lean-agents stopped the OpenCode 2 background service its commands started/);
  assert.match(f.log(), /^service stop$/m);
});

test('a thrown error mid-run still stops the service this run started', posix, () => {
  const f = fixture();
  // An existing OpenCode config makes apply write a backup; a file where the backups folder goes makes that throw.
  fs.mkdirSync(path.join(f.home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.config', 'opencode', 'opencode.jsonc'), '{}\n');
  fs.mkdirSync(path.join(f.home, '.config', 'lean-agents'));
  fs.writeFileSync(path.join(f.home, '.config', 'lean-agents', 'backups'), 'blocker\n');
  const r = f.lean(['--yes', '--json', '--agents', 'opencode-v2', '--no-core', '--no-tools', '--lang', 'en', '--profile', 'none']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ENOTDIR|not a directory/);
  assert.match(f.log(), /^service stop$/m);
});