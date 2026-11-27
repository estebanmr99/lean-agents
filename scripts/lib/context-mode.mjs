// Context Mode 2.1.7 AGENT_IDS (npm tarball, package/server.mjs). The server only resolves a project from
// `--agent <id>`; an id not in this list is rejected, so a client with no id must be reported, never guessed.
export const CTX_AGENT_IDS = ['claude-code', 'codex', 'gemini', 'qwen', 'copilot-cli', 'vscode', 'kiro', 'zcode', 'pi', 'opencode'];

// MCP clients lean-agents writes Context Mode for, mapped to their AGENT_IDS entry.
const AGENT = {
  claude: 'claude-code', 'claude-code': 'claude-code', 'copilot-cli': 'copilot-cli',
  vscode: 'vscode', 'vscode-insiders': 'vscode', opencode: 'opencode',
};

export const agentFor = (client) => (CTX_AGENT_IDS.includes(AGENT[client]) ? AGENT[client] : null);

export const contextModeCommand = (command, client) => {
  const id = agentFor(client);
  return id ? [...command, '--agent', id] : command;
};
