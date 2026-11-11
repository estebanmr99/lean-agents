// --migrate: copy one harness's rules, agents, skills, prompts and MCP servers to the agents you pick.
// Hooks are only reported. MCP env and header values are never read into the result, only their names.
// Source paths and their upstream docs: docs/compatibility.md "Migration sources".
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { OWNED_MARK, hasMark, removeBlock } from './fsops.mjs';
import { parseAgent } from './render.mjs';
import { configHome, envDir } from './system.mjs';
import { configPath, renderOpenCodeAgent } from './adapters/opencode-v2.mjs';
import { vscodeUserDir } from './adapters/vscode-copilot.mjs';
import { renderClaudeAgent } from './adapters/claude.mjs';
import { renderCopilotAgent } from './adapters/copilot-cli.mjs';
import { renderCursorAgent } from './adapters/cursor.mjs';

const j = path.join;

// Per harness: where each kind of item lives. `b` is the home (user scope) or the project dir.
// ruleDirs/agents/prompts are [dir, extension]; mcp is [[file, keyPath]]; hooks is [[file or dir, key]].
// `verify` paths are unproven upstream: reported when present, never read.
const SOURCES = {
  claude: (b, user) => {
    const d = j(b, '.claude');
    return {
      rules: [user ? j(d, 'CLAUDE.md') : j(b, 'CLAUDE.md')], ruleDirs: [[j(d, 'rules'), '.md']],
      agents: [j(d, 'agents'), '.md'], skills: j(d, 'skills'), prompts: user ? null : [j(d, 'commands'), '.md'],
      mcp: [[user ? j(b, '.claude.json') : j(b, '.mcp.json'), ['mcpServers']]],
      hooks: [[j(d, 'settings.json'), 'hooks']], verify: user ? [j(d, 'commands')] : [],
    };
  },
  'vscode-copilot': (b, user) => {
    if (user) {
      const c = envDir(b, 'COPILOT_HOME', j(b, '.copilot'));
      const v = vscodeUserDir(b);
      return { rules: [], ruleDirs: [], agents: null, skills: j(c, 'skills'), prompts: null, mcp: [], hooks: [[j(c, 'hooks'), null]], verify: [j(v, 'prompts'), j(v, 'mcp.json')] };
    }
    const g = j(b, '.github');
    return {
      rules: [j(g, 'copilot-instructions.md'), j(b, 'AGENTS.md')], ruleDirs: [[j(g, 'instructions'), '.instructions.md']],
      agents: [j(g, 'agents'), '.agent.md'], skills: j(g, 'skills'), prompts: [j(g, 'prompts'), '.prompt.md'],
      mcp: [[j(b, '.vscode', 'mcp.json'), ['servers']]], hooks: [[j(g, 'hooks'), null]], verify: [],
    };
  },
  cursor: (b, user) => {
    const d = j(b, '.cursor');
    return {
      rules: user ? [] : [j(b, 'AGENTS.md')], ruleDirs: user ? [] : [[j(d, 'rules'), '.mdc']],
      agents: [j(d, 'agents'), '.md'], skills: j(d, 'skills'), prompts: null,
      mcp: [[j(d, 'mcp.json'), ['mcpServers']]], hooks: [[j(d, 'hooks.json'), null]], verify: [j(d, 'commands')],
    };
  },
  'copilot-cli': (b, user) => {
    if (user) {
      const c = envDir(b, 'COPILOT_HOME', j(b, '.copilot'));
      return {
        rules: [j(c, 'copilot-instructions.md')], ruleDirs: [[j(c, 'instructions'), '.instructions.md']],
        agents: [j(c, 'agents'), '.agent.md'], skills: j(c, 'skills'), prompts: null,
        mcp: [[j(c, 'mcp-config.json'), ['mcpServers']]], hooks: [[j(c, 'hooks'), null]], verify: [],
      };
    }
    const g = j(b, '.github');
    return {
      rules: [j(g, 'copilot-instructions.md'), j(b, 'AGENTS.md')], ruleDirs: [[j(g, 'instructions'), '.instructions.md']],
      agents: [j(g, 'agents'), '.agent.md'], skills: j(g, 'skills'), prompts: null,
      mcp: [[j(b, '.mcp.json'), ['mcpServers']], [j(g, 'mcp.json'), ['mcpServers']]], hooks: [[j(g, 'hooks'), null]], verify: [j(g, 'prompts')],
    };
  },
};
const opencodeSource = (b, user, from) => {
  const cfg = user ? j(configHome(b), 'opencode') : j(b, '.opencode');
  return {
    rules: [j(user ? cfg : b, 'AGENTS.md')], ruleDirs: [],
    agents: [j(cfg, 'agents'), '.md'], skills: j(cfg, 'skills'), prompts: [j(cfg, 'commands'), '.md'],
    mcp: [[configPath(user ? cfg : b), from === 'opencode-v1' ? ['mcp'] : ['mcp', 'servers']]], hooks: [], verify: [],
  };
};
SOURCES['opencode-v1'] = opencodeSource;
SOURCES['opencode-v2'] = opencodeSource;

