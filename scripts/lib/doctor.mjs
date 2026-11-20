// Doctor: compares what lean-agents installed with what is on disk and what the agents load.
import fs from 'node:fs';
import path from 'node:path';
import { sha } from './fsops.mjs';
import { PINS, npmSpec, behindPins, nodeRange } from './pins.mjs';
import { version, quiet, findAgy, antigravityFootprint } from './system.mjs';
import { redactText } from './redact.mjs';
import { satisfies, nodeSkipLine, minVersion, findNvm, nodeAt } from './node-runtime.mjs';
import { mcpLaunches, classify, duplicateSkills, skillDirs } from './inventory.mjs';
import { stillNeeded, shellNotice } from './terminals.mjs';
import { adhdSkillFiles } from './adhd.mjs';
import { proxyReport, childEnv, fromPrivacy } from './network.mjs';
import { leftovers } from './parallel.mjs';
import { pluginHealth } from './plugin-health.mjs';

const CORE_AGENTS = ['debug', 'explore', 'planner', 'research', 'review'];
const SECRET_KEY = /(key|token|secret|password|auth)/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]));
  }
  return value;
}

// OpenCode 2 prints a JSON array of config sources ({type, path, info}); 1.x printed one object.
export function resolvedOpenCodeConfig(text) {
  const start = text.search(/^[[{]/m);
  const data = JSON.parse(text.slice(start).trim());
  if (!Array.isArray(data)) return data;
  const merged = {};
  for (const src of data) if (src.type === 'document' && src.info) Object.assign(merged, src.info);
  return merged;
}

function checkCopilot(o, add, q, withMcp) {
  const mcp = withMcp ? q(['copilot', 'mcp', 'list', '--json']) : { ok: false, out: '' };
  for (const s of ['serena', 'playwright', 'playwright-extension', 'context-mode'].filter((t) => withMcp && o.tools.includes(t))) {
    add(`copilot mcp ${s}`, mcp.ok && mcp.out.includes(`"${s}"`) ? 'ok' : 'error', mcp.ok ? '' : 'copilot mcp list failed');
  }
  const rules = q(['copilot', 'instruction', 'list']);
  add('copilot rules loaded', rules.ok && rules.out.includes('copilot-instructions.md') ? 'ok' : 'error');
}

function checkCursor(o, add, q) {
  // `mcp list` starts every server, and Serena through uvx can take longer than 30s.
  const mcp = q(['cursor-agent', 'mcp', 'list'], 120000);
  for (const s of ['serena', 'playwright', 'playwright-extension', 'context-mode'].filter((t) => o.tools.includes(t))) {
    add(`cursor mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : 'cursor-agent mcp list failed');
  }
}

function checkAntigravity(o, core, add, q, withMcp, agy = 'agy') {
  const agents = q([agy, 'agents']).out;
  add('agy subagents loaded', core.every((a) => agents.includes(a)) ? 'ok' : 'error');
  const mcp = withMcp ? q([agy, 'mcp', 'list']) : { ok: false, out: '' };
  for (const s of ['serena', 'playwright'].filter((t) => withMcp && o.tools.includes(t))) {
    add(`agy mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : 'agy mcp list failed');
  }
  const plugins = q([agy, 'plugin', 'list', '--json']).out;
  for (const t of ['rtk'].filter((p) => o.tools.includes(p))) {
    add(`agy plugin ${t}`, plugins.includes(`"${t}"`) ? 'ok' : 'error');
  }
}

// Which Node runs each registered MCP command of a pinned tool, and skills that two folders of one agent both hold.
// Read-only, and it also covers machines lean-agents did not set up (#104 points 4-5, #132).
function checkInventory({ home, exec, run, env, platform, fsx }, add) {
  const rel = (p) => (p && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const nodes = mcpLaunches(home, { env, platform, fsx }).map((m) => {
    let nodeVersion = m.launch.nodeVersion;
    // Only with exec: a symlink or PATH Node has no version in its path, so ask it.
    if (!nodeVersion && exec && m.launch.node) nodeVersion = /\d+\.\d+\.\d+/.exec(run([m.launch.node, '--version'], 20000).out ?? '')?.[0] ?? null;
    const launch = { ...m.launch, nodeVersion };
    const v = classify(launch, m.pin);
    const status = v.status === 'wrong-node' ? 'error' : v.status === 'unknown' ? 'note' : 'ok';
    const where = `${m.client} mcp ${m.name}`;
    const major = minVersion(v.range)[0];
    const detail = v.status === 'wrong-node'
      ? `${m.pin} needs Node ${v.range} but this entry runs Node ${nodeVersion} (${launch.style}); run --update to register an absolute Node ${major}+ command (docs/manual-install.md)`
      : v.status === 'unknown' ? `${m.pin} needs Node ${v.range}; the Node behind this ${launch.style} entry could not be read`
        : `Node ${nodeVersion} (${launch.style})${v.fragile ? '; follows nvm use or PATH, so it can change, and VS Code or Cursor started outside this shell can resolve another Node' : ''}`;
    add(`node for ${where}`, status, detail);
    return { client: m.client, name: m.name, pin: m.pin, style: launch.style, node: rel(launch.node), nodeVersion, range: v.range, status };
  });
  const ORCA = new Set(['orca-cli', 'orchestration', 'computer-use']);
  const bySkill = new Map();
  for (const agent of ['claude', 'opencode', 'cursor', 'copilot']) {
    for (const d of duplicateSkills(skillDirs(agent, home), fsx)) {
      const k = `${d.name}\0${d.dirs.join('\0')}`;
      bySkill.set(k, { ...(bySkill.get(k) ?? { name: d.name, dirs: d.dirs.map(rel), differs: d.differs, unreadable: d.unreadable, winner: d.winner, agents: [] }), agents: [...(bySkill.get(k)?.agents ?? []), agent] });
    }
  }
  const skills = [...bySkill.values()];
  for (const s of skills) {
    const orca = ORCA.has(s.name) ? ' Orca installs this skill in both folders on purpose.' : '';
    add(`duplicate skill ${s.name}`, s.differs ? 'changed' : 'note',
      `in ${s.dirs.join(' and ')} (read by ${s.agents.join(', ')}); ${s.unreadable ? 'a copy is unreadable, so they could not be compared' : `the copies ${s.differs ? 'differ' : 'are identical'}`}; winner: ${s.winner}. Keep one folder.${orca}`);
  }
  return { nodes, skills };
}

// Redacted: npm error lines can carry proxy credentials or tokens, and doctor output gets pasted into issues.
export function npxFailDetail(out, opts) {
  const raw = (out ?? '').split('\n').find((l) => /error/i.test(l))?.trim();
  if (!raw) return '';
  const line = redactText(raw, opts).slice(0, 200);
  // npm prints `code ENOENT` first and the _npx path on a later line, so look at the whole output for the folder.
  const npx = /enoent/i.test(out) && out.match(/[^\s'"]*_npx[\\/][0-9a-f]+/i)?.[0];
  if (npx) return `${line} (broken npx cache entry: delete ${redactText(npx, opts)}, then run again)`;
  return line;
}

// Active Node compared to the project's engines.node; stops at home or root.
export function projectNode({ cwd, home, nodeVersion, fsx = fs }) {
  if (!cwd) return null;
  let dir = path.resolve(cwd);
  const rootHome = home ? path.resolve(home) : null;
  while (true) {
    const pkg = path.join(dir, 'package.json');
    if (fsx.existsSync(pkg)) {
      let data;
      try { data = JSON.parse(fsx.readFileSync(pkg, 'utf8')); } catch { return null; }
      const range = data?.engines?.node;
      if (typeof range !== 'string' || !range.trim()) return null;
      // shortcut: ranges are lower-bound only; exact pins compare major numbers.
      let fits = false;
      try {
        fits = /^\d+\.\d+\.\d+$/.test(range.trim())
          ? Number(String(nodeVersion).replace(/^v/, '').split('.')[0]) === Number(range.trim().split('.')[0])
          : satisfies(nodeVersion, range);
      } catch {
        fits = false;
      }
      const isUnder = rootHome && (pkg === rootHome || pkg.startsWith(rootHome + path.sep) || pkg.startsWith(rootHome + '/'));
      const rel = isUnder
        ? `~${pkg.slice(rootHome.length).startsWith('/') || pkg.slice(rootHome.length).startsWith('\\') ? '' : '/'}${pkg.slice(rootHome.length).replaceAll('\\', '/')}`
        : pkg;
      const status = fits ? 'ok' : 'note';
      const detail = fits
        ? `Node ${nodeVersion} fits engines.node ${range} in ${rel}; VS Code or Cursor started outside this shell can resolve another Node`
        : `Node ${nodeVersion} is active but ${rel} asks for engines.node ${range}: run nvm use (or your version manager) in this project; VS Code or Cursor started outside this shell can resolve another Node`;
      return { item: 'project Node', status, detail };
    }
    if (rootHome && dir === rootHome) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function doctor({ home, state, exec, nodeVersion = process.versions.node, json = false, run = quiet, env = process.env, platform = process.platform, fsx = fs, cwd = process.cwd(), probe = [], collect = null }) {
  const rows = [];
  const add = (item, status, detail = '') => rows.push({ item, status, detail });
  if (!state) {
    add('lean-agents', 'missing', 'not installed (run the installer)');
  } else {
    const o = { ...state.options };
    const network = o.network ?? fromPrivacy(o.privacy) ?? {};
    const q = (argv, timeout) => run(argv, timeout, childEnv(network));
    // `mcp list` starts every server (Serena through uvx git, Playwright), which is outbound traffic.
    const withMcp = network.outbound !== 'off';
    // A saved toolNode means Context Mode runs on its own Node, so the active one does not matter.
    const nodeNote = o.tools.includes('context-mode') && !state.toolNode && !satisfies(nodeVersion, nodeRange('context-mode')) ? nodeSkipLine('context-mode', nodeRange('context-mode'), nodeVersion) : '';
    if (nodeNote) o.tools = o.tools.filter((t) => t !== 'context-mode');
    add('lean-agents', 'ok', `v${state.version}, agents: ${o.agents.join(', ')}, privacy: ${o.privacy}`);
    const active = (exec && /\d+\.\d+\.\d+/.exec(version('node') ?? '')?.[0]) || nodeVersion;
    const pn = projectNode({ cwd, home, nodeVersion: active, fsx });
    if (pn) add(pn.item, pn.status, pn.detail);
    if (nodeNote) add('context-mode', 'note', nodeNote);
    if (o.agents.includes('opencode-v1')) add('OpenCode 1.x: supported; lean-agents will not upgrade it', 'ok');
    const shell = shellNotice();
    if (shell) add('shell', shell.ok ? 'ok' : 'note', shell.text);
    if (o.terminals?.length) add('terminals', 'ok', `integrations for ${o.terminals.join(', ')} (commands listed below; app settings are yours)`);
    for (const t of stillNeeded({ home, terminals: o.terminals ?? [], agents: o.agents, exec })) {
      add('still needed', t.check?.() ? 'ok' : 'note', t.text);
    }
    const latest = [...new Map(state.files.map((f) => [f.path, f])).values()];
    for (const f of latest) {
      const rel = f.path.startsWith(home) ? `~${f.path.slice(home.length)}` : f.path;
      if (!fs.existsSync(f.path)) { add(rel, 'error', 'missing'); continue; }
      const same = sha(fs.readFileSync(f.path, 'utf8')) === f.hash;
      add(rel, same ? 'ok' : 'changed', same ? '' : 'edited since install (fine if on purpose)');
    }
    // Drift: the installer pinned other versions than core/pins.json lists now (a newer lean-agents, or an edited pin).
    const drift = Object.entries(state.pins ?? {}).filter(([k, v]) => PINS[k] && PINS[k].version !== v);
    for (const [k, v] of drift) add(`pin ${k}`, 'changed', `installed ${v}, core/pins.json has ${PINS[k].version} (run --update)`);
    if (state.pins && !drift.length) add('pinned versions', 'ok', `${Object.keys(state.pins).length} pins match core/pins.json`);
    for (const c of state.commands) add(c.desc, c.ok ? 'ok' : 'error', c.ok ? '' : 'failed at install time');
    if (o.tools.includes('i-have-adhd')) {
      const reset = adhdSkillFiles(home).filter((f) => fs.readFileSync(f, 'utf8').includes('disable-model-invocation: true'));
      if (reset.length) add('i-have-adhd skill', 'changed', 'a plugin update reset it; run --update');
    }
    if (o.agents.includes('vscode-copilot')) add('Copilot extension', 'skipped', 'managed by VS Code, not lean-agents: install and update it from the Extensions view');
    if (exec) {
      for (const [bin, tool] of [['claude', 'claude'], ['opencode', 'opencode-v1'], ['opencode', 'opencode-v2'], ['copilot', 'copilot-cli'], ['agy', 'antigravity'], ['rtk', 'rtk'], ['context-mode', 'context-mode'], ['uvx', 'serena']]) {
        const needed = o.agents.includes(tool) || o.tools.includes(tool);
        if (!needed) continue;
        if (bin === 'context-mode' && state.toolNode?.version) {
          const nvm = findNvm({ env, home, platform, realHome: env.HOME || env.USERPROFILE || home });
          if (nvm) {
            const dir = nvm.win ? path.join(nvm.dir, `v${state.toolNode.version}`) : path.join(nvm.dir, 'versions', 'node', `v${state.toolNode.version}`);
            const n = nodeAt(nvm, dir, state.toolNode.version);
            const cli = path.join(n.modules, 'context-mode', 'package.json');
            const found = fsx.existsSync(cli);
            add(`context-mode on Node ${state.toolNode.version}`, found ? 'ok' : 'error', found ? cli : `not found: ${cli}`);
            continue;
          }
        }
        const at = bin === 'agy' ? findAgy(home, platform, env) ?? bin : bin;
        const v = version(at, undefined, childEnv(network));
        add(at === bin ? `${bin} on PATH` : `${bin} found outside PATH`, v ? 'ok' : 'error', v ?? 'not found');
      }
      for (const [bin, agent] of [['code', 'vscode-copilot'], ['cursor-agent', 'cursor']]) {
        if (!o.agents.includes(agent)) continue;
        const v = version(bin, undefined, childEnv(network));
        add(`${bin} on PATH`, v ? 'ok' : 'error', v ?? 'not found');
      }
      if (!withMcp && ['claude', 'cursor', 'copilot-cli', 'antigravity'].some((a) => o.agents.includes(a))) add('mcp servers', 'skipped', 'network off (outbound off): `mcp list` not run');
      if (o.agents.includes('cursor') && withMcp) checkCursor(o, add, q);
      if (o.agents.includes('claude') && withMcp) {
        const mcp = q(['claude', 'mcp', 'list']);
        for (const s of ['serena', 'playwright'].filter((t) => o.tools.includes(t))) {
          add(`claude mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : 'claude mcp list failed');
        }
      }
      if (o.agents.some((a) => a.startsWith('opencode'))) checkOpenCode(o, add, q);
      if (o.agents.includes('copilot-cli')) checkCopilot(o, add, q, withMcp);
      if (o.agents.includes('antigravity')) checkAntigravity(o, CORE_AGENTS, add, q, withMcp, findAgy(home, platform, env) ?? 'agy');
      // npx may have to download, which takes longer than a local check.
      if (o.tools.includes('codeburn')) {
        const r = q(['npx', '-y', npmSpec('codeburn'), '--version'], 120000);
        add('codeburn runs', r.ok ? 'ok' : 'error', r.ok ? '' : npxFailDetail(r.out, { home, env }));
      }
      if (o.tools.includes('autoskills')) {
        const r = q(['npx', '-y', npmSpec('autoskills'), '--help'], 120000);
        add('autoskills runs', r.ok ? 'ok' : 'error', r.ok ? '' : npxFailDetail(r.out, { home, env }));
      }
    }
  }
  checkAntigravityIde(home, add, fsx);
  const { nodes, skills } = checkInventory({ home, exec, run, env, platform, fsx }, add);
  // #212: config listing a plugin is not proof it loads. Read-only; `probe` holds findings of the opt-in --probe-plugins server run.
  if (state?.options.agents.some((a) => a.startsWith('opencode'))) {
    for (const f of [...pluginHealth(home, { fsx }), ...probe]) add(`plugin ${f.plugin || 'probe'} ${f.id}`, ['deps-incomplete', 'command-missing'].includes(f.id) ? 'error' : 'changed', `${f.line}. Fix: ${f.fix}`);
  }
  const left = leftovers(process.cwd());
  if (left.length) add('parallel workers', 'changed', `left in this repo: ${left.join(', ')} (merge them, then run scripts/parallel.mjs clean)`);
  const netRows = proxyReport();
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'NODE_USE_SYSTEM_CA']) if (!netRows.some((l) => l.startsWith(`${name}=`))) netRows.push(`${name}=not set`);
  for (const line of netRows) add('network env', 'ok', line);
  const ok = !rows.some((r) => r.status === 'error' || r.status === 'missing');
  const behind = state ? behindPins(state) : [];
  if (json) process.stdout.write(`${JSON.stringify({ ok, behind, nodes, skills, rows }, null, 2)}\n`);
  else if (collect) collect.push(...rows);
  else print(rows);
  return ok;
}

// Read-only (#216): a row only when the IDE folders or the extension exist.
function checkAntigravityIde(home, add, fsx) {
  const found = antigravityFootprint(home, fsx);
  if (found.length) add('antigravity ide', 'ok', found.map((f) => f.name).join(', '));
}

function checkOpenCode(o, add, q) {
  const r = q(['opencode', 'debug', 'config']);
  if (!r.ok) return add('opencode resolved config', 'error', '`opencode debug config` failed');
  let cfg;
  try { cfg = resolvedOpenCodeConfig(r.out); } catch { return add('opencode resolved config', 'changed', 'could not parse output; check by hand'); }
  cfg = redact(cfg);
  const servers = cfg.mcp?.servers ?? cfg.mcp ?? {};
  const v1 = o.agents.includes('opencode-v1');
  for (const s of ['context-mode', 'serena', 'playwright', 'playwright-extension'].filter((t) => o.tools.includes(t) && !(v1 && t === 'context-mode'))) {
    add(`opencode mcp ${s}`, servers[s] ? 'ok' : 'error', servers[s] ? '' : 'not in resolved config');
  }
  const plugins = [...(cfg.plugins ?? []), ...(cfg.plugin ?? [])].map(String);
  if (v1 && o.tools.includes('context-mode')) {
    const loaded = plugins.some((p) => p.includes('context-mode'));
    add('opencode plugin context-mode', loaded ? 'ok' : 'error', loaded ? '' : 'not in resolved config');
  }
  if (plugins.some((p) => p.includes('context-mode')) && servers['context-mode']) {
    add('context-mode duplicate', 'error', 'enabled as plugin and MCP; keep one');
  }
  if (plugins.some((p) => p.includes('oh-my-openagent'))) add('oh-my-openagent', 'error', 'present; lean-agents does not support it');
  const instr = (cfg.instructions ?? []).some((i) => String(i).includes('lean-agents'));
  add('opencode rules loaded', instr ? 'ok' : 'error', instr ? '' : 'instructions entry missing');
}

function print(rows) {
  const w = Math.min(48, Math.max(...rows.map((r) => r.item.length)));
  for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.item.padEnd(w)} ${r.detail}`);
}
