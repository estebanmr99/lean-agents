// End-to-end tests of the engine in a temporary HOME. External commands are never run (--no-exec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { applyJsonEdits, revertJsonEdits } from '../scripts/lib/fsops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'vertex-gemini', '--adhd-always', '--ponytail-mode', 'lite'];

function lean(home, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
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

function userHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{\n  // mine\n  "model": "opus",\n  "env": { "FOO": "1" }\n}\n');
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# My rules\n');
  fs.writeFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), '{\n  // keep me\n  "theme": "dark",\n  "instructions": ["mine.md"],\n}\n');
  return home;
}

test('dry run changes nothing', () => {
  const home = userHome();
  const before = snapshot(home);
  const out = lean(home, [...ALL, '--dry-run']);
  assert.match(out, /Dry run: nothing was changed/);
  assert.deepEqual(snapshot(home), before);
});

test('install keeps user values and comments, and is idempotent', () => {
  const home = userHome();
  lean(home, ALL);
  const settings = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.match(settings, /\/\/ mine/);
  const s = parse(settings);
  assert.equal(s.model, 'opus', 'user model must be kept');
  assert.equal(s.env.FOO, '1');
  assert.equal(s.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '80');
  assert.equal(s.env.DISABLE_TELEMETRY, '1');

  const ocText = fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), 'utf8');
  assert.match(ocText, /\/\/ keep me/);
  const oc = parse(ocText, [], { allowTrailingComma: true });
  assert.deepEqual(oc.instructions[0], 'mine.md');
  assert.ok(oc.instructions[1].endsWith('lean-agents/AGENTS.md'));
  assert.equal(oc.agents.plan.model, 'google-vertex/gemini-4-argon');
  assert.ok(oc.mcp.servers.serena && oc.mcp.servers.playwright && oc.mcp.servers['context-mode']);
  assert.equal(oc.share, 'disabled');

  assert.match(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), /^# My rules\n[\s\S]*lean-agents:start/);
  assert.match(fs.readFileSync(path.join(home, '.claude', 'agents', 'explore.md'), 'utf8'), /model: haiku/);
  assert.match(fs.readFileSync(path.join(home, '.config', 'opencode', 'agents', 'planner.md'), 'utf8'), /model: google-vertex\/gemini-4-argon/);

  const after = snapshot(home);
  const plan = lean(home, ['--update', '--yes', '--no-exec', '--dry-run']);
  assert.doesNotMatch(plan, /^\s+(create|modify)\s/m, 'second run must change nothing');
  assert.deepEqual(snapshot(home), after);
});

test('uninstall restores untouched files and removes only our keys from edited ones', () => {
  const home = userHome();
  const before = snapshot(home);
  lean(home, ALL);
  const oc = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  fs.writeFileSync(oc, fs.readFileSync(oc, 'utf8').replace('"theme": "dark",', '"theme": "dark",\n  "later": true,'));
  lean(home, ['--uninstall', '--yes', '--no-exec']);
  const now = snapshot(home);
  for (const f of ['.claude/settings.json', '.claude/CLAUDE.md']) assert.equal(now[f], before[f], f);
  // Edited after install: only our keys are removed (array formatting may change).
  const edited = now['.config/opencode/opencode.jsonc'];
  assert.match(edited, /\/\/ keep me/);
  assert.deepEqual(parse(edited, [], { allowTrailingComma: true }), { theme: 'dark', later: true, instructions: ['mine.md'] });
  const left = Object.keys(now).filter((f) => !f.startsWith('.config/lean-agents/'));
  assert.deepEqual(left.sort(), Object.keys(before).sort(), 'no files may be left behind');
});

test('existing unmanaged agent files are not overwritten', () => {
  const home = userHome();
  fs.mkdirSync(path.join(home, '.claude', 'agents'));
  fs.writeFileSync(path.join(home, '.claude', 'agents', 'review.md'), 'my own reviewer\n');
  const out = lean(home, ALL);
  assert.match(out, /skip\s+~[\\/]\.claude[\\/]agents[\\/]review\.md/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'agents', 'review.md'), 'utf8'), 'my own reviewer\n');
});

test('rules mention only installed tools and honor the language', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--no-tools', '--lang', 'es', '--privacy', 'standard']);
  const rules = fs.readFileSync(path.join(home, '.config', 'lean-agents', 'AGENTS.md'), 'utf8');
  assert.match(rules, /Responde siempre en español/);
  assert.doesNotMatch(rules, /Serena|Context Mode|\{\{/);
});

test('OpenCode 1.x gets singular keys, no Context Mode MCP, and a clean uninstall', () => {
  const home = userHome();
  const before = snapshot(home);
  assert.match(lean(home, ['--dry-run', '--yes', '--no-exec', '--agents', 'opencode-v1', '--tools', 'context-mode', '--lang', 'en']), /npm install -g context-mode/);
  const args = ['--yes', '--no-exec', '--agents', 'opencode-v1', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'anthropic-api', '--ponytail-mode', 'lite'];
  lean(home, args);
  const oc = parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), 'utf8'), [], { allowTrailingComma: true });
  assert.equal(oc.agent.plan.model, 'anthropic/claude-opus-5-5');
  assert.ok(oc.mcp.serena.enabled && oc.mcp.playwright.enabled);
  assert.equal(oc.mcp['context-mode'], undefined);
  assert.deepEqual(oc.plugin, ['context-mode', '@dietrichgebert/ponytail', '@tarquinen/opencode-dcp@latest']);
  assert.equal(oc.compaction.reserved, 40000);
  assert.equal(oc.autoupdate, false);
  assert.equal(oc.experimental.openTelemetry, false);
  assert.deepEqual(oc.disabled_providers, ['opencode']);
  assert.equal(oc.agents ?? oc.plugins ?? oc.update ?? oc.policies, undefined, 'no 2.x keys');
  const dcp = parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'dcp.jsonc'), 'utf8'));
  assert.deepEqual([dcp.compress.minContextLimit, dcp.compress.maxContextLimit], [100000, 160000]);

  lean(home, ['--uninstall', '--yes', '--no-exec']);
  const now = snapshot(home);
  const left = Object.keys(now).filter((f) => !f.startsWith('.config/lean-agents/'));
  assert.deepEqual(left.sort(), Object.keys(before).sort(), 'no files may be left behind');
  assert.equal(now['.config/opencode/opencode.jsonc'], before['.config/opencode/opencode.jsonc']);
});

test('OpenCode 1.x and 2.x cannot be configured together', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--yes', '--no-exec', '--dry-run', '--agents', 'opencode-v1,opencode-v2'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pick one/);
});

test('unknown tools are rejected and DCP only applies to OpenCode 1.x', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const base = ['--yes', '--no-exec', '--agents', 'opencode-v2', '--privacy', 'standard', '--lang', 'en', '--profile', 'anthropic-api'];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...base, '--tools', 'playwrite'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown tools: playwrite/);
  lean(home, [...base, '--all-tools']);
  const { tools } = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8')).options;
  assert.ok(tools.includes('playwright') && !tools.includes('dcp'));
});

test('json edits round-trip', () => {
  const original = '{\n  // c\n  "a": 1\n}\n';
  const edits = [
    { path: ['b', 'c'], value: 2, mode: 'setIfAbsent', createdParents: [['b']] },
    { path: ['list'], value: 'x', mode: 'arrayAdd', createdParents: [['list']] },
  ];
  const { text, applied } = applyJsonEdits(original, edits);
  assert.deepEqual(parse(text), { a: 1, b: { c: 2 }, list: ['x'] });
  assert.equal(revertJsonEdits(text, applied), original);
});
