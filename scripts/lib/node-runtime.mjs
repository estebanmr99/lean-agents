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

// True/false for a package's `engines.node`; null when a form is not understood (a pre-release, a URL, `node`), so callers
// never flag a package on a range they cannot read. Covers the forms npm packages use: `>=a[.b[.c]]`, `>`, `<=`, `<`, `=`,
// `^`, `~`, `a.x` wildcards and `||`. Anything else in a clause makes that clause unknown. (#465)
export function meetsEngines(version, range) {
  if (!range) return null;
  const v = String(version).replace(/^v/, '');
  const clause = (text) => {
    let unknown = false;
    let ok = true;
    for (const part of text.trim().replace(/([<>=^~])\s+/g, '$1').split(/\s+/).filter(Boolean)) {
      if (/^[xX*]$/.test(part)) continue;
      const m = /^(>=|<=|>|<|=|\^|~)?v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/.exec(part);
      if (!m) { unknown = true; continue; }
      const op = m[1] ?? '';
      const n = m.slice(2).map((x) => (x === undefined || /^[xX*]$/.test(x) ? null : Number(x)));
      const lo = [n[0], n[1] ?? 0, n[2] ?? 0];
      const d = compare(v, lo);
      let pass;
      if (op === '>=') pass = d >= 0;
      else if (op === '>') pass = d > 0;
      else if (op === '<=') pass = n[1] === null ? compare(v, [n[0] + 1, 0, 0]) < 0 : n[2] === null ? compare(v, [n[0], n[1] + 1, 0]) < 0 : d <= 0;
      else if (op === '<') pass = d < 0;
      else if (op === '=') pass = d === 0;
      else if (op === '^' || op === '~') {
        const hi = op === '~'
          ? (n[1] === null ? [n[0] + 1, 0, 0] : [n[0], n[1] + 1, 0])
          : n[0] > 0 ? [n[0] + 1, 0, 0] : n[1] !== null && n[1] > 0 ? [0, n[1] + 1, 0] : n[2] !== null ? [0, 0, n[2] + 1] : [1, 0, 0];
        pass = d >= 0 && compare(v, hi) < 0;
      } else if (n[1] === null) pass = n[0] === Number(v.split('.')[0]);
      else if (n[2] === null) pass = compare(v, [n[0], n[1], 0]) >= 0 && compare(v, [n[0], n[1] + 1, 0]) < 0;
      else pass = d === 0;
      if (!pass) ok = false;
    }
    return unknown ? null : ok;
  };
  let unknown = false;
  for (const text of String(range).split('||')) {
    const r = clause(text);
    if (r === true) return true;
    if (r === null) unknown = true;
  }
  return unknown ? null : false;
}

// nvm (macOS, Linux) or nvm-windows. `env`/`home` are passed in so tests and --home never read the real machine.
// POSIX: NVM_DIR counts only when it lies inside the target home or the target is the real home; a dev run with --home <temp>
// must never `nvm install` into the owner's nvm, so it uses <home>/.nvm. nvm-windows is only scanned (never installed into), so NVM_HOME is always used.
export function findNvm({ env, home, platform, realHome }) {
  const win = platform === 'win32';
  const inside = env.NVM_DIR && (home === realHome || !path.relative(home, env.NVM_DIR).startsWith('..') && !path.isAbsolute(path.relative(home, env.NVM_DIR)));
  const dir = win ? env.NVM_HOME : inside ? env.NVM_DIR : path.join(home, '.nvm');
  if (!dir || !fs.existsSync(win ? dir : path.join(dir, 'nvm.sh'))) return null;
  return { win, dir };
}

// Every installed Node, lowest first. Layouts: POSIX $NVM_DIR/versions/node/vX/{bin/node,lib/node_modules}, Windows %NVM_HOME%\vX\{node.exe,node_modules}.
export function installedNodes(nvm) {
  const root = nvm.win ? nvm.dir : path.join(nvm.dir, 'versions', 'node');
  if (!fs.existsSync(root)) return [];
  // A folder without its node binary is the rest of a failed install: not a Node to reuse.
  return fs.readdirSync(root).filter((d) => /^v\d+\.\d+\.\d+$/.test(d)).sort(compare).map((d) => nodeAt(nvm, path.join(root, d), d.slice(1))).filter((n) => fs.existsSync(n.node));
}

export function nodeAt(nvm, dir, version) {
  const modules = path.join(dir, nvm.win ? 'node_modules' : path.join('lib', 'node_modules'));
  return { version, dir, node: path.join(dir, nvm.win ? 'node.exe' : path.join('bin', 'node')), pathDir: nvm.win ? dir : path.join(dir, 'bin'), modules, npmCli: path.join(modules, 'npm', 'bin', 'npm-cli.js'), npxCli: path.join(modules, 'npm', 'bin', 'npx-cli.js') };
}

export const nodeSkipLine = (tool, range, found) => `${tool} needs Node ${range}, found ${found}: skipped. Install nvm or Node ${minVersion(range).slice(0, 2).join('.')}+, then run --update.`;

// Fix command for an old Node: nvm use if a fit is installed, else install the major (#392). Full version: nvm-windows needs it.
export function nodeFloorFix(floor, nodes) {
  const fit = [...nodes].reverse().find((n) => satisfies(n.version, floor));
  if (fit) return `nvm use ${fit.version}`;
  return `nvm install ${minVersion(floor)[0]} && nvm use ${minVersion(floor)[0]}`;
}

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

// nvm refuses to work while an npm prefix is set ("nvm is not compatible with the npm_config_prefix environment variable"), and users
// and throwaway HOMEs often set one. Every nvm command runs with both spellings removed (an undefined value drops the variable from the child env).
export const nvmEnv = (nvmDir) => ({ NVM_DIR: nvmDir, npm_config_prefix: undefined, NPM_CONFIG_PREFIX: undefined });

// nvm installs the newest Node of a major and makes the first one `default`; the user's default stays as it was (none before: none after).
export const nvmInstallArgv = (major) => ['bash', '-c',
  `had=0; [ -e "$NVM_DIR/alias/default" ] && had=1; . "$NVM_DIR/nvm.sh" --no-use && nvm install ${Number(major)} && { [ $had = 1 ] || rm -f "$NVM_DIR/alias/default"; }`];

// Newest published Node of a major through nvm (network). LEAN_AGENTS_NVM_REMOTE fakes it for tests, like LEAN_AGENTS_NODE.
export function nvmLatest(nvm, major, { env = process.env, run }) {
  if (env.LEAN_AGENTS_NVM_REMOTE) return env.LEAN_AGENTS_NVM_REMOTE;
  const r = run(['bash', '-c', `. "$NVM_DIR/nvm.sh" --no-use && nvm version-remote ${Number(major)}`], 30000, nvmEnv(nvm.dir));
  const v = r.ok && /v(\d+\.\d+\.\d+)\s*$/.exec(r.out.trim());
  return v ? v[1] : null;
}