export const MIGRATE_SOURCES = Object.keys(SOURCES);
export const MIGRATE_TARGETS = MIGRATE_SOURCES;

const text = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const list = (dir, ext) => {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => ({ name: f.slice(0, -ext.length), file: j(dir, f) })); } catch { return []; }
};
const SAFE_NAME = /^[A-Za-z0-9][\w.-]*$/;
const TEXT_LIMIT = 200 * 1024;

function frontmatter(t) {
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return m ? { meta: m[1], body: m[2] } : { meta: '', body: t };
}

function skillFiles(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = j(d, e.name);
      if (e.isDirectory()) { walk(p, [...rel, e.name]); continue; }
      if (!e.isFile() || fs.statSync(p).size > TEXT_LIMIT) continue;
      const content = fs.readFileSync(p, 'utf8');
      if (!content.includes('\0')) out.push({ rel: [...rel, e.name], content });
    }
  };
  walk(dir, []);
  return out;
}

// Names of env and header keys only; values never leave this function.
function mcpServers(file, keyPath) {
  const raw = text(file);
  const root = raw && parse(raw, [], { allowTrailingComma: true });
  let node = root;
  for (const k of keyPath) node = node && typeof node === 'object' ? node[k] : undefined;
  const out = [];
  for (const [name, s] of Object.entries(node && typeof node === 'object' ? node : {})) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const command = Array.isArray(s.command) ? s.command.map(String) : s.command ? [String(s.command), ...(Array.isArray(s.args) ? s.args.map(String) : [])] : [];
    out.push({
      name, source: file, command, url: typeof s.url === 'string' ? s.url : undefined, transport: s.type === 'sse' ? 'sse' : 'http',
      envNames: Object.keys(s.env ?? s.environment ?? {}), headerNames: Object.keys(s.headers ?? {}),
    });
  }
  return out;
}

