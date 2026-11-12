// Claude Code adapter. Files only under ~/.claude; MCP servers and plugins go through
// the `claude` CLI so ~/.claude.json (which holds auth) is never edited directly.
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { privacyOf } from '../network.mjs';
import { statuslineScript } from '../copilot-usage.mjs';
import { marketplaceSource, skillSource, skillsCli } from '../pins.mjs';

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
    ...(net.autoUpdate === 'off' ? ['DISABLE_AUTOUPDATER'] : []),
    ...(net.telemetry === 'off' ? ['DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING'] : []),
    ...(net.outbound === 'off' ? ['DISABLE_BUG_COMMAND'] : []),
    // Also stops updates and telemetry, so only when every category is off.
    ...(privacyOf(net) === 'strict' ? ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'] : []),
    ...(net.telemetry === 'off' ? ['DO_NOT_TRACK'] : []),
  ];
  for (const k of off) edits.push({ path: ['env', k], value: '1', mode: 'set' });
  if (tools.includes('copilot-usage')) {
    // Only when the user has no statusLine (setIfAbsent); uninstall removes it only while it is still ours. Forward slashes: Claude runs it through bash, also on Windows.
    const script = path.join(dir, 'lean-copilot-usage-statusline.mjs');
    actions.push({ kind: 'file', path: script, content: statuslineScript() });
    const q = (p) => `"${p.replaceAll('\\', '/')}"`;
    edits.push({ path: ['statusLine'], value: { type: 'command', command: `${q(process.execPath)} ${q(script)}` }, mode: 'setIfAbsent', keepIfChanged: true });
  }
  actions.push({ kind: 'json', path: path.join(dir, 'settings.json'), edits });

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Claude Code', run: [['rtk', 'init', '-g', '--auto-patch']], undo: [['rtk', 'init', '-g', '--uninstall']] });
  }
  if (tools.includes('context-mode') && opts.toolNode) {
    // The plugin starts its server with the first `node` on PATH, so on an old Node it registers the absolute server instead (hooks and skills are lost).
    commands.push({
      tool: 'context-mode',
      desc: CTX_MCP,
      run: [['claude', 'mcp', 'add', '--scope', 'user', 'context-mode', '--', ...core.mcp['context-mode'].command]],
      undo: [['claude', 'mcp', 'remove', '--scope', 'user', 'context-mode']],
      skipIfOutput: { cmd: ['claude', 'mcp', 'get', 'context-mode'], ok: true },
    });
  } else if (tools.includes('context-mode')) {
    // An earlier run on an old Node registered the absolute MCP server; the plugin runs its own, so lean-agents removes the one it added.
    if ((opts.prior ?? []).some((c) => c.desc === CTX_MCP && c.undo?.length)) {
      commands.push({ tool: 'context-mode', desc: CTX_MCP, run: [['claude', 'mcp', 'remove', '--scope', 'user', 'context-mode']], undo: [] });
    }
    commands.push({ tool: 'context-mode', desc: 'Context Mode plugin', ...plugin(marketplaceSource('context-mode-plugin'), 'context-mode@context-mode') });
  }
  if (tools.includes('ponytail')) {
    commands.push({ tool: 'ponytail', desc: 'Ponytail plugin', ...plugin(marketplaceSource('ponytail-plugin'), 'ponytail@ponytail') });
  }
  if (tools.includes('i-have-adhd')) {
    commands.push({ tool: 'i-have-adhd', desc: 'i-have-adhd plugin', ...plugin(marketplaceSource('i-have-adhd'), 'i-have-adhd@i-have-adhd') }, adhdCommand);
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
  return { actions, commands };
}
