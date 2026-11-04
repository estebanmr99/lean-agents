// VS Code Copilot adapter. VS Code reads the same user rules, agents and skills as Copilot CLI
// (~/.copilot, ~/.agents/skills), so those are skipped when copilot-cli is installed too.
import os from 'node:os';
import path from 'node:path';
import { configHome, envDir } from '../system.mjs';
import { localServer } from './opencode-v2.mjs';
import { renderCopilotAgent, skills } from './copilot-cli.mjs';

// Read at import, before isolate() points HOME and USERPROFILE at --home.
const REAL_HOME = os.homedir();

export function vscodeUserDir(home) {
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Code', 'User');
  if (process.platform !== 'win32') return path.join(configHome(home), 'Code', 'User');
  // Only the real home may use %APPDATA%: --home must keep every write inside the temp dir.
  const appData = home === REAL_HOME && process.env.APPDATA ? process.env.APPDATA : path.join(home, 'AppData', 'Roaming');
  return path.join(appData, 'Code', 'User');
}

// `servers` entries for a VS Code mcp.json, user or workspace.
export function vscodeServers(core, tools) {
  return ['serena', 'playwright', 'context-mode'].filter((t) => tools.includes(t)).map((name) => {
    const [command, ...args] = localServer(core, name).command;
    return { path: ['servers', name], value: { type: 'stdio', command, args }, mode: 'setIfAbsent' };
  });
}

export function vscodeCopilotAdapter({ home, core, profile, opts, rules, adhdCommand }) {
  const tools = opts.tools;
  const user = vscodeUserDir(home);
  const actions = [];
  const commands = [];
  if (!opts.agents.includes('copilot-cli')) {
    const dir = envDir(home, 'COPILOT_HOME', path.join(home, '.copilot'));
    actions.push({ kind: 'block', path: path.join(dir, 'copilot-instructions.md'), body: rules });
    for (const agent of core.agents) {
      actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.agent.md`), content: renderCopilotAgent(agent, profile) });
    }
    if (tools.includes('caveman')) {
      commands.push(skills('caveman', 'Caveman skills for VS Code Copilot', 'JuliusBrussee/caveman', ['caveman', 'caveman-compress', 'caveman-stats']));
    }
    if (tools.includes('i-have-adhd')) {
      commands.push(skills('i-have-adhd', 'i-have-adhd skill for VS Code Copilot', 'ayghri/i-have-adhd', ['i-have-adhd']), adhdCommand);
    }
  }
  const edits = vscodeServers(core, tools);
  if (edits.length) actions.push({ kind: 'json', path: path.join(user, 'mcp.json'), edits });
  if (opts.privacy === 'strict') {
    actions.push({
      kind: 'json',
      path: path.join(user, 'settings.json'),
      edits: [{ path: ['telemetry.telemetryLevel'], value: 'off', mode: 'set' }, { path: ['update.mode'], value: 'none', mode: 'set' }],
    });
  }
  return { actions, commands };
}
