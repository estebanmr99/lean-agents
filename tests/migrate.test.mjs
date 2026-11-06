// Tests for --migrate in a temporary HOME. External commands are never run (--no-exec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSource, migratePlan, detectSources } from '../scripts/lib/migrate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'SECRET-VALUE-123';

function lean(home, args, expect = 0) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8' });
  assert.equal(r.status, expect, r.stderr || r.stdout);
  return r.stdout + r.stderr;
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const put = (root, rel, content) => {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

// A Cursor user setup: one agent, one skill, MCP servers with secrets, a hook.
function cursorHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-migrate-'));
  put(home, '.cursor/agents/x.md', '---\nname: x\ndescription: Does x\n---\nBe careful.\n');
  put(home, '.cursor/skills/demo/SKILL.md', '---\nname: demo\ndescription: demo\n---\nDo demo.\n');
  put(home, '.cursor/mcp.json', JSON.stringify({
    mcpServers: {
      gh: { command: 'npx', args: ['-y', 'gh-mcp'], env: { GH_TOKEN: SECRET } },
      remote: { url: 'https://example.com/mcp', headers: { Authorization: `Bearer ${SECRET}` } },
    },
  }));
  put(home, '.cursor/hooks.json', '{"hooks":{"stop":[{"command":"echo"}]}}');
  return home;
}

test('readSource returns the neutral shape and never an env or header value', () => {
  const home = cursorHome();
  const r = readSource('cursor', home, 'user');
  assert.deepEqual(r.agents.map((a) => a.name), ['x']);
  assert.deepEqual(r.skills.map((s) => s.name), ['demo']);
  assert.deepEqual(r.mcp.map((m) => [m.name, m.envNames, m.headerNames]), [['gh', ['GH_TOKEN'], []], ['remote', [], ['Authorization']]]);
  assert.equal(r.hooks.length, 1);
  assert.ok(!JSON.stringify(r).includes(SECRET));
  assert.throws(() => readSource('nope', home, 'user'), /unknown --migrate source/);
  assert.deepEqual(detectSources(home, 'user', ['claude']), ['cursor']);
});

test('every migration action is a file, json or block action', () => {
  const home = cursorHome();
  const { actions } = migratePlan({ sources: [readSource('cursor', home, 'user')], targets: ['claude', 'opencode-v2', 'copilot-cli', 'vscode-copilot'], base: home, scope: 'user', stateDir: path.join(home, 's') });
  assert.ok(actions.length);
  for (const a of actions) assert.ok(['file', 'json', 'block'].includes(a.kind), a.kind);
  assert.ok(!JSON.stringify(actions).includes(SECRET));
});

test('migrate writes the items, keeps secrets out, and --uninstall restores the home', () => {
  const home = cursorHome();
  put(home, '.config/opencode/opencode.jsonc', '{\n  // keep me\n  "theme": "dark"\n}\n');
  const before = snapshot(home);
  const out = lean(home, ['--yes', '--no-exec', '--migrate', 'cursor', '--agents', 'claude,opencode-v2']);
  assert.match(out, /agent x\s+~\/\.cursor\/agents\/x\.md\s+~\/\.claude\/agents\/x\.md\s+migrated/);
  assert.match(out, /hooks\s+~\/\.cursor\/hooks\.json\s+-\s+reported/);
  assert.match(out, /Set these env vars[^\n]*GH_TOKEN/);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'demo', 'SKILL.md')));
  const oc = fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), 'utf8');
  assert.match(oc, /keep me/);
  assert.match(oc, /"GH_TOKEN": "\{env:GH_TOKEN\}"/);
  for (const [file, content] of Object.entries(snapshot(home))) {
    if (!file.startsWith('.cursor/')) assert.ok(!content.includes(SECRET), `${file} has a secret value`);
  }
  lean(home, ['--yes', '--no-exec', '--uninstall']);
  // Backups and the retired state file stay on purpose.
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([f]) => !f.startsWith('.config/lean-agents/')));
  assert.deepEqual(after, before);
});

test('an existing target item is skipped and stays byte-identical', () => {
  const home = cursorHome();
  put(home, '.claude/agents/x.md', 'mine\n');
  const out = lean(home, ['--yes', '--no-exec', '--migrate', 'cursor', '--agents', 'claude']);
  assert.match(out, /agent x\s+\S+\s+~\/\.claude\/agents\/x\.md\s+skipped/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'x.md'), 'utf8'), 'mine\n');
  assert.ok(fs.existsSync(path.join(home, '.cursor', 'agents', 'x.md')), 'the source is never moved');
});

test('the Claude user MCP path goes through claude mcp add, not ~/.claude.json', () => {
  const home = cursorHome();
  const out = lean(home, ['--yes', '--no-exec', '--migrate', 'cursor', '--agents', 'claude', '--dry-run']);
  assert.match(out, /claude mcp add --scope user gh -- npx -y gh-mcp/);
  assert.match(out, /claude mcp add --scope user --transport http remote https:\/\/example\.com\/mcp/);
  assert.ok(!fs.existsSync(path.join(home, '.claude.json')));
});

test('--project migrates a VS Code Copilot repository, dry run changes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-migrate-home-'));
  const proj = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-migrate-proj-')));
  put(proj, '.github/copilot-instructions.md', 'Use tabs.\n');
  put(proj, '.github/agents/reviewer.agent.md', '---\nname: reviewer\ndescription: Reviews\ntools: ["read"]\n---\nReview.\n');
  put(proj, '.github/prompts/explain.prompt.md', 'Explain.\n');
  put(proj, '.vscode/mcp.json', JSON.stringify({ servers: { gh: { type: 'stdio', command: 'npx', args: ['gh'], env: { GH_TOKEN: SECRET } } } }));
  const before = snapshot(proj);
  const args = ['--yes', '--no-exec', '--migrate', 'vscode-copilot', '--project', proj, '--agents', 'opencode-v2,claude'];
  lean(home, [...args, '--dry-run']);
  assert.deepEqual(snapshot(proj), before);
  lean(home, args);
  assert.match(fs.readFileSync(path.join(proj, '.claude', 'agents', 'reviewer.md'), 'utf8'), /tools: Read, Grep, Glob/);
  assert.ok(fs.existsSync(path.join(proj, '.opencode', 'commands', 'explain.md')));
  assert.match(fs.readFileSync(path.join(proj, '.mcp.json'), 'utf8'), /\$\{GH_TOKEN\}/);
  assert.ok(!fs.readFileSync(path.join(proj, 'opencode.jsonc'), 'utf8').includes(SECRET));
});

test('unknown source fails, auto with nothing found exits 0', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-migrate-empty-'));
  assert.match(lean(home, ['--migrate', 'nope'], 1), /unknown --migrate source/);
  assert.match(lean(home, ['--yes', '--no-exec', '--migrate', 'auto', '--agents', 'claude']), /Nothing to migrate/);
  assert.match(lean(home, ['--yes', '--no-exec', '--migrate', 'claude', '--agents', 'claude'], 1), /source and target are both claude/);
});
