// i-have-adhd ships with disable-model-invocation: true, so an agent cannot load it when a
// prompt asks for it; only a typed /i-have-adhd or the always-on hook can. The owner wants
// agents to load it, so lean-agents flips the flag in the installed copies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../adhd-skill.mjs', import.meta.url));

export function adhdCommand(home) {
  return {
    tool: 'i-have-adhd',
    desc: 'Let agents load the i-have-adhd skill',
    run: [['node', SCRIPT, 'on', home]],
    undo: [['node', SCRIPT, 'off', home]],
  };
}

export const setInvocable = (text, on) => text.replace(/^disable-model-invocation: (true|false)$/m, `disable-model-invocation: ${on ? 'false' : 'true'}`);

// Every installed copy. Claude Code keeps one folder per plugin version.
export function adhdSkillFiles(home) {
  const cache = path.join(home, '.claude', 'plugins', 'cache', 'i-have-adhd', 'i-have-adhd');
  const versions = fs.existsSync(cache) ? fs.readdirSync(cache).map((v) => path.join(cache, v, 'skills', 'i-have-adhd', 'SKILL.md')) : [];
  return [...versions, path.join(home, '.agents', 'skills', 'i-have-adhd', 'SKILL.md')].filter((f) => fs.existsSync(f));
}
