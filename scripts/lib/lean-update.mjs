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

// Same repo and tag for every skill this repo ships; `coordinate` is opt-in, lean-update is always installed.
const skillCommands = (skill, agents) => [...new Set(agents.map((a) => SKILLS_AGENT[a]).filter(Boolean))].map((flag) => ({
  tool: skill,
  optional: true, // the pinned tag may not exist yet (before a release); the rest of the install still stands
  desc: `${skill} skill for ${flag}`,
  run: [['npx', '-y', skillsCli(), 'add', source(), '--skill', skill, '-a', flag, '-g', '-y']],
  // Without -a: `remove -a` keeps ~/.agents/skills while another detected agent may share that folder.
  undo: [['npx', '-y', skillsCli(), 'remove', skill, '-g', '-y']],
}));

export const leanUpdateCommands = (agents) => skillCommands('lean-update', agents);
export const coordinateCommands = (agents) => skillCommands('coordinate', agents);
