// #592: --doctor and --update leave no OpenCode 2 service running that they started. POSIX shell stubs (opencode, ps, npx):
// any opencode subcommand but --version and `service stop` starts the service with a new pid, as auto-start does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAN = path.join(ROOT, 'scripts', 'lean.mjs');
const posix = { skip: process.platform === 'win32' && 'POSIX shell stubs, as in opencode-service-run.test.mjs' };

// Shell builtins only: the test PATH holds the stubs and node, not dirname, cat or rm. The service runs while bin/running
// is non-empty; starting it writes this shell pid (new on every start), stopping it empties the file.
const OPENCODE = `#!/bin/sh
D=\${0%/*}
echo "$*" >> "$D/argv.log"
case "$*" in
  --version) echo 2.2.7 ;;
  "service stop") : > "$D/running" ;;
  *) [ -s "$D/running" ] || echo $$ > "$D/running" ;;
esac
exit 0
`;
const PS = `#!/bin/sh
D=\${0%/*}
[ -s "$D/running" ] || exit 0
read -r PID < "$D/running"
case "$*" in *pid=*) echo "  $PID opencode" ;; *) echo opencode ;; esac
exit 0
`;
const NPX = '#!/bin/sh\nexit 0\n';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-service-doctor-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const [name, body] of [['opencode', OPENCODE], ['ps', PS], ['npx', NPX]]) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const env = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`, HOME: home };
  if (process.env.NVM_DIR) env.NVM_DIR = process.env.NVM_DIR;
  const lean = (args) => spawnSync(process.execPath, [LEAN, '--home', home, ...args], { encoding: 'utf8', env, input: '' });
  // A saved OpenCode 2 setup without tools (no git clone, no network), installed without running any command.
  const setup = () => {
    const r = lean(['--yes', '--no-exec', '--no-core', '--no-tools', '--lang', 'en', '--profile', 'none', '--agents', 'opencode-v2']);
    assert.equal(r.status, 0, r.stderr);
  };
  const log = () => (fs.existsSync(path.join(bin, 'argv.log')) ? fs.readFileSync(path.join(bin, 'argv.log'), 'utf8') : '');
  return { lean, setup, log, running: () => (fs.existsSync(path.join(bin, 'running')) ? fs.readFileSync(path.join(bin, 'running'), 'utf8').trim() : ''), start: (pid) => fs.writeFileSync(path.join(bin, 'running'), `${pid}\n`) };
}

test('--doctor stops the service its own probe started', posix, () => {
  const f = fixture();
  f.setup();
  f.lean(['--doctor', '--json']);
  assert.match(f.log(), /^debug config$/m);
  assert.match(f.log(), /^service stop$/m);
  assert.equal(f.running(), '', 'the service the doctor started is still running');
});

test('--doctor keeps a service the user started', posix, () => {
  const f = fixture();
  f.setup();
  f.start(4242);
  f.lean(['--doctor', '--json']);
  assert.match(f.log(), /^debug config$/m);
  assert.doesNotMatch(f.log(), /^service stop$/m);
  assert.equal(f.running(), '4242');
});

test('--update leaves no service running that its run started', posix, () => {
  const f = fixture();
  f.setup();
  f.lean(['--update', '--yes']);
  assert.match(f.log(), /^debug config$/m, 'the update summary probe should start the service in this stub');
  assert.equal(f.running(), '', 'the service the update started is still running');
});
