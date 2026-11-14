// --adopt: inventory of a hand-built machine, each item classified and given the action a later
// apply would take. Read-only: nothing is written, env and header values are never read, the OpenCode database is only
// read through a copy (#106, #132). `home`, `env`, `platform` and `fsx` are passed in so tests never read the real machine.
// With --yes it applies the plan (adoptApply: backup, edits, verify, automatic undo on failure); --adopt --undo restores from the backup.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'jsonc-parser';
import { hasMark, plan as planFiles, revertJsonEdits, sha, writePrivate, privateDir, dropBackups, unsafe } from './fsops.mjs';
import { PINS, npmSpec, pinVersions } from './pins.mjs';
import { configHome, envDir } from './system.mjs';
import { configPath } from './adapters/opencode-v2.mjs';
import { mcpServers } from './migrate.mjs';
import { findNvm, resolveToolNodes, minVersion, compare, satisfies, installedNodes, toolEnv } from './node-runtime.mjs';
import { run } from './system.mjs';
import { doctor } from './doctor.mjs';
import { orcaHooksFound } from './terminals.mjs';
import { clients, launchOf, pinOf, classify, npmCopies, skillDirs, duplicateSkills, treeSha, probeInitialize } from './inventory.mjs';

const j = path.join;
const MANAGED_SKILLS = new Set(Object.entries(PINS).filter(([, p]) => p.kind === 'skill').map(([k]) => k));
const MANAGED_HOOK = /\b(rtk|context-mode|gsd)\b/;
const MANAGED_PLUGIN = /context-mode|opencode-dcp|opencode-warp|lean-agents/;

const readJson = (file) => { try { return parse(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true }) ?? null; } catch { return null; } };
const readJsonText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const pinVersion = (argv, pin) => {
  const m = argv.map((a) => new RegExp(`${PINS[pin].source.replace(/[/.]/g, '\\$&')}@(\\d[^\\s/]*)$`).exec(a)).find(Boolean);
  return m?.[1] ?? null;
};

// Hand-made stopgaps from the original machine (issue #123 last comment, #78, #132): path under home → what replaces them.
// `needs`: what state.json must record before the replacement counts as installed (a tool or a terminal integration).
const CUSAGE = 'the managed `copilot-usage` tool (--tools copilot-usage)';
const STOPGAPS = [
  { rel: ['.local', 'bin', 'copilot-usage'], by: CUSAGE, needs: { tools: 'copilot-usage' } },
  { rel: ['.local', 'bin', 'copilot-usage.ps1'], by: CUSAGE, needs: { tools: 'copilot-usage' } },
  { rel: ['.config', 'opencode', 'plugins', 'copilot-usage-tui'], by: CUSAGE, needs: { tools: 'copilot-usage' } },
  { rel: ['.config', 'opencode', 'plugins', 'orca-status-tui-shim.js'], by: 'the managed Orca integration (--terminal orca)', needs: { terminals: 'orca' } },
];

// node:sqlite needs no flag from Node 22.13 (24.x too); a tool Node older than that is not tried.
const sqliteOk = (v) => { const [a, b] = minVersion(`>=${v}`); return a >= 24 || (a === 22 && b >= 13); };
const COUNT_SCRIPT = "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('SELECT count(*) AS n FROM session').get().n)";

