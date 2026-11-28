// Doctor: compares what lean-agents installed with what is on disk and what the agents load.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { sha, homeRel, userHash } from './fsops.mjs';
import { PINS, npmSpec, behindPins, nodeRange, rtkPin, rtkTooOld } from './pins.mjs';
import { version, quiet, findAgy, antigravityFootprint, wingetAnswer, configHome } from './system.mjs';
import { redactText } from './redact.mjs';
import { satisfies, compare, nodeSkipLine, minVersion, findNvm, nodeAt, installedNodes, nodeFloorFix } from './node-runtime.mjs';
import { mcpLaunches, classify, duplicateSkills, skillDirs } from './inventory.mjs';
import { stillNeeded, shellNotice } from './terminals.mjs';
import { adhdSkillFiles } from './adhd.mjs';
import { proxyReport, childEnv, fromPrivacy } from './network.mjs';
import { leftovers } from './parallel.mjs';
import { pluginHealth, dcpRow, codeModeRow } from './plugin-health.mjs';
import { configPath, localPluginFiles, legacyTuiShape, copilotMeterShape } from './adapters/opencode-v2.mjs';
import { serviceGuard } from './opencode-backup.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
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
  const mcp = withMcp ? q(['copilot', 'mcp', 'list', '--json'], 90000) : { ok: false, out: '' };
  for (const s of ['serena', 'playwright', 'playwright-extension', 'context-mode'].filter((t) => withMcp && o.tools.includes(t))) {
    add(`copilot mcp ${s}`, mcp.ok && mcp.out.includes(`"${s}"`) ? 'ok' : 'error', mcp.ok ? '' : (mcp.failed ? 'copilot mcp list timed out or did not run (90 s limit)' : `copilot mcp list exited ${mcp.status}`));
  }
  const rules = q(['copilot', 'instruction', 'list']);
  add('copilot rules loaded', rules.ok && rules.out.includes('copilot-instructions.md') ? 'ok' : 'error');
}

function checkCursor(o, add, q) {
  // `mcp list` starts every server, and Serena through uvx can take longer than 30s.
  const mcp = q(['cursor-agent', 'mcp', 'list'], 120000);
  for (const s of ['serena', 'playwright', 'playwright-extension', 'context-mode'].filter((t) => o.tools.includes(t))) {
    add(`cursor mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : (mcp.failed ? 'cursor-agent mcp list timed out or did not run (120 s limit)' : `cursor-agent mcp list exited ${mcp.status}`));
  }
}

function checkAntigravity(o, core, add, q, withMcp, agy = 'agy') {
  const agents = q([agy, 'agents']).out;
  add('agy subagents loaded', core.every((a) => agents.includes(a)) ? 'ok' : 'error');
  const mcp = withMcp ? q([agy, 'mcp', 'list'], 90000) : { ok: false, out: '' };
  for (const s of ['serena', 'playwright'].filter((t) => withMcp && o.tools.includes(t))) {
    add(`agy mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : (mcp.failed ? `${agy} mcp list timed out or did not run (90 s limit)` : `${agy} mcp list exited ${mcp.status}`));
  }
  const plugins = q([agy, 'plugin', 'list', '--json']).out;
  for (const t of ['rtk'].filter((p) => o.tools.includes(p))) {
    add(`agy plugin ${t}`, plugins.includes(`"${t}"`) ? 'ok' : 'error');
  }
}

// Skill names lean-agents installed: saved records keep only `undo`, which for skills is `npx -y skills@<v> remove <names> -g -y`.
export function ownSkills(state) {
  const names = new Set();
  if (!state) return names;
  // A failed install (ok false) does not own the name: the copies may be the user's.
  for (const argv of (state.commands ?? []).filter((c) => c.ok).flatMap((c) => c.undo ?? [])) {
    if (!/^skills@/.test(argv[2] ?? '') || argv[3] !== 'remove') continue;
    for (const a of argv.slice(4)) { if (a.startsWith('-')) break; names.add(a); }
  }
  return names;
}

