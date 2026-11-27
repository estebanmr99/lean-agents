// Cursor adapter (IDE and the `agent` CLI). Cursor keeps user rules in its settings UI only,
// so global rules are not written here; `--project` puts them in the repo's AGENTS.md.
import path from 'node:path';
import { OWNED_MARK } from '../fsops.mjs';
import { localServer, mcpEdit } from './opencode-v2.mjs';
import { hasProxy } from '../network.mjs';
import { skillSource, skillsCli } from '../pins.mjs';

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
// Context Mode has no id in its AGENT_IDS for Cursor (2.1.7), and a server without --agent fails every ctx_* call, so it is
// left out and reported instead of writing a broken entry.
export function cursorServers(core, tools) {
  return ['serena', 'playwright', 'playwright-extension'].filter((t) => tools.includes(t)).map((name) => {
    return mcpEdit(['mcpServers', name], ([command, ...args]) => ({ command, args }), localServer(core, name).command, core.mcp[name].legacy);
  });
}

const skills = (tool, desc, repo, names) => ({
  tool,
  desc,
  run: [['npx', '-y', skillsCli(), 'add', repo, '--skill', ...names, '-a', 'cursor', '-g', '-y']],
  filesOnly: true, // #546: the add and its remove only copy skill files; no running OpenCode to wait for
  // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
  undo: [['npx', '-y', skillsCli(), 'remove', ...names, '-g', '-y']],
});

export function cursorAdapter({ home, core, opts, adhdCommand }) {
  const dir = path.join(home, '.cursor');
  const tools = opts.tools;
  const actions = core.agents.map((agent) => ({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderCursorAgent(agent) }));
  const commands = [];
  const edits = cursorServers(core, tools);
  if (edits.length) actions.push({ kind: 'json', path: path.join(dir, 'mcp.json'), edits });
  if (tools.includes('context-mode')) {
    console.log('Context Mode has no Cursor agent id in v2.1.7 (AGENT_IDS: claude-code, codex, gemini, qwen, copilot-cli, vscode, kiro, zcode, pi, opencode): its MCP entry is skipped, not guessed. Use another MCP client for Context Mode.');
  }
  // Proxies such as Zscaler break the agent's HTTP/2 stream (#25). Only the flag is written, never a proxy value.
  if (hasProxy()) actions.push({ kind: 'json', path: path.join(dir, 'cli-config.json'), edits: [{ path: ['network', 'useHttp1ForAgent'], value: true, mode: 'setIfAbsent' }] });

  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK hook for Cursor', run: [['rtk', 'init', '-g', '--agent', 'cursor']], undo: [['rtk', 'init', '-g', '--agent', 'cursor', '--uninstall']] });
  }
  if (tools.includes('caveman')) {
    commands.push(skills('caveman', 'Caveman skills for Cursor', skillSource('caveman'), ['caveman', 'caveman-compress', 'caveman-stats']));
  }
  if (tools.includes('i-have-adhd')) {
    commands.push(skills('i-have-adhd', 'i-have-adhd skill for Cursor', skillSource('i-have-adhd'), ['i-have-adhd']), adhdCommand);
  }
  return { actions, commands };
}
