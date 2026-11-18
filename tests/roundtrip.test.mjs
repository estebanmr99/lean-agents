// Install-then-uninstall round trip for every adapter: the whole HOME tree must equal its pre-install snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vscodeUserDir } from '../scripts/lib/adapters/vscode-copilot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pre-existing user files per adapter: a JSONC comment, a user MCP server, and an agent and a skill named like managed ones.
const jsonc = (servers) => `{\n  // mine\n  "theme": "dark",\n  ${servers}\n}\n`;
const mine = { mine: { command: 'echo' } };
const userFiles = (home) => ({
  claude: {
    '.claude/settings.json': jsonc('"env": { "FOO": "1" }'),
    '.claude/CLAUDE.md': '# My rules\n',
    '.claude/agents/explore.md': 'my explorer\n',
    '.claude/skills/caveman/SKILL.md': 'my skill\n',
  },
  'opencode-v1': {
    '.config/opencode/opencode.jsonc': jsonc(`"mcp": ${JSON.stringify(mine)}`),
    '.config/opencode/agents/explore.md': 'my explorer\n',
    '.agents/skills/caveman/SKILL.md': 'my skill\n',
  },
  'opencode-v2': {
    '.config/opencode/opencode.jsonc': jsonc(`"mcp": { "servers": ${JSON.stringify(mine)} }`),
    '.config/opencode/agents/explore.md': 'my explorer\n',
    '.agents/skills/caveman/SKILL.md': 'my skill\n',
  },
  'copilot-cli': {
    '.copilot/mcp-config.json': jsonc(`"mcpServers": ${JSON.stringify(mine)}`),
    '.copilot/copilot-instructions.md': '# My rules\n',
    '.copilot/agents/explore.agent.md': 'my explorer\n',
    '.agents/skills/caveman/SKILL.md': 'my skill\n',
  },
  antigravity: {
    '.gemini/config/mcp_config.json': jsonc(`"mcpServers": ${JSON.stringify(mine)}`),
    '.gemini/config/agents/explore.md': 'my explorer\n',
    '.agents/skills/caveman/SKILL.md': 'my skill\n',
  },
  cursor: {
    '.cursor/mcp.json': jsonc(`"mcpServers": ${JSON.stringify(mine)}`),
    '.cursor/agents/explore.md': 'my explorer\n',
    '.agents/skills/caveman/SKILL.md': 'my skill\n',
  },
  'vscode-copilot': {
    [path.relative(home, path.join(vscodeUserDir(home), 'mcp.json'))]: jsonc(`"servers": ${JSON.stringify(mine)}`),
    '.copilot/copilot-instructions.md': '# My rules\n',
    '.copilot/agents/explore.agent.md': 'my explorer\n',
    '.agents/skills/caveman/SKILL.md': 'my skill\n',
  },
});

// Only PATH, NVM_DIR and HOME reach the engine; LEAN_AGENTS_NODE stops the host Node from deciding the Context Mode plan.
const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR, LEAN_AGENTS_NODE: '24.22.2' };
const lean = (home, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { ...env, HOME: home } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
};

// Paths and bytes of every file. Empty directories are not compared (uninstall leaves some; see the PR). Ignored: the engine's own folder (backups, and the state.uninstalled-*.json it keeps on purpose).
function snapshot(root) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (rel === '.config/lean-agents') continue;
      if (e.isDirectory()) walk(p);
      else out[rel] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(root);
  return out;
}

for (const agent of Object.keys(userFiles('/h'))) {
  test(`${agent}: install then --uninstall leaves HOME as it was`, () => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-roundtrip-')));
    for (const [rel, text] of Object.entries(userFiles(home)[agent])) {
      fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
      fs.writeFileSync(path.join(home, rel), text);
    }
    const before = snapshot(home);
    lean(home, ['--yes', '--no-exec', '--agents', agent, '--all-tools']);
    assert.notDeepEqual(snapshot(home), before, 'install must change something');
    lean(home, ['--uninstall', '--yes', '--no-exec']);
    assert.deepEqual(snapshot(home), before);
  });
}
