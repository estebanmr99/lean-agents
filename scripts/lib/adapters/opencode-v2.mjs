// OpenCode 2.x adapter. Uses the native 2.x keys (agents, plugins, update, policies,
// mcp.servers), confirmed against `opencode debug config` on OpenCode 2.2 in CI.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'jsonc-parser';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { configHome } from '../system.mjs';
import { gitBashPath } from '../terminals.mjs';
import { PINS, npmSpec, skillSource, skillsCli } from '../pins.mjs';
import { updaterMode } from '../network.mjs';
import { contextModeCommand } from '../context-mode.mjs';

const PERMISSIONS = {
  'read-only': ['  edit: deny', '  bash: deny'],
  'git-read': ['  edit: deny', '  bash:', '    "*": deny', '    "git diff*": allow', '    "git log*": allow', '    "git show*": allow', '    "git status*": allow'],
  'read-write': [],
};

export function renderOpenCodeAgent(agent, profile) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const m = modelFor(profile, tier);
  const lines = ['---', `# ${OWNED_MARK} (tier: ${tier})`, `description: ${agent.description}`, 'mode: subagent'];
  if (m?.model) lines.push(`model: ${m.model}`);
  for (const [k, v] of Object.entries(m?.options ?? {})) lines.push(`${k}: ${v}`);
  const perms = [...PERMISSIONS[agent.access]];
  if (agent.name === 'research') perms.push('  webfetch: allow');
  if (perms.length) lines.push('permission:', ...perms);
  lines.push('---', '', agent.body, '');
  return lines.join('\n');
}

export function configPath(dir) {
  for (const f of ['opencode.jsonc', 'opencode.json']) {
    if (fs.existsSync(path.join(dir, f))) return path.join(dir, f);
  }
  return path.join(dir, 'opencode.jsonc');
}

// `client` names the Context Mode agent id; serena and playwright ignore it.
export function localServer(core, name, client) {
  const server = core.mcp[name];
  let command = [...server.command];
  if (name === 'serena') command.splice(command.indexOf('start-mcp-server') + 1, 0, '--context', server.context.default);
  if (name === 'context-mode') command = contextModeCommand(command, client);
  return { type: 'local', command, enabled: true };
}

// dcp.jsonc thresholds, shared by 1.x and 2.x. setIfAbsent keeps any value the user already set.
export function dcpConfigAction(dir, profile) {
  const contextWindow = profile?.context_window ?? 200000;
  return {
    kind: 'json',
    path: path.join(dir, 'dcp.jsonc'),
    edits: [
      { path: ['$schema'], value: 'https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json', mode: 'setIfAbsent' },
      { path: ['compress', 'minContextLimit'], value: Math.round(contextWindow * 0.5), mode: 'setIfAbsent' },
      { path: ['compress', 'maxContextLimit'], value: Math.round(contextWindow * 0.8), mode: 'setIfAbsent' },
      // DCP's own updater floats to npm latest and broke loading once (#212); `autoUpdate` is in dcp.schema.json (checked 2026-11-23).
      { path: ['autoUpdate'], value: false, mode: 'setIfAbsent' },
    ],
  };
}

// DCP plugin edit for the server (`plugin` on 1.x, `plugins` on 2.x) or tui.json: a bare name or `@latest` moves to the pin
// in place; an exact version the user chose is not in `legacy`, so it stays and nothing is added (#212).
export function dcpPluginEdit(key) {
  const pkg = PINS['opencode-dcp'].source;
  return { path: [key], value: npmSpec('opencode-dcp'), mode: 'arrayAdd', legacy: [`${pkg}@latest`, pkg], restore: true };
}

// DCP specs the server config lists (`plugin` on 1.x, `plugins` on 2.x).
function serverDcpSpecs(dir) {
  const pkg = PINS['opencode-dcp'].source;
  for (const file of ['opencode.jsonc', 'opencode.json']) {
    try {
      const c = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      return [...(c?.plugins ?? []), ...(c?.plugin ?? [])].filter(x => typeof x === 'string' && (x === pkg || x.startsWith(`${pkg}@`)));
    } catch (e) {
      // missing or unreadable: no DCP entry there
    }
  }
  return [];
}

