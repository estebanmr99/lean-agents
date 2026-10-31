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
import { diffModels } from '../scripts/models-refresh.mjs';
import { prereqFor } from '../scripts/lib/system.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'vertex-gemini', '--adhd-always', '--ponytail-mode', 'lite'];

function lean(home, args, env = process.env) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env });
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
  assert.doesNotMatch(rules, /Serena|Context Mode|Playwright|ToolSearch|\{\{/);
});

test('rules say when to use each installed tool', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'playwright', '--lang', 'en', '--privacy', 'standard']);
  const rules = fs.readFileSync(path.join(home, '.config', 'lean-agents', 'AGENTS.md'), 'utf8');
  for (const text of ['ctx_batch_execute', 'ctx_fetch_and_index', 'Playwright', 'ToolSearch']) assert.ok(rules.includes(text), text);
  assert.doesNotMatch(rules, /Serena|\{\{/);
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

test('XDG_CONFIG_HOME inside --home moves the OpenCode and Ponytail config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const xdg = path.join(home, 'xdg');
  lean(home, [...ALL, '--agents', 'opencode-v2'], { ...process.env, XDG_CONFIG_HOME: xdg });
  assert.ok(fs.existsSync(path.join(xdg, 'opencode', 'opencode.jsonc')));
  assert.ok(fs.existsSync(path.join(xdg, 'opencode', 'agents', 'planner.md')));
  if (process.platform !== 'win32') assert.ok(fs.existsSync(path.join(xdg, 'ponytail', 'config.json')));
  assert.ok(!fs.existsSync(path.join(home, '.config', 'opencode')));
});

test('XDG_CONFIG_HOME outside --home is ignored, so a test run cannot escape', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-outside-'));
  lean(home, [...ALL, '--agents', 'opencode-v2'], { ...process.env, XDG_CONFIG_HOME: outside });
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'opencode.jsonc')));
});

test('a failed install command exits 1 and still records state', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  for (const name of ['rtk', 'context-mode']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const args = ['--yes', '--agents', 'opencode-v2', '--tools', 'rtk', '--privacy', 'standard', '--lang', 'en', '--profile', 'none'];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env: { ...process.env, PATH: bin } });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /1 step\(s\) failed/);
  assert.ok(fs.existsSync(path.join(home, '.config', 'lean-agents', 'state.json')));
});

test('winget installs accept agreements, or they stop at a prompt without a TTY', () => {
  for (const tool of ['rtk', 'serena']) assert.ok(prereqFor(tool, 'winget').install[0].includes('--accept-package-agreements'));
});

const NEW = ['--yes', '--no-exec', '--agents', 'copilot-cli,antigravity', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'none', '--adhd-always', '--ponytail-mode', 'off'];

test('Copilot CLI and Antigravity: files, kept user values, full uninstall', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const copilot = path.join(home, '.copilot');
  const gemini = path.join(home, '.gemini', 'config');
  fs.mkdirSync(copilot, { recursive: true });
  fs.mkdirSync(gemini, { recursive: true });
  fs.writeFileSync(path.join(copilot, 'copilot-instructions.md'), '# mine\n');
  fs.writeFileSync(path.join(copilot, 'mcp-config.json'), '{\n  "mcpServers": { "playwright": { "type": "http", "url": "https://mine" } }\n}\n');
  fs.writeFileSync(path.join(gemini, 'mcp_config.json'), '{\n  // keep me\n  "mcpServers": {}\n}\n');
  const before = snapshot(home);
  lean(home, NEW);

  const rules = fs.readFileSync(path.join(copilot, 'copilot-instructions.md'), 'utf8');
  assert.match(rules, /^# mine/);
  assert.match(rules, /lean-agents:start/);
  const mcp = JSON.parse(fs.readFileSync(path.join(copilot, 'mcp-config.json'), 'utf8')).mcpServers;
  assert.equal(mcp.playwright.url, 'https://mine');
  assert.equal(mcp.serena.type, 'local');
  assert.equal(mcp.serena.command, 'uvx');
  assert.ok(!mcp['context-mode'], 'Context Mode comes from the plugin, never also as MCP');
  assert.equal(JSON.parse(fs.readFileSync(path.join(copilot, 'settings.json'), 'utf8')).autoUpdate, false);
  const agent = fs.readFileSync(path.join(copilot, 'agents', 'explore.agent.md'), 'utf8');
  assert.match(agent, /^model: claude-haiku-5\.5$/m);
  assert.match(agent, /^tools: \["read","search"\]$/m);

  assert.match(fs.readFileSync(path.join(gemini, 'rules', 'lean-agents.md'), 'utf8'), /managed by lean-agents/);
  const agy = fs.readFileSync(path.join(gemini, 'agents', 'planner.md'), 'utf8');
  assert.match(agy, /^subagent: true$/m);
  assert.match(agy, /^model: pro$/m);
  const agyMcp = parse(fs.readFileSync(path.join(gemini, 'mcp_config.json'), 'utf8'));
  assert.equal(agyMcp.mcpServers.playwright.command, 'npx');
  assert.equal(agyMcp.mcpServers.playwright.type, undefined);

  lean(home, ['--uninstall', '--yes', '--no-exec']);
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([f]) => !f.startsWith('.config/lean-agents/')));
  assert.deepEqual(after, before);
});

