// Doctor: compares what lean-agents installed with what is on disk and what the agents load.
import fs from 'node:fs';
import path from 'node:path';
import { sha } from './fsops.mjs';
import { version, quiet } from './system.mjs';

const SECRET_KEY = /(key|token|secret|password|auth)/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]));
  }
  return value;
}

// `opencode debug config` may print log lines around the JSON: take the first balanced object.
export function firstJsonObject(text) {
  const lineStart = text.search(/^\{/m);
  const start = lineStart >= 0 ? lineStart : text.indexOf('{');
  let depth = 0;
  let inString = false;
  for (let i = start; i >= 0 && i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('no JSON object found');
}

export function doctor({ home, state, exec }) {
  const rows = [];
  const add = (item, status, detail = '') => rows.push({ item, status, detail });
  if (!state) {
    add('lean-agents', 'missing', 'not installed (run the installer)');
  } else {
    const o = state.options;
    add('lean-agents', 'ok', `v${state.version}, agents: ${o.agents.join(', ')}, privacy: ${o.privacy}`);
    const latest = [...new Map(state.files.map((f) => [f.path, f])).values()];
    for (const f of latest) {
      const rel = f.path.startsWith(home) ? `~${f.path.slice(home.length)}` : f.path;
      if (!fs.existsSync(f.path)) { add(rel, 'error', 'missing'); continue; }
      const same = sha(fs.readFileSync(f.path, 'utf8')) === f.hash;
      add(rel, same ? 'ok' : 'changed', same ? '' : 'edited since install (fine if on purpose)');
    }
    for (const c of state.commands) add(c.desc, c.ok ? 'ok' : 'error', c.ok ? '' : 'failed at install time');
    if (exec) {
      for (const [bin, tool] of [['claude', 'claude'], ['opencode', 'opencode-v2'], ['rtk', 'rtk'], ['context-mode', 'context-mode'], ['uvx', 'serena']]) {
        const needed = o.agents.includes(tool) || o.tools.includes(tool);
        if (!needed) continue;
        const v = version(bin);
        add(`${bin} on PATH`, v ? 'ok' : 'error', v ?? 'not found');
      }
      if (o.agents.includes('claude')) {
        const mcp = quiet(['claude', 'mcp', 'list']);
        for (const s of ['serena', 'playwright'].filter((t) => o.tools.includes(t))) {
          add(`claude mcp ${s}`, mcp.ok && mcp.out.includes(s) ? 'ok' : 'error', mcp.ok ? '' : 'claude mcp list failed');
        }
      }
      if (o.agents.includes('opencode-v2')) checkOpenCode(o, add);
    }
  }
  print(rows);
  return !rows.some((r) => r.status === 'error' || r.status === 'missing');
}

function checkOpenCode(o, add) {
  const r = quiet(['opencode', 'debug', 'config']);
  if (!r.ok) return add('opencode resolved config', 'error', '`opencode debug config` failed');
  let cfg;
  try { cfg = firstJsonObject(r.out); } catch { return add('opencode resolved config', 'changed', 'could not parse output; check by hand'); }
  cfg = redact(cfg);
  const servers = cfg.mcp?.servers ?? cfg.mcp ?? {};
  for (const s of ['context-mode', 'serena', 'playwright'].filter((t) => o.tools.includes(t))) {
    add(`opencode mcp ${s}`, servers[s] ? 'ok' : 'error', servers[s] ? '' : 'not in resolved config');
  }
  const plugins = [...(cfg.plugins ?? []), ...(cfg.plugin ?? [])].map(String);
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
