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
  return { toolNode: null, skipped: failing.map(([k, p]) => ({ tool: k, line: nodeSkipLine(k, p.node, active) })) };
}

// `env` for a command that must find this Node first: its folder leads PATH (npm starts package bins with the first `node` on PATH).
export function toolEnv(toolNode, penv = process.env, platform = process.platform) {
  const key = platform === 'win32' ? Object.keys(penv).find((k) => k.toUpperCase() === 'PATH') ?? 'Path' : 'PATH';
  return { [key]: [toolNode.pathDir, penv[key]].filter(Boolean).join(platform === 'win32' ? ';' : ':') };
}

// nvm installs the newest Node of a major and makes the first one `default`; the user's default stays as it was (none before: none after).
export const nvmInstallArgv = (major) => ['bash', '-c',
  `had=0; [ -e "$NVM_DIR/alias/default" ] && had=1; . "$NVM_DIR/nvm.sh" --no-use && nvm install ${Number(major)} && { [ $had = 1 ] || rm -f "$NVM_DIR/alias/default"; }`];

// Newest published Node of a major through nvm (network). LEAN_AGENTS_NVM_REMOTE fakes it for tests, like LEAN_AGENTS_NODE.
export function nvmLatest(nvm, major, { env = process.env, run }) {
  if (env.LEAN_AGENTS_NVM_REMOTE) return env.LEAN_AGENTS_NVM_REMOTE;
  const r = run(['bash', '-c', `. "$NVM_DIR/nvm.sh" --no-use && nvm version-remote ${Number(major)}`], 30000, { NVM_DIR: nvm.dir });
  const v = r.ok && /v(\d+\.\d+\.\d+)\s*$/.exec(r.out.trim());
  return v ? v[1] : null;
}
