// Claude Code adapter. Files only under ~/.claude; MCP servers and plugins go through
// the `claude` CLI so ~/.claude.json (which holds auth) is never edited directly.
import path from 'node:path';
import { OWNED_MARK, isLegacy } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { privacyOf, updaterMode } from '../network.mjs';
import { statuslineScript } from '../copilot-usage.mjs';
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
const plugin = (repo, id) => ({
  run: [['claude', 'plugin', 'marketplace', 'add', repo], ['claude', 'plugin', 'install', id]],
  undo: [['claude', 'plugin', 'uninstall', id]],
});

export function claudeAdapter({ home, core, profile, opts, rulesPath, adhdCommand }) {
  const dir = path.join(home, '.claude');
  const actions = [];
  const commands = [];
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
  if (tools.includes('copilot-usage')) {
    // Only when the user has no statusLine (setIfAbsent); uninstall removes it only while it is still ours. Forward slashes: Claude runs it through bash, also on Windows.
    const script = path.join(dir, 'lean-copilot-usage-statusline.mjs');
    actions.push({ kind: 'file', path: script, content: statuslineScript() });
    const q = (p) => `"${p.replaceAll('\\', '/')}"`;
    edits.push({ path: ['statusLine'], value: { type: 'command', command: `${q(process.execPath)} ${q(script)}` }, mode: 'setIfAbsent', keepIfChanged: true });
  }
  const pluginWrites = [];
  const settingsAction = { kind: 'json', path: path.join(dir, 'settings.json'), edits };
  actions.push(settingsAction);

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
    commands.push({ tool: 'context-mode', desc: 'Context Mode plugin', ...plugin(repo, 'context-mode@context-mode') });
    pluginWrites.push(...pluginKeys('context-mode@context-mode', repo));
  }
  if (tools.includes('ponytail')) {
    const repo = marketplaceSource('ponytail-plugin');
    commands.push({ tool: 'ponytail', desc: 'Ponytail plugin', ...plugin(repo, 'ponytail@ponytail') });
    pluginWrites.push(...pluginKeys('ponytail@ponytail', repo));
  }
  if (tools.includes('i-have-adhd')) {
    const repo = marketplaceSource('i-have-adhd');
    commands.push({ tool: 'i-have-adhd', desc: 'i-have-adhd plugin', ...plugin(repo, 'i-have-adhd@i-have-adhd') }, adhdCommand);
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
  return { actions, commands };
}
