// GitHub Copilot CLI adapter. Paths and keys confirmed on copilot 1.0.105 in CI.
// Copilot has no rule import, so the rendered rules go in a marked block.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { envDir } from '../system.mjs';
import { localServer } from './opencode-v2.mjs';
import { skillSource, skillsCli } from '../pins.mjs';

const CONTEXT_MODE_SCRIPT = fileURLToPath(new URL('../../copilot-context-mode.mjs', import.meta.url));

const TOOLS = {
  'read-only': ['read', 'search'],
  'git-read': ['read', 'search', 'execute'],
  'read-write': null,
};

// Web tools are dropped when other outbound calls are off.
export function renderCopilotAgent(agent, profile, web) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const model = modelFor(profile, tier)?.model.replace('github-copilot/', '');
  const tools = TOOLS[agent.access] && [...TOOLS[agent.access], ...(agent.name === 'research' && web ? ['web'] : [])];
  const lines = ['---', `# ${OWNED_MARK} (tier: ${tier})`, `name: ${agent.name}`, `description: ${agent.description}`];
  if (model) lines.push(`model: ${model}`);
  if (tools) lines.push(`tools: ${JSON.stringify(tools)}`);
  lines.push('---', '', agent.body, '');
  return lines.join('\n');
}

export const skills = (tool, desc, repo, names) => ({
  tool,
  desc,
  run: [['npx', '-y', skillsCli(), 'add', repo, '--skill', ...names, '-a', 'github-copilot', '-g', '-y']],
  // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
  undo: [['npx', '-y', skillsCli(), 'remove', ...names, '-g', '-y']],
});

export function copilotAdapter({ home, core, profile, opts, rules, adhdCommand }) {
  const dir = envDir(home, 'COPILOT_HOME', path.join(home, '.copilot'));
  const tools = opts.tools;
  const actions = [{ kind: 'block', path: path.join(dir, 'copilot-instructions.md'), body: rules }];
  const commands = [];

  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.agent.md`), content: renderCopilotAgent(agent, profile, opts.network.outbound !== 'off') });
  }
  const edits = [];
  for (const name of ['serena', 'playwright', 'playwright-extension'].filter((t) => tools.includes(t))) {
    const [command, ...args] = localServer(core, name).command;
    edits.push({ path: ['mcpServers', name], value: { type: 'local', command, args, tools: ['*'] }, mode: 'setIfAbsent' });
  }
  if (edits.length) actions.push({ kind: 'json', path: path.join(dir, 'mcp-config.json'), edits, keepEmpty: [['mcpServers']] });
  if (opts.network.autoUpdate === 'off') {
    actions.push({ kind: 'json', path: path.join(dir, 'settings.json'), edits: [{ path: ['autoUpdate'], value: false, mode: 'set' }] });
  }

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Copilot CLI', run: [['rtk', 'init', '-g', '--copilot']], undo: [['rtk', 'init', '-g', '--copilot', '--uninstall']] });
  }
  if (tools.includes('context-mode')) {
    // Only the MCP server (`copilot mcp add`, which writes mcp-config.json itself); the npm package comes from the prerequisite step.
    commands.push({
      tool: 'context-mode',
      desc: 'Context Mode MCP server for Copilot CLI',
      run: [['node', CONTEXT_MODE_SCRIPT]],
      undo: [['copilot', 'mcp', 'remove', 'context-mode']],
    });
    console.log('Context Mode hooks and skills for Copilot CLI are not installed: run `context-mode setup --print copilot-cli` and follow it.');
  }
  if (tools.includes('caveman')) {
    commands.push(skills('caveman', 'Caveman skills for Copilot CLI', skillSource('caveman'), ['caveman', 'caveman-compress', 'caveman-stats']));
  }
  if (tools.includes('i-have-adhd')) {
    commands.push(skills('i-have-adhd', 'i-have-adhd skill for Copilot CLI', skillSource('i-have-adhd'), ['i-have-adhd']), adhdCommand);
  }
  return { actions, commands };
}
