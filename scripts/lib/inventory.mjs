// Read-only inventory of what is already on the machine: which Node runs each registered MCP command, which
// pinned npm packages sit in which nvm Node, and which skill folders are read twice. Never writes; `home`, `env`,
// `platform` and `fsx` are passed in so tests never read the real machine (#104 points 4-5, #132).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PINS } from './pins.mjs';
import { configHome, envDir } from './system.mjs';
import { configPath } from './adapters/opencode-v2.mjs';
import { vscodeUserDir } from './adapters/vscode-copilot.mjs';
import { mcpServers } from './migrate.mjs';
import { installedNodes, satisfies } from './node-runtime.mjs';

const j = path.join;

// Files that hold MCP servers per client, as { client, file, keyPath }. Same `~` paths on every OS (proven for Windows by #78).
// shortcut: MCP files only; hooks, plugins and OpenCode data come with --adopt. OpenCode 1.x keeps servers under `mcp`, 2.x under `mcp.servers`.
export function clients(home) {
  const oc = configPath(j(configHome(home), 'opencode'));
  const code = vscodeUserDir(home);
  const insiders = j(path.dirname(path.dirname(code)), 'Code - Insiders', 'User');
  return [
    { client: 'claude', file: j(home, '.claude.json'), keyPath: ['mcpServers'] },
    { client: 'cursor', file: j(home, '.cursor', 'mcp.json'), keyPath: ['mcpServers'] },
    { client: 'vscode', file: j(code, 'mcp.json'), keyPath: ['servers'] },
    { client: 'vscode-insiders', file: j(insiders, 'mcp.json'), keyPath: ['servers'] }, // VERIFY: user dir
    { client: 'opencode', file: oc, keyPath: ['mcp'] },
    { client: 'opencode', file: oc, keyPath: ['mcp', 'servers'] },
    { client: 'copilot-cli', file: j(envDir(home, 'COPILOT_HOME', j(home, '.copilot')), 'mcp-config.json'), keyPath: ['mcpServers'] },
  ];
}

const VERSION_DIR = /[\\/]v(\d+\.\d+\.\d+)(?=[\\/])/;

// How one registered command picks its Node.
// style: absolute (full path to node) · symlink (an nvm "current" link that moves with `nvm use`) · path (bare `node`, first on PATH)
// · npx-path (bare `npx`, which runs the first `node` on PATH) · npx-absolute (full path to npx) · bun · other.
// node: the binary that will run, or null. nodeVersion: from the vX.Y.Z folder in its path (or its real path), else null.
export function launchOf(argv, { env = process.env, platform = process.platform, fsx = fs } = {}) {
  const win = platform === 'win32';
  const P = win ? path.win32 : path.posix;
  const cmd = argv[0] ?? '';
  const base = P.basename(cmd).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  const exists = (p) => { try { return fsx.existsSync(p); } catch { return false; } };
  const real = (p) => { try { return fsx.realpathSync(p); } catch { return p; } };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const onPath = () => (env[key] ?? '').split(win ? ';' : ':').filter(Boolean).map((d) => P.join(d, win ? 'node.exe' : 'node')).find(exists) ?? null;
  const links = win ? [env.NVM_SYMLINK ?? 'C:\\nodejs'] : env.NVM_DIR ? [P.join(env.NVM_DIR, 'current'), P.join(env.NVM_DIR, 'alias')] : [];
  // Only nvm's own links move with `nvm use`; any other link (Homebrew's /opt/homebrew/bin/node) is a fixed path whose real path gives the version.
  const isLink = (p) => links.some((l) => (win ? p.toLowerCase().startsWith(l.toLowerCase()) : p.startsWith(l)));
  const versionOf = (p) => (VERSION_DIR.exec(p) ?? VERSION_DIR.exec(real(p)))?.[1] ?? null;
  const out = (style, node) => ({ style, node, nodeVersion: node ? versionOf(node) : null });

  if (!cmd) return out('url', null);
  if (base === 'node') return P.isAbsolute(cmd) ? out(isLink(cmd) ? 'symlink' : 'absolute', cmd) : out('path', onPath());
  if (base === 'npx') {
    if (!P.isAbsolute(cmd)) return out('npx-path', onPath());
    // npx.cmd (Windows) runs the node.exe beside it; the POSIX npx script runs the first `node` on PATH.
    const beside = win ? P.join(P.dirname(cmd), 'node.exe') : null;
    const node = beside && exists(beside) ? beside : onPath();
    return out(win && node === beside && isLink(beside) ? 'symlink' : 'npx-absolute', node);
  }
  if (base === 'bun' || base === 'bunx') return out('bun', null);
  return out('other', null);
}

