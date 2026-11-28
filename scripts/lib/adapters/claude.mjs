// Claude Code adapter. Files only under ~/.claude; MCP servers and plugins go through
// the `claude` CLI so ~/.claude.json (which holds auth) is never edited directly.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { OWNED_MARK, isLegacy } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { privacyOf, updaterMode } from '../network.mjs';
import { marketplaceSource, skillSource, skillsCli } from '../pins.mjs';
import { contextModeCommand } from '../context-mode.mjs';
import { mcpServers } from '../migrate.mjs';

// Also the key of its record in state.json: removing the entry replaces that record (empty undo), so --uninstall does not remove it twice.
const CTX_MCP = 'Context Mode MCP server (user scope)';
const TOOLS = {
  'read-only': 'Read, Grep, Glob',
  'git-read': 'Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)',
  'read-write': null,
};

// Web tools are dropped when other outbound calls are off.
export function renderClaudeAgent(agent, profile, web) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const model = modelFor(profile, tier)?.model ?? 'inherit';
  let tools = TOOLS[agent.access];
  if (agent.name === 'research' && tools && web) tools += ', WebFetch, WebSearch';
  const lines = [
    '---',
    `# ${OWNED_MARK} (tier: ${tier})`,
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    `model: ${model}`,
  ];
  if (tools) lines.push(`tools: ${tools}`);
  lines.push('---', '', agent.body, '');
  return lines.join('\n');
}

