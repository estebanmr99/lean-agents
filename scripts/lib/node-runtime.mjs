// Which Node runs each tool. A tool whose `engines.node` (core/pins.json `node`) the active Node fails gets an installed
// Node of its own, found through nvm, and an absolute command; without nvm it is skipped with one line (#44, #104).

import fs from 'node:fs';
import path from 'node:path';

// shortcut: only ">=a[.b[.c]]" ranges, which every pinned tool uses today; verify-pins keeps the pins honest. Anything else throws.
export function minVersion(range) {
  const m = /^>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(range).trim());
  if (!m) throw new Error(`unsupported node range "${range}" (only >=a.b.c)`);
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

const parse = (v) => String(v).replace(/^v/, '').split('.').map(Number);
export function compare(a, b) {
  const [x, y] = [Array.isArray(a) ? a : parse(a), Array.isArray(b) ? b : parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

// True when `version` ("22.20.0" or "v22.20.0") meets `range`; a missing range accepts every Node.
export const satisfies = (version, range) => !range || compare(version, minVersion(range)) >= 0;

// nvm (macOS, Linux) or nvm-windows. `env`/`home` are passed in so tests and --home never read the real machine.
export function findNvm({ env, home, platform }) {
  const win = platform === 'win32';
  const dir = win ? env.NVM_HOME : env.NVM_DIR || path.join(home, '.nvm');
  if (!dir || !fs.existsSync(win ? dir : path.join(dir, 'nvm.sh'))) return null;
  return { win, dir };
}

// Every installed Node, lowest first. Layouts: POSIX $NVM_DIR/versions/node/vX/{bin/node,lib/node_modules}, Windows %NVM_HOME%\vX\{node.exe,node_modules}.
export function installedNodes(nvm) {
  const root = nvm.win ? nvm.dir : path.join(nvm.dir, 'versions', 'node');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((d) => /^v\d+\.\d+\.\d+$/.test(d)).sort(compare).map((d) => nodeAt(nvm, path.join(root, d), d.slice(1)));
}

export function nodeAt(nvm, dir, version) {
  const modules = path.join(dir, nvm.win ? 'node_modules' : path.join('lib', 'node_modules'));
  return { version, dir, node: path.join(dir, nvm.win ? 'node.exe' : path.join('bin', 'node')), pathDir: nvm.win ? dir : path.join(dir, 'bin'), modules, npmCli: path.join(modules, 'npm', 'bin', 'npm-cli.js'), npxCli: path.join(modules, 'npm', 'bin', 'npx-cli.js') };
}

export const nodeSkipLine = (tool, range, found) => `${tool} needs Node ${range}, found ${found}: skipped. Install nvm or Node ${minVersion(range).slice(0, 2).join('.')}+, then run --update.`;

// Pins in use whose range the active Node fails -> { toolNode, skipped }. `pins`: { key: { node } } already filtered to the
// ones in use. `toolNode` is null when none fails or nothing can run them. All failing pins share one Node, the one for the highest floor.
// A Node that is not installed yet gets `install` (the major) and the version `latest(major)` reports, so configs can name its path.
export function resolveToolNodes({ pins, active, nvm, latest }) {
  const failing = Object.entries(pins).filter(([, p]) => !satisfies(active, p.node));
  if (!failing.length) return { toolNode: null, skipped: [] };
  const floor = failing.map(([, p]) => minVersion(p.node)).sort(compare).at(-1);
  const range = `>=${floor.join('.')}`;
  const have = nvm && installedNodes(nvm).find((n) => satisfies(n.version, range));
  if (have) return { toolNode: have, tools: failing.map(([k]) => k), skipped: [] };
  const version = nvm && !nvm.win && latest?.(floor[0]);
  if (version && satisfies(version, range)) return { toolNode: { ...nodeAt(nvm, path.join(nvm.dir, 'versions', 'node', `v${version}`), version), install: floor[0] }, tools: failing.map(([k]) => k), skipped: [] };
  return { toolNode: null, skipped: failing.map(([k, p]) => ({ key: k, line: nodeSkipLine(k, p.node, active) })) };
}
