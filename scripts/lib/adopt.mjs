// --adopt (dry run in this release): inventory of a hand-built machine, each item classified and given the action a later
// apply would take. Read-only: nothing is written, env and header values are never read, the OpenCode database is only
// read through a copy (#106, #132). `home`, `env`, `platform` and `fsx` are passed in so tests never read the real machine.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { hasMark } from './fsops.mjs';
import { PINS } from './pins.mjs';
import { configHome, envDir } from './system.mjs';
import { configPath } from './adapters/opencode-v2.mjs';
import { mcpServers } from './migrate.mjs';
import { findNvm, resolveToolNodes, minVersion } from './node-runtime.mjs';
import { clients, launchOf, pinOf, classify, npmCopies, skillDirs, duplicateSkills } from './inventory.mjs';

const j = path.join;
const MANAGED_SKILLS = new Set(Object.entries(PINS).filter(([, p]) => p.kind === 'skill').map(([k]) => k));
const MANAGED_HOOK = /\b(rtk|context-mode|gsd)\b/;
const MANAGED_PLUGIN = /context-mode|opencode-dcp|opencode-warp|lean-agents/;

const readJson = (file) => { try { return parse(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true }) ?? null; } catch { return null; } };
const pinVersion = (argv, pin) => {
  const m = argv.map((a) => new RegExp(`${PINS[pin].source.replace(/[/.]/g, '\\$&')}@(\\d[^\\s/]*)$`).exec(a)).find(Boolean);
  return m?.[1] ?? null;
};

// Hand-made stopgaps from the original machine (issue #123 last comment, #78, #132): path under home → what replaces them.
const STOPGAPS = [
  { rel: ['.local', 'bin', 'copilot-usage'], by: 'the managed `copilot-usage` tool (--tools copilot-usage)' },
  { rel: ['.local', 'bin', 'copilot-usage.ps1'], by: 'the managed `copilot-usage` tool (--tools copilot-usage)' },
  { rel: ['.config', 'opencode', 'plugins', 'copilot-usage-tui'], by: 'the managed `copilot-usage` tool (--tools copilot-usage)' },
  { rel: ['.config', 'opencode', 'plugins', 'orca-status-tui-shim.js'], by: 'the managed Orca integration (--terminal orca)' },
];