export function readSource(from, base, scope) {
  if (!SOURCES[from]) throw new Error(`unknown --migrate source "${from}" (available: ${[...MIGRATE_SOURCES, 'auto'].join(', ')})`);
  const l = SOURCES[from](base, scope === 'user', from);
  const r = { from, rules: [], agents: [], skills: [], prompts: [], mcp: [], hooks: [], unsupported: [] };

  const addRule = (file, strip) => {
    const raw = text(file);
    if (raw === null || (hasMark(raw) && !raw.includes('lean-agents:start'))) return;
    const { meta, body } = strip ? frontmatter(raw) : { meta: '', body: raw };
    const clean = removeBlock(body).trim();
    if (clean) r.rules.push({ file, text: clean, scoped: /^(applyTo|globs|paths):\s*\S/m.test(meta) });
  };
  for (const f of l.rules) addRule(f, false);
  for (const [dir, ext] of l.ruleDirs) for (const it of list(dir, ext)) addRule(it.file, true);

  if (l.agents) {
    for (const it of list(...l.agents)) {
      const raw = text(it.file);
      if (raw === null) continue;
      let a;
      // shortcut: parseAgent drops text after "#" in a frontmatter value, so "fix #12" becomes "fix"; upgrade if it bites.
      try { a = parseAgent(raw); } catch { a = { body: raw.trim() }; }
      if (!SAFE_NAME.test(it.name)) continue;
      // The tool list formats differ, so an agent that had one is migrated read-only rather than widened.
      r.agents.push({ name: it.name, description: a.description ?? it.name, body: a.body, restricted: 'tools' in a || 'permission' in a, source: it.file });
    }
  }
  if (isDir(l.skills)) {
    for (const e of fs.readdirSync(l.skills, { withFileTypes: true })) {
      if (e.isDirectory() && SAFE_NAME.test(e.name)) r.skills.push({ name: e.name, source: j(l.skills, e.name), files: skillFiles(j(l.skills, e.name)) });
    }
  }
  if (l.prompts) for (const it of list(...l.prompts)) if (SAFE_NAME.test(it.name) && text(it.file) !== null) r.prompts.push({ name: it.name, source: it.file, text: text(it.file) });
  for (const [file, key] of l.mcp) r.mcp.push(...mcpServers(file, key));
  for (const [p, key] of l.hooks) {
    const files = isDir(p) ? list(p, '.json').map((x) => x.file) : isFile(p) ? [p] : [];
    for (const f of files) {
      const body = key ? parse(text(f) ?? '', [], { allowTrailingComma: true }) : true;
      if (body && (!key || body[key])) r.hooks.push({ source: f });
    }
  }
  for (const p of l.verify) if (fs.existsSync(p)) r.unsupported.push(p);
  return r;
}

export const hasContent = (r) => ['rules', 'agents', 'skills', 'prompts', 'mcp', 'hooks', 'unsupported'].some((k) => r[k].length);

// `auto`: every source that has files here, except the ones being written to.
export function detectSources(base, scope, exclude = []) {
  return MIGRATE_SOURCES.filter((s) => !exclude.includes(s) && hasContent(readSource(s, base, scope)));
}

const refs = { claude: (v) => `\${${v}}`, 'opencode-v1': (v) => `{env:${v}}`, 'opencode-v2': (v) => `{env:${v}}`, cursor: (v) => `\${env:${v}}` };

