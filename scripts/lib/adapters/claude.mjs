// Claude Code adapter. Files only under ~/.claude; MCP servers and plugins go through
// the `claude` CLI so ~/.claude.json (which holds auth) is never edited directly.
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';

const TOOLS = {
  'read-only': 'Read, Grep, Glob',
  'git-read': 'Read, Grep, Glob, Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git status:*)',
  'read-write': null,
};

export function renderClaudeAgent(agent, profile) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const model = modelFor(profile, tier)?.model ?? 'inherit';
  let tools = TOOLS[agent.access];
  if (agent.name === 'research' && tools) tools += ', WebFetch, WebSearch';
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
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderClaudeAgent(agent, profile) });
  }

  const env = { BASH_MAX_OUTPUT_LENGTH: '15000', CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' };
  const edits = Object.entries(env).map(([k, v]) => ({ path: ['env', k], value: v, mode: 'setIfAbsent' }));
  edits.unshift({ path: ['model'], value: profile?.main_model ?? 'sonnet', mode: 'setIfAbsent' });
  if (opts.privacy === 'strict') {
    for (const k of ['DISABLE_AUTOUPDATER', 'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING', 'DISABLE_BUG_COMMAND', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC']) {
      edits.push({ path: ['env', k], value: '1', mode: 'set' });
    }
  }
  actions.push({ kind: 'json', path: path.join(dir, 'settings.json'), edits });

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Claude Code', run: [['rtk', 'init', '-g', '--auto-patch']], undo: [['rtk', 'init', '-g', '--uninstall']] });
  }
  if (tools.includes('context-mode')) {
    commands.push({ tool: 'context-mode', desc: 'Context Mode plugin', ...plugin('mksglu/context-mode', 'context-mode@context-mode') });
  }
  if (tools.includes('ponytail')) {
    commands.push({ tool: 'ponytail', desc: 'Ponytail plugin', ...plugin('DietrichGebert/ponytail', 'ponytail@ponytail') });
  }
  if (tools.includes('i-have-adhd')) {
    commands.push({ tool: 'i-have-adhd', desc: 'i-have-adhd plugin', ...plugin('ayghri/i-have-adhd', 'i-have-adhd@i-have-adhd') }, adhdCommand);
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
      run: [['npx', '-y', 'skills', 'add', 'JuliusBrussee/caveman', '--skill', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'claude-code', '-g', '-y']],
      undo: [['npx', '-y', 'skills', 'remove', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'claude-code', '-g', '-y']],
    });
  }
  return { actions, commands };
}
