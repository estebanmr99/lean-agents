// Property test (#305 S4): for random starting configs, install then --uninstall gives back the exact bytes.
// Each case is built from a seed; a failure prints it, and LEAN_SEED=<n> reruns only that case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { vscodeUserDir } from '../scripts/lib/adapters/vscode-copilot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = ['claude', 'opencode-v2', 'copilot-cli', 'cursor', 'vscode-copilot'];

// mulberry32: small seeded PRNG, so every case can be rerun exactly.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function lean(home, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.equal(r.status, 0, r.stderr || r.stdout);
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return Object.fromEntries(Object.entries(out).filter(([f]) => !f.startsWith('.config/lean-agents/')));
}

// A JSON(C) text with random user keys, optional comments, trailing commas, indent and final newline.
function jsonc(r, entries) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const ind = pick(['  ', '    ', '\t']);
  const nl = r() < 0.2 ? '\r\n' : '\n';
  const lines = entries.filter(() => r() < 0.7).map(([k, v]) => `${ind}${r() < 0.3 ? `// note on ${k}${nl}${ind}` : ''}${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{${nl}${lines.join(`,${nl}`)}${lines.length && r() < 0.3 ? ',' : ''}${nl}}${r() < 0.8 ? nl : ''}`;
}

function startHome(seed) {
  const r = rng(seed);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-rt-'));
  const put = (rel, text) => { if (r() < 0.25) return; fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), text); };
  const server = { command: 'npx', args: ['-y', 'my-server'] };
  put('.claude/settings.json', jsonc(r, [['model', 'opus'], ['env', { FOO: '1', BASH_MAX_OUTPUT_LENGTH: '9000' }], ['permissions', { allow: ['Bash(ls:*)'] }], ['statusLine', { type: 'command', command: 'echo hi' }]]));
  put('.claude/CLAUDE.md', r() < 0.5 ? '# My rules\n\n- be brief\n' : 'no trailing newline');
  put('.config/opencode/opencode.jsonc', jsonc(r, [['theme', 'dark'], ['instructions', ['mine.md']], ['plugin', ['my-plugin@1.0.0']], ['mcp', { mine: { type: 'local', command: ['mine'] } }]]));
  put('.config/opencode/AGENTS.md', '# Mine\n');
  put('.copilot/mcp-config.json', jsonc(r, [['mcpServers', { mine: server }]]));
  put('.cursor/mcp.json', jsonc(r, [['mcpServers', { mine: server }]]));
  put(path.relative(home, path.join(vscodeUserDir(home), 'mcp.json')), jsonc(r, [['servers', { mine: server }], ['inputs', []]]));
  put('.zshrc', 'export PATH="$HOME/bin:$PATH"\n');
  const agents = AGENTS.filter(() => r() < 0.6);
  if (!agents.length) agents.push(AGENTS[Math.floor(r() * AGENTS.length)]);
  const args = ['--yes', '--no-exec', '--agents', agents.join(','), '--lang', 'en', '--profile', 'none', '--privacy', r() < 0.5 ? 'standard' : 'strict', ...(r() < 0.5 ? ['--all-tools'] : ['--tools', 'serena,code-mode'])];
  return { home, args };
}

const seeds = process.env.LEAN_SEED ? [Number(process.env.LEAN_SEED)] : Array.from({ length: 12 }, (_, i) => 1000 + i);
for (const seed of seeds) {
  test(`install then --uninstall restores the exact bytes (seed ${seed})`, () => {
    const { home, args } = startHome(seed);
    const before = snapshot(home);
    lean(home, args);
    lean(home, ['--uninstall', '--yes', '--no-exec']);
    assert.deepEqual(snapshot(home), before, `rerun with LEAN_SEED=${seed}; args: ${args.join(' ')}`);
  });
}
