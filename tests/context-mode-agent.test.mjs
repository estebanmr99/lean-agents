// Context Mode 2.1.7 needs --agent <id> on every MCP entry (#562). The ids come from its AGENT_IDS; a client without one is reported, not guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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

function claudePlan(home, core) {
  const opts = { tools: ['context-mode'], agents: ['claude'], network: preset('on'), toolNode: { node: '/opt/node', modules: '/opt/lib/node_modules' }, prior: [], env: {}, adhdAlways: false, ponytailMode: null };
  return claudeAdapter({ home, core, profile: null, opts, rulesPath: path.join(home, 'AGENTS.md'), adhdCommand: null }).commands;
}

const seedClaude = (servers) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-agent-'));
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: servers }));
  return home;
};

test('--update replaces an old lean-agents Claude Context Mode entry that lacks --agent', () => {
  const core = loadCore(ROOT);
  const home = seedClaude({ 'context-mode': { command: 'npx', args: ['-y', 'context-mode@2.1.4', 'server'] } });
  const mcp = claudePlan(home, core).find((c) => c.desc.includes('Context Mode MCP server'));
  assert.equal(mcp.run.length, 2, 'remove the old entry, then add the new one');
  assert.deepEqual(mcp.run[0], ['claude', 'mcp', 'remove', '--scope', 'user', 'context-mode']);
  assert.deepEqual(mcp.run[1].slice(-2), ['--agent', 'claude-code']);
  assert.equal(mcp.skipIfOutput, undefined, 'a skipped add would leave the old entry in place');
});

test('--update leaves a Claude entry that already has --agent and one the user wrote alone', () => {
  const core = loadCore(ROOT);
  const mine = seedClaude({ 'context-mode': { command: 'npx', args: ['-y', 'context-mode@2.1.4', 'server', '--agent', 'claude-code'] } });
  assert.equal(claudePlan(mine, core).find((c) => c.desc.includes('Context Mode MCP server')), undefined);
  const user = seedClaude({ 'context-mode': { command: 'my-own-ctx', args: [] } });
  assert.equal(claudePlan(user, core).find((c) => c.desc.includes('Context Mode MCP server')), undefined);
});