// #562: Context Mode 2.1.7 resolves the project only from `--agent <id>` or CLAUDE_PROJECT_DIR, so an MCP entry without it
// fails every ctx_* call. Own function so parallel doctor work (#556, #558) does not collide.
function checkContextModeAgent(nodes, add, { home, platform }) {
  for (const n of nodes.filter((x) => x.pin === 'context-mode' && !x.hasAgent)) {
    const fix = n.client === 'cursor'
      ? `remove the context-mode entry from Cursor's mcp.json (lean-agents no longer manages it): ${homeRel(n.file, home, platform)}`
      : 'run lean-agents --update';
    add(`context-mode agent for ${n.client} mcp ${n.name}`, 'error',
      `Context Mode needs --agent <id>; without it every ctx_* call fails with "Project source --agent is missing". Fix: ${fix}`);
  }
}

// Which Node runs each registered MCP command of a pinned tool, and skills that two folders of one agent both hold.
// Read-only, and it also covers machines lean-agents did not set up (#104 points 4-5, #132).
function checkInventory({ home, exec, run, env, platform, fsx, state }, add) {
  const rel = (p) => homeRel(p, home, platform);
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
    return { client: m.client, name: m.name, file: rel(m.file), pin: m.pin, style: launch.style, node: rel(launch.node), nodeVersion, range: v.range, status, hasAgent: m.hasAgent };
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
  const own = ownSkills(state);
  for (const s of skills) {
    if (!s.differs && !s.unreadable && own.has(s.name)) {
      add(`duplicate skill ${s.name}`, 'ok',
        `in ${s.dirs.join(' and ')} (read by ${s.agents.join(', ')}); identical copies that lean-agents installed (the Skills CLI writes one per agent folder)`);
      continue;
    }
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
  let line = redactText(raw, opts).slice(0, 200);
  if (/ECOMPROMISED|EINTEGRITY/.test(out)) line += '. Fix: run npm cache verify, then --doctor again';
  // npm prints `code ENOENT` first and the _npx path on a later line, so look at the whole output for the folder.
  const npx = /enoent/i.test(out) && out.match(/[^\s'"]*_npx[\\/][0-9a-f]+/i)?.[0];
  if (npx) return `${line} (broken npx cache entry: delete ${redactText(npx, opts)}, then run again)`;
  return line;
}

// The active Node against the nearest package.json engines.node, from cwd up to home (or the root).
export function projectNode({ cwd, home, nodeVersion, fsx = fs }) {
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    const pkg = path.join(dir, 'package.json');
    if (fsx.existsSync(pkg)) {
      let range;
      try { range = JSON.parse(fsx.readFileSync(pkg, 'utf8')).engines?.node; } catch { return null; }
      if (typeof range !== 'string' || !range.trim()) return null;
      const short = homeRel(pkg, home);
      const rel = short === pkg ? pkg : short.replaceAll('\\', '/');
      const gui = '; VS Code or Cursor started outside this shell can resolve another Node';
      // shortcut: only an exact version and >=a.b.c are checked; ^, ~, x and || ranges get a note, add a parser when a real project needs one.
      let fits;
      try { fits = /^\d+\.\d+\.\d+$/.test(range.trim()) ? compare(nodeVersion, range.trim()) === 0 : satisfies(nodeVersion, range); } catch {
        return { item: 'project Node', status: 'note', detail: `Node ${nodeVersion} is active; ${rel} asks for engines.node ${range}, which lean-agents does not check${gui}` };
      }
      return fits
        ? { item: 'project Node', status: 'ok', detail: `Node ${nodeVersion} fits engines.node ${range} in ${rel}${gui}` }
        : { item: 'project Node', status: 'note', detail: `Node ${nodeVersion} is active but ${rel} asks for engines.node ${range}: run nvm use (or your version manager) in this project${gui}` };
    }
    if (dir === path.resolve(home) || path.dirname(dir) === dir) return null;
  }
}

// #592: the probes below run `opencode debug config`, which auto-starts the OpenCode 2 service. Every caller (--doctor, the --update
// summary, --adopt) goes through here, so the service is stopped again only when these checks started it (#548).
export function doctor(opts) {
  // Without exec no probe runs, so nothing starts a service: list nothing and stop nothing.
  if (!opts.exec) return doctorChecks(opts);
  const guard = serviceGuard({ agents: opts.state?.options?.agents });
  try { return doctorChecks(opts); } finally { guard.stop(opts.run ?? quiet, opts.json ? console.error : console.log); }
}

function doctorChecks({ home, state, exec, nodeVersion = process.versions.node, json = false, run = quiet, env = process.env, platform = process.platform, fsx = fs, cwd = process.cwd(), probe = [], probed = false, collect = null }) {
  const rows = [];
  const add = (item, status, detail = '') => rows.push({ item, status, detail });

  const active = (exec && /\d+\.\d+\.\d+/.exec(version('node') ?? '')?.[0]) || nodeVersion;
  const floor = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node;
  const nodeRow = satisfies(active, floor)
    ? { status: 'ok', detail: `Node ${active}` }
    : (() => {
      const nvm = findNvm({ env, home, platform, realHome: env.HOME || env.USERPROFILE || home });
      return { status: 'error', detail: `Node ${active} is older than ${floor.replace(/^>=/, '')}, which lean-agents needs. Fix: ${nodeFloorFix(floor, nvm ? installedNodes(nvm) : [])}` };
    })();

  if (!state) {
    add('lean-agents', 'missing', 'not installed (run the installer)');
    add('node for lean-agents', nodeRow.status, nodeRow.detail);
  } else {
    const o = { ...state.options };
    const network = o.network ?? fromPrivacy(o.privacy) ?? {};
    const q = (argv, timeout) => run(argv, timeout, childEnv(network));
    // `mcp list` starts every server (Serena through uvx git, Playwright), which is outbound traffic.
    const withMcp = network.outbound !== 'off';
    // A saved toolNode means Context Mode runs on its own Node, so the active one does not matter.
    const nodeNote = o.tools.includes('context-mode') && !state.toolNode && !satisfies(nodeVersion, nodeRange('context-mode')) ? nodeSkipLine('context-mode', nodeRange('context-mode'), nodeVersion) : '';
    if (nodeNote) o.tools = o.tools.filter((t) => t !== 'context-mode');
    
    // #370 Active setup row
    const rulesFile = state.files.find((f) => /AGENTS\.md|CLAUDE\.md|copilot-instructions\.md|instructions/i.test(f.path) && fsx.existsSync(f.path));
    const rulesSize = rulesFile ? fsx.statSync(rulesFile.path).size : 0;
    const subagentsCount = state.files.filter((f) => f.path.replace(/\\/g, '/').includes('/agents/') && f.path.endsWith('.md')).length;
    add('Active setup', 'ok', `rules ${rulesSize} bytes (~${Math.round(rulesSize / 4)} tokens), tools on: ${o.tools.join(', ') || 'none'}, subagents: ${subagentsCount}`);

    add('lean-agents', 'ok', `v${state.version}, agents: ${o.agents.join(', ')}, privacy: ${o.privacy}`);
    add('node for lean-agents', nodeRow.status, nodeRow.detail);
    if (state.pending?.steps?.length) add('pending', 'note', `${state.pending.steps.length} OpenCode steps deferred from ${String(state.pending.since).slice(0, 10)}; close OpenCode, then run \`lean-agents --update\` in a terminal`);
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
      const rel = homeRel(f.path, home, platform);
      if (!fs.existsSync(f.path)) { add(rel, 'error', 'missing. Fix: run lean-agents again to restore it'); continue; }
      const text = fs.readFileSync(f.path, 'utf8');
      const usableIgnore = Array.isArray(f.ignore) && f.ignore.every((e) => e && Array.isArray(e.path) && e.path.length && e.path.every((k) => typeof k === 'string'));
      const same = f.userHash && usableIgnore ? userHash(text, f.ignore) === f.userHash : sha(text) === f.hash;
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
        if (bin === 'rtk' && rtkTooOld(v)) { add('rtk on PATH', 'error', `${v}, older than ${rtkPin().min} (lean-agents min): update it and make it first on PATH`); continue; }
        add(at === bin ? `${bin} on PATH` : `${bin} found outside PATH`, v ? 'ok' : 'error', v ?? 'not found');
      }
      // VS Code: stable or Insiders, whichever is on PATH.
      for (const [bins, agent] of [[['code', 'code-insiders'], 'vscode-copilot'], [['cursor-agent'], 'cursor']]) {
        if (!o.agents.includes(agent)) continue;
        let hit = null;
        for (const b of bins) { const v = version(b, undefined, childEnv(network)); if (v) { hit = [b, v]; break; } }
        add(`${hit?.[0] ?? bins[0]} on PATH`, hit ? 'ok' : 'error', hit?.[1] ?? 'not found');
      }
      if (!withMcp && ['claude', 'cursor', 'copilot-cli', 'antigravity'].some((a) => o.agents.includes(a))) add('mcp servers', 'skipped', 'network off (outbound off): `mcp list` not run');
      if (o.agents.includes('cursor') && withMcp) checkCursor(o, add, q);
      if (o.agents.includes('claude') && withMcp) {
        const mcp = q(['claude', 'mcp', 'list'], 90000);
        for (const s of ['serena', 'playwright'].filter((t) => o.tools.includes(t))) {
          add(`claude mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : (mcp.failed ? 'claude mcp list timed out or did not run (90 s limit)' : `claude mcp list exited ${mcp.status}`));
        }
      }
      if (o.agents.some((a) => a.startsWith('opencode'))) checkOpenCode(o, add, q, home, fsx);
      if (o.agents.includes('copilot-cli')) checkCopilot(o, add, q, withMcp);
      if (o.agents.includes('antigravity')) checkAntigravity(o, CORE_AGENTS, add, q, withMcp, findAgy(home, platform, env) ?? 'agy');
      // npx may have to download, which takes longer than a local check.
      if (o.tools.includes('codeburn')) {
        const r = q(['npx', '-y', npmSpec('codeburn'), '--version'], 120000);
        add('codeburn runs', r.ok ? 'ok' : 'error', r.ok ? '' : npxFailDetail(r.out, { home, env }));
      }
      // Code Mode needs Claude Code 2.1.323+; an older CLI ignores the setting (#304).
      if (o.tools.includes('code-mode') && o.agents.includes('claude')) {
        const v = /\d+\.\d+\.\d+/.exec(q(['claude', '--version']).out ?? '')?.[0];
        if (v) add('Claude Code Mode', compare(v, '2.1.323') < 0 ? 'note' : 'ok', compare(v, '2.1.323') < 0 ? `Claude Code ${v} is older than 2.1.323: the setting is on, Code Mode stays off until --update moves the pin` : `Claude Code ${v}`);
      }
      if (o.tools.includes('autoskills')) {
        const r = q(['npx', '-y', npmSpec('autoskills'), '--help'], 120000);
        add('autoskills runs', r.ok ? 'ok' : 'error', r.ok ? '' : npxFailDetail(r.out, { home, env }));
      }
    }
  }
  checkAntigravityIde({ home, exec, run, platform, fsx }, add);
  const { nodes, skills } = checkInventory({ home, exec, run, env, platform, fsx, state }, add);
  checkContextModeAgent(nodes, add, { home, platform });
  // #212: config listing a plugin is not proof it loads. Read-only; `probe` holds findings of the opt-in --probe-plugins server run.
  const dcp = dcpRow(home, { fsx, probe, probed });
  if (dcp) add('DCP', dcp.status, dcp.detail);
  openCodeTuiRows({ home, state, platform, fsx }, add);
  const cm = codeModeRow(home, { fsx });
  if (cm) add('OpenCode Code Mode', cm.status, cm.detail);
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

// Read-only (#216, #466): a row only when config folders or the extension exist; the status comes from the app itself, since
// the folders also belong to the agy CLI. The app is probed only with exec (winget); other platforms: unknown.
function checkAntigravityIde({ home, exec, run, platform, fsx }, add) {
  const found = antigravityFootprint(home, fsx);
  if (!found.length) return;
  const folders = found.map((f) => f.name).join(', ');
  const link = 'https://antigravity.google/download';
  if (platform === 'darwin') {
    const there = ['/Applications', path.join(home, 'Applications')].some((d) => fsx.existsSync(path.join(d, 'Antigravity.app')));
    if (there) return add('antigravity ide', 'ok', folders);
    return add('antigravity ide', 'note', `app not installed (config found: ${folders}); download: ${link}`);
  }
  if (platform === 'win32') {
    if (!exec) return add('antigravity ide', 'note', `app check skipped without exec (config found: ${folders})`);
    const app = wingetAnswer(run(['winget', 'list', '--id', 'Google.Antigravity', '-e'], 20000));
    if (app === 'present') return add('antigravity ide', 'ok', folders);
    if (app === 'absent') return add('antigravity ide', 'note', `app not installed (config found: ${folders}); download: ${link}`);
    return add('antigravity ide', 'note', `could not check whether the app is installed (config found: ${folders}); download: ${link}`);
  }
  add('antigravity ide', 'note', `app check not available on this OS (config found: ${folders})`);
}

// 1.x MCP field names that OpenCode 2 ignores (#556). Read from the live file so a field OpenCode drops is still reported.
const STALE_MCP_OAUTH = { clientId: 'client_id', clientSecret: 'client_secret', callbackPort: 'callback_port', redirectUri: 'redirect_uri' };
export function staleMcpFields(cfg) {
  const out = [];
  for (const [name, s] of Object.entries(cfg?.mcp?.servers ?? {})) {
    if (!s || typeof s !== 'object') continue;
    if (s.enabled !== undefined) out.push(`mcp.servers.${name}.enabled -> disabled`);
    if (!s.oauth || typeof s.oauth !== 'object') continue;
    for (const [from, to] of Object.entries(STALE_MCP_OAUTH)) {
      if (s.oauth[from] !== undefined) out.push(`mcp.servers.${name}.oauth.${from} -> oauth.${to}`);
    }
  }
  return out;
}

function checkOpenCode(o, add, q, home, fsx) {
  // A file that already went through the upgrade can still hold 1.x MCP names (#556): OpenCode 2 ignores them.
  let stale = [];
  try {
    for (const f of ['opencode.jsonc', 'opencode.json']) {
      const p = path.join(configHome(home), 'opencode', f);
      if (!fsx.existsSync(p)) continue;
      stale = staleMcpFields(parse(fsx.readFileSync(p, 'utf8'), [], { allowTrailingComma: true }));
      break;
    }
  } catch { /* unreadable config: the debug config check below still runs */ }
  if (stale.length) add('opencode mcp 1.x keys', 'changed', `${stale.join('; ')}. Fix: run lean-agents --update to rename them`);
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

// #558: OpenCode 2's TUI reads cli.json (not tui.json), a stale tui.json is only reported, and a local plugin written for
// the 1.x TUI API is named by path as not loaded. Read-only; never prints plugin file contents.
function openCodeTuiRows({ home, state, platform = process.platform, fsx = fs }, add) {
  const dir = path.join(configHome(home), 'opencode');
  const cli = path.join(dir, 'cli.json');
  const hasCli = fsx.existsSync(cli);
  const v2 = hasCli || state?.options?.agents?.includes('opencode-v2');
  if (!v2) return;
  const rel = (p) => homeRel(p, home, platform);
  if (hasCli) {
    for (const name of ['tui.json', 'tui.jsonc']) {
      const f = path.join(dir, name);
      if (fsx.existsSync(f)) add(`OpenCode ${name}`, 'changed', `stale: OpenCode 2 reads cli.json, not this file. Fix: delete ${rel(f)} by hand once you need nothing from it; lean-agents never deletes it`);
    }
  }
  const read = (f) => { try { return parse(fsx.readFileSync(f, 'utf8')); } catch { return null; } };
  const dcp = '@tarquinen/opencode-dcp';
  const spec = (v) => typeof v === 'string' && (v === dcp || v.startsWith(`${dcp}@`));
  const server = read(configPath(dir));
  const tuiFiles = [['cli.json', read(cli)], ['tui.json', read(path.join(dir, 'tui.json'))], ['tui.jsonc', read(path.join(dir, 'tui.jsonc'))]]
    .filter(([, cfg]) => (cfg?.plugins ?? cfg?.plugin ?? []).some(spec))
    .map(([name]) => name);
  if ((server?.plugins ?? server?.plugin ?? []).some(spec) && tuiFiles.length) {
    add('DCP /dcp duplicate', 'changed', `DCP is listed in opencode.jsonc and ${tuiFiles.join(' and ')}, so the TUI lists /dcp twice; opencode.jsonc already loads its TUI part. Fix: run lean-agents --update (it removes the duplicate TUI entries, backed up)`);
  }
  const seen = new Set();
  for (const p of localPluginFiles(dir, { fsx, home })) {
    if (seen.has(p.file) || !legacyTuiShape(p.text)) continue;
    seen.add(p.file);
    const where = rel(p.file);
    add(`plugin ${path.basename(p.file)}`, 'changed', copilotMeterShape(p.text)
      ? `hand-made copilot-usage meter, not loaded on OpenCode 2. Fix: replace it with the managed tool: lean-agents --add-tools copilot-usage (removes this one entry, backed up; undo with --uninstall). File: ${where}`
      : `not loaded on OpenCode 2: uses the 1.x TUI API (api.command/api.slots). Fix: port it to the 2.x plugin API or remove its entry; lean-agents leaves the file alone. File: ${where}`);
  }
}

function print(rows) {
  const w = Math.min(48, Math.max(...rows.map((r) => r.item.length)));
  for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.item.padEnd(w)} ${r.detail}`);
}
