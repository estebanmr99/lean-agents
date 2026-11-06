// Registers Context Mode 2 with Copilot CLI. Its `setup` is a silent no-op for Copilot (plugin install
// "does not work yet", upstream docs/install/copilot-cli.md), so this runs the manual step from
// `context-mode setup --print copilot-cli`. The server path depends on where npm put the global package.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const shell = process.platform === 'win32';
const q = (a) => (shell ? `"${a}"` : a);
const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell }).trim();
const server = path.join(root, 'context-mode', 'server.mjs');
const r = spawnSync('copilot', ['mcp', 'add', 'context-mode', '--', process.execPath, server, '--agent', 'copilot-cli'].map(q), { stdio: 'inherit', shell });
process.exit(r.status ?? 1);