// TUI config a 2.x client reads: cli.json once it exists (the terminal client writes it on first start); tui.json(c)
// before that (#558). lean-agents never creates a TUI file; it only edits one that is already there.
export function tuiConfigs(dir, fsx = fs) {
  const cli = path.join(dir, 'cli.json');
  if (fsx.existsSync(cli)) return [{ path: cli, key: 'plugins', cli: true }];
  return ['tui.json', 'tui.jsonc'].map((f) => path.join(dir, f)).filter((p) => fsx.existsSync(p)).map((p) => ({ path: p, key: 'plugin', cli: false }));
}

// A 1.x TUI plugin uses api.command/api.slots; 2.x plugins export a default definition with setup(context) (#558).
export const legacyTuiShape = (text) => /\bapi\.(command|slots)\b/.test(text);
// The header of the hand-made #123 meter this repo used to document (core/copilot-usage-tui.js carries it too).
export const copilotMeterShape = (text) => /lean-agents#123/.test(text);

// Local path behind a plugin entry (file:// URL, path or ~); null for npm names or a bad URL.
function pluginPath(dir, spec, home = process.env.HOME ?? os.homedir()) {
  const raw = String(spec);
  if (raw.startsWith('file:')) { try { return fileURLToPath(raw); } catch { return null; } }
  if (/^([./~\\]|[a-zA-Z]:[\\/])/.test(raw)) return raw.startsWith('~') ? path.join(home, raw.slice(1)) : path.resolve(dir, raw);
  return null;
}

// File behind a local plugin entry (a file, or a folder with tui.js/index.js/index.ts); null for npm names.
function pluginFile(dir, spec, fsx, home = process.env.HOME ?? os.homedir()) {
  const p = pluginPath(dir, spec, home);
  if (!p) return null;
  try {
    if (fsx.statSync(p).isDirectory()) {
      const entry = ['tui.js', 'index.js', 'index.ts'].map((n) => path.join(p, n)).find((f) => fsx.existsSync(f));
      return entry ? { file: entry, text: fsx.readFileSync(entry, 'utf8') } : null;
    }
    return { file: p, text: fsx.readFileSync(p, 'utf8') };
  } catch { return null; }
}

// Local plugin files a 2.x machine has configured (server `plugins` and the TUI file), with their source text. Read-only.
export function localPluginFiles(dir, { fsx = fs, home } = {}) {
  const out = [];
  const cfgs = [{ path: configPath(dir), keys: ['plugins', 'plugin'] }, ...tuiConfigs(dir, fsx).map((c) => ({ path: c.path, keys: [c.key] }))];
  for (const c of cfgs) {
    let cfg;
    try { cfg = parse(fsx.readFileSync(c.path, 'utf8')); } catch { continue; }
    for (const k of c.keys) for (const e of Array.isArray(cfg?.[k]) ? cfg[k] : []) {
      const hit = pluginFile(dir, Array.isArray(e) ? e[0] : e, fsx, home);
      if (hit) out.push({ config: c.path, key: k, entry: Array.isArray(e) ? e[0] : e, ...hit });
    }
  }
  return out;
}

// Hand-made #123 meters in the TUI config: the managed copilot-usage tool replaces the entry (#558). The owner's layout
// names the folder copilot-usage-tui, so that entry is dead even when its target file is missing or unreadable.
export function copilotMeterEntries(dir, { fsx = fs, home } = {}) {
  const named = (p) => p && p.split(/[\\/]/).includes('copilot-usage-tui');
  return tuiConfigs(dir, fsx).flatMap((c) => {
    let cfg;
    try { cfg = parse(fsx.readFileSync(c.path, 'utf8')); } catch { return []; }
    return (Array.isArray(cfg?.[c.key]) ? cfg[c.key] : []).flatMap((e) => {
      const raw = Array.isArray(e) ? e[0] : e;
      const hit = pluginFile(dir, raw, fsx, home);
      const dead = (hit && copilotMeterShape(hit.text)) || (!hit && named(pluginPath(dir, raw, home)));
      return dead ? [{ config: c.path, key: c.key, entry: raw, file: hit?.file ?? pluginPath(dir, raw, home) }] : [];
    });
  });
}