// Count in a child Node when this one lacks node:sqlite (#201): the tool Node first, then this Node with the flag. null when neither answers.
function countInChild(dbCopy, toolNode, home) {
  const tried = [];
  const shown = (p) => (p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
  const cands = [
    ...(toolNode?.node && sqliteOk(toolNode.version) ? [{ node: toolNode.node, flags: [], label: `Node ${toolNode.version}` }] : []),
    { node: process.execPath, flags: ['--experimental-sqlite'], label: `${shown(process.execPath)} --experimental-sqlite` },
  ];
  for (const c of cands) {
    tried.push(c.label);
    try {
      const out = execFileSync(c.node, [...c.flags, '-e', COUNT_SCRIPT, dbCopy], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (/^\d+$/.test(out)) return { sessions: Number(out) }; // empty output is a failure, not 0
    } catch { /* next candidate */ }
  }
  return { tried };
}

// OpenCode: major from the config shape (2.x: mcp.servers / plugins; 1.x: flat mcp / plugin), data folder, db size, session count read from a COPY.
// `opts.toolNode` ({version, node}): where the count runs when this Node lacks node:sqlite; `opts.sqliteImport` lets tests hide node:sqlite.
export async function opencodeInfo(home, env, fsx = fs, { toolNode = null, sqliteImport = () => import('node:sqlite') } = {}) {
  const cfgFile = configPath(j(configHome(home), 'opencode'));
  const cfg = readJson(cfgFile);
  const major = !cfg ? null : cfg.mcp?.servers || cfg.plugins ? 2 : 1; // VERIFY with `opencode --version` in real-adopt
  const dataDir = j(envDir(home, 'XDG_DATA_HOME', j(home, '.local', 'share')), 'opencode');
  const dbs = fsx.existsSync(dataDir) ? fsx.readdirSync(dataDir).filter((f) => /^opencode\.db(-wal|-shm)?$/.test(f)) : [];
  const dbBytes = dbs.reduce((n, f) => n + fsx.statSync(j(dataDir, f)).size, 0);
  const out = { major, dataDir, dbBytes, sessions: null };
  if (!dbs.includes('opencode.db')) return { ...out, note: 'no opencode.db' };
  let sqlite = null;
  try { sqlite = await sqliteImport(); } catch { /* counted in a child below */ }
  const tmp = fs.mkdtempSync(j(os.tmpdir(), 'lean-adopt-'));
  try {
    for (const f of dbs) fs.copyFileSync(j(dataDir, f), j(tmp, f));
    if (!sqlite) {
      const c = countInChild(j(tmp, 'opencode.db'), toolNode, home);
      if (c.tried) out.note = `node:sqlite is not available on this Node: sessions not counted (tried ${c.tried.join(', ')})`;
      else out.sessions = c.sessions;
      return out;
    }
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
        // Inline `VAR=value` prefixes can hold secrets: never use them as the name.
        while (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) argv.shift();
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
  // --- Cursor: hooks.json, {version, hooks: {event: [{command}]}} (cursor.com/docs/hooks, read 2026-11-13). Encoded payloads are never printed.
  const cursorHooks = j(home, '.cursor', 'hooks.json');
  const ch = readJson(cursorHooks);
  const orcaFile = orcaHooksFound(home).includes(cursorHooks);
  for (const [event, hooks] of Object.entries(ch?.hooks && typeof ch.hooks === 'object' ? ch.hooks : {})) {
    for (const h of Array.isArray(hooks) ? hooks : []) {
      if (typeof h?.command !== 'string') continue;
      const argv = (h.command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^(["'])(.*)\1$/, '$2'));
      while (argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) argv.shift();
      if (!argv.length) continue;
      const encoded = /(^|\s)-enc\w*(\s|$)/i.test(h.command);
      // Only an absolute path can carry the mark: a bare `rtk` would resolve against the cwd.
      const script = !encoded && path.isAbsolute(argv[0]) ? argv[0] : null;
      // RTK and GSD write their own Cursor hooks without the mark, so the name match counts too (#199).
      const managed = !encoded && (MANAGED_HOOK.test(h.command) || (Boolean(script) && fsx.existsSync(script) && hasMark(readJsonText(script) ?? '')));
      add({ client: 'cursor', kind: 'hook', name: `${event}:${encoded ? 'powershell' : path.basename(argv[0])}`, file: cursorHooks, keyPath: ['hooks', event], owner: managed ? 'managed' : 'user', extra: encoded && orcaFile ? { note: 'Orca agent status hook' } : undefined });
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
    // a local plugin is named `<folder>/<file>`: two `tui.js` in different folders stay distinct
    const name = target ? `${path.basename(path.dirname(target))}/${path.basename(target)}` : spec.replace(/\/\/[^/@\s]*@/, '//').replace(/[?#].*$/, '');
    add({ client: 'opencode', kind: 'plugin', name, file, keyPath: [key], owner: !target && MANAGED_PLUGIN.test(spec) ? 'managed' : 'user', status, extra: target ? { source: rel(target) } : {} });
  };
  for (const [file, keys] of [[ocCfg, ['plugin', 'plugins']], [j(ocDir, 'tui.json'), ['plugin']], [j(ocDir, 'tui.jsonc'), ['plugin']]]) {
    const c = readJson(file);
    for (const k of keys) for (const e of Array.isArray(c?.[k]) ? c[k] : []) pluginEntry(file, k, e);
  }
  const pdir = j(ocDir, 'plugins');
  for (const e of fsx.existsSync(pdir) ? fsx.readdirSync(pdir, { withFileTypes: true }) : []) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || (!e.isDirectory() && !/\.[cm]?[jt]s$/.test(e.name))) continue; // package.json and friends are not plugins
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
  // A skill is a duplicate only in the folders one client reads together (#176); links count, a client scanning both paths meets it twice.
  const dupRows = new Map(); // `${folder}\0${name}` -> { clients, copies: { folder: short sha }, differs, linked }
  for (const a of ['claude', 'opencode', 'cursor', 'copilot']) {
    for (const d of duplicateSkills(skillDirs(a, home), fsx, { links: true })) {
      const group = d.dirs.map((x, i) => ({ dir: x, sha: d.shas[i] }));
      for (const g of group) {
        const row = dupRows.get(`${g.dir}\0${d.name}`) ?? { clients: [], copies: {}, differs: false, linked: false };
        if (!row.clients.includes(a)) row.clients.push(a);
        for (const x of group) row.copies[rel(x.dir)] = x.sha === 'unreadable' ? x.sha : x.sha.slice(0, 8);
        row.differs ||= d.differs; row.linked ||= d.linked;
        dupRows.set(`${g.dir}\0${d.name}`, row);
      }
    }
  }
  for (const d of dirs) {
    let list = [];
    try { list = fsx.readdirSync(d).filter((n) => fsx.existsSync(j(d, n, 'SKILL.md'))); } catch { continue; }
    for (const name of list) {
      const dup = dupRows.get(`${d}\0${name}`);
      const fix = dup && `keep one folder (e.g. ~/.agents/skills) and delete the other copy after a backup${dup.linked ? '; the copies are links, so remove the extra link, not the folder it points to' : ''}${Object.keys(dup.copies).includes('~/.claude/skills') ? '; Claude Code reads only ~/.claude/skills' : ''}`;
      add({ client: 'skills', kind: 'skill', name, file: j(d, name), owner: MANAGED_SKILLS.has(name) ? 'managed' : 'user', status: dup ? ['duplicate'] : [], extra: dup ? { copies: Object.keys(dup.copies), hashes: dup.copies, clients: dup.clients.sort(), differs: dup.differs, linked: dup.linked, fix } : {} });
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
    // shortcut: compare() reads "2.1.7-beta" as NaN, so a pre-release copy counts as equal; no pinned tool ships one, revisit if that changes
    const cmp = compare(c.version, PINS[c.pin].version);
    if (cmp < 0) status.push('drift');
    else if (cmp > 0) status.push('newer'); // newer than the pin: nothing to upgrade
    const dup = byPin.get(c.pin).length > 1;
    if (dup) status.push('duplicate');
    if (dup && !satisfies(c.node, PINS[c.pin].node)) status.push('below-floor'); // this copy cannot run: it is a removal, not an upgrade
    add({ client: 'npm', kind: 'npm', name: `${c.name}@${c.version}`, file: c.prefix, owner: 'managed', status, pin: c.pin, wanted: PINS[c.pin].version, extra: { node: c.node } });
  }

  // --- Known hand-made stopgaps: listed with their managed replacement
  const stopgaps = STOPGAPS.filter((s) => fsx.existsSync(j(home, ...s.rel))).map((s) => ({ file: rel(j(home, ...s.rel)), replaceWith: s.by }));

  // --- Actions
  for (const it of items) {
    const s = it.status;
    if (it.owner === 'user') it.action = s.includes('stale') || s.includes('duplicate') ? 'ask' : 'keep';
    else if (s.includes('wrong-node')) it.action = 'reinstall';
    else if (s.includes('below-floor')) it.action = 'remove';
    else if (s.includes('drift')) it.action = 'upgrade';
    else if (s.includes('stale')) it.action = 'remove';
    else if (s.includes('duplicate')) it.action = it.kind === 'skill' || it.kind === 'plugin' || it.kind === 'mcp' ? 'ask' : it.kind === 'npm' ? (tn && it.node !== tn.version ? 'remove' : 'keep') : 'remove';
  }
  const oc = await opencodeInfo(home, env, fsx, { toolNode: tn });
  const plan = items.filter((i) => i.action !== 'keep').map((i) => `${i.action} ${i.client} ${i.kind} ${i.name} (${i.status.join(', ') || i.owner})`);
  for (const s of stopgaps) if (s.replaceWith) plan.push(`ask ${s.file}: replace with ${s.replaceWith}`);
  return { version: 1, os: platform, toolNode, items, opencode: { ...oc, dataDir: rel(oc.dataDir) }, stopgaps, plan, ok: !items.some((i) => i.action !== 'keep') };
}

export async function adopt(o) {
  if (o.undo) return adoptUndo(o);
  if (o.yes && !o.dryRun && !o.json) return adoptApply(o);
  const r = await inventory(o);
  if (o.json) { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return true; }
  const by = {};
  for (const i of r.items) by[`${i.kind}`] = (by[`${i.kind}`] ?? 0) + 1;
  console.log(`--adopt (dry run: nothing is changed; --yes applies). Found: ${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing'}`);
  console.log(`tool Node: ${r.toolNode.range ? `${r.toolNode.range} -> ${r.toolNode.node ?? 'no matching Node installed, nvm not found'} (${r.toolNode.source ?? 'none'})` : 'not needed'}`);
  console.log(`OpenCode: major ${r.opencode.major ?? 'none'}, ${r.opencode.dbBytes} bytes of db, sessions ${r.opencode.sessions ?? 'unknown'}${r.opencode.note ? ` (${r.opencode.note})` : ''}`);
  for (const i of r.items.filter((x) => x.action !== 'keep' || x.owner === 'managed' || x.kind === 'hook')) {
    console.log(`  ${i.action.padEnd(9)} ${i.owner.padEnd(8)} ${i.client} ${i.kind} ${i.name}${i.status.length ? `  [${i.status.join(', ')}]` : ''}${i.note ? `  (${i.note})` : ''}  (${i.file})`);
    if (i.kind === 'skill' && i.fix) console.log(`            ${i.clients.join(' and ')} loads it twice: ${Object.entries(i.hashes).map(([d, h]) => `${d} ${h}`).join(', ')} (${i.differs ? 'differs' : 'identical'}); ${i.fix}`);
  }
  console.log(`  user-owned items kept untouched: ${r.items.filter((i) => i.owner === 'user' && i.action === 'keep').length}`);
  for (const s of r.stopgaps) console.log(`  stopgap   ${s.file}${s.replaceWith ? `: replace with ${s.replaceWith}` : `: ${s.note}`}`);
  console.log(r.plan.length ? `Plan (${r.plan.length} steps; add --yes to apply, --confirm-removals to allow the removals):\n${r.plan.map((l) => `  - ${l}`).join('\n')}` : 'Plan: nothing to change.');
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Apply and undo (#106). Everything below writes, and only inside `home` and `stateDir`.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const absOf = (home, f) => (f === '~' || f.startsWith('~/') || f.startsWith('~\\') ? home + f.slice(1) : f);
const walk = (obj, p) => p.reduce((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const bytes = (f) => fs.readFileSync(f);
const relIn = (home, f) => (f.startsWith(home + path.sep) ? path.relative(home, f) : f.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, ''));

// State file: --adopt adds `adopt` to an existing state.json, or creates one that only holds it (`adoptOnly`).
const stateFile = (stateDir) => j(stateDir, 'state.json');
const readState = (stateDir) => readJson(stateFile(stateDir));
function saveState(stateDir, adoptState) {
  const st = readState(stateDir) ?? {
    version: JSON.parse(fs.readFileSync(j(ROOT, 'package.json'), 'utf8')).version, installedAt: new Date().toISOString(), pins: pinVersions(), adoptOnly: true,
    options: { migrateOnly: true, agents: [], tools: [], privacy: 'standard', gh: false, terminals: [], unverified: {}, lang: 'en', profile: null, adhdAlways: false, ponytailMode: null, bun: false, shell: 'git-bash' },
    files: [], commands: [],
  };
  st.updatedAt = new Date().toISOString();
  st.adopt = adoptState;
  privateDir(stateDir, stateDir);
  writePrivate(stateFile(stateDir), `${JSON.stringify(st, null, 2)}\n`);
}

// What to change, from one inventory. Pure: no writes. `state`: the saved state.json (tells which managed replacements exist).
export function adoptPlan(r, { home, env, platform, realHome, state, fsx = fs }) {
  const nvm = findNvm({ env, home, platform, realHome });
  const nodes = nvm ? installedNodes(nvm) : [];
  const tn = r.toolNode.version ? nodes.find((n) => n.version === r.toolNode.version) ?? null : null;
  const out = { tn, nodes, edits: new Map(), rewritten: [], install: null, oldCopies: [], dupSkills: [], stopgaps: [], notes: [] };
  const addEdit = (file, e) => out.edits.set(file, [...(out.edits.get(file) ?? []), e]);

  // Managed MCPs on the wrong or a moving Node -> `<tool Node> <entry>` (plan-106 section 2). `set`, not `upgradeIf`: the old value is recorded, so a key revert writes it back.
  const pin = 'context-mode';
  const cli = tn && j(tn.modules, 'context-mode', 'cli.mjs');
  const seen = new Set();
  for (const it of r.items) {
    if (it.kind !== 'mcp' || it.owner !== 'managed' || it.pin !== pin || !['reinstall', 'upgrade'].includes(it.action)) continue;
    const file = absOf(home, it.file);
    const id = `${file}\0${it.keyPath.join('.')}\0${it.name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!tn) { out.notes.push(`${it.client} ${it.name}: no installed Node meets ${r.toolNode.range}; install one with nvm, then run --adopt again`); continue; }
    const entry = walk(readJson(file), [...it.keyPath, it.name]);
    const base = [...it.keyPath, it.name];
    if (Array.isArray(entry?.command)) addEdit(file, { path: [...base, 'command'], mode: 'set', value: [tn.node, cli, 'server'] });
    else if (typeof entry?.command === 'string') { addEdit(file, { path: [...base, 'command'], mode: 'set', value: tn.node }); addEdit(file, { path: [...base, 'args'], mode: 'set', value: [cli, 'server'] }); }
    else continue;
    out.rewritten.push({ client: it.client, name: it.name, file, path: base, argv: [tn.node, cli, 'server'] });
  }
  // Stale keys of ours (a managed MCP whose command is gone, an enabledPlugins entry of ours without its plugin): removed, the old value recorded. A user's own stale key is only listed.
  for (const it of r.items) {
    if (it.owner !== 'managed' || it.action !== 'remove' || !it.status.includes('stale')) continue;
    const p = it.kind === 'mcp' ? [...it.keyPath, it.name] : it.kind === 'plugin' && it.keyPath[0] === 'enabledPlugins' ? it.keyPath : null;
    if (p) addEdit(absOf(home, it.file), { path: p, mode: 'remove' });
  }
  // The pinned package in the tool Node's prefix.
  if (tn && out.rewritten.length) {
    let have = null;
    try { have = JSON.parse(fsx.readFileSync(j(tn.modules, 'context-mode', 'package.json'), 'utf8')).version; } catch { /* not installed there */ }
    if (have !== PINS[pin].version) out.install = { have, node: tn };
  }
  // (a) old npm copies under another Node; (b) a skill in both folders; stopgaps with their managed replacement installed.
  if (tn) for (const it of r.items) if (it.kind === 'npm' && it.status.includes('duplicate') && it.node !== tn.version) { const n = nodes.find((x) => x.version === it.node); if (n) out.oldCopies.push({ node: n, pin: it.pin, name: PINS[it.pin].source, version: it.name.replace(/^.*@/, '') }); }
  const shared = j(home, '.agents', 'skills');
  const claude = j(home, '.claude', 'skills');
  const otherAgents = fsx.existsSync(j(home, '.cursor')) || fsx.existsSync(envDir(home, 'COPILOT_HOME', j(home, '.copilot')));
  for (const name of new Set(r.items.filter((i) => i.kind === 'skill' && i.status.includes('duplicate')).map((i) => i.name))) {
    const drop = j(shared, name);
    // Keep the copy in ~/.claude/skills (Claude reads only that folder, OpenCode reads both); Cursor and Copilot read only ~/.agents/skills, so with them present nothing is removed.
    const linked = r.items.some((i) => i.kind === 'skill' && i.name === name && i.linked);
    if (fsx.existsSync(j(claude, name, 'SKILL.md')) && fsx.existsSync(j(drop, 'SKILL.md')) && !otherAgents && !linked) out.dupSkills.push(drop);
    else out.notes.push(`skill ${name} stays in both folders (${linked ? 'the copies are links to one folder' : otherAgents ? 'Cursor or Copilot read only ~/.agents/skills' : 'the copies are not the ~/.agents and ~/.claude pair'}); keep one by hand`);
  }
  const have = (need) => Object.entries(need).every(([k, v]) => (state?.options?.[k] ?? []).includes(v));
  for (const sg of STOPGAPS) {
    const f = j(home, ...sg.rel);
    if (!fsx.existsSync(f)) continue;
    if (have(sg.needs)) out.stopgaps.push(f);
    else out.notes.push(`${path.relative(home, f)}: kept (${sg.by} is not installed yet)`);
  }
  return out;
}

// A snapshot of everything of the user's that must not change: whole files and folders by hash, entries of shared JSON files by value.
function userSnapshot(r, home, skip) {
  const snap = new Map();
  for (const it of r.items) {
    if (it.owner !== 'user') continue;
    const f = absOf(home, it.file);
    if (skip.has(f)) continue;
    try {
      if (it.kind === 'skill') snap.set(`${f}`, treeSha(f, fs));
      else if (it.kind === 'plugin' && !it.keyPath.length) snap.set(f, sha(bytes(f)));
      else if (it.kind === 'mcp') snap.set(`${f}\0${it.keyPath.join('.')}\0${it.name}`, JSON.stringify(walk(readJson(f), [...it.keyPath, it.name]) ?? null));
      else if (it.kind === 'plugin' && it.keyPath[0] === 'enabledPlugins') snap.set(`${f}\0${it.name}`, JSON.stringify(walk(readJson(f), it.keyPath) ?? null));
    } catch { /* unreadable: nothing to compare */ }
  }
  return snap;
}

export async function adoptApply(o) {
  const { home, env = process.env, platform = process.platform, realHome = os.homedir(), stateDir = j(home, '.config', 'lean-agents'), exec = true, keepBackup = false, confirm = async () => false } = o;
  const r = await inventory(o);
  const state = readState(stateDir);
  if (state?.adopt) { console.log('An earlier --adopt run is still recorded. Run --adopt --undo first (or delete its backup and the "adopt" key by hand).'); return false; }
  const p = adoptPlan(r, { home, env, platform, realHome, state });
  const nothing = !p.edits.size && !p.install && !p.oldCopies.length && !p.dupSkills.length && !p.stopgaps.length;
  for (const n of p.notes) console.log(`  note: ${n}`);
  if (nothing) { console.log('--adopt: nothing to change.'); return true; }

  // Removals outside the JSON edits need a yes (menu on a terminal, --confirm-removals without one); else they are listed and kept.
  const rel = (f) => `~${f.slice(home.length)}`;
  const ask = async (list, q) => { if (!list.length) return false; for (const l of list) console.log(`  ask: ${l}`); const ok = await confirm(q); if (!ok) console.log('  kept (not confirmed; pass --confirm-removals to allow)'); return ok; };
  const okCopies = exec && (await ask(p.oldCopies.map((c) => `npm uninstall the old ${c.name}@${c.version} under Node ${c.node.version}`), 'Remove these old npm copies? (undo reinstalls them from the network)'));
  if (!exec && p.oldCopies.length) console.log('  kept: old npm copies need a run without --no-exec');
  const okSkills = await ask(p.dupSkills.map((d) => `delete ${rel(d)} (copied to the backup first)`), 'Delete these duplicate skill folders?');
  const okStops = await ask(p.stopgaps.map((d) => `delete the hand-made ${rel(d)} (copied to the backup first)`), 'Delete these hand-made stopgaps?');

  const user = userSnapshot(r, home, new Set([...(okSkills ? p.dupSkills : []), ...(okStops ? p.stopgaps : [])]));
  const sessions = r.opencode.sessions;
  const backupDir = j(stateDir, `adopt-${stamp()}`);
  privateDir(backupDir, stateDir);
  const adoptState = { backupDir, files: [], dirs: [], npm: [] };
  saveState(stateDir, adoptState);
  const env2 = { ...env };
  const fail = async (why) => { console.log(`! ${why}\nRolling back from the backup.`); await adoptUndo({ ...o, undo: true }); return false; };

  // 1. npm into the tool Node's prefix
  if (p.install && exec) {
    const { node: n, have } = p.install;
    const prefix = ['--prefix', n.dir];
    const argv = [n.node, n.npmCli, 'install', '-g', ...prefix, npmSpec('context-mode')];
    const undoArgv = have ? [n.node, n.npmCli, 'install', '-g', ...prefix, `${PINS['context-mode'].source}@${have}`] : [n.node, n.npmCli, 'uninstall', '-g', ...prefix, 'context-mode'];
    adoptState.npm.push({ desc: `context-mode ${PINS['context-mode'].version} in Node ${n.version}`, undo: [undoArgv], env: toolEnv(n, env, platform) });
    saveState(stateDir, adoptState);
    if (!run(argv, { dryRun: false, log: console.log, env: toolEnv(n, env, platform) })) return fail('npm install failed');
  } else if (p.install) console.log(`  --no-exec: install context-mode ${PINS['context-mode'].version} into ${p.install.node.dir} by hand`);

  // 2. JSON edits: the old bytes go to the backup first
  const actions = [...p.edits].map(([file, edits]) => ({ kind: 'json', path: file, edits }));
  for (const pl of planFiles(actions, [home, configHome(home), envDir(home, 'COPILOT_HOME', null)].filter(Boolean))) {
    if (pl.status !== 'modify') { if (pl.status === 'skip') console.log(`  skipped ${rel(pl.path)}: ${pl.note}`); continue; }
    const backup = j(backupDir, 'files', relIn(home, pl.path));
    privateDir(path.dirname(backup), stateDir);
    fs.copyFileSync(pl.path, backup);
    fs.chmodSync(backup, 0o600);
    adoptState.files.push({ path: pl.path, before: sha(bytes(pl.path)), after: sha(pl.after), backup, applied: pl.applied });
    saveState(stateDir, adoptState);
    fs.writeFileSync(pl.path, pl.after);
    console.log(`  edited ${rel(pl.path)}`);
  }

  // 3. removals: copy into the backup, then delete
  const drop = (list, label) => {
    for (const d of list) {
      const why = unsafe(d, [home]);
      if (why) { console.log(`  kept ${label} ${rel(d)}: ${why}`); continue; }
      const backup = j(backupDir, 'dirs', relIn(home, d));
      privateDir(path.dirname(backup), stateDir);
      fs.cpSync(d, backup, { recursive: true });
      adoptState.dirs.push({ path: d, backup });
      saveState(stateDir, adoptState);
      fs.rmSync(d, { recursive: true, force: true });
      console.log(`  removed ${label} ${rel(d)}`);
    }
  };
  if (okSkills) drop(p.dupSkills, 'duplicate skill');
  if (okStops) drop(p.stopgaps, 'stopgap');
  if (okCopies) {
    for (const c of p.oldCopies) {
      const e = toolEnv(c.node, env, platform);
      const prefix = ['--prefix', c.node.dir];
      adoptState.npm.push({ desc: `old ${c.name}@${c.version} in Node ${c.node.version}`, undo: [[c.node.node, c.node.npmCli, 'install', '-g', ...prefix, `${c.name}@${c.version}`]], env: e });
      saveState(stateDir, adoptState);
      if (!run([c.node.node, c.node.npmCli, 'uninstall', '-g', ...prefix, c.name], { dryRun: false, log: console.log, env: e })) return fail(`could not remove the old ${c.name} under Node ${c.node.version}`);
    }
  }

  // 4. verify: each rewritten MCP answers initialize with the current PATH first (the default or symlink Node), user files unchanged, sessions equal
  const bad = [];
  if (exec) {
    for (const m of p.rewritten) {
      const pr = await probeInitialize(m.argv, { env: env2, expect: 'context-mode' });
      console.log(`  ${pr.ok ? 'ok  ' : 'FAIL'} initialize ${m.client} ${m.name}${pr.error ? ` (${pr.error})` : ''}`);
      if (!pr.ok) bad.push(`${m.client} ${m.name} did not answer initialize`);
    }
  } else console.log('  verify: initialize skipped (--no-exec)');
  const after = userSnapshot(r, home, new Set());
  for (const [k, v] of user) if (after.get(k) !== v) bad.push(`a user-owned item changed: ${k.split('\0')[0].replace(home, '~')}`);
  const oc = await opencodeInfo(home, env, fs, { toolNode: p.tn });
  if (oc.sessions !== sessions) bad.push(`OpenCode sessions ${sessions} -> ${oc.sessions}`);
  if (bad.length) return fail(bad.join('; '));
  const dr = doctor({ home, state: readState(stateDir), exec: false, env, platform, json: false });
  if (!dr) return fail('--doctor reports problems after the change');

  // Read back what is on disk: a skipped write (symlinked or unparsable file) must not pass on the value we meant to write.
  for (const m of p.rewritten) {
    const e = walk(readJson(m.file), m.path);
    const now = Array.isArray(e?.command) ? e.command : [e?.command, ...(e?.args ?? [])];
    if (JSON.stringify(now) !== JSON.stringify(m.argv)) return fail(`${rel(m.file)} still has the old ${m.name} command (the file was skipped)`);
  }
  // A deleted folder comes back only from the backup, so one that removed a folder keeps it.
  if (keepBackup || adoptState.dirs.length) console.log(`Done. Backup kept: ${backupDir}\nUndo: --adopt --undo`);
  else {
    // The backup is the undo: without it --adopt --undo can only revert our keys.
    dropBackups(backupDir);
    adoptState.backupDir = null;
    for (const f of adoptState.files) f.backup = null;
    for (const d of adoptState.dirs) d.backup = null;
    saveState(stateDir, adoptState);
    console.log('Done. Verified; backup deleted (--keep-backup keeps it for --adopt --undo).');
  }
  return true;
}

export async function adoptUndo(o) {
  const { home, stateDir = j(home, '.config', 'lean-agents'), exec = true, env = process.env } = o;
  const st = readState(stateDir);
  const a = st?.adopt;
  if (!a) { console.log('Nothing to undo: no --adopt run is recorded.'); return true; }
  if (o.dryRun) { console.log(`--adopt --undo --dry-run: would restore ${a.files.length} files, ${a.dirs.length} folders and undo ${a.npm.length} npm steps; nothing was changed.`); return true; }
  let ok = true;
  for (const c of [...a.npm].reverse()) {
    if (!exec) { console.log(`  by hand: ${c.undo.map((u) => u.join(' ')).join(' && ')}`); continue; }
    for (const argv of c.undo) {
      // An offline reinstall of an old copy must not stop the byte restore: it is listed instead.
      if (!run(argv, { dryRun: false, log: console.log, env: c.env })) console.log(`  ! could not run it; run the command above by hand (${c.desc})`);
    }
  }
  for (const d of a.dirs) {
    if (!d.backup || !fs.existsSync(d.backup)) { console.log(`  ! no backup for ${d.path}; nothing restored`); ok = false; continue; }
    // Keep the backup: it is the only copy of this folder.
    if (fs.existsSync(d.path)) { console.log(`  left ${d.path} (it exists again); its copy stays in the backup`); ok = false; continue; }
    fs.mkdirSync(path.dirname(d.path), { recursive: true });
    fs.cpSync(d.backup, d.path, { recursive: true });
    console.log(`  restored ${d.path}`);
  }
  for (const f of [...a.files].reverse()) {
    let now = null;
    try { now = bytes(f.path); } catch { /* gone */ }
    if (now === null) { console.log(`  ! ${f.path} is gone; left`); continue; }
    const why = unsafe(f.path, [home, configHome(home)]);
    if (why) { console.log(`  ! ${f.path}: ${why}`); ok = false; continue; }
    if (sha(now) === f.after && f.backup && fs.existsSync(f.backup)) { fs.writeFileSync(f.path, bytes(f.backup)); console.log(`  restored ${f.path}`); continue; }
    // Edited since (or no backup kept): take back only our keys.
    fs.writeFileSync(f.path, revertJsonEdits(now.toString('utf8'), f.applied ?? []));
    console.log(`  reverted our keys in ${f.path}${sha(now) === f.after ? ' (no backup kept)' : ' (you edited it since)'}`);
  }
  if (!ok) { console.log(`Undone with problems; the record and backup stay so you can retry: ${a.backupDir ?? '(no backup)'}`); return false; }
  if (a.backupDir) dropBackups(a.backupDir);
  if (st.adoptOnly) fs.rmSync(stateFile(stateDir));
  else { delete st.adopt; writePrivate(stateFile(stateDir), `${JSON.stringify(st, null, 2)}\n`); }
  try { fs.rmdirSync(stateDir); } catch { /* other lean-agents files live there */ }
  console.log(ok ? 'Undone.' : 'Undone, with the problems above.');
  return ok;
}