// OpenCode: major from the config shape (2.x: mcp.servers / plugins; 1.x: flat mcp / plugin), data folder, db size, session count read from a COPY.
export async function opencodeInfo(home, env, fsx = fs) {
  const cfgFile = configPath(j(configHome(home), 'opencode'));
  const cfg = readJson(cfgFile);
  const major = !cfg ? null : cfg.mcp?.servers || cfg.plugins ? 2 : 1; // VERIFY with `opencode --version` in real-adopt
  const dataDir = j(envDir(home, 'XDG_DATA_HOME', j(home, '.local', 'share')), 'opencode');
  const dbs = fsx.existsSync(dataDir) ? fsx.readdirSync(dataDir).filter((f) => /^opencode\.db(-wal|-shm)?$/.test(f)) : [];
  const dbBytes = dbs.reduce((n, f) => n + fsx.statSync(j(dataDir, f)).size, 0);
  const out = { major, dataDir, dbBytes, sessions: null };
  if (!dbs.includes('opencode.db')) return { ...out, note: 'no opencode.db' };
  let sqlite;
  try { sqlite = await import('node:sqlite'); } catch { return { ...out, note: 'node:sqlite is not available on this Node: sessions not counted' }; }
  const tmp = fs.mkdtempSync(j(os.tmpdir(), 'lean-adopt-'));
  try {
    for (const f of dbs) fs.copyFileSync(j(dataDir, f), j(tmp, f));
    const db = new sqlite.DatabaseSync(j(tmp, 'opencode.db'), { readOnly: true });
    try { out.sessions = Number(db.prepare('SELECT count(*) AS n FROM session').get().n); } finally { db.close(); }
  } catch (e) { out.note = `sessions not counted: ${String(e.message).split('\n')[0]}`; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return out;
}

export async function inventory({ home, env = process.env, platform = process.platform, realHome = os.homedir(), fsx = fs }) {
  const rel = (p) => (p && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const items = [];
  const add = (it) => items.push({ client: it.client, kind: it.kind, name: it.name, file: rel(it.file), keyPath: it.keyPath ?? [], launch: it.launch ?? null, owner: it.owner, status: it.status ?? [], pin: it.pin ?? null, wanted: it.wanted ?? null, action: 'keep', ...(it.extra ?? {}) });
  const shape = (l) => ({ style: l.style, node: rel(l.node), nodeVersion: l.nodeVersion });
  const seen = new Set();

  // --- MCP servers (names only; args and env stay unread)
  const names = new Set();
  for (const { client, file, keyPath } of clients(home)) {
    for (const s of mcpServers(file, keyPath)) {
      const id = `${file}\0${s.name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const pin = s.command.length ? pinOf(s.command) : null;
      const managed = Boolean(pin) || (s.name === 'serena' && s.command.includes('start-mcp-server'));
      const status = [];
      const launch = s.command.length ? launchOf(s.command, { env, platform, fsx }) : null;
      let wanted = null;
      if (launch && pin && classify(launch, pin).status === 'wrong-node') status.push('wrong-node');
      if (pin) {
        const v = pinVersion(s.command, pin);
        wanted = PINS[pin].version;
        if (v && v !== wanted) status.push('drift');
      }
      const abs = s.command[0] && path.isAbsolute(s.command[0]);
      if (abs && !fsx.existsSync(s.command[0])) status.push('stale');
      names.add(`${client}\0${s.name}`);
      add({ client, kind: 'mcp', name: s.name, file, keyPath, launch: launch && shape(launch), owner: managed ? 'managed' : 'user', status, pin, wanted });
    }
  }

  // --- Claude: hooks, enabledPlugins
  const settings = j(home, '.claude', 'settings.json');
  const cs = readJson(settings) ?? {};
  for (const [event, groups] of Object.entries(cs.hooks ?? {})) {
    for (const g of Array.isArray(groups) ? groups : []) {
      for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
        if (typeof h?.command !== 'string') continue;
        const argv = h.command.split(/\s+/).filter(Boolean);
        if (!argv.length) continue;
        const pin = pinOf(argv);
        const launch = launchOf(argv, { env, platform, fsx });
        const status = [];
        if (pin && classify(launch, pin).status === 'wrong-node') status.push('wrong-node');
        if (path.isAbsolute(argv[0] ?? '') && !fsx.existsSync(argv[0])) status.push('stale');
        add({ client: 'claude', kind: 'hook', name: `${event}:${path.basename(argv[0])}`, file: settings, keyPath: ['hooks', event], launch: shape(launch), owner: MANAGED_HOOK.test(h.command) ? 'managed' : 'user', status, pin });
      }
    }
  }
  const installed = readJson(j(home, '.claude', 'plugins', 'installed_plugins.json')); // VERIFY: name and shape, proven in real-adopt
  const have = installed && typeof installed.plugins === 'object' ? installed.plugins : null;
  for (const [key, on] of Object.entries(cs.enabledPlugins ?? {})) {
    const stale = have && typeof have === 'object' && !(key in have);
    add({ client: 'claude', kind: 'plugin', name: key, file: settings, keyPath: ['enabledPlugins', key], owner: /^(context-mode|ponytail)@/.test(key) ? 'managed' : 'user', status: stale ? ['stale'] : [], extra: { enabled: Boolean(on) } });
  }

  // --- OpenCode: plugin / plugins, tui.json plugin, plugins/ folder
  const ocDir = j(configHome(home), 'opencode');
  const ocCfg = configPath(ocDir);
  const pluginEntry = (file, key, e) => {
    const spec = Array.isArray(e) ? String(e[0]) : String(e);
    const status = [];
    let target = null;
    try { target = spec.startsWith('file://') ? fileURLToPath(spec) : null; } catch { /* not a local file URL */ }
    if (target && !fsx.existsSync(target)) status.push('stale');
    if (/context-mode/.test(spec) && names.has('opencode\0context-mode')) status.push('duplicate'); // plugin and MCP; the MCP row gets the same mark below
    add({ client: 'opencode', kind: 'plugin', name: spec.replace(/^file:\/\/.*[\\/]/, 'file:').replace(/\/\/[^/@\s]*@/, '//').replace(/[?#].*$/, ''), file, keyPath: [key], owner: !target && MANAGED_PLUGIN.test(spec) ? 'managed' : 'user', status });
  };
  for (const [file, keys] of [[ocCfg, ['plugin', 'plugins']], [j(ocDir, 'tui.json'), ['plugin']], [j(ocDir, 'tui.jsonc'), ['plugin']]]) {
    const c = readJson(file);
    for (const k of keys) for (const e of Array.isArray(c?.[k]) ? c[k] : []) pluginEntry(file, k, e);
  }
  const pdir = j(ocDir, 'plugins');
  for (const e of fsx.existsSync(pdir) ? fsx.readdirSync(pdir, { withFileTypes: true }) : []) {
    const f = j(pdir, e.name);
    let owned = false;
    if (e.isFile()) { try { owned = hasMark(fs.readFileSync(f, 'utf8')); } catch { /* unreadable: user */ } }
    add({ client: 'opencode', kind: 'plugin', name: `plugins/${e.name}`, file: f, owner: owned ? 'managed' : 'user' });
  }

  if (items.some((i) => i.client === 'opencode' && i.kind === 'plugin' && i.status.includes('duplicate'))) {
    const mcp = items.find((i) => i.client === 'opencode' && i.kind === 'mcp' && i.name === 'context-mode');
    if (mcp) mcp.status.push('duplicate');
  }

  // --- Skills in every folder some agent reads
  const dirs = [...new Set(['claude', 'opencode', 'cursor', 'copilot'].flatMap((a) => skillDirs(a, home)))];
  const dupDirs = new Map();
  for (const a of ['claude', 'opencode', 'cursor', 'copilot']) for (const d of duplicateSkills(skillDirs(a, home), fsx)) dupDirs.set(d.name, d);
  for (const d of dirs) {
    let list = [];
    try { list = fsx.readdirSync(d).filter((n) => fsx.existsSync(j(d, n, 'SKILL.md'))); } catch { continue; }
    for (const name of list) {
      const dup = dupDirs.get(name);
      add({ client: 'skills', kind: 'skill', name, file: j(d, name), owner: MANAGED_SKILLS.has(name) ? 'managed' : 'user', status: dup ? ['duplicate'] : [], extra: dup ? { copies: dup.dirs.map(rel), differs: dup.differs } : {} });
    }
  }

  // --- npm copies under each nvm Node, and the one Node the tools should use
  const nvm = findNvm({ env, home, platform, realHome });
  const copies = nvm ? npmCopies(nvm) : [];
  const toolPins = Object.fromEntries([...new Set(items.map((i) => i.pin).filter(Boolean))].map((k) => [k, PINS[k]]));
  // active '0.0.0': the question is which Node the tools should run on, whatever Node runs this command.
  const r = resolveToolNodes({ pins: toolPins, active: '0.0.0', nvm, latest: null });
  const ranges = Object.values(toolPins).map((p) => p.node).filter(Boolean);
  const floor = ranges.length ? ranges.map((x) => minVersion(x)).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0].join('.') : null;
  const tn = r.toolNode;
  const toolNode = tn
    ? { version: tn.version, node: rel(tn.node), range: `>=${floor}`, source: tn.install ? 'install' : 'reuse' }
    : { version: null, node: null, range: floor ? `>=${floor}` : null, source: null };
  const byPin = new Map();
  for (const c of copies) byPin.set(c.pin, [...(byPin.get(c.pin) ?? []), c]);
  for (const c of copies) {
    const status = [];
    if (PINS[c.pin].version !== c.version) status.push('drift');
    if (byPin.get(c.pin).length > 1) status.push('duplicate');
    add({ client: 'npm', kind: 'npm', name: `${c.name}@${c.version}`, file: c.prefix, owner: 'managed', status, pin: c.pin, wanted: PINS[c.pin].version, extra: { node: c.node } });
  }

  // --- Known hand-made stopgaps: listed with their managed replacement
  const stopgaps = STOPGAPS.filter((s) => fsx.existsSync(j(home, ...s.rel))).map((s) => ({ file: rel(j(home, ...s.rel)), replaceWith: s.by }));

  // --- Actions
  for (const it of items) {
    const s = it.status;
    if (it.owner === 'user') it.action = s.includes('stale') || s.includes('duplicate') ? 'ask' : 'keep';
    else if (s.includes('wrong-node')) it.action = 'reinstall';
    else if (s.includes('drift')) it.action = 'upgrade';
    else if (s.includes('stale')) it.action = 'remove';
    else if (s.includes('duplicate')) it.action = it.kind === 'skill' || it.kind === 'plugin' || it.kind === 'mcp' ? 'ask' : it.kind === 'npm' ? (tn && it.node !== tn.version ? 'remove' : 'keep') : 'remove';
  }
  const oc = await opencodeInfo(home, env, fsx);
  const plan = items.filter((i) => i.action !== 'keep').map((i) => `${i.action} ${i.client} ${i.kind} ${i.name} (${i.status.join(', ') || i.owner})`);
  for (const s of stopgaps) if (s.replaceWith) plan.push(`ask ${s.file}: replace with ${s.replaceWith}`);
  return { version: 1, os: platform, toolNode, items, opencode: { ...oc, dataDir: rel(oc.dataDir) }, stopgaps, plan, ok: !items.some((i) => i.action !== 'keep') };
}

export async function adopt(o) {
  const r = await inventory(o);
  if (o.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return true; }
  const by = {};
  for (const i of r.items) by[`${i.kind}`] = (by[`${i.kind}`] ?? 0) + 1;
  console.log(`--adopt (dry run: nothing is changed). Found: ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}`);
  console.log(`tool Node: ${r.toolNode.range ? `${r.toolNode.range} -> ${r.toolNode.node ?? 'no matching Node installed, nvm not found'} (${r.toolNode.source ?? 'none'})` : 'not needed'}`);
  console.log(`OpenCode: major ${r.opencode.major ?? 'none'}, ${r.opencode.dbBytes} bytes of db, sessions ${r.opencode.sessions ?? 'unknown'}${r.opencode.note ? ` (${r.opencode.note})` : ''}`);
  for (const i of r.items.filter((x) => x.action !== 'keep' || x.owner === 'managed')) console.log(`  ${i.action.padEnd(9)} ${i.owner.padEnd(8)} ${i.client} ${i.kind} ${i.name}${i.status.length ? `  [${i.status.join(', ')}]` : ''}`);
  console.log(`  user-owned items kept untouched: ${r.items.filter((i) => i.owner === 'user' && i.action === 'keep').length}`);
  for (const s of r.stopgaps) console.log(`  stopgap   ${s.file}${s.replaceWith ? `: replace with ${s.replaceWith}` : `: ${s.note}`}`);
  console.log(r.plan.length ? `Plan (${r.plan.length} steps, applying comes in a later release):\n${r.plan.map((l) => `  - ${l}`).join('\n')}` : 'Plan: nothing to change.');
  return true;
}