// DCP TUI entry (shared by 1.x and 2.x). 1.x: tui.json(c), only for a file that already exists and already lists DCP. tui follows the server
// config (#479): when the server ends up with our pin (none yet, the pin, a bare name or `@latest`), an exact other version in
// tui moves to it too; a server pin the user chose leaves tui alone. Ranges and pre-releases are never moved.
// 2.x: opencode.json(c) already loads DCP's TUI part, so no TUI entry is added and every TUI entry (cli.json, and the
// stale tui.json(c) the client's migration copies) is dropped (#558, opencode.ai/docs/cli/plugins, 2026-11-27).
export function dcpTuiActions(dir, { v2 = false, fsx = fs } = {}) {
  const pkg = PINS['opencode-dcp'].source;
  const pin = npmSpec('opencode-dcp');
  const actions = [];
  if (v2) {
    // The server entry already loads DCP's TUI part (opencode.ai/docs/cli/plugins, 2026-11-27), so no entry is added and
    // every TUI entry is dropped: cli.json, and tui.json(c), because the client's migration copies that file on start.
    if (!serverDcpSpecs(dir).length) return actions;
    for (const [file, key] of [['cli.json', 'plugins'], ['tui.json', 'plugin'], ['tui.jsonc', 'plugin']]) {
      const p = path.join(dir, file);
      if (!fsx.existsSync(p)) continue;
      let plugins;
      try { plugins = parse(fsx.readFileSync(p, 'utf8'))?.[key]; } catch { continue; }
      const mine = (Array.isArray(plugins) ? plugins : []).filter((x) => typeof x === 'string' && (x === pkg || x.startsWith(`${pkg}@`)));
      if (mine.length) {
        actions.push({ kind: 'json', path: p, edits: mine.map((value) => ({ path: [key], value, mode: 'arrayRemove', label: 'DCP', why: 'opencode.jsonc already loads its TUI part' })) });
      }
    }
    return actions;
  }
  const ours = serverDcpSpecs(dir).every(x => x === pin || x === pkg || x === `${pkg}@latest`);
  for (const file of ['tui.json', 'tui.jsonc']) {
    const p = path.join(dir, file);
    if (!fsx.existsSync(p)) continue;
    try {
      const plugins = parse(fsx.readFileSync(p, 'utf8'))?.plugin;
      if (!Array.isArray(plugins) || !plugins.some(x => typeof x === 'string' && (x === pkg || x.startsWith(`${pkg}@`)))) continue;
      const edit = dcpPluginEdit('plugin');
      if (ours) edit.legacy = [...edit.legacy, ...plugins.filter(x => typeof x === 'string' && x.startsWith(`${pkg}@`) && /^\d+\.\d+\.\d+$/.test(x.slice(pkg.length + 1)))];
      actions.push({ kind: 'json', path: p, edits: [{ ...edit, label: 'DCP', why: 'to match opencode.jsonc' }] });
    } catch (e) {
      // unreadable file: leave it alone
    }
  }
  return actions;
}