test('--all-tools leaves out opt-in tools; --tools adds them', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const all = lean(home, [...NEW, '--dry-run']);
  assert.ok(!all.includes('gsd-core'));
  assert.match(all, /tools: .*codeburn/);
  assert.ok(!/tools: .*autoskills/.test(all));
  const some = lean(home, [...NEW, '--dry-run', '--tools', 'gsd,autoskills']);
  assert.match(some, /@opengsd\/gsd-core@latest --copilot --global/);
  assert.match(some, /@opengsd\/gsd-core@latest --antigravity --global/);
});

test('GSD defaults use profile models, and existing defaults survive uninstall', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const file = path.join(home, '.gsd', 'defaults.json');
  fs.mkdirSync(path.dirname(file));
  const mine = '{\n  "model_overrides": { "gsd-planner": "mine" }\n}\n';
  fs.writeFileSync(file, mine);
  lean(home, [...NEW, '--agents', 'copilot-cli', '--tools', 'gsd']);
  const on = JSON.parse(fs.readFileSync(file, 'utf8')).model_overrides;
  assert.equal(on['gsd-planner'], 'mine');
  assert.equal(on['gsd-debugger'], 'claude-opus-5.5');
  assert.equal(on['gsd-plan-checker'], 'claude-haiku-5.5');
  lean(home, ['--uninstall', '--yes', '--no-exec']);
  assert.equal(fs.readFileSync(file, 'utf8'), mine);
});

test('every GSD defaults file maps agents to tiers of its profile', () => {
  const dirs = fs.readdirSync(path.join(ROOT, 'profiles'), { withFileTypes: true }).filter((e) => e.isDirectory());
  assert.ok(dirs.length >= 6);
  for (const d of dirs) {
    const profile = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', `${d.name}.json`), 'utf8'));
    const gsd = JSON.parse(fs.readFileSync(path.join(ROOT, 'profiles', d.name, 'gsd-defaults.json'), 'utf8'));
    for (const tier of Object.values(gsd.model_overrides)) assert.ok(profile.tiers[tier], `${d.name}: ${tier}`);
  }
});

test('adhd-skill flips the flag in every installed copy and back', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const a = path.join(home, '.claude', 'plugins', 'cache', 'i-have-adhd', 'i-have-adhd', '0.4.1', 'skills', 'i-have-adhd', 'SKILL.md');
  const b = path.join(home, '.agents', 'skills', 'i-have-adhd', 'SKILL.md');
  const text = '---\nname: i-have-adhd\ndisable-model-invocation: true\n---\nbody\n';
  for (const f of [a, b]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  const script = (mode, h) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'adhd-skill.mjs'), mode, h], { encoding: 'utf8' }).status;
  assert.equal(script('on', home), 0);
  for (const f of [a, b]) assert.match(fs.readFileSync(f, 'utf8'), /disable-model-invocation: false/);
  assert.equal(script('off', home), 0);
  for (const f of [a, b]) assert.equal(fs.readFileSync(f, 'utf8'), text);
  assert.equal(script('on', fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'))), 1, 'a missing skill must fail the install');
});

test('diffModels reports missing IDs and newer family members, and skips aliases', () => {
  const catalog = { acme: { models: {
    'a-1': { id: 'a-1', family: 'a', release_date: '2026-01-01' },
    'a-2': { id: 'a-2', family: 'a', release_date: '2026-02-01' },
    'a-3': { id: 'a-3', family: 'a', release_date: '2026-03-01' },
    'b-1': { id: 'b-1', family: 'b', release_date: '2026-09-01' },
  } } };
  const tiers = { fast: { model: 'acme/a-1' }, balanced: { model: 'acme/b-1' }, strong: { model: 'acme/gone' }, alias: { model: 'opus' } };
  assert.deepEqual(diffModels([{ name: 'p', tiers }], catalog), {
    missing: [{ profile: 'p', model: 'acme/gone' }],
    newer: [{ profile: 'p', model: 'acme/a-1', latest: 'acme/a-3' }],
  });
});
