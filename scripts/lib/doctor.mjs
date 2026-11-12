// Doctor: compares what lean-agents installed with what is on disk and what the agents load.
import fs from 'node:fs';
import path from 'node:path';
import { sha } from './fsops.mjs';
import { PINS, npmSpec, behindPins, nodeRange } from './pins.mjs';
import { version, quiet } from './system.mjs';
import { satisfies, nodeSkipLine } from './node-runtime.mjs';
import { stillNeeded, shellNotice } from './terminals.mjs';
import { adhdSkillFiles } from './adhd.mjs';
import { proxyReport, childEnv, fromPrivacy } from './network.mjs';
import { leftovers } from './parallel.mjs';

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

function checkAntigravity(o, core, add, q, withMcp) {
  const agents = q(['agy', 'agents']).out;
  add('agy subagents loaded', core.every((a) => agents.includes(a)) ? 'ok' : 'error');
  const mcp = withMcp ? q(['agy', 'mcp', 'list']) : { ok: false, out: '' };
  for (const s of ['serena', 'playwright'].filter((t) => withMcp && o.tools.includes(t))) {
    add(`agy mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : 'agy mcp list failed');
  }
  const plugins = q(['agy', 'plugin', 'list', '--json']).out;
  for (const t of ['rtk'].filter((p) => o.tools.includes(p))) {
    add(`agy plugin ${t}`, plugins.includes(`"${t}"`) ? 'ok' : 'error');
  }
}

export function doctor({ home, state, exec, nodeVersion = process.versions.node, json = false, run = quiet }) {
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
    if (exec) {
      for (const [bin, tool] of [['claude', 'claude'], ['opencode', 'opencode-v1'], ['opencode', 'opencode-v2'], ['copilot', 'copilot-cli'], ['agy', 'antigravity'], ['rtk', 'rtk'], ['context-mode', 'context-mode'], ['uvx', 'serena']]) {
        const needed = o.agents.includes(tool) || o.tools.includes(tool);
        if (!needed) continue;
        const v = version(bin, undefined, childEnv(network));
        add(`${bin} on PATH`, v ? 'ok' : 'error', v ?? 'not found');
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
      if (o.agents.includes('antigravity')) checkAntigravity(o, CORE_AGENTS, add, q, withMcp);
      // npx may have to download, which takes longer than a local check.
      if (o.tools.includes('codeburn')) add('codeburn runs', q(['npx', '-y', npmSpec('codeburn'), '--version'], 120000).ok ? 'ok' : 'error');
      if (o.tools.includes('autoskills')) add('autoskills runs', q(['npx', '-y', npmSpec('autoskills'), '--help'], 120000).ok ? 'ok' : 'error');
    }
  }
  const left = leftovers(process.cwd());
  if (left.length) add('parallel workers', 'changed', `left in this repo: ${left.join(', ')} (merge them, then run scripts/parallel.mjs clean)`);
  for (const line of proxyReport()) add('network env', 'ok', line);
  const ok = !rows.some((r) => r.status === 'error' || r.status === 'missing');
  const behind = state ? behindPins(state) : [];
  if (json) process.stdout.write(`${JSON.stringify({ ok, behind, rows }, null, 2)}\n`);
  else print(rows);
  return ok;
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
