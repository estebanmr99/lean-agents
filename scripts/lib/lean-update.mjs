// The lean-update skill (skills/lean-update) installed for every selected agent through the Skills CLI.
import { skillSource, skillsCli } from './pins.mjs';

// Skills CLI `-a` name per lean-agents agent; Copilot CLI and VS Code Copilot share one.
const SKILLS_AGENT = {
  claude: 'claude-code',
  'opencode-v1': 'opencode',
  'opencode-v2': 'opencode',
  'copilot-cli': 'github-copilot',
  'vscode-copilot': 'github-copilot',
  cursor: 'cursor',
  antigravity: 'antigravity-cli',
};

// CI installs the skill from the checkout (LEAN_AGENTS_SKILL_SOURCE) because the pinned release tag does not exist before release.
const source = () => process.env.LEAN_AGENTS_SKILL_SOURCE || skillSource('lean-update');

export function leanUpdateCommands(agents) {
  return [...new Set(agents.map((a) => SKILLS_AGENT[a]).filter(Boolean))].map((flag) => ({
    tool: 'lean-update',
    optional: true, // the pinned tag may not exist yet (before a release); the rest of the install still stands
    desc: `lean-update skill for ${flag}`,
    run: [['npx', '-y', skillsCli(), 'add', source(), '--skill', 'lean-update', '-a', flag, '-g', '-y']],
    // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
    undo: [['npx', '-y', skillsCli(), 'remove', 'lean-update', '-g', '-y']],
  }));
}