// Leftover 1.x names in an already-2.x `mcp.servers` entry (#556). Rename in place; a snake_case target that already
// exists wins (the stale key is skipped and reported, never overwritten). Values are copied, never printed.
const STALE_OAUTH = { clientId: 'client_id', clientSecret: 'client_secret', callbackPort: 'callback_port', redirectUri: 'redirect_uri' };
export function staleMcpEdits(cfg) {
  const edits = [];
  const skipped = [];
  for (const [name, s] of Object.entries(cfg?.mcp?.servers ?? {})) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) continue;
    const base = ['mcp', 'servers', name];
    if (s.enabled === false) {
      if (s.disabled === undefined) {
        edits.push({ path: [...base, 'disabled'], value: true, mode: 'setIfAbsent' });
        edits.push({ path: [...base, 'enabled'], mode: 'remove' });
      } else skipped.push(`mcp.servers.${name}.enabled (disabled already set)`);
    } else if (s.enabled !== undefined) {
      edits.push({ path: [...base, 'enabled'], mode: 'remove' });
    }
    if (!s.oauth || typeof s.oauth !== 'object' || Array.isArray(s.oauth)) continue;
    for (const [from, to] of Object.entries(STALE_OAUTH)) {
      if (s.oauth[from] === undefined) continue;
      if (s.oauth[to] !== undefined) { skipped.push(`mcp.servers.${name}.oauth.${from} (oauth.${to} already set)`); continue; }
      edits.push({ path: [...base, 'oauth', to], value: s.oauth[from], mode: 'setIfAbsent' });
      edits.push({ path: [...base, 'oauth', from], mode: 'remove' });
    }
  }
  return { edits, skipped };
}

function existingConfig(dir) {
  try { return parse(fs.readFileSync(configPath(dir), 'utf8'), [], { allowTrailingComma: true }) ?? null; } catch { return null; }
}

// MCP entry edit. `shape` turns a command array into this agent's entry. A server with `legacy` commands in core/mcp.json
// (Context Mode: other versions, with or without `server`, npx or an nvm Node; `*` is a wildcard) has those entries replaced
// by a rerun, so the npx and absolute forms flip either way. Anything else the user has is kept.
export function mcpEdit(path, shape, command, legacy, enabledLegacy = false) {
  const value = shape(command);
  // Older lean-agents wrote `enabled: true` on 2.x; accept it as a legacy match so --update can drop it (#556).
  const old = legacy?.flatMap((c) => (enabledLegacy ? [shape(c), { ...shape(c), enabled: true }] : [shape(c)]));
  return legacy ? { path, value, mode: 'upgradeIf', legacy: old, restorePrevious: true } : { path, value, mode: 'setIfAbsent' };
}

// Windows only, and only when Git Bash is actually found (#124 follow-up, proven in `real-opencode-shell`
// CI for both majors: setting `shell` to an absolute Git Bash path makes the bash/shell tool run there,
// PATH or not). `setIfAbsent` never overwrites a `shell` the user already set. `opts.shell === 'default'`
// opts out (`--shell default`). `opts.platform`/`opts.env` let tests fake the OS without one.
export function shellEdit(opts) {
  if (opts.shell === 'default') return null;
  const bash = gitBashPath({ platform: opts.platform ?? process.platform, env: opts.env ?? process.env });
  return bash ? { path: ['shell'], value: bash, mode: 'setIfAbsent' } : null;
}

export function profileEdits(profile, agentsKey) {
  if (!profile) return [];
  const edits = [];
  if (profile.main_model) edits.push({ path: ['model'], value: profile.main_model, mode: 'setIfAbsent' });
  for (const [agent, tier] of Object.entries(profile.primary ?? {})) {
    const m = modelFor(profile, tier);
    if (!m) continue;
    edits.push({ path: [agentsKey, agent, 'model'], value: m.model, mode: 'setIfAbsent' });
    for (const [k, v] of Object.entries(m.options ?? {})) edits.push({ path: [agentsKey, agent, k], value: v, mode: 'setIfAbsent' });
  }
  return edits;
}

// Read at import, before isolate() points HOME and USERPROFILE at --home.
const REAL_HOME = os.homedir();

function ponytailConfig(home) {
  if (process.platform !== 'win32') return path.join(configHome(home), 'ponytail', 'config.json');
  // Only the real home may use %APPDATA%: --home must keep every write inside the temp dir.
  const appData = home === REAL_HOME && process.env.APPDATA ? process.env.APPDATA : path.join(home, 'AppData', 'Roaming');
  return path.join(appData, 'ponytail', 'config.json');
}

