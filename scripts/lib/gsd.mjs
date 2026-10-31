// GSD Core (opt-in). One upstream install per runtime; ~/.gsd/defaults.json gets per-agent
// models from profiles/<name>/gsd-defaults.json. The json action backs that file up first.
import fs from 'node:fs';
import path from 'node:path';
import { loadProfile, modelFor } from './render.mjs';

const PACKAGE = '@opengsd/gsd-core@latest';
const FLAGS = { claude: '--claude', 'opencode-v1': '--opencode', 'opencode-v2': '--opencode', 'copilot-cli': '--copilot', antigravity: '--antigravity' };

export function gsdProfileName(o) {
  // --profile only selects OpenCode models; its IDs mean nothing to the other runtimes.
  if (o.profile && o.agents.some((a) => a.startsWith('opencode'))) return o.profile;
  if (o.agents.includes('copilot-cli')) return 'github-copilot';
  return o.agents.includes('claude') ? 'claude-subscription' : null;
}

export function gsdPlan(root, home, o) {
  const commands = [...new Set(o.agents.map((a) => FLAGS[a]))].map((flag) => ({
    tool: 'gsd',
    desc: `GSD Core (${flag.slice(2)})`,
    run: [['npx', '-y', PACKAGE, flag, '--global']],
    undo: [['npx', '-y', PACKAGE, flag, '--global', '--uninstall']],
  }));
  const name = gsdProfileName(o);
  const file = name && path.join(root, 'profiles', name, 'gsd-defaults.json');
  if (!file || !fs.existsSync(file)) return { actions: [], commands };
  const profile = loadProfile(root, name);
  // shortcut: one model map for every runtime, use model_profile_overrides if mixing runtimes matters.
  const bare = !o.agents.some((a) => a.startsWith('opencode'));
  const edits = Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).model_overrides).map(([agent, tier]) => {
    const model = modelFor(profile, tier).model;
    return { path: ['model_overrides', agent], value: bare ? model.replace('github-copilot/', '') : model, mode: 'setIfAbsent' };
  });
  return { actions: [{ kind: 'json', path: path.join(home, '.gsd', 'defaults.json'), edits }], commands };
}
