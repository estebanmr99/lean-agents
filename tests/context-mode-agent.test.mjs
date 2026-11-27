// Context Mode 2.1.7 needs --agent <id> on every MCP entry (#562). The ids come from its AGENT_IDS; a client without one is reported, not guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from '../scripts/lib/render.mjs';
import { agentFor, contextModeCommand, CTX_AGENT_IDS } from '../scripts/lib/context-mode.mjs';
import { localServer } from '../scripts/lib/adapters/opencode-v2.mjs';
import { vscodeServers } from '../scripts/lib/adapters/vscode-copilot.mjs';
import { cursorServers } from '../scripts/lib/adapters/cursor.mjs';
import { claudeAdapter } from '../scripts/lib/adapters/claude.mjs';
import { preset } from '../scripts/lib/network.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the AGENT_IDS list is the 2.1.7 tarball one and every MCP client maps to an id or none', () => {
  assert.deepEqual(CTX_AGENT_IDS, ['claude-code', 'codex', 'gemini', 'qwen', 'copilot-cli', 'vscode', 'kiro', 'zcode', 'pi', 'opencode']);
  assert.equal(agentFor('vscode'), 'vscode');
  assert.equal(agentFor('opencode'), 'opencode');
  assert.equal(agentFor('copilot-cli'), 'copilot-cli');
  assert.equal(agentFor('claude'), 'claude-code');
  assert.equal(agentFor('cursor'), null);
  assert.equal(agentFor('antigravity'), null);
  assert.deepEqual(contextModeCommand(['npx', 'context-mode', 'server'], 'cursor'), ['npx', 'context-mode', 'server']);
});

test('VS Code, OpenCode and the Claude MCP fallback get --agent; Cursor gets no Context Mode entry', () => {
  const core = loadCore(ROOT);
  const vscode = vscodeServers(core, ['context-mode']);
  assert.deepEqual(vscode[0].value.args.slice(-2), ['--agent', 'vscode']);
  assert.deepEqual(localServer(core, 'context-mode', 'opencode').command.slice(-2), ['--agent', 'opencode']);
  assert.deepEqual(cursorServers(core, ['context-mode']), []);

  const opts = { tools: ['context-mode'], agents: ['claude'], network: preset('on'), toolNode: { node: '/opt/node', modules: '/opt/lib/node_modules' }, prior: [], env: {}, adhdAlways: false, ponytailMode: null };
  const { commands } = claudeAdapter({ home: '/h', core, profile: null, opts, rulesPath: '/h/AGENTS.md', adhdCommand: null });
  const mcp = commands.find((c) => c.desc.includes('Context Mode MCP server'));
  assert.deepEqual(mcp.run[0].slice(-2), ['--agent', 'claude-code']);
});