// state.json is editable, so the undo does not trust its path: it re-derives the vendor dir from HOME (the engine points it at --home)
// and refuses anything else, or a symlink, through fsops.unsafe.
const SCRIPT = (fsops, system) => `import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs';
import { unsafe } from ${JSON.stringify(fsops)}; import { configHome } from ${JSON.stringify(system)};
const home = os.homedir(); const want = path.join(configHome(home), 'opencode', 'vendor', 'i-have-adhd');
const why = (process.platform === 'win32' ? (x) => x.toLowerCase() : (x) => x)(path.resolve(process.argv[1])) !== (process.platform === 'win32' ? want.toLowerCase() : want) ? 'not the path lean-agents installed' : unsafe(want, [home]);
if (why) { console.error('refusing to remove ' + process.argv[1] + ': ' + why); process.exit(1); }
fs.rmSync(want, { recursive: true, force: true });`;
const vendorUndo = (vendor) => [process.execPath, '--input-type=module', '-e',
  SCRIPT(pathToFileURL(fileURLToPath(new URL('../fsops.mjs', import.meta.url))).href, pathToFileURL(fileURLToPath(new URL('../system.mjs', import.meta.url))).href), vendor];

// Everything that is the same on OpenCode 1.x and 2.x: files and commands, not config keys.
export function opencodeShared({ home, dir, core, profile, opts, v2 = false }) {
  const tools = opts.tools;
  const actions = [];
  const commands = [];
  if (tools.includes('ponytail')) {
    actions.push({ kind: 'json', path: ponytailConfig(home), edits: [{ path: ['defaultMode'], value: opts.ponytailMode, mode: 'setIfAbsent' }] });
  }
  if (tools.includes('copilot-usage')) {
    // Own folder, so the hand-made copilot-usage-tui is never touched. 1.x loads it through a tui.json entry; 2.x discovers
    // plugins/<dir>/tui.js by itself (docs: opencode.ai/docs/build/plugins), so there is no config entry there.
    const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
    const source = fs.readFileSync(fileURLToPath(new URL('../../../core/copilot-usage-tui.js', import.meta.url)), 'utf8');
    actions.push({ kind: 'file', path: file, content: `// ${OWNED_MARK}\n${source}` });
    if (!v2) actions.push({ kind: 'json', path: path.join(dir, 'tui.json'), edits: [{ path: ['plugin'], value: pathToFileURL(file).href, mode: 'arrayAdd' }] });
    else {
      // A hand copy of the #123 meter is dead on OpenCode 2: the managed tool replaces its one config entry (#558).
      for (const hit of copilotMeterEntries(dir, { home })) {
        actions.push({ kind: 'json', path: hit.config, edits: [{ path: [hit.key], value: hit.entry, mode: 'arrayRemove', label: 'hand-made copilot-usage', why: 'replaced by the managed tool' }] });
      }
    }
  }
  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderOpenCodeAgent(agent, profile) });
  }
  // rtk 1.2.0's plugin has both entries (1.x server(), 2.x setup(ctx)), so 1.x and 2.x share this command (#478); an rtk below
  // the pin min is skipped by lean.mjs (rtkTooOld), which also covers the 1.x-only templates that OpenCode 2 rejected (#179).
  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK plugin for OpenCode', run: [['rtk', 'init', '-g', '--opencode']], undo: [['rtk', 'init', '-g', '--opencode', '--uninstall']] });
  }
  if (tools.includes('i-have-adhd')) {
    const vendor = path.join(dir, 'vendor', 'i-have-adhd');
    commands.push({
      tool: 'i-have-adhd',
      desc: 'i-have-adhd checkout for OpenCode',
      // The tag must still point at the pinned commit; a moved tag removes the checkout and fails the command.
      run: [['git', 'clone', '--depth', '1', '--branch', PINS['i-have-adhd'].version, 'https://github.com/ayghri/i-have-adhd', vendor],
        [process.execPath, fileURLToPath(new URL('../verify-commit.mjs', import.meta.url)), vendor, PINS['i-have-adhd'].sha]],
      undo: [vendorUndo(vendor)],
      skipIfExists: vendor,
    });
    actions.push({
      kind: 'file',
      path: path.join(dir, 'plugins', 'i-have-adhd.ts'),
      content: `// ${OWNED_MARK}\nexport { default } from '../vendor/i-have-adhd/.opencode/plugins/i-have-adhd.mjs';\n`,
    });
    if (opts.adhdAlways) actions.push({ kind: 'file', path: path.join(dir, '.i-have-adhd-always'), content: '', force: true });
  }
  if (tools.includes('caveman')) {
    commands.push({
      tool: 'caveman',
      desc: 'Caveman skills for OpenCode',
      run: [['npx', '-y', skillsCli(), 'add', skillSource('caveman'), '--skill', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'opencode', '-g', '-y']],
      filesOnly: true, // #546: the add and its remove only copy skill files; no running OpenCode to wait for
      // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
      undo: [['npx', '-y', skillsCli(), 'remove', 'caveman', 'caveman-compress', 'caveman-stats', '-g', '-y']],
    });
  }
  return { actions, commands };
}

