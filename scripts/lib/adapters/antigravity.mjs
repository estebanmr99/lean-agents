// Antigravity CLI (`agy`) adapter. Paths confirmed on agy 1.4.12 in CI.
import fs from 'node:fs';
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { localServer } from './opencode-v2.mjs';
import { skillSource, skillsCli } from '../pins.mjs';

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

// #148: a skill folder is ours only if an earlier run recorded it in state.json (prior) or it did not exist before.
// An unmarked folder with the same name is the user's: it is neither overwritten nor removed.
const skills = (home, prior, tool, desc, repo, names) => {
  const mine = names.filter((n) => prior.some((c) => c.desc === desc && c.undo?.some((u) => u.includes(n))) || !fs.existsSync(path.join(home, '.gemini', 'config', 'skills', n)));
  for (const n of names.filter((x) => !mine.includes(x))) console.log(`Kept your existing Antigravity skill "${n}": lean-agents did not install it and will not remove it.`);
  if (!mine.length) return null;
  return {
    tool,
    desc,
    run: [['npx', '-y', skillsCli(), 'add', repo, '--skill', ...mine, '-a', 'antigravity-cli', '-g', '-y']],
    // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
    undo: [['npx', '-y', skillsCli(), 'remove', ...mine, '-g', '-y']],
  };
};

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
    // Context Mode 2.1.7 has no antigravity id in AGENT_IDS and dropped its Antigravity plugin (2.1.4).
    console.log('Context Mode has no Antigravity agent id in v2.1.7 and no v2 Antigravity setup: MCP entry skipped, not guessed. Check `context-mode setup --list` for support.');
  }
  if (tools.includes('caveman')) {
    const c = skills(home, opts.prior ?? [], 'caveman', 'Caveman skills for Antigravity', skillSource('caveman'), ['caveman', 'caveman-compress', 'caveman-stats']);
    if (c) commands.push(c);
  }
  if (tools.includes('i-have-adhd')) {
    const c = skills(home, opts.prior ?? [], 'i-have-adhd', 'i-have-adhd skill for Antigravity', skillSource('i-have-adhd'), ['i-have-adhd']);
    // adhdCommand rewrites every i-have-adhd copy, so it must not run over a kept user skill.
    if (c) commands.push(c, adhdCommand);
  }
  return { actions, commands };
}
