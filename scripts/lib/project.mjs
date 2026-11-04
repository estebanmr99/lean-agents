// --project mode: the shared setup inside one repository, so a team gets it through git.
// Rules live once in AGENTS.md; the Copilot and Cursor files only point to it.
import path from 'node:path';
import { OWNED_MARK, sha } from './fsops.mjs';
import { loadCore, renderRules, loadProfile } from './render.mjs';
import { renderCopilotAgent } from './adapters/copilot-cli.mjs';
import { vscodeServers } from './adapters/vscode-copilot.mjs';
import { cursorServers, renderCursorAgent } from './adapters/cursor.mjs';

const POINTER = 'Follow the shared rules in `AGENTS.md` at the repository root.';

// State holds absolute paths, so it stays in the user's home, never in the repository.
export function projectStateDir(home, dir) {
  return path.join(home, '.config', 'lean-agents', 'projects', sha(dir).slice(0, 12));
}

export function projectPlan(root, dir, o) {
  const core = loadCore(root);
  const profile = loadProfile(root, 'github-copilot');
  const actions = [
    { kind: 'block', path: path.join(dir, 'AGENTS.md'), body: renderRules(root, o) },
    { kind: 'block', path: path.join(dir, '.github', 'copilot-instructions.md'), body: `${POINTER}\n` },
    {
      kind: 'file',
      path: path.join(dir, '.cursor', 'rules', 'lean-agents.mdc'),
      content: ['---', 'description: Shared team rules from lean-agents', 'alwaysApply: true', '---', `<!-- ${OWNED_MARK} -->`, POINTER, ''].join('\n'),
    },
  ];
  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, '.github', 'agents', `${agent.name}.agent.md`), content: renderCopilotAgent(agent, profile) });
    actions.push({ kind: 'file', path: path.join(dir, '.cursor', 'agents', `${agent.name}.md`), content: renderCursorAgent(agent) });
  }
  const vscode = vscodeServers(core, o.tools);
  if (vscode.length) actions.push({ kind: 'json', path: path.join(dir, '.vscode', 'mcp.json'), edits: vscode });
  const cursor = cursorServers(core, o.tools);
  if (cursor.length) actions.push({ kind: 'json', path: path.join(dir, '.cursor', 'mcp.json'), edits: cursor });
  return { actions, commands: [] };
}