export function opencodeV2Adapter({ home, core, profile, opts, rulesPath }) {
  const dir = path.join(configHome(home), 'opencode');
  const tools = opts.tools;
  const { actions, commands } = opencodeShared({ home, dir, core, profile, opts, v2: true });
  const edits = [
    { path: ['$schema'], value: 'https://opencode.ai/config.json', mode: 'setIfAbsent' },
    { path: ['instructions'], value: rulesPath, mode: 'arrayAdd' },
    { path: ['default_agent'], value: 'plan', mode: 'setIfAbsent' },
    { path: ['compaction', 'auto'], value: true, mode: 'setIfAbsent' },
    { path: ['compaction', 'buffer'], value: 40000, mode: 'setIfAbsent' },
    ...profileEdits(profile, 'agents'),
  ];
  const shell = shellEdit(opts);
  if (shell) edits.push(shell);

  for (const name of ['context-mode', 'serena', 'playwright', 'playwright-extension']) {
if (tools.includes(name)) edits.push(mcpEdit(['mcp', 'servers', name], (command) => ({ type: 'local', command }), localServer(core, name, 'opencode').command, core.mcp[name].legacy, true));
  }
  if (tools.includes('ponytail')) edits.push({ path: ['plugins'], value: npmSpec('ponytail'), mode: 'arrayAdd', legacy: ['@dietrichgebert/ponytail'] });
  if (tools.includes('dcp')) {
    edits.push(dcpPluginEdit('plugins'));
    actions.push(dcpConfigAction(dir, profile));
  }
  // Also repairs a duplicate /dcp on every run: DCP stays in opencode.jsonc, the migrated cli.json entry goes (#558).
  actions.push(...dcpTuiActions(dir, { v2: true }));
  if (opts.terminals?.includes('warp')) edits.push({ path: ['plugins'], value: npmSpec('warp-opencode'), mode: 'arrayAdd', legacy: ['@warp-dot-dev/opencode-warp'] });
  if (opts.network.outbound === 'off') edits.push({ path: ['share'], value: 'disabled', mode: 'set' });
  // Managed installs update through --update: off unless the user already set `update` (network off forces it).
  if (updaterMode(opts)) edits.push({ path: ['update'], value: 'disable', mode: updaterMode(opts) });
  if (opts.network.outbound === 'off') {
    if (profile?.provider !== 'opencode') {
      edits.push({ path: ['policies'], value: { effect: 'deny', action: 'provider.use', resource: 'opencode' }, mode: 'arrayAdd' });
    }
  }
  const stale = staleMcpEdits(existingConfig(dir));
  edits.push(...stale.edits);
  actions.push({ kind: 'json', path: configPath(dir), edits, ...(stale.skipped.length && { note: `left stale keys alone: ${stale.skipped.join(', ')}` }) });
  return { actions, commands };
}
