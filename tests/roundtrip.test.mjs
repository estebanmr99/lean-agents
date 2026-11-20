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
    '.gemini/config/skills/caveman/SKILL.md': 'my skill\n',
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

// Paths and bytes of every file, and every directory path. Ignored: the state.uninstalled-*.json the engine keeps on purpose.
function snapshot(root) {
  const files = {};
  const dirs = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const rel = path.relative(root, p).split(path.sep).join('/');
      if (/^\.config\/lean-agents\/state\.uninstalled-.*\.json$/.test(rel)) continue;
      if (e.isDirectory()) { dirs.push(rel); walk(p); }
      else files[rel] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(root);
  return { files, dirs };
}

// --yes keeps backups on uninstall on purpose (they undo edits we cannot revert). Each must be a byte copy of a user file from before the install.
const BACKUPS = /^\.config\/lean-agents\/backups\/[^/]+\//;
function withoutBackups(files, before) {
  const rest = {};
  for (const [rel, b64] of Object.entries(files)) {
    if (!BACKUPS.test(rel)) { rest[rel] = b64; continue; }
    assert.equal(b64, before[rel.replace(BACKUPS, '')], `backup of a file the user did not have: ${rel}`);
  }
  return rest;
}

for (const agent of Object.keys(userFiles('/h'))) {
  test(`${agent}: install then --uninstall leaves HOME as it was`, (t) => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-roundtrip-')));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    for (const [rel, text] of Object.entries(userFiles(home)[agent])) {
      fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
      fs.writeFileSync(path.join(home, rel), text);
    }
    const before = snapshot(home);
    lean(home, ['--yes', '--no-exec', '--agents', agent, '--all-tools']);
    assert.notDeepEqual(snapshot(home).files, before.files, 'install must change something');
    lean(home, ['--uninstall', '--yes', '--no-exec']);
    const after = snapshot(home);
    assert.deepEqual(withoutBackups(after.files, before.files), before.files);
    // Every directory the user had survives, and no new one is left (#223) but the engine folder, kept on purpose.
    assert.deepEqual(before.dirs.filter((d) => !after.dirs.includes(d)), []);
    assert.deepEqual(after.dirs.filter((d) => !before.dirs.includes(d) && !/^\.config(\/lean-agents(\/backups(\/[^/]+.*)?)?)?$/.test(d)), []);
  });
}

// Property test (#305 S4): random starting configs, same check. A failure prints its seed; LEAN_SEED=<n> reruns that case.
// mulberry32: small seeded PRNG, so every case can be rerun exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// A JSON(C) text with random user keys, optional comments, trailing commas, indent, CRLF and final newline.
function randomJsonc(r, entries) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const ind = pick(['  ', '    ', '\t']);
  const nl = r() < 0.2 ? '\r\n' : '\n';
  const lines = entries.filter(() => r() < 0.7).map(([k, v]) => `${ind}${r() < 0.3 ? `// note on ${k}${nl}${ind}` : ''}${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{${nl}${lines.join(`,${nl}`)}${lines.length && r() < 0.3 ? ',' : ''}${nl}}${r() < 0.8 ? nl : ''}`;
}

const AGENTS = Object.keys(userFiles('/h'));
function randomCase(seed, home) {
  const r = rng(seed);
  const server = { command: 'npx', args: ['-y', 'my-server'] };
  const files = {
    '.claude/settings.json': randomJsonc(r, [['model', 'opus'], ['env', { FOO: '1', BASH_MAX_OUTPUT_LENGTH: '9000' }], ['permissions', { allow: ['Bash(ls:*)'] }], ['statusLine', { type: 'command', command: 'echo hi' }]]),
    '.claude/CLAUDE.md': r() < 0.5 ? '# My rules\n\n- be brief\n' : 'no trailing newline',
    '.config/opencode/opencode.jsonc': randomJsonc(r, [['theme', 'dark'], ['instructions', ['mine.md']], ['plugin', ['my-plugin@1.0.0']], ['mcp', { mine: { type: 'local', command: ['mine'] } }]]),
    '.config/opencode/AGENTS.md': '# Mine\n',
    '.copilot/mcp-config.json': randomJsonc(r, [['mcpServers', { mine: server }]]),
    '.cursor/mcp.json': randomJsonc(r, [['mcpServers', { mine: server }]]),
    [path.relative(home, path.join(vscodeUserDir(home), 'mcp.json'))]: randomJsonc(r, [['servers', { mine: server }], ['inputs', []]]),
    '.zshrc': 'export PATH="$HOME/bin:$PATH"\n',
  };
  const kept = Object.fromEntries(Object.entries(files).filter(() => r() < 0.75));
  const agents = AGENTS.filter(() => r() < 0.5).filter((a, _, xs) => a !== 'opencode-v1' || !xs.includes('opencode-v2')); // the engine refuses both: same files
  if (!agents.length) agents.push(AGENTS[Math.floor(r() * AGENTS.length)]);
  const args = ['--yes', '--no-exec', '--agents', agents.join(','), '--privacy', r() < 0.5 ? 'standard' : 'strict', ...(r() < 0.5 ? ['--all-tools'] : ['--tools', 'serena,code-mode'])];
  return { files: kept, args };
}

const seeds = process.env.LEAN_SEED ? [Number(process.env.LEAN_SEED)] : Array.from({ length: 12 }, (_, i) => 1000 + i);
for (const seed of seeds) {
  test(`random config (seed ${seed}): install then --uninstall leaves HOME as it was`, (t) => {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-roundtrip-')));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    const { files, args } = randomCase(seed, home);
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
      fs.writeFileSync(path.join(home, rel), text);
    }
    const before = snapshot(home);
    lean(home, args);
    lean(home, ['--uninstall', '--yes', '--no-exec']);
    const after = snapshot(home);
    const why = `rerun with LEAN_SEED=${seed}; args: ${args.join(' ')}`;
    assert.deepEqual(withoutBackups(after.files, before.files), before.files, why);
    assert.deepEqual(before.dirs.filter((d) => !after.dirs.includes(d)), [], why);
    assert.deepEqual(after.dirs.filter((d) => !before.dirs.includes(d) && !/^\.config(\/lean-agents(\/backups(\/[^/]+.*)?)?)?$/.test(d)), [], why);
  });
}
