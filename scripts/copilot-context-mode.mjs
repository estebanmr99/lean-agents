// Registers Context Mode 2 with Copilot CLI. Its `setup` is a silent no-op for Copilot (plugin install
// "does not work yet", upstream docs/install/copilot-cli.md), so this runs the manual step from
// `context-mode setup --print copilot-cli`. The server path depends on where npm put the global package.
import fs from 'node:fs';
import path from 'node:path';
import { which, spawnFor } from './lib/system.mjs';

const listed = spawnFor(['copilot', 'mcp', 'list', '--json'], { encoding: 'utf8' });
// An entry lean-agents wrote (absolute Node plus the package's server.mjs, or an old npx form) without --agent is
// replaced. Anything else is the user's own entry and stays.
const ours = (argv) => {
  const [cmd, ...args] = argv;
  if (/(^|[\\/])(node|node\.exe)$/i.test(cmd ?? '') && /[\\/]context-mode[\\/]server\.mjs$/.test(args[0] ?? '')) return true;
  return /(^|[\\/])npx(\.cmd)?$/i.test(cmd ?? '') && args.includes('server') && args.some((a) => /^context-mode(@\d+\.\d+\.\d+)?$/.test(a));
};
if (listed.status === 0 && listed.stdout.includes('"context-mode"')) {
  let entry;
  try { entry = JSON.parse(listed.stdout).mcpServers?.['context-mode']; } catch { /* unparseable: keep the old safe default */ }
  if (entry) {
    const argv = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].filter((a) => a != null).map(String);
    if (argv.includes('--agent')) {
      console.log('context-mode is already registered with Copilot CLI, left alone');
      process.exit(0);
    }
    if (ours(argv)) {
      const removed = spawnFor(['copilot', 'mcp', 'remove', 'context-mode'], { stdio: 'inherit' });
      if (removed.status !== 0) process.exit(removed.status ?? 1);
    } else {
      console.log('Kept your existing Context Mode entry: it has different args. Add --agent copilot-cli to it, or remove it and run lean-agents --update.');
      process.exit(0);
    }
  } else {
    console.log('context-mode is already registered with Copilot CLI, left alone');
    process.exit(0);
  }
}

// The command npm linked is the ground truth for the prefix: a symlink into the package on Unix, a shim next
// to node_modules on Windows. `npm root -g` is only the fallback, since it recomputes the prefix.
const candidates = [];
const linked = process.env.LEAN_CONTEXT_MODE_DIR ? null : which('context-mode');
const bin = linked && path.isAbsolute(linked) ? linked : null; // shortcut: dash's `command -v` can answer relative for an empty PATH entry (macOS sh answers absolute, so untested here)
if (process.env.LEAN_CONTEXT_MODE_DIR) candidates.push(process.env.LEAN_CONTEXT_MODE_DIR); // set by lean-agents: the package lives in the tool Node's own prefix
if (bin) candidates.push(path.dirname(fs.realpathSync(bin)), path.join(path.dirname(bin), 'node_modules', 'context-mode'));
const root = process.env.LEAN_CONTEXT_MODE_DIR ? '' : (spawnFor(['npm', 'root', '-g'], { encoding: 'utf8' }).stdout ?? '').trim();
if (path.isAbsolute(root)) candidates.push(path.join(root, 'context-mode')); // a failed npm gives '', which would mean ./context-mode
const dir = candidates.find((d) => fs.existsSync(path.join(d, 'server.mjs')));
// The prerequisite step skips the install when any context-mode (for example 1.x) is already on PATH.
if (!dir) {
  console.error(`context-mode 2 not found under npm root -g (looked in: ${candidates.join('; ')}); run npm i -g context-mode@2.1.4`);
  process.exit(1);
}
const r = spawnFor(['copilot', 'mcp', 'add', 'context-mode', '--', process.execPath, path.join(dir, 'server.mjs'), '--agent', 'copilot-cli'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