// JSON key paths the `claude plugin` commands write: doctor ignores them when telling the user's edits from ours (#492).
// Only the exact values those commands write count; any other value stays an edit in the hash.
const pluginKeys = (id, repo) => [
  { path: ['enabledPlugins', id], value: true },
  { path: ['extraKnownMarketplaces', id.split('@')[1]], repo: repo.replace(/#.*$/, '') },
];
const pluginRepo = (repo) => repo.replace(/#.*$/, '');
// The ref of our own marketplace entry when the pin moves (#546): `claude plugin marketplace add` refuses a repo whose
// extraKnownMarketplaces entry names another ref. Only an entry with our repo is touched; another repo is the user's.
function marketplaceMove(dir, name, repo) {
  const file = path.join(dir, 'settings.json');
  let src;
  try {
    src = parse(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true })?.extraKnownMarketplaces?.[name]?.source;
  } catch (e) { return e.code === 'ENOENT' ? { missing: true } : {}; }
  if (!src || typeof src !== 'object') return { missing: true };
  const shown = src.repo ?? src.url;
  if (shown !== pluginRepo(repo)) {
    return { warning: `! ${name} marketplace entry in ${file} points at ${shown ?? 'another source'}, not ${pluginRepo(repo)}: left as it is; change it or remove it by hand.` };
  }
  const ref = repo.slice(repo.indexOf('#') + 1);
  // Only a recorded ref moves (a marketplace add without a ref, or a user's own edit, keeps its shape).
  if (typeof src.ref !== 'string' || src.ref === ref) return {};
  return { edit: { path: ['extraKnownMarketplaces', name, 'source', 'ref'], value: ref, mode: 'set', marketplace: name, keepIfChanged: true } };
}

export function claudeAdapter({ home, core, profile, opts, rulesPath, adhdCommand }) {
  const dir = path.join(home, '.claude');
  const actions = [];
  const commands = [];
  const warnings = [];
  const tools = opts.tools;

  actions.push({ kind: 'block', path: path.join(dir, 'CLAUDE.md'), body: `@${rulesPath}` });
  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderClaudeAgent(agent, profile, opts.network.outbound !== 'off') });
  }

  const env = { BASH_MAX_OUTPUT_LENGTH: '15000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' };
  const edits = Object.entries(env).map(([k, v]) => ({ path: ['env', k], value: v, mode: 'setIfAbsent' }));
  edits.unshift({ path: ['model'], value: profile?.main_model ?? 'sonnet', mode: 'setIfAbsent' });
  const net = opts.network;
  const off = [
    ...(net.telemetry === 'off' ? ['DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING'] : []),
    ...(net.outbound === 'off' ? ['DISABLE_BUG_COMMAND'] : []),
    // Also stops updates and telemetry, so only when every category is off.
    ...(privacyOf(net) === 'strict' ? ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] : []),
    ...(net.telemetry === 'off' ? ['DO_NOT_TRACK'] : []),
  ];
  for (const k of off) edits.push({ path: ['env', k], value: '1', mode: 'set' });
  // Managed installs update through --update: off unless the user already chose a value (network off forces it).
  // A DISABLE_AUTOUPDATER already in the environment is the user's own choice, so it is respected too.
  const updater = updaterMode(opts);
  if (updater && !(updater === 'setIfAbsent' && (opts.env ?? process.env).DISABLE_AUTOUPDATER !== undefined)) edits.push({ path: ['env', 'DISABLE_AUTOUPDATER'], value: '1', mode: updater });
  // Opt-in only (#304): experimental, and a session started with it resumes only with it on. User settings only; project settings ignore it.
  if (tools.includes('code-mode')) edits.push({ path: ['env', 'CLAUDE_CODE_EXPERIMENTAL_CODE_MODE'], value: '1', mode: 'setIfAbsent' });
  const pluginWrites = [];
  const settingsAction = { kind: 'json', path: path.join(dir, 'settings.json'), edits };
  actions.push(settingsAction);

  // Before `marketplace add`: move our own entry to the new pin, then refresh the marketplace and the plugin (#546).
  const addPlugin = (tool, desc, repo, id) => {
    const name = id.split('@')[1];
    const move = marketplaceMove(dir, name, repo);
    if (move.edit) settingsAction.edits.push(move.edit);
    // A fresh install records the entry we are about to add, so --uninstall removes it (another repo is the user's).
    else if (move.missing) settingsAction.edits.push({ path: ['extraKnownMarketplaces', name], value: { source: { source: 'github', repo: pluginRepo(repo), ref: repo.slice(repo.indexOf('#') + 1) } }, mode: 'setIfAbsent' });
    if (move.warning) warnings.push(move.warning);
    const installed = (opts.prior ?? []).some((c) => c.ok && (c.desc === desc
      || (c.run ?? []).some((a) => a[0] === 'claude' && a[1] === 'plugin' && (a[2] === 'install' || a[2] === 'update') && a[3] === id)));
    const run = [['claude', 'plugin', 'marketplace', 'add', repo]];
    if (installed && move.edit) run.push(['claude', 'plugin', 'marketplace', 'update', name], ['claude', 'plugin', 'update', id]);
    else run.push(['claude', 'plugin', 'install', id]);
    commands.push({ tool, desc, run, undo: [['claude', 'plugin', 'uninstall', id]] });
  };

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Claude Code', run: [['rtk', 'init', '-g', '--auto-patch']], undo: [['rtk', 'init', '-g', '--uninstall']] });
  }
  if (tools.includes('context-mode') && opts.toolNode) {
    // The plugin starts its server with the first `node` on PATH, so on an old Node it registers the absolute server instead (hooks and skills are lost).
    const add = ['claude', 'mcp', 'add', '--scope', 'user', 'context-mode', '--', ...contextModeCommand(core.mcp['context-mode'].command, 'claude-code')];
    const remove = ['claude', 'mcp', 'remove', '--scope', 'user', 'context-mode'];
    const entry = mcpServers(path.join(home, '.claude.json'), ['mcpServers']).find((s) => s.name === 'context-mode');
    if (!entry) {
      commands.push({ tool: 'context-mode', desc: CTX_MCP, run: [add], undo: [remove], skipIfOutput: { cmd: ['claude', 'mcp', 'get', 'context-mode'], ok: true } });
    } else if (entry.command.includes('--agent')) {
      // Already rewritten by this version: nothing to plan.
    } else if (isLegacy(entry.command, core.mcp['context-mode'].legacy)) {
      // An entry lean-agents wrote before --agent existed: replace it so ctx_* calls resolve the project.
      commands.push({ tool: 'context-mode', desc: CTX_MCP, run: [remove, add], undo: [remove] });
    } else {
      console.log('Kept your existing Context Mode MCP entry: it has different args. Add --agent claude-code to it, or remove it and run lean-agents --update.');
    }
  } else if (tools.includes('context-mode')) {
    // An earlier run on an old Node registered the absolute MCP server; the plugin runs its own, so lean-agents removes the one it added.
    if ((opts.prior ?? []).some((c) => c.desc === CTX_MCP && c.undo?.length)) {
      commands.push({ tool: 'context-mode', desc: CTX_MCP, run: [['claude', 'mcp', 'remove', '--scope', 'user', 'context-mode']], undo: [] });
    }
    const repo = marketplaceSource('context-mode-plugin');
    addPlugin('context-mode', 'Context Mode plugin', repo, 'context-mode@context-mode');
    pluginWrites.push(...pluginKeys('context-mode@context-mode', repo));
  }
  if (tools.includes('ponytail')) {
    const repo = marketplaceSource('ponytail-plugin');
    addPlugin('ponytail', 'Ponytail plugin', repo, 'ponytail@ponytail');
    pluginWrites.push(...pluginKeys('ponytail@ponytail', repo));
  }
  if (tools.includes('i-have-adhd')) {
    const repo = marketplaceSource('i-have-adhd');
    addPlugin('i-have-adhd', 'i-have-adhd plugin', repo, 'i-have-adhd@i-have-adhd');
    commands.push(adhdCommand);
    pluginWrites.push(...pluginKeys('i-have-adhd@i-have-adhd', repo));
    if (opts.adhdAlways) actions.push({ kind: 'file', path: path.join(dir, '.i-have-adhd-always'), content: '' , force: true });
  }
  for (const name of ['serena', 'playwright']) {
    if (!tools.includes(name)) continue;
    const server = core.mcp[name];
    const cmd = [...server.command];
    if (name === 'serena') cmd.splice(cmd.indexOf('start-mcp-server') + 1, 0, '--context', server.context['claude-code']);
    commands.push({
      tool: name,
      desc: `${name} MCP server (user scope)`,
      run: [['claude', 'mcp', 'add', '--scope', 'user', name, '--', ...cmd]],
      undo: [['claude', 'mcp', 'remove', '--scope', 'user', name]],
      skipIfOutput: { cmd: ['claude', 'mcp', 'get', name], ok: true },
    });
  }
  if (tools.includes('caveman')) {
    commands.push({
      tool: 'caveman',
      desc: 'Caveman skills for Claude Code',
      run: [['npx', '-y', skillsCli(), 'add', skillSource('caveman'), '--skill', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'claude-code', '-g', '-y']],
      filesOnly: true, // #546: the add and its remove only copy skill files; no running OpenCode to wait for
      undo: [['npx', '-y', skillsCli(), 'remove', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'claude-code', '-g', '-y']],
    });
  }
  if (opts.terminals?.includes('warp')) pluginWrites.push(...pluginKeys('warp@claude-code-warp', 'warpdotdev/claude-code-warp'));
  // An earlier install's plugin commands also wrote keys (for example warp when this --update has no --terminal).
  for (const c of opts.prior ?? []) {
    const add = c.run?.find((a) => a[0] === 'claude' && a[1] === 'plugin' && a[2] === 'marketplace' && a[3] === 'add');
    const inst = c.run?.find((a) => a[0] === 'claude' && a[1] === 'plugin' && a[2] === 'install');
    if (add?.[4] && inst?.[3]) pluginWrites.push(...pluginKeys(inst[3], add[4]));
  }
  const uniqueWrites = [...new Map(pluginWrites.map((e) => [JSON.stringify(e), e])).values()];
  if (uniqueWrites.length) settingsAction.ignore = uniqueWrites;
  return { actions, commands, warnings };
}
