// Registers Context Mode 2 with Copilot CLI. Its `setup` is a silent no-op for Copilot (plugin install
// "does not work yet", upstream docs/install/copilot-cli.md), so this runs the manual step from
// `context-mode setup --print copilot-cli`. The server path depends on where npm put the global package.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { which } from './lib/system.mjs';

const shell = process.platform === 'win32';
const q = (a) => (shell ? `"${a}"` : a);

// shortcut: any "context-mode" entry counts as ours, so a hand-made one is kept; the undo (`copilot mcp remove`) still removes it. Compare paths if that ever matters.
const listed = spawnSync('copilot', ['mcp', 'list', '--json'], { encoding: 'utf8', shell });
if (listed.status === 0 && listed.stdout.includes('"context-mode"')) {
  console.log('context-mode is already registered with Copilot CLI, left alone');
  process.exit(0);
}

// The command npm linked is the ground truth for the prefix: a symlink into the package on Unix, a shim next
// to node_modules on Windows. `npm root -g` is only the fallback, since it recomputes the prefix.
const candidates = [];
const bin = which('context-mode');
if (bin) candidates.push(path.dirname(fs.realpathSync(bin)), path.join(path.dirname(bin), 'node_modules', 'context-mode'));
candidates.push(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell }).trim(), 'context-mode'));
const dir = candidates.find((d) => fs.existsSync(path.join(d, 'server.mjs')));
// The prerequisite step skips the install when any context-mode (for example 1.x) is already on PATH.
if (!dir) {
  console.error(`context-mode 2 not found under npm root -g (looked in: ${candidates.join('; ')}); run npm i -g context-mode@2.1.4`);
  process.exit(1);
}
const r = spawnSync('copilot', ['mcp', 'add', 'context-mode', '--', process.execPath, path.join(dir, 'server.mjs'), '--agent', 'copilot-cli'].map(q), { stdio: 'inherit', shell });
process.exit(r.status ?? 1);