// Where and how each target takes items. `ctx` carries the rules file the engine writes under its state dir.
const TARGETS = {
  claude: (b, user) => {
    const d = j(b, '.claude');
    return {
      agent: [j(d, 'agents'), '.md', (a) => renderClaudeAgent(a, null, true)], skills: j(d, 'skills'), prompts: [j(d, 'commands'), '.md'],
      mcp: user ? { cli: true } : { file: j(b, '.mcp.json'), key: ['mcpServers'], value: (s, env) => (s.url ? { type: s.transport, url: s.url } : { command: s.command[0], args: s.command.slice(1), ...(env ? { env } : {}) }) },
      rules: user
        ? (rulesFile) => [{ kind: 'block', path: j(d, 'CLAUDE.md'), body: `@${rulesFile.split(path.sep).join('/')}` }]
        : (_f, body) => [{ kind: 'block', path: j(b, 'CLAUDE.md'), body }],
      rulesPath: user ? null : j(b, 'CLAUDE.md'),
    };
  },
  cursor: (b, user) => {
    const d = j(b, '.cursor');
    return {
      agent: [j(d, 'agents'), '.md', renderCursorAgent], skills: j(d, 'skills'), prompts: null,
      mcp: { file: j(d, 'mcp.json'), key: ['mcpServers'], value: (s, env) => (s.url ? { url: s.url } : { command: s.command[0], args: s.command.slice(1), ...(env ? { env } : {}) }) },
      rules: user ? null : (_f, body) => [{ kind: 'block', path: j(b, 'AGENTS.md'), body }],
      rulesPath: user ? null : j(b, 'AGENTS.md'),
    };
  },
  'vscode-copilot': (b, user) => {
    const c = user ? envDir(b, 'COPILOT_HOME', j(b, '.copilot')) : j(b, '.github');
    return {
      agent: [j(c, 'agents'), '.agent.md', (a) => renderCopilotAgent(a, null, true)], skills: j(c, 'skills'), prompts: user ? null : [j(c, 'prompts'), '.prompt.md'],
      mcp: { file: user ? j(vscodeUserDir(b), 'mcp.json') : j(b, '.vscode', 'mcp.json'), key: ['servers'], value: (s) => (s.url ? { type: s.transport, url: s.url } : { type: 'stdio', command: s.command[0], args: s.command.slice(1) }) },
      rules: (_f, body) => [{ kind: 'block', path: user ? j(c, 'copilot-instructions.md') : j(b, 'AGENTS.md'), body }],
      rulesPath: user ? j(c, 'copilot-instructions.md') : j(b, 'AGENTS.md'),
    };
  },
  'copilot-cli': (b, user) => {
    const c = user ? envDir(b, 'COPILOT_HOME', j(b, '.copilot')) : j(b, '.github');
    return {
      agent: [j(c, 'agents'), '.agent.md', (a) => renderCopilotAgent(a, null, true)], skills: j(c, 'skills'), prompts: null,
      mcp: { file: user ? j(c, 'mcp-config.json') : j(b, '.mcp.json'), key: ['mcpServers'], value: (s) => (s.url ? { type: s.transport, url: s.url, tools: ['*'] } : { type: 'local', command: s.command[0], args: s.command.slice(1), tools: ['*'] }) },
      rules: (_f, body) => [{ kind: 'block', path: user ? j(c, 'copilot-instructions.md') : j(b, 'AGENTS.md'), body }],
      rulesPath: user ? j(c, 'copilot-instructions.md') : j(b, 'AGENTS.md'),
    };
  },
};
const opencodeTarget = (v2) => (b, user) => {
  const cfg = user ? j(configHome(b), 'opencode') : j(b, '.opencode');
  const file = configPath(user ? cfg : b);
  return {
    agent: [j(cfg, 'agents'), '.md', (a) => renderOpenCodeAgent(a, null)], skills: j(cfg, 'skills'), prompts: [j(cfg, 'commands'), '.md'],
    mcp: {
      file, key: v2 ? ['mcp', 'servers'] : ['mcp'],
      value: (s, env) => (s.url ? { type: 'remote', url: s.url, enabled: true } : { type: 'local', command: s.command, ...(env ? { environment: env } : {}), enabled: true }),
    },
    rules: user
      ? (rulesFile) => [{ kind: 'json', path: file, edits: [{ path: ['instructions'], value: rulesFile.split(path.sep).join('/'), mode: 'arrayAdd' }] }]
      : (_f, body) => [{ kind: 'block', path: j(b, 'AGENTS.md'), body }],
    rulesPath: user ? null : j(b, 'AGENTS.md'),
  };
};
TARGETS['opencode-v1'] = opencodeTarget(false);
TARGETS['opencode-v2'] = opencodeTarget(true);

const rulesText = (from, items) => `<!-- ${OWNED_MARK}: migrated from ${from} -->\n${items.map((r) => r.text).join('\n\n')}\n`;

