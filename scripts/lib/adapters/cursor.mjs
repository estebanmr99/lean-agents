// Cursor adapter (IDE and the `agent` CLI). Cursor keeps user rules in its settings UI only,
// so global rules are not written here; `--project` puts them in the repo's AGENTS.md.
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { localServer } from './opencode-v2.mjs';

// Model IDs differ from every profile, so subagents inherit the chat model.
export function renderCursorAgent(agent) {
  return [
    '---',
    `# ${OWNED_MARK} (tier: ${agent.tier})`,
    `name: ${agent.name}`,
    `description: ${agent.description}`,
    'model: inherit',
    `readonly: ${agent.access !== 'read-write'}`,
    '---',
    '',
    agent.body,
    '',
  ].join('\n');
}

// `mcpServers` entries for a Cursor mcp.json, user or project.
export function cursorServers(core, tools) {
  return ['serena', 'playwright', 'context-mode'].filter((t) => tools.includes(t)).map((name) => {
    const [command, ...args] = localServer(core, name).command;
    return { path: ['mcpServers', name], value: { command, args }, mode: 'setIfAbsent' };
  });
}

const skills = (tool, desc, repo, names) => ({
  tool,
  desc,
  run: [['npx', '-y', 'skills', 'add', repo, '--skill', ...names, '-a', 'cursor', '-g', '-y']],
  // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
  undo: [['npx', '-y', 'skills', 'remove', ...names, '-g', '-y']],
});

export function cursorAdapter({ home, core, opts, adhdCommand }) {
  const dir = path.join(home, '.cursor');
  const tools = opts.tools;
  const actions = core.agents.map((agent) => ({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderCursorAgent(agent) }));
  const commands = [];
  const edits = cursorServers(core, tools);
  if (edits.length) actions.push({ kind: 'json', path: path.join(dir, 'mcp.json'), edits });

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Cursor', run: [['rtk', 'init', '-g', '--agent', 'cursor']], undo: [['rtk', 'init', '-g', '--agent', 'cursor', '--uninstall']] });
  }
  if (tools.includes('caveman')) {
    commands.push(skills('caveman', 'Caveman skills for Cursor', 'JuliusBrussee/caveman', ['caveman', 'caveman-compress', 'caveman-stats']));
  }
  if (tools.includes('i-have-adhd')) {
    commands.push(skills('i-have-adhd', 'i-have-adhd skill for Cursor', 'ayghri/i-have-adhd', ['i-have-adhd']), adhdCommand);
  }
  return { actions, commands };
}
