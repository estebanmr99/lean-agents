// GitHub Copilot CLI adapter. Paths and keys confirmed on copilot 1.0.105 in CI.
// Copilot has no rule import, so the rendered rules go in a marked block.
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { envDir } from '../system.mjs';
import { localServer } from './opencode-v2.mjs';

const TOOLS = {
  'read-only': ['read', 'search'],
  'git-read': ['read', 'search', 'execute'],
  'read-write': null,
};

export function renderCopilotAgent(agent, profile) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const model = modelFor(profile, tier)?.model.replace('github-copilot/', '');
  const tools = TOOLS[agent.access] && [...TOOLS[agent.access], ...(agent.name === 'research' ? ['web'] : [])];
  const lines = ['---', `# ${OWNED_MARK} (tier: ${tier})`, `name: ${agent.name}`, `description: ${agent.description}`];
  if (model) lines.push(`model: ${model}`);
  if (tools) lines.push(`tools: ${JSON.stringify(tools)}`);
  lines.push('---', '', agent.body, '');
  return lines.join('\n');
}

const skills = (tool, desc, repo, names) => ({
  tool,
  desc,
  run: [['npx', '-y', 'skills', 'add', repo, '--skill', ...names, '-a', 'github-copilot', '-g', '-y']],
  // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
  undo: [['npx', '-y', 'skills', 'remove', ...names, '-g', '-y']],
});

export function copilotAdapter({ home, core, profile, opts, rules, adhdCommand }) {
  const dir = envDir(home, 'COPILOT_HOME', path.join(home, '.copilot'));
  const tools = opts.tools;
  const actions = [{ kind: 'block', path: path.join(dir, 'copilot-instructions.md'), body: rules }];
  const commands = [];

  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.agent.md`), content: renderCopilotAgent(agent, profile) });
  }
  const edits = [];
  for (const name of ['serena', 'playwright'].filter((t) => tools.includes(t))) {
    const [command, ...args] = localServer(core, name).command;
    edits.push({ path: ['mcpServers', name], value: { type: 'local', command, args, tools: ['*'] }, mode: 'setIfAbsent' });
  }
  if (edits.length) actions.push({ kind: 'json', path: path.join(dir, 'mcp-config.json'), edits });
  if (opts.privacy === 'strict') {
    actions.push({ kind: 'json', path: path.join(dir, 'settings.json'), edits: [{ path: ['autoUpdate'], value: false, mode: 'set' }] });
  }

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Copilot CLI', run: [['rtk', 'init', '-g', '--copilot']], undo: [['rtk', 'init', '-g', '--copilot', '--uninstall']] });
  }
  if (tools.includes('context-mode')) {
    // The plugin brings its own MCP server and hooks, so it is never added to mcp-config.json too.
    commands.push({
      tool: 'context-mode',
      desc: 'Context Mode plugin for Copilot CLI',
      run: [['copilot', 'plugin', 'install', 'mksglu/context-mode:configs/copilot-cli']],
      undo: [['copilot', 'plugin', 'uninstall', 'context-mode']],
    });
  }
  if (tools.includes('caveman')) {
    commands.push(skills('caveman', 'Caveman skills for Copilot CLI', 'JuliusBrussee/caveman', ['caveman', 'caveman-compress', 'caveman-stats']));
  }
  if (tools.includes('i-have-adhd')) {
    commands.push(skills('i-have-adhd', 'i-have-adhd skill for Copilot CLI', 'ayghri/i-have-adhd', ['i-have-adhd']), adhdCommand);
  }
  return { actions, commands };
}
