// Login checklist (#181): one row per tool with the command the user runs. Read-only, never reads or stores credentials.
import { quiet, which } from './system.mjs';

// `status` is an upstream read-only command whose exit code says logged in (0) or not; null means no such command is verified (docs/compatibility.md).
const TOOLS = [
  { tool: 'gh', login: 'gh auth login', status: ['gh', 'auth', 'status'], bin: 'gh' },
  { tool: 'claude', agent: 'claude', login: 'claude auth login', status: ['claude', 'auth', 'status'], bin: 'claude' },
  { tool: 'opencode', agent: /^opencode-v[12]$/, login: 'opencode, then /connect', status: null },
  { tool: 'copilot', agent: 'copilot-cli', login: 'copilot, then /login', status: null },
  { tool: 'antigravity', agent: 'antigravity', login: 'agy', status: null },
  { tool: 'vscode-copilot', agent: 'vscode-copilot', login: 'sign in to GitHub Copilot from the VS Code Accounts menu', status: null },
];

// Rows `{ tool, login, state }`, state: ok | needed | unknown (not checked: no verified command, `exec` off, outbound off, tool missing, or the probe timed out).
// Only the exit code is used; the probe's output is dropped on purpose (it can hold an account name or email).
export function loginRows({ agents = [], gh = false, exec = false, outbound = 'on', run = quiet, have = which } = {}) {
  const wanted = TOOLS.filter((t) => (t.tool === 'gh' ? gh : t.agent instanceof RegExp ? agents.some((a) => t.agent.test(a)) : agents.includes(t.agent)));
  return wanted.map(({ tool, login, status, bin }) => {
    let state = 'unknown';
    // `gh auth status` may refresh a token over the network, so strict runs only show the command.
    if (exec && status && outbound !== 'off' && have(bin)) {
      const r = run(status, 15000);
      // A timeout or signal (offline, slow proxy) is not a "not logged in" answer.
      state = r.ok ? 'ok' : r.failed ? 'unknown' : 'needed';
    }
    return { tool, login, state };
  });
}
