// Antigravity CLI (`agy`) adapter. Paths confirmed on agy 1.4.12 in CI.
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { localServer } from './opencode-v2.mjs';

const TOOLS = {
  'read-only': ['view_file', 'grep_search', 'find_by_name'],
  'git-read': ['view_file', 'grep_search', 'find_by_name', 'run_command'],
  'read-write': ['view_file', 'grep_search', 'find_by_name', 'run_command', 'write_to_file', 'replace_file_content'],
};
const WEB = ['search_web', 'read_url_content'];

export function renderAntigravityAgent(agent, profile) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const tools = [...TOOLS[agent.access], ...(agent.name === 'research' ? WEB : [])];
  return [
    '---',
    `# ${OWNED_MARK} (tier: ${tier})`,
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    'subagent: true',
    `model: ${modelFor(profile, tier)?.model ?? 'inherit'}`,
    'tools:',
    ...tools.map((t) => `- ${t}`),
    '---',
    '',
    agent.body,
    '',
  ].join('\n');
}

const skills = (tool, desc, repo, names) => ({
  tool,
  desc,
  run: [['npx', '-y', 'skills', 'add', repo, '--skill', ...names, '-a', 'antigravity-cli', '-g', '-y']],
  // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
  undo: [['npx', '-y', 'skills', 'remove', ...names, '-g', '-y']],
});

export function antigravityAdapter({ home, core, profile, opts, rules, adhdCommand }) {
  const dir = path.join(home, '.gemini', 'config');
  const tools = opts.tools;
  const actions = [{ kind: 'file', path: path.join(dir, 'rules', 'lean-agents.md'), content: rules }];
  const commands = [];

  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderAntigravityAgent(agent, profile) });
  }
  const edits = [];
  for (const name of ['serena', 'playwright'].filter((t) => tools.includes(t))) {
    const [command, ...args] = localServer(core, name).command;
    edits.push({ path: ['mcpServers', name], value: { command, args }, mode: 'setIfAbsent' });
  }
  if (edits.length) actions.push({ kind: 'json', path: path.join(dir, 'mcp_config.json'), edits });

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK plugin for Antigravity', run: [['rtk', 'init', '-g', '--agent', 'antigravity']], undo: [['rtk', 'init', '-g', '--agent', 'antigravity', '--uninstall']] });
  }
  if (tools.includes('context-mode')) {
    commands.push({
      tool: 'context-mode',
      desc: 'Context Mode plugin for Antigravity',
      run: [['agy', 'plugin', 'install', 'https://github.com/mksglu/context-mode/tree/main/configs/antigravity-cli']],
      undo: [['agy', 'plugin', 'uninstall', 'context-mode']],
    });
  }
  if (tools.includes('caveman')) {
    commands.push(skills('caveman', 'Caveman skills for Antigravity', 'JuliusBrussee/caveman', ['caveman', 'caveman-compress', 'caveman-stats']));
  }
  if (tools.includes('i-have-adhd')) {
    commands.push(skills('i-have-adhd', 'i-have-adhd skill for Antigravity', 'ayghri/i-have-adhd', ['i-have-adhd']), adhdCommand);
  }
  return { actions, commands };
}