// Returns { actions, commands, rows, env, headers }. Rows get their final status from finishRows().
export function migratePlan({ sources, targets, base, scope, stateDir }) {
  const user = scope === 'user';
  for (const t of targets) {
    if (!TARGETS[t]) throw new Error(`cannot migrate to "${t}" (available: ${MIGRATE_TARGETS.join(', ')})`);
    if (sources.some((s) => s.from === t)) throw new Error(`source and target are both ${t}`);
  }
  const L = Object.fromEntries(targets.map((t) => [t, TARGETS[t](base, user)]));
  const jsonByPath = new Map();
  const actions = [];
  const commands = [];
  const rows = [];
  const env = new Set();
  const headers = new Set();
  const taken = new Map();
  // The first source wins a name; later sources report the clash.
  const claim = (kind, name, s) => {
    const k = `${kind}:${name}`;
    if (taken.has(k)) { rows.push({ item: `${kind} ${name}`, source: s, target: '-', status: 'skipped', note: `already taken from ${taken.get(k)}` }); return false; }
    taken.set(k, s);
    return true;
  };
  const file = (item, source, target, content, note = '') => {
    actions.push({ kind: 'file', path: target, content });
    rows.push({ item, source, target, status: 'migrated', path: target, note });
  };
  const noteTarget = (item, source, t, note) => rows.push({ item, source, target: t, status: 'reported', note });

  // Rules from every source go into one block per target: a second block would replace the first.
  const seenRules = new Set();
  const allRules = sources.flatMap((x) => x.rules.map((r) => ({ ...r, from: x.from }))).filter((r) => !seenRules.has(path.resolve(r.file)) && seenRules.add(path.resolve(r.file)));
  if (allRules.length) {
    for (const t of targets) {
      const T = L[t];
      if (!T.rules) { noteTarget('rules', allRules[0].from, t, `${t} has no user rules file`); continue; }
      const items = allRules.filter((r) => path.resolve(r.file) !== (T.rulesPath && path.resolve(T.rulesPath)));
      if (!items.length) continue;
      const names = [...new Set(items.map((r) => r.from))].join(', ');
      const body = rulesText(names, items);
      const rulesFile = j(stateDir, 'migrated-rules.md');
      const acts = T.rules(rulesFile, body);
      if (user && ['claude', 'opencode-v1', 'opencode-v2'].includes(t)) acts.unshift({ kind: 'file', path: rulesFile, content: body });
      actions.push(...acts);
      const notes = [`${items.length} file(s)`, ...(items.some((r) => r.scoped) ? ['scope (applyTo/globs) is lost: rules apply everywhere'] : [])];
      rows.push({ item: 'rules', source: items[0].file, target: acts.at(-1).path, status: 'migrated', path: acts.at(-1).path, note: notes.join('; ') });
    }
  }
  for (const src of sources) {
    const from = src.from;
    for (const a of src.agents) {
      if (!claim('agent', a.name, a.source)) continue;
      const agent = { name: a.name, description: a.description, body: a.body, tier: 'migrated', access: a.restricted ? 'read-only' : 'read-write' };
      for (const t of targets) {
        const [dir, ext, render] = L[t].agent;
        file(`agent ${a.name}`, a.source, j(dir, `${a.name}${ext}`), render(agent), a.restricted ? 'tool list not carried over: set to read-only' : '');
      }
    }
    for (const s of src.skills) {
      if (!claim('skill', s.name, s.source)) continue;
      for (const t of targets) {
        const dir = j(L[t].skills, s.name);
        for (const f of s.files) actions.push({ kind: 'file', path: j(dir, ...f.rel), content: f.content });
        // One row per skill; its status follows the first file.
        if (s.files.length) rows.push({ item: `skill ${s.name}`, source: s.source, target: dir, status: 'migrated', path: j(dir, ...s.files[0].rel), note: `${s.files.length} file(s)` });
      }
    }
    for (const p of src.prompts) {
      if (!claim('prompt', p.name, p.source)) continue;
      for (const t of targets) {
        if (!L[t].prompts) { noteTarget(`prompt ${p.name}`, p.source, t, `${t} prompt path is unverified`); continue; }
        const [dir, ext] = L[t].prompts;
        file(`prompt ${p.name}`, p.source, j(dir, `${p.name}${ext}`), p.text);
      }
    }
    for (const s of src.mcp) {
      if (!claim('mcp', s.name, s.source)) continue;
      if (s.url && /[?#]|\/\/[^/]*@/.test(s.url)) { rows.push({ item: `mcp ${s.name}`, source: s.source, target: '-', status: 'skipped', note: 'url has a query or credentials, which may hold a token: add it by hand' }); continue; }
      if (!SAFE_NAME.test(s.name) || (!s.url && !s.command.length)) { rows.push({ item: `mcp ${s.name}`, source: s.source, target: '-', status: 'skipped', note: 'no command or url' }); continue; }
      s.envNames.forEach((n) => env.add(n));
      s.headerNames.forEach((n) => headers.add(`${s.name}: ${n}`));
      const note = s.headerNames.length ? `headers not copied: add ${s.headerNames.join(', ')} by hand` : '';
      for (const t of targets) {
        const m = L[t].mcp;
        if (m.cli) {
          const argv = s.url
            ? ['claude', 'mcp', 'add', '--scope', 'user', '--transport', s.transport, s.name, s.url]
            : ['claude', 'mcp', 'add', '--scope', 'user', s.name, '--', ...s.command];
          commands.push({ tool: 'migrate', desc: `MCP server ${s.name} for Claude Code (user scope)`, run: [argv], undo: [['claude', 'mcp', 'remove', '--scope', 'user', s.name]], skipIfOutput: { cmd: ['claude', 'mcp', 'get', s.name], ok: true } });
          rows.push({ item: `mcp ${s.name}`, source: s.source, target: `claude mcp add (${t})`, status: 'migrated', command: argv.join(' '), note });
          continue;
        }
        const ref = refs[t];
        const envNote = s.envNames.length && !ref ? `env ${s.envNames.join(', ')} not written: export it` : '';
        const vars = ref && s.envNames.length ? Object.fromEntries(s.envNames.map((n) => [n, ref(n)])) : null;
        let a = jsonByPath.get(m.file);
        if (!a) { a = { kind: 'json', path: m.file, edits: [] }; jsonByPath.set(m.file, a); actions.push(a); }
        const key = [...m.key, s.name];
        // Two targets can share a file (.mcp.json): the first server definition wins.
        if (!a.edits.some((e) => e.path.join('.') === key.join('.'))) a.edits.push({ path: key, value: m.value(s, vars), mode: 'setIfAbsent' });
        rows.push({ item: `mcp ${s.name}`, source: s.source, target: m.file, status: 'migrated', path: m.file, key: key.join('.'), note: [note, envNote].filter(Boolean).join('; ') });
      }
    }
    for (const h of src.hooks) rows.push({ item: 'hooks', source: h.source, target: '-', status: 'reported', note: 'hooks are not migrated: formats differ, copy by hand' });
    for (const p of src.unsupported) rows.push({ item: 'unverified path', source: p, target: '-', status: 'reported', note: 'unsupported source path (VERIFY)' });
  }
  return { actions: dedupe(actions), commands, rows, env: [...env].sort(), headers: [...headers].sort() };
}

// Two targets can share a path (Copilot CLI and VS Code both use .github/agents); the first one wins.
function dedupe(actions) {
  const seen = new Set();
  return actions.filter((a) => {
    const k = a.kind === 'json' ? null : `${a.kind}:${a.path}`;
    if (k === null) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Final status per row: what plan() decided, or what --no-exec leaves undone.
export function finishRows(rows, planned, exec) {
  return rows.map((r) => {
    if (r.command) return exec ? r : { ...r, status: 'reported', note: `run it yourself: ${r.command}` };
    if (!r.path || r.status !== 'migrated') return r;
    const p = planned.find((x) => x.path === r.path);
    if (!p) return r;
    if (p.status === 'skip') return { ...r, status: 'skipped', note: p.note };
    if (p.status === 'unchanged') return { ...r, status: 'skipped', note: 'already there' };
    if (r.key && p.keptKeys?.includes(r.key)) return { ...r, status: 'skipped', note: 'kept your existing server' };
    return r;
  });
}

export function formatTable(rows, rel) {
  const cells = rows.map((r) => [r.item, rel(r.source), rel(r.target), r.status + (r.note ? ` (${r.note})` : '')]);
  const head = ['item', 'source', 'target', 'status'];
  const w = head.map((h, i) => Math.max(h.length, ...cells.map((c) => c[i].length)));
  const line = (c) => `  ${c.map((v, i) => v.padEnd(w[i])).join('  ').trimEnd()}`;
  return [line(head), ...cells.map(line)].join('\n');
}