// The npm pin an MCP command runs (key in core/pins.json), or null for a server of the user's own.
// Only pins with an `engines.node` range matter here; matching is by package name as a whole word.
export function pinOf(argv) {
  for (const [key, p] of Object.entries(PINS)) {
    if (p.kind !== 'npm' || !p.node || p.ciOnly || key === 'skills-cli') continue;
    const re = new RegExp(`(^|[\\\\/])${p.source.replace(/[/.]/g, '\\$&')}([@\\\\/]|$)`);
    if (argv.some((a) => re.test(a))) return key;
  }
  return null;
}

const FRAGILE = new Set(['symlink', 'path', 'npx-path', 'npx-absolute']);

// Verdict for one launch against its pin's Node range: 'ok' | 'wrong-node' | 'unknown' (version not readable without running it).
export function classify(launch, pinKey) {
  const range = PINS[pinKey]?.node;
  const status = !launch.nodeVersion ? 'unknown' : satisfies(launch.nodeVersion, range) ? 'ok' : 'wrong-node';
  return { status, range, fragile: FRAGILE.has(launch.style) };
}

// Every registered MCP command that runs a pinned npm tool: { client, name, file, pin, launch, ...classify }. Args and env are never returned.
export function mcpLaunches(home, opts = {}) {
  const seen = new Set();
  const out = [];
  for (const { client, file, keyPath } of clients(home)) {
    for (const s of mcpServers(file, keyPath)) {
      const pin = s.command.length ? pinOf(s.command) : null;
      const id = `${file}\0${s.name}`;
      if (!pin || seen.has(id)) continue;
      seen.add(id);
      const launch = launchOf(s.command, opts);
      out.push({ client, name: s.name, file, pin, launch, ...classify(launch, pin) });
    }
  }
  return out;
}

// Every pinned npm package installed under each nvm Node: { pin, name, version, node, prefix }.
export function npmCopies(nvm) {
  const out = [];
  for (const n of installedNodes(nvm)) {
    for (const [pin, p] of Object.entries(PINS)) {
      if (p.kind !== 'npm' || p.ciOnly) continue;
      try {
        const v = JSON.parse(fs.readFileSync(j(n.modules, ...p.source.split('/'), 'package.json'), 'utf8')).version;
        out.push({ pin, name: p.source, version: v, node: n.version, prefix: n.dir });
      } catch { /* not installed under this Node */ }
    }
  }
  return out;
}

// Skill folders an agent reads, in no particular order. Sources and dates: docs/compatibility.md "Skill folders".
export function skillDirs(agent, home) {
  const claude = j(home, '.claude', 'skills');
  const shared = j(home, '.agents', 'skills');
  if (agent === 'claude') return [claude];
  if (agent === 'cursor') return [j(home, '.cursor', 'skills'), shared];
  if (agent === 'copilot') return [j(envDir(home, 'COPILOT_HOME', j(home, '.copilot')), 'skills'), shared];
  if (agent.startsWith('opencode')) return [j(configHome(home), 'opencode', 'skills'), shared, claude];
  return [];
}

const SAFE_NAME = /^[A-Za-z0-9][\w.-]*$/;

// One hash over the paths and bytes of every file under a skill folder.
// A file or folder that cannot be read gives the marker 'unreadable' instead of an error, so --doctor never crashes on it.
const UNREADABLE = 'unreadable';
function treeSha(dir, fsx) {
  const h = createHash('sha256');
  const walk = (d, rel) => {
    for (const e of fsx.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = j(d, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else if (e.isFile()) h.update(`${rel}${e.name}\0`).update(fsx.readFileSync(p)).update('\0');
    }
  };
  try { walk(dir, ''); } catch { return UNREADABLE; }
  return h.digest('hex');
}

// Skills (a folder with SKILL.md) found in two or more of `dirs`. Two paths that are one folder (a link) are not a duplicate.
export function duplicateSkills(dirs, fsx = fs) {
  const found = new Map();
  for (const d of dirs) {
    let names;
    try { names = fsx.readdirSync(d); } catch { continue; }
    for (const name of names.filter((n) => SAFE_NAME.test(n) && fsx.existsSync(j(d, n, 'SKILL.md')))) {
      let real;
      try { real = fsx.realpathSync(j(d, name)); } catch { real = j(d, name); }
      const list = found.get(name) ?? [];
      if (!list.some((x) => x.real === real)) list.push({ dir: d, real });
      found.set(name, list);
    }
  }
  return [...found].filter(([, l]) => l.length > 1).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, l]) => {
    const shas = l.map((x) => treeSha(j(x.dir, name), fsx));
    const unreadable = shas.includes(UNREADABLE);
    // The load order is not documented and OpenCode 1.19's log shows the "existing" copy changing per skill (#78), so no winner is claimed.
    return { name, dirs: l.map((x) => x.dir), shas, unreadable, differs: unreadable || new Set(shas).size > 1, winner: 'unknown (load order)' };
  });
}
