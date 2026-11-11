// End-to-end tests of the engine in a temporary HOME. External commands are never run (--no-exec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'jsonc-parser';
import { applyJsonEdits, revertJsonEdits, plan as planActions, apply as applyActions, undo as undoActions } from '../scripts/lib/fsops.mjs';
import { diffModels } from '../scripts/models-refresh.mjs';
import { releaseNotes } from '../scripts/release.mjs';
import { prereqFor, antigravityPrereqs, bunInstall, contextModeNodeNote } from '../scripts/lib/system.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';
import { detectTerminals, terminalCommands, gitBashActions, stillNeeded } from '../scripts/lib/terminals.mjs';
import { vscodeUserDir } from '../scripts/lib/adapters/vscode-copilot.mjs';
import { npmSpec, PINS } from '../scripts/lib/pins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL = ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'vertex-gemini', '--adhd-always', '--ponytail-mode', 'lite'];

// The host Node must not decide whether Context Mode is planned (it needs Node 24.15+); child engines inherit this.
process.env.LEAN_AGENTS_NODE ??= '24.22.2';

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
  assert.match(lean(home, ['--dry-run', '--yes', '--no-exec', '--agents', 'opencode-v1', '--tools', 'context-mode', '--lang', 'en']), /npm install -g context-mode@\d/);
  const args = ['--yes', '--no-exec', '--agents', 'opencode-v1', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--profile', 'anthropic-api', '--ponytail-mode', 'lite'];
  lean(home, args);
  const oc = parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), 'utf8'), [], { allowTrailingComma: true });
  assert.equal(oc.agent.plan.model, 'anthropic/claude-opus-5-5');
  assert.ok(oc.mcp.serena.enabled && oc.mcp.playwright.enabled);
  assert.equal(oc.mcp['context-mode'], undefined);
  assert.deepEqual(oc.plugin, [npmSpec('context-mode'), npmSpec('ponytail'), npmSpec('opencode-dcp')]);
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
  fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); // the lean-update skill install
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
  assert.match(some, /@opengsd\/gsd-core@\d[\d.]* --copilot --global/);
  assert.match(some, /@opengsd\/gsd-core@\d[\d.]* --antigravity --global/);
});

test('--no-core installs only the listed tools, and --update keeps it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const base = ['--yes', '--no-exec', '--agents', 'opencode-v2', '--no-core', '--tools', 'playwright-extension', '--lang', 'en', '--profile', 'none'];
  const plan = lean(home, [...base, '--dry-run']);
  assert.match(plan, /tools: playwright-extension \|/);
  assert.ok(!/rtk init|context-mode/.test(plan));
  lean(home, base);
  const servers = () => Object.keys(JSON.parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), 'utf8')).mcp.servers);
  assert.deepEqual(servers(), ['playwright-extension']);
  lean(home, ['--update', '--yes', '--no-exec']);
  assert.deepEqual(servers(), ['playwright-extension']);  // A core install updated with --no-core drops RTK and Context Mode from the saved tools.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(other, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'playwright', '--lang', 'en', '--profile', 'none']);
  assert.match(lean(other, ['--update', '--no-core', '--yes', '--no-exec', '--dry-run']), /tools: playwright \|/);
});

test('GSD plans --cursor and skips agents without an installer instead of crashing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const out = lean(home, ['--no-exec', '--yes', '--dry-run', '--agents', 'cursor,vscode-copilot', '--tools', 'gsd']);
  assert.match(out, /@opengsd\/gsd-core@\d[\d.]* --cursor --global/);
  assert.match(out, /no installer for vscode-copilot: skipped/);
});

test('Context Mode v2: Copilot CLI adds only the MCP server (undo: mcp remove), Antigravity skips with a note', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const out = lean(home, ['--yes', '--no-exec', '--dry-run', '--agents', 'copilot-cli,antigravity', '--tools', 'context-mode', '--lang', 'en']);
  assert.match(out, /\$ node .*copilot-context-mode\.mjs/);
  assert.match(out, /context-mode setup --print copilot-cli/);
  assert.match(out, /no Antigravity setup in v2: skipped/);
  assert.ok(!/plugin install/.test(out));
});

test('--uninstall leaves Copilot mcp-config.json valid (mcpServers present) or removes the file lean-agents created', () => {
  const run = (home, before) => {
    const file = path.join(home, '.copilot', 'mcp-config.json');
    if (before) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, before); }
    lean(home, ['--yes', '--no-exec', '--agents', 'copilot-cli', '--tools', 'serena', '--lang', 'en']);
    // `copilot mcp add` / `remove` rewrite the file, so it no longer matches lean-agents' hash.
    fs.writeFileSync(file, `${fs.readFileSync(file, 'utf8')}\n`);
    lean(home, ['--uninstall', '--yes', '--no-exec']);
    return file;
  };
  const created = run(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-')));
  assert.ok(!fs.existsSync(created), 'a file lean-agents created is removed');
  const kept = run(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-')), '{ "other": 1 }\n');
  const after = JSON.parse(fs.readFileSync(kept, 'utf8'));
  assert.equal(after.other, 1);
  assert.deepEqual(after.mcpServers, {});
});

test('Context Mode 2 is skipped below Node 24.15, with one line saying how to fix it', () => {
  for (const v of ['22.20.0', '22.23.4', '24.14.9']) {
    assert.equal(contextModeNodeNote(v), `Context Mode 2 needs Node 24.15+, found ${v}: skipped. Upgrade Node (or nvm install 24) and run --update.`);
  }
  for (const v of ['24.15.0', '24.22.2', '25.0.0', '26.12.1']) assert.equal(contextModeNodeNote(v), '');
});

test('--doctor reports a skipped Context Mode as a note, not an error', () => {
  const state = { version: 'test', options: { agents: ['copilot-cli'], tools: ['rtk', 'context-mode'], privacy: 'standard' }, files: [], commands: [] };
  const rows = [];
  const log = console.log;
  console.log = (line) => rows.push(String(line));
  let ok;
  try { ok = doctor({ home: os.tmpdir(), state, exec: false, nodeVersion: '22.23.4' }); } finally { console.log = log; }
  assert.ok(ok, 'a note does not fail the doctor');
  assert.ok(rows.some((r) => /^note\s+context-mode\s+Context Mode 2 needs Node 24\.15\+, found 22\.23\.4: skipped/.test(r)));
});

test('the engine drops Context Mode on an old Node and keeps it on a new one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const plan = (node) => lean(home, ['--yes', '--no-exec', '--dry-run', '--agents', 'copilot-cli', '--tools', 'context-mode', '--lang', 'en'], { ...process.env, LEAN_AGENTS_NODE: node });
  const old = plan('22.23.4');
  assert.match(old, /Context Mode 2 needs Node 24\.15\+, found 22\.23\.4: skipped/);
  assert.ok(!/tools: .*context-mode/.test(old));
  const current = plan('24.22.2');
  assert.ok(!/needs Node 24\.15/.test(current));
  assert.match(current, /tools: .*context-mode/);
});

test('copilot-context-mode.mjs finds the package next to the linked command, and says where it looked when it cannot', { skip: process.platform === 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-cm-'));
  const nodeDir = path.dirname(process.execPath);
  const tools = path.join(tmp, 'tools');
  fs.mkdirSync(tools);
  // Only node and npm: a real global context-mode on the developer's PATH must not leak in.
  for (const bin of ['node', 'npm']) fs.symlinkSync(path.join(nodeDir, bin), path.join(tools, bin));
  const stub = path.join(tmp, 'stub');
  fs.mkdirSync(stub);
  fs.writeFileSync(path.join(stub, 'copilot'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${tmp}/calls.txt"\n`, { mode: 0o755 });
  const run = (extra) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'copilot-context-mode.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmp, NPM_CONFIG_PREFIX: path.join(tmp, 'elsewhere'), PATH: [...extra, stub, tools].join(path.delimiter) },
  });
  // Windows-style layout: the shim sits next to node_modules, and `npm root -g` points somewhere else.
  const prefix = path.join(tmp, 'prefix');
  fs.mkdirSync(path.join(prefix, 'node_modules', 'context-mode'), { recursive: true });
  fs.writeFileSync(path.join(prefix, 'node_modules', 'context-mode', 'server.mjs'), '');
  fs.writeFileSync(path.join(prefix, 'context-mode'), '#!/bin/sh\n', { mode: 0o755 });
  const found = run([prefix]);
  assert.equal(found.status, 0, found.stderr);
  assert.match(fs.readFileSync(path.join(tmp, 'calls.txt'), 'utf8'), new RegExp(`mcp add context-mode -- .*${path.join('prefix', 'node_modules', 'context-mode', 'server.mjs').replace(/[\\/]/g, '[\\\\/]')} --agent copilot-cli`));
  const missing = run([]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /context-mode 2 not found under npm root -g \(looked in: .*elsewhere.*\); run npm i -g context-mode@2\.1\.4/);
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

test('diffModels skips models the profile already uses and models with other outputs (issue #6)', () => {
  const text = { output: ['text'] };
  const catalog = { acme: { models: {
    'k-3': { id: 'k-3', family: 'k', release_date: '2026-01-01', modalities: text },
    'k-3.1-pro': { id: 'k-3.1-pro', family: 'k', release_date: '2026-02-01', modalities: text },
    'f-1': { id: 'f-1', family: 'f', release_date: '2026-01-01', modalities: text },
    'f-image': { id: 'f-image', family: 'f', release_date: '2026-03-01', modalities: { output: ['text', 'image'] } },
  } } };
  const tiers = { balanced: { model: 'acme/k-3' }, strong: { model: 'acme/k-3.1-pro' }, fast: { model: 'acme/f-1' } };
  assert.deepEqual(diffModels([{ name: 'p', tiers }], catalog), { missing: [], newer: [] });
  catalog.acme.models['f-2'] = { id: 'f-2', family: 'f', release_date: '2026-02-01' };
  assert.deepEqual(diffModels([{ name: 'p', tiers }], catalog).newer, [{ profile: 'p', model: 'acme/f-1', latest: 'acme/f-2' }]);
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

test('--home reaches child tools, and a failed undo exits 1', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-real-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  const rtk = path.join(bin, 'rtk');
  fs.writeFileSync(rtk, '#!/bin/sh\necho "$XDG_CONFIG_HOME" > "$HOME/rtk-ran"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'context-mode'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); // the lean-update skill install
  const env = { ...process.env, HOME: real, XDG_CONFIG_HOME: path.join(real, '.config'), PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const engine = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env });
  const r = engine(['--yes', '--agents', 'opencode-v2', '--tools', 'rtk', '--privacy', 'standard', '--lang', 'en', '--profile', 'none']);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(!fs.existsSync(path.join(real, 'rtk-ran')));
  assert.equal(fs.readFileSync(path.join(home, 'rtk-ran'), 'utf8').trim(), path.join(home, '.config'));

  assert.notEqual(engine(['--uninstall', '--yes', '--no-exec']).status, 0, 'undo commands would be lost');
  fs.writeFileSync(rtk, '#!/bin/sh\nexit 1\n');
  assert.equal(engine(['--uninstall', '--yes']).status, 1);
});

test('GSD ignores --profile when no OpenCode agent is selected', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(home, [...NEW, '--agents', 'copilot-cli', '--tools', 'gsd', '--profile', 'anthropic-api']);
  const models = JSON.parse(fs.readFileSync(path.join(home, '.gsd', 'defaults.json'), 'utf8')).model_overrides;
  assert.equal(models['gsd-debugger'], 'claude-opus-5.5');
});

test('--home drops XDG cache, data and state dirs outside it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const inside = path.join(home, 'state');
  const code = `import('${pathToFileURL(path.join(ROOT, 'scripts/lib/system.mjs')).href}').then((m) => { m.isolate(process.argv[1]); console.log(JSON.stringify([process.env.XDG_CACHE_HOME ?? null, process.env.XDG_STATE_HOME])); })`;
  const env = { ...process.env, XDG_CACHE_HOME: path.join(os.tmpdir(), 'real-cache'), XDG_STATE_HOME: inside };
  const r = spawnSync(process.execPath, ['-e', code, home], { encoding: 'utf8', env });
  assert.deepEqual(JSON.parse(r.stdout), [null, inside]);
});

test('real-binary scripts run no agent CLI before HOME is a throwaway', () => {
  const scripts = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => /^real-.*\.sh$/.test(f));
  assert.ok(scripts.length >= 4);
  for (const f of scripts) {
    const lines = fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8').split('\n');
    const home = lines.findIndex((l) => /^HOME="\$\(mktemp -d\)"/.test(l));
    assert.ok(home >= 0, `${f}: no throwaway HOME`);
    const early = lines.slice(0, home).filter((l) => !/^\s*#|command -v/.test(l) && /\b(agy|claude|copilot|opencode|rtk|npx|npm|agent|code)\b/.test(l));
    assert.deepEqual(early, [], `${f}: runs a CLI before HOME is set`);
  }
});

test('release notes come from one CHANGELOG section, and a wrong version stops the build', () => {
  const log = '## [Unreleased]\n\n- soon\n\n## [1.2.0] - 2026-01-02\n\n- first\n- second\n\n## [1.1.0] - 2026-01-01\n\n- old\n';
  assert.equal(releaseNotes(log, '1.2.0'), '- first\n- second');
  assert.equal(releaseNotes(log, '1.1.0'), '- old');
  assert.equal(releaseNotes(log, '9.9.9'), '');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'release.mjs'), '9.9.9'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match package.json/);
});

test('without a TTY and without --yes: asks nothing, changes nothing, says why', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const args = ['--no-exec', '--agents', 'claude', '--tools', 'serena', '--privacy', 'standard', '--lang', 'en', '--terminal', 'none', '--bun'];
  // detached starts a new session, which has no controlling terminal: /dev/tty cannot open.
  const noTty = (extra) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], detached: true, timeout: 20000 });
  const apply = noTty([]);
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /no terminal to ask on: pass --yes/);
  assert.deepEqual(fs.readdirSync(home), []);
  const dry = noTty(['--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run: nothing was changed/);
  assert.deepEqual(fs.readdirSync(home), []);
});

const NET_BASE = ['--yes', '--no-exec', '--no-tools', '--lang', 'en', '--profile', 'anthropic-api'];
const SWITCHES = {
  claude: (s) => Object.keys(parse(s['.claude/settings.json']).env).filter((k) => /^DISABLE_|NONESSENTIAL|DO_NOT_TRACK/.test(k)).sort(),
  'opencode-v2': (s) => { const c = parse(s['.config/opencode/opencode.jsonc'] ?? '{}'); return { share: c.share, update: c.update, policies: c.policies }; },
  'opencode-v1': (s) => { const c = parse(s['.config/opencode/opencode.jsonc'] ?? '{}'); return { share: c.share, autoupdate: c.autoupdate, otel: c.experimental?.openTelemetry, disabled: c.disabled_providers }; },
  'copilot-cli': (s) => parse(s['.copilot/settings.json'] ?? '{}').autoUpdate,
};
const switchesFor = (agents, flags) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-net-'));
  lean(home, [...NET_BASE, '--agents', agents.join(','), ...flags]);
  const s = snapshot(home);
  return Object.fromEntries(agents.map((a) => [a, SWITCHES[a](s)]));
};

test('--network off turns every telemetry, update and outbound switch off and is recorded', () => {
  const deny = [{ effect: 'deny', action: 'provider.use', resource: 'opencode' }];
  assert.deepEqual(switchesFor(['claude', 'opencode-v2', 'copilot-cli'], ['--network', 'off']), {
    claude: ['CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_AUTOUPDATER', 'DISABLE_BUG_COMMAND', 'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'DO_NOT_TRACK'],
    'opencode-v2': { share: 'disabled', update: 'disable', policies: deny },
    'copilot-cli': false,
  });
  assert.deepEqual(switchesFor(['opencode-v1'], ['--network', 'off'])['opencode-v1'], { share: 'disabled', autoupdate: false, otel: false, disabled: ['opencode'] });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-net-'));
  lean(home, [...NET_BASE, '--agents', 'claude', '--network', 'off']);
  const { options } = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.deepEqual(options.network, { telemetry: 'off', autoUpdate: 'off', outbound: 'off' });
  assert.equal(options.privacy, 'strict');
});

test('--privacy strict equals --network off; --network on and the --yes default set no switch', () => {
  const agents = ['claude', 'opencode-v2', 'copilot-cli'];
  assert.deepEqual(switchesFor(agents, ['--privacy', 'strict']), switchesFor(agents, ['--network', 'off']));
  const none = { claude: [], 'opencode-v2': { share: undefined, update: undefined, policies: undefined }, 'copilot-cli': undefined };
  assert.deepEqual(switchesFor(agents, ['--network', 'on']), none);
  assert.deepEqual(switchesFor(agents, []), none);
});

test('the research agent keeps its web tools unless outbound is off', () => {
  const research = (flags) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-net-'));
    lean(home, [...NET_BASE, '--agents', 'claude,copilot-cli', ...flags]);
    const s = snapshot(home);
    return [s['.claude/agents/research.md'], s['.copilot/agents/research.agent.md']];
  };
  for (const flags of [[], ['--network', 'on'], ['--network', 'off', '--outbound', 'on'], ['--telemetry', 'off']]) {
    const [claude, copilot] = research(flags);
    assert.match(claude, /WebFetch, WebSearch/);
    assert.match(copilot, /"web"/);
  }
  for (const flags of [['--network', 'off'], ['--privacy', 'strict'], ['--outbound', 'off']]) {
    const [claude, copilot] = research(flags);
    assert.doesNotMatch(claude, /WebFetch|WebSearch/);
    assert.doesNotMatch(copilot, /"web"/);
  }
});

test('--project drops the research agent web tools when outbound is off', () => {
  const agent = (flags) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    lean(home, ['--yes', '--no-exec', '--project', repo, '--no-tools', '--lang', 'en', ...flags]);
    return fs.readFileSync(path.join(repo, '.github', 'agents', 'research.agent.md'), 'utf8');
  };
  assert.match(agent(['--network', 'on']), /"web"/);
  assert.doesNotMatch(agent(['--network', 'off']), /"web"/);
});

test('--network off still plans the tools you pick (privacy.md: the preset sets switches, it does not filter tools)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-net-'));
  const out = lean(home, ['--yes', '--no-exec', '--dry-run', '--lang', 'en', '--profile', 'anthropic-api', '--agents', 'claude', '--all-tools', '--network', 'off']);
  for (const t of ['serena', 'codeburn', 'ponytail']) assert.match(out, new RegExp(t, 'i'));
});

test('one category flag overrides the preset', () => {
  const r = switchesFor(['claude', 'opencode-v2'], ['--network', 'off', '--auto-update', 'on']);
  assert.deepEqual(r.claude, ['DISABLE_BUG_COMMAND', 'DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'DO_NOT_TRACK']);
  assert.equal(r['opencode-v2'].update, undefined);
  assert.deepEqual(switchesFor(['claude'], ['--telemetry', 'off']).claude, ['DISABLE_ERROR_REPORTING', 'DISABLE_TELEMETRY', 'DO_NOT_TRACK']);
  const bad = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--outbound', 'maybe'], { encoding: 'utf8' });
  assert.match(bad.stderr, /--outbound takes on or off/);
});

test('--update keeps the network choice of a state file that only has privacy', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-net-'));
  lean(home, [...NET_BASE, '--agents', 'opencode-v2', '--privacy', 'strict']);
  const f = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete state.options.network;
  fs.writeFileSync(f, JSON.stringify(state));
  lean(home, ['--update', '--yes', '--no-exec']);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')).options.network, { telemetry: 'off', autoUpdate: 'off', outbound: 'off' });
});

test('proxy variables are shown redacted, shared in both cases, and never written to disk', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-proxy-'));
  const env = { ...process.env, https_proxy: 'http://alice:s3cret@127.0.0.1:3128', NO_PROXY: 'localhost', NODE_EXTRA_CA_CERTS: '/etc/corp-ca.pem' };
  delete env.HTTPS_PROXY; delete env.no_proxy;
  const out = lean(home, ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--all-tools', '--network', 'off', '--lang', 'en', '--profile', 'none'], env);
  assert.match(out, /HTTPS_PROXY=http:\/\/\*\*\*@127\.0\.0\.1:3128 NO_PROXY=localhost NODE_EXTRA_CA_CERTS=\/etc\/corp-ca\.pem/);
  assert.ok(!out.includes('s3cret'));
  for (const [f, text] of Object.entries(snapshot(home))) assert.ok(!text.includes('s3cret') && !text.includes('3128'), f);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--doctor', '--no-exec'], { encoding: 'utf8', env });
  assert.match(r.stdout, /network env\s+HTTPS_PROXY=http:\/\/\*\*\*@127\.0\.0\.1:3128/);
  assert.ok(!r.stdout.includes('s3cret'));
  const { shareProxy, redactUrl } = await import('../scripts/lib/network.mjs');
  assert.equal(redactUrl('http://ci:p@ss@host:3128'), 'http://***@host:3128');
  const e = { https_proxy: 'http://p:1', NO_PROXY: 'x', NODE_USE_ENV_PROXY: '0' };
  shareProxy(e);
  assert.deepEqual(e, { https_proxy: 'http://p:1', HTTPS_PROXY: 'http://p:1', NO_PROXY: 'x', no_proxy: 'x', NODE_USE_ENV_PROXY: '0' });
  const e2 = { HTTP_PROXY: 'http://p:1' };
  shareProxy(e2);
  assert.equal(e2.NODE_USE_ENV_PROXY, '1');
});

test('gh installs at user scope with brew or winget, only when asked for', () => {
  assert.deepEqual(prereqFor('gh', 'brew').install, [['brew', 'install', 'gh']]);
  assert.deepEqual(prereqFor('gh', 'winget').install[0].slice(0, 6), ['winget', 'install', '--id', 'GitHub.cli', '-e', '--scope']);
  assert.equal(prereqFor('gh', null).install, null);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-gh-'));
  const f = path.join(home, '.config', 'lean-agents', 'state.json');
  lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--no-tools', '--lang', 'en']);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).options.gh, false);
  const out = lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--no-tools', '--lang', 'en', '--gh']);
  assert.match(out, /gh auth login/);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).options.gh, true);
});

test('undocumented settings: asked only when relevant, kept when another agent set them up, never guessed', async () => {
  const { unverifiedItems, notesFile } = await import('../scripts/lib/unverified.mjs');
  const { preset } = await import('../scripts/lib/network.mjs');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const o = (agents, tools, net) => ({ agents, tools, network: preset(net) });
  const ids = (items) => items.map((i) => `${i.id}${i.kept ? ':kept' : ''}`);
  assert.deepEqual(ids(unverifiedItems(o(['claude'], ['rtk'], 'on'), home, { platform: 'darwin', env: {} })), []);
  assert.deepEqual(ids(unverifiedItems(o(['antigravity'], ['serena', 'playwright', 'gsd', 'autoskills', 'dcp'], 'off'), home, { platform: 'darwin', env: {} })),
    ['antigravity', 'serena', 'download-hosts', 'dcp', 'gsd', 'autoskills']);
  assert.deepEqual(ids(unverifiedItems(o(['claude'], ['gsd'], 'on'), home, { platform: 'win32', env: { https_proxy: 'http://p:1' } })), ['winget-proxy', 'download-hosts']);
  fs.mkdirSync(path.join(home, '.serena'));
  fs.writeFileSync(path.join(home, '.serena', 'serena_config.yml'), 'x: 1\n');
  fs.mkdirSync(path.join(home, '.gsd'));
  const gsd = path.join(home, '.gsd', 'defaults.json');
  fs.writeFileSync(gsd, '{}\n');
  const both = o(['claude'], ['serena', 'gsd'], 'off');
  assert.deepEqual(ids(unverifiedItems(both, home, { platform: 'darwin', env: {} })), ['serena:kept', 'gsd:kept']);
  assert.deepEqual(ids(unverifiedItems(both, home, { platform: 'darwin', env: {}, stateFiles: [{ path: gsd }] })), ['serena:kept', 'gsd']);

  const item = { id: 'serena', label: 'Serena config' };
  const line = notesFile(home, item, 'proxy http://u:s3cret@127.0.0.1:8080');
  assert.equal(line.path, path.join(home, '.config', 'lean-agents', 'notes', 'serena.md'));
  assert.match(line.content, /managed by lean-agents[\s\S]*Source: pasted\n\nproxy http:\/\/\*\*\*@127\.0\.0\.1:8080\n$/);
  assert.match(notesFile(home, item, 'HTTPS_PROXY=u:pw@10.0.0.1:8080 password: hunter2').content, /HTTPS_PROXY=\*\*\*@10\.0\.0\.1:8080 password: \*\*\*\n$/);
  // A relative name is pasted text, even when such a file exists (npm test runs in the repo root).
  assert.match(notesFile(home, item, 'package.json').content, /Source: pasted\n\npackage\.json\n$/);
  const src = path.join(home, 'it-notes.txt');
  fs.writeFileSync(src, 'line 1\nline 2 http://a:b@c\n');
  assert.match(notesFile(home, item, src).content, /Source: .*it-notes\.txt\n\nline 1\nline 2 http:\/\/\*\*\*@c\n$/);
  assert.match(notesFile(home, item, '~/it-notes.txt').content, /Source: .*it-notes\.txt/);
});

test('--yes keeps every tool default for undocumented settings and writes no notes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  // A host proxy adds the Windows-only winget-proxy item.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?|all)_proxy$/i.test(k)));
  lean(home, ['--yes', '--no-exec', '--agents', 'antigravity', '--tools', 'serena,playwright', '--network', 'off', '--lang', 'en'], env);
  const state = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.deepEqual(state.options.unverified, { antigravity: 'default', serena: 'default', 'download-hosts': 'default' });
  assert.ok(!fs.existsSync(path.join(home, '.config', 'lean-agents', 'notes')));
});

test('VS Code Copilot: user MCP and strict settings, shared ~/.copilot files written once, full uninstall', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const user = vscodeUserDir(home);
  fs.mkdirSync(user, { recursive: true });
  fs.writeFileSync(path.join(user, 'settings.json'), '{\n  // mine\n  "editor.fontSize": 14\n}\n');
  fs.writeFileSync(path.join(user, 'mcp.json'), '{\n  "servers": { "playwright": { "type": "http", "url": "https://mine" } }\n}\n');
  const before = snapshot(home);
  const out = lean(home, ['--yes', '--no-exec', '--agents', 'vscode-copilot', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--adhd-always', '--ponytail-mode', 'off']);
  assert.match(out, /Caveman skills for VS Code Copilot/);

  const mcp = parse(fs.readFileSync(path.join(user, 'mcp.json'), 'utf8')).servers;
  assert.equal(mcp.playwright.url, 'https://mine');
  assert.equal(mcp.serena.type, 'stdio');
  assert.equal(mcp['context-mode'].command, 'npx');
  const settings = parse(fs.readFileSync(path.join(user, 'settings.json'), 'utf8'));
  assert.equal(settings['editor.fontSize'], 14);
  assert.equal(settings['telemetry.telemetryLevel'], 'off');
  assert.equal(settings['update.mode'], 'none');
  assert.match(fs.readFileSync(path.join(home, '.copilot', 'copilot-instructions.md'), 'utf8'), /lean-agents:start/);
  assert.match(fs.readFileSync(path.join(home, '.copilot', 'agents', 'explore.agent.md'), 'utf8'), /^model: claude-haiku-5\.5$/m);

  lean(home, ['--uninstall', '--yes', '--no-exec']);
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([f]) => !f.startsWith('.config/lean-agents/')));
  assert.deepEqual(after, before);

  // With Copilot CLI too, the shared ~/.copilot files and skills come from one adapter only.
  const both = lean(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-')), ['--yes', '--no-exec', '--dry-run', '--agents', 'copilot-cli,vscode-copilot', '--all-tools', '--privacy', 'standard', '--lang', 'en', '--adhd-always', '--ponytail-mode', 'off']);
  assert.equal(both.match(/copilot-instructions\.md/g).length, 1);
  assert.doesNotMatch(both, /for VS Code Copilot/);
});

test('--project writes the team files into the repo, keeps user content, and undoes cleanly', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Team rules\n');
  fs.mkdirSync(path.join(repo, '.vscode'));
  fs.writeFileSync(path.join(repo, '.vscode', 'mcp.json'), '{\n  // ours\n  "servers": { "docs": { "type": "http", "url": "https://docs" } }\n}\n');
  const before = snapshot(repo);
  const out = lean(home, ['--yes', '--project', repo, '--tools', 'serena,playwright', '--privacy', 'standard', '--lang', 'en']);
  assert.match(out, /commit these files/);
  assert.doesNotMatch(out, /Commands:/);

  const files = snapshot(repo);
  assert.match(files['AGENTS.md'], /^# Team rules[\s\S]*lean-agents:start/);
  assert.match(files['.github/copilot-instructions.md'], /AGENTS\.md/);
  assert.match(files['.cursor/rules/lean-agents.mdc'], /^---\ndescription: .+\nalwaysApply: true\n---\n/);
  assert.match(files['.github/agents/planner.agent.md'], /^model: claude-opus-5\.5$/m);
  const vscode = parse(files['.vscode/mcp.json']).servers;
  assert.equal(vscode.docs.url, 'https://docs');
  assert.deepEqual(Object.keys(vscode).sort(), ['context-mode', 'docs', 'playwright', 'serena']);
  assert.match(files['.cursor/agents/review.md'], /^readonly: true$/m);
  const cursor = JSON.parse(files['.cursor/mcp.json']).mcpServers;
  assert.equal(cursor.serena.command, 'uvx');
  for (const [f, text] of Object.entries(files)) {
    assert.ok(!text.includes(home) && !text.includes(repo) && !text.includes(os.homedir()), `${f} holds a local path`);
  }
  // State stays in the user's home, never in the repo; a user install is not touched.
  assert.ok(!fs.existsSync(path.join(home, '.config', 'lean-agents', 'state.json')));
  assert.equal(fs.readdirSync(path.join(home, '.config', 'lean-agents', 'projects')).length, 1);

  // Another spelling of the same folder finds the same state.
  const spelled = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--project', '.', '--doctor'], { encoding: 'utf8', cwd: repo });
  assert.equal(spelled.status, 0, spelled.stdout);
  assert.match(spelled.stdout, /AGENTS\.md/);
  lean(home, ['--project', repo, '--uninstall', '--yes']);
  assert.deepEqual(snapshot(repo), before);
});

test('--project refuses --agents', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--project', home, '--agents', 'claude', '--dry-run', '--yes'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--project writes repository files only/);
});

test('Cursor: subagents, MCP, kept user values, no global rules, full uninstall', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const dir = path.join(home, '.cursor');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'mcp.json'), '{\n  "mcpServers": { "serena": { "command": "mine" } }\n}\n');
  const before = snapshot(home);
  const out = lean(home, ['--yes', '--no-exec', '--agents', 'cursor', '--all-tools', '--privacy', 'strict', '--lang', 'en', '--adhd-always', '--ponytail-mode', 'off']);
  assert.match(out, /rtk init -g --agent cursor/);
  assert.match(out, /skills@\d[\d.]* add JuliusBrussee\/caveman#[0-9a-f]{40} .* -a cursor -g/);
  assert.match(out, /Privacy Mode in Cursor/);

  const mcp = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8')).mcpServers;
  assert.equal(mcp.serena.command, 'mine');
  assert.equal(mcp.playwright.command, 'npx');
  assert.equal(mcp['context-mode'].command, 'npx');
  const agent = fs.readFileSync(path.join(dir, 'agents', 'debug.md'), 'utf8');
  assert.match(agent, /^model: inherit$/m);
  assert.match(agent, /^readonly: false$/m);
  assert.ok(!fs.existsSync(path.join(dir, 'rules')), 'Cursor user rules live in its settings UI');

  lean(home, ['--uninstall', '--yes', '--no-exec']);
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([f]) => !f.startsWith('.config/lean-agents/')));
  assert.deepEqual(after, before);
});

test('with --home, %APPDATA% outside it is never written (Ponytail, VS Code)', { skip: process.platform !== 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-appdata-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'opencode-v2,vscode-copilot', '--tools', 'ponytail,serena', '--privacy', 'strict', '--lang', 'en', '--profile', 'none', '--ponytail-mode', 'lite'], { ...process.env, APPDATA: appData });
  assert.deepEqual(fs.readdirSync(appData), []);
  const roaming = path.join(home, 'AppData', 'Roaming');
  assert.ok(fs.existsSync(path.join(roaming, 'ponytail', 'config.json')));
  assert.ok(fs.existsSync(path.join(roaming, 'Code', 'User', 'mcp.json')));
});

test('playwright-extension: opt-in, written for agents without a browser, never for Claude Code, and undone', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const args = ['--yes', '--no-exec', '--lang', 'en', '--privacy', 'standard', '--profile', 'github-copilot', '--adhd-always', '--ponytail-mode', 'off'];
  const all = lean(home, [...args, '--agents', 'opencode-v2', '--all-tools', '--dry-run']);
  assert.ok(!/tools: .*playwright-extension/.test(all));
  assert.ok(!all.includes('Playwright Extension'));

  const before = snapshot(home);
  const out = lean(home, [...args, '--agents', 'opencode-v2,copilot-cli,cursor,vscode-copilot,claude', '--tools', 'playwright-extension']);
  assert.match(out, /chromewebstore\.google\.com\/detail\/playwright-extension\/mmlmfjhmonkocbjadbfplnigmagldckm/);
  assert.match(out, /docs\/browser-extension\.md/);
  assert.ok(!/claude mcp add .*playwright-extension/.test(out));
  assert.ok(!out.includes('PLAYWRIGHT_MCP_EXTENSION_TOKEN'));
  const read = (...p) => parse(fs.readFileSync(path.join(...p), 'utf8'));
  const ext = ['-y', npmSpec('playwright-mcp'), '--extension'];
  assert.deepEqual(read(home, '.config', 'opencode', 'opencode.jsonc').mcp.servers['playwright-extension'].command, ['npx', ...ext]);
  assert.deepEqual(read(home, '.copilot', 'mcp-config.json').mcpServers['playwright-extension'].args, ext);
  assert.deepEqual(read(home, '.cursor', 'mcp.json').mcpServers['playwright-extension'].args, ext);
  assert.deepEqual(read(vscodeUserDir(home), 'mcp.json').servers['playwright-extension'].args, ext);
  for (const f of ['.copilot/mcp-config.json', '.cursor/mcp.json']) assert.ok(!read(home, f).mcpServers.playwright, f);

  lean(home, ['--uninstall', '--yes', '--no-exec']);
  const after = Object.fromEntries(Object.entries(snapshot(home)).filter(([f]) => !f.startsWith('.config/lean-agents/')));
  assert.deepEqual(after, before);
});

test('bunInstall: pinned zip, SHA256 check before extraction, undo only for what it installs', () => {
  const { version, sha256 } = PINS.bun;
  const linux = bunInstall('/h', '/h/state', 'linux', null, 'x64');
  assert.equal(linux.run[0].at(-1), `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64.zip`);
  assert.deepEqual(linux.run[1].slice(2), [linux.run[0][3], sha256['linux-x64']]);
  assert.equal(linux.run[2][0], 'unzip');
  assert.equal(linux.undo[0].at(-1), path.join('/h', '.bun'));
  assert.match(bunInstall('/h', '/h/state', 'linux', null, 'arm64').run[0].at(-1), /bun-linux-aarch64\.zip$/);
  const mac = bunInstall('/h', '/h/state', 'darwin', 'brew');
  assert.deepEqual([mac.run, mac.undo], [[['brew', 'install', 'oven-sh/bun/bun']], [['brew', 'uninstall', 'bun']]]);
  assert.equal(bunInstall('/h', '/h/state', 'darwin', null), null);
  const win = bunInstall('/h', '/h/state', 'win32', 'winget', 'x64');
  assert.equal(win.run[0][0], 'curl.exe');
  assert.equal(win.run[1][3], sha256['windows-x64']);
  assert.match(win.run[2].at(-1), /Expand-Archive.*bun\.exe.*SetEnvironmentVariable/s);
  assert.match(win.undo[1].at(-1), /SetEnvironmentVariable/);
  assert.match(bunInstall("C:\\Users\\O'Neil", 'C:\\s', 'win32', 'winget', 'x64').run[2].at(-1), /O''Neil/);
});

test('verify-sha256: a mismatch deletes the file and exits 1 so the chain stops before extraction', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-sha-'));
  const file = path.join(dir, 'bun.zip');
  fs.writeFileSync(file, 'not bun');
  const script = path.join(ROOT, 'scripts', 'lib', 'verify-sha256.mjs');
  const bad = spawnSync(process.execPath, [script, file, 'a'.repeat(64)], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /SHA256 mismatch/);
  assert.ok(!fs.existsSync(file));
  fs.writeFileSync(file, 'not bun');
  const want = spawnSync(process.execPath, ['-e', `console.log(require('crypto').createHash('sha256').update('not bun').digest('hex'))`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(spawnSync(process.execPath, [script, file, want], { encoding: 'utf8' }).status, 0);
  assert.ok(fs.existsSync(file));
});

test('Bun: on by default with Context Mode, --no-bun is saved and reused, --update keeps it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const args = ['--yes', '--no-exec', '--agents', 'claude', '--lang', 'en', '--privacy', 'standard'];
  assert.match(lean(home, [...args, '--dry-run']), /bun: on/);
  assert.match(lean(home, [...args, '--dry-run', '--no-bun']), /bun: off/);
  lean(home, [...args, '--no-bun']);
  const state = () => JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.equal(state().options.bun, false);
  lean(home, ['--update', '--yes', '--no-exec']);
  assert.equal(state().options.bun, false);
});

test('~/.bunfig.toml: telemetry block at the top only with telemetry off, user content kept, undone', () => {
  const args = ['--yes', '--no-exec', '--agents', 'claude', '--lang', 'en'];
  const std = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(std, [...args, '--privacy', 'standard']);
  assert.ok(!fs.existsSync(path.join(std, '.bunfig.toml')));

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const file = path.join(home, '.bunfig.toml');
  const mine = '[install]\nregistry = "https://example.test"\n';
  fs.writeFileSync(file, mine);
  lean(home, [...args, '--privacy', 'strict']);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('# lean-agents:start\ntelemetry = false\n# lean-agents:end\n'));
  assert.ok(text.endsWith(mine));
  lean(home, ['--uninstall', '--yes', '--no-exec']);
  assert.equal(fs.readFileSync(file, 'utf8'), mine);

  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(fresh, [...args, '--privacy', 'strict']);
  assert.ok(fs.existsSync(path.join(fresh, '.bunfig.toml')));
  lean(fresh, ['--uninstall', '--yes', '--no-exec']);
  assert.ok(!fs.existsSync(path.join(fresh, '.bunfig.toml')));
});

test('playwright-extension alone adds no Playwright rule lines for a Claude-only install', () => {
  const args = ['--yes', '--no-exec', '--lang', 'en', '--privacy', 'standard', '--tools', 'playwright-extension'];
  const rules = (agents) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
    lean(home, [...args, '--agents', agents]);
    return fs.readFileSync(path.join(home, '.config', 'lean-agents', 'AGENTS.md'), 'utf8');
  };
  assert.doesNotMatch(rules('claude'), /Playwright/);
  assert.match(rules('opencode-v2'), /Playwright/);
});

test('terminals: nothing detected means no integration; --terminal adds Warp and Orca and uninstall undoes it', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  const env = { ...process.env, PATH: `${bare}${path.delimiter}${path.dirname(process.execPath)}`, LOCALAPPDATA: '' };
  const base = ['--yes', '--no-exec', '--agents', 'claude,opencode-v2', '--tools', 'rtk'];
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-empty-'));
  const oldPath = process.env.PATH;
  process.env.PATH = bare;
  try { assert.deepEqual(detectTerminals(empty, { platform: 'linux', env: {} }), [], 'nothing found: no prompt, no change'); } finally { process.env.PATH = oldPath; }
  fs.mkdirSync(path.join(empty, 'Applications', 'Warp.app'), { recursive: true });
  assert.deepEqual(detectTerminals(empty, { platform: 'darwin', env: {} }).filter((t) => t === 'warp'), ['warp']);

  fs.writeFileSync(path.join(bare, 'orca'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bare, 'warp-terminal'), '#!/bin/sh\n', { mode: 0o755 });
  process.env.PATH = bare;
  // `where` finds no extensionless stub on Windows.
  if (process.platform !== 'win32') try {
    assert.deepEqual(detectTerminals(empty, { platform: 'darwin', system: true, env: {} }).sort(), ['orca', 'warp']);
    assert.deepEqual(detectTerminals(empty, { platform: 'linux', system: true, env: {} }), ['warp'], 'linux orca is a screen reader');
    assert.deepEqual(detectTerminals(empty, { platform: 'darwin', system: false, env: {} }).filter((t) => t === 'orca'), [], '--home ignores PATH');
  } finally { process.env.PATH = oldPath; }
  if (process.platform === 'darwin') {
    const h = userHome();
    fs.mkdirSync(path.join(h, 'Applications', 'Orca.app'), { recursive: true });
    assert.match(lean(h, [...base, '--dry-run'], env), /terminals: orca/, 'detected terminal is the default');
  }
  assert.doesNotMatch(lean(userHome(), [...base, '--dry-run', '--terminal', 'none'], env), /terminals:/);

  const home = userHome();
  const before = snapshot(home);
  const plan = lean(home, [...base, '--dry-run', '--terminal', 'both'], env);
  assert.match(plan, /claude plugin install warp@claude-code-warp/);
  assert.match(plan, /skills@\d[\d.]* add stablyai\/orca#[0-9a-f]{40} --skill orca-cli -a claude-code opencode -g -y/);
  lean(home, [...base, '--terminal', 'warp']);
  const oc = parse(fs.readFileSync(path.join(home, '.config', 'opencode', 'opencode.jsonc'), 'utf8'), [], { allowTrailingComma: true });
  assert.ok(oc.plugins.includes(npmSpec('warp-opencode')));
  lean(home, ['--uninstall', '--yes']);
  const after = snapshot(home);
  for (const k of Object.keys(before)) assert.equal(after[k], before[k], `${k} restored`);

  const v1 = userHome();
  lean(v1, ['--yes', '--no-exec', '--agents', 'opencode-v1', '--tools', 'rtk', '--terminal', 'warp']);
  const oc1 = parse(fs.readFileSync(path.join(v1, '.config', 'opencode', 'opencode.jsonc'), 'utf8'), [], { allowTrailingComma: true });
  assert.ok(oc1.plugin.includes(npmSpec('warp-opencode')));
});

test('terminals: all-off network prints the Warp and Orca privacy switches', () => {
  const out = lean(userHome(), ['--yes', '--no-exec', '--dry-run', '--agents', 'claude', '--network', 'off', '--terminal', 'both']);
  assert.match(out, /telemetry_enabled = false/);
  assert.match(out, /DO_NOT_TRACK=1/);
});

const NO_PROXY_ENV = { HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', no_proxy: '' };

test('Orca on Windows: skill for Cursor and VS Code Copilot, telemetry and NO_PROXY commands only for the real home', () => {
  const win = { terminals: ['orca'], agents: ['cursor', 'vscode-copilot'], platform: 'win32' };
  const skill = terminalCommands({ ...win, network: {}, env: {} }).find((c) => c.desc === 'Orca skill orca-cli');
  assert.deepEqual(skill.run[0].slice(-5), ['-a', 'cursor', 'github-copilot', '-g', '-y']);

  const rd = (user, machine = null) => (scope) => (scope === 'User' ? user : machine);
  const proxied = { HTTPS_PROXY: 'http://proxy.invalid:8080' };
  const text = (c) => c.run.flat().join(' ');
  const cmds = terminalCommands({ ...win, network: { telemetry: 'off' }, env: proxied, readEnv: rd('corp.invalid,localhost') });
  const dnt = cmds.find((c) => /DO_NOT_TRACK/.test(text(c)));
  assert.ok(dnt.skipIfOutput, 'a value you already set is never overwritten');
  assert.match(dnt.skipIfOutput.cmd.join(' '), /'Machine'/, 'nor one set machine-wide');
  assert.match(dnt.undo.flat().join(' '), /DO_NOT_TRACK.*\$null/);
  assert.ok(cmds.some((c) => /ORCA_TELEMETRY_DISABLED/.test(text(c))));
  const np = cmds.find((c) => /NO_PROXY/.test(text(c)));
  assert.match(np.desc, /add 127\.0\.0\.1, ::1 to/, 'only the entries missing from the user value');
  assert.doesNotMatch(np.undo.flat().join(' '), /'localhost'/, 'undo never removes what you had');
  assert.doesNotMatch(np.undo.flat().join(' '), /'Machine'/, 'a user value existed: nothing else to drop');

  // No user value: the machine value is the starting point, and undo drops the var once only that is left.
  const fromMachine = terminalCommands({ ...win, network: {}, env: proxied, readEnv: rd(null, 'corp.invalid') }).find((c) => /NO_PROXY/.test(text(c)));
  assert.match(text(fromMachine), /\$v=\[Environment\]::GetEnvironmentVariable\('NO_PROXY','User'\); if \(-not \$v\) \{ \$v=\[Environment\]::GetEnvironmentVariable\('NO_PROXY','Machine'\)/);
  assert.match(fromMachine.undo.flat().join(' '), /'Machine'/);
  // A value set only in this shell is not persisted anywhere, so it does not count as covered.
  const sessionOnly = terminalCommands({ ...win, network: {}, env: { ...proxied, NO_PROXY: 'localhost,127.0.0.1,::1' }, readEnv: rd(null) });
  assert.ok(sessionOnly.some((c) => /NO_PROXY/.test(text(c))));

  const covered = terminalCommands({ ...win, network: {}, env: proxied, readEnv: rd('localhost,127.0.0.1,::1') });
  assert.ok(!covered.some((c) => /NO_PROXY/.test(text(c))));
  assert.ok(!terminalCommands({ ...win, network: {}, env: {}, readEnv: rd(null) }).some((c) => /NO_PROXY/.test(text(c))), 'no proxy, no change');
  const cidr = terminalCommands({ ...win, network: {}, env: proxied, readEnv: rd('127.0.0.0/8') });
  assert.match(cidr.find((c) => /NO_PROXY/.test(text(c))).desc, /localhost, 127\.0\.0\.1, ::1/, 'a CIDR does not count');
  const away = terminalCommands({ ...win, network: { telemetry: 'off' }, env: proxied, system: false, readEnv: rd(null) });
  assert.deepEqual(away.filter((c) => /powershell/.test(text(c))), [], '--home never touches the machine');
  assert.deepEqual(terminalCommands({ ...win, platform: 'darwin', network: { telemetry: 'off' }, env: proxied, readEnv: rd(null) }).filter((c) => /powershell/.test(text(c))), []);
});

test('Git Bash: marked .bashrc block with the Cursor aliases and loopback NO_PROXY, undone byte for byte', () => {
  const home = userHome();
  const rc = path.join(home, '.bashrc');
  const mine = '# mine\nexport FOO=1\n';
  fs.writeFileSync(rc, mine);
  const args = { home, terminals: ['orca'], agents: ['cursor'], platform: 'win32', env: { MSYSTEM: 'MINGW64', HTTPS_PROXY: 'http://proxy.invalid:8080' } };
  assert.deepEqual(gitBashActions({ ...args, platform: 'linux' }), []);
  assert.deepEqual(gitBashActions({ ...args, env: {} }), [], 'no Git Bash found');
  const actions = gitBashActions(args);
  const [p] = planActions(actions);
  assert.match(p.after, /alias agent='MSYSTEM= SHELL= agent\.cmd'/);
  assert.match(p.after, /alias cursor-agent='MSYSTEM= SHELL= cursor-agent\.cmd'/);
  assert.match(p.after, /for h in localhost 127\.0\.0\.1 ::1; do/);
  assert.doesNotMatch(p.after, /proxy\.invalid/, 'proxy values never reach disk');
  const entries = applyActions([p], path.join(home, 'bk'), home);
  assert.match(fs.readFileSync(rc, 'utf8'), /export FOO=1/);
  // The NO_PROXY loop appends only what is missing and keeps the user's entries.
  const body = p.after.match(/for h in[\s\S]*export NO_PROXY no_proxy/)[0];
  const shell = spawnSync('bash', ['-c', `NO_PROXY='corp.invalid,localhost'\n${body}\necho "$NO_PROXY|$no_proxy"`], { encoding: 'utf8' });
  if (!shell.error) assert.equal(shell.stdout.trim(), 'corp.invalid,localhost,127.0.0.1,::1|localhost,127.0.0.1,::1');
  undoActions(entries);
  assert.equal(fs.readFileSync(rc, 'utf8'), mine);
  assert.deepEqual(gitBashActions({ ...args, agents: ['claude'], terminals: [] }), []);
  assert.doesNotMatch(gitBashActions({ ...args, env: { MSYSTEM: 'MINGW64' } })[0].body, /NO_PROXY/, 'no proxy, no NO_PROXY');
});

test('Cursor behind a proxy: only useHttp1ForAgent is merged into cli-config.json and uninstall restores it', () => {
  const home = userHome();
  const cfg = path.join(home, '.cursor', 'cli-config.json');
  fs.mkdirSync(path.dirname(cfg), { recursive: true });
  const mine = '{\n  "editor": { "vimMode": true }\n}\n';
  fs.writeFileSync(cfg, mine);
  const base = ['--yes', '--no-exec', '--agents', 'cursor', '--tools', 'serena', '--terminal', 'none'];
  lean(home, base, { ...process.env, ...NO_PROXY_ENV });
  assert.equal(fs.readFileSync(cfg, 'utf8'), mine, 'no proxy, no change');
  lean(home, base, { ...process.env, ...NO_PROXY_ENV, HTTPS_PROXY: 'http://proxy.invalid:8080' });
  const text = fs.readFileSync(cfg, 'utf8');
  assert.deepEqual(parse(text), { editor: { vimMode: true }, network: { useHttp1ForAgent: true } });
  assert.doesNotMatch(text, /proxy\.invalid/);
  lean(home, ['--uninstall', '--yes']);
  assert.equal(fs.readFileSync(cfg, 'utf8'), mine);
});

test('Still needed from you: printed after install and by --doctor, Orca hooks found even when PowerShell-encoded', () => {
  const home = userHome();
  const out = lean(home, ['--yes', '--no-exec', '--agents', 'cursor', '--tools', 'serena', '--terminal', 'orca'], { ...process.env, ...NO_PROXY_ENV });
  assert.match(out, /Still needed from you:/);
  assert.match(out, /agent login/);
  assert.match(out, /User Rules/);
  assert.match(out, /Install CLI & Skills|first launch/);
  const none = lean(userHome(), ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'rtk', '--terminal', 'none'], { ...process.env, ...NO_PROXY_ENV });
  assert.doesNotMatch(none, /Still needed/);

  const hook = Buffer.from('curl http://127.0.0.1:%ORCA_AGENT_HOOK_PORT%/hook/cursor', 'utf16le').toString('base64');
  const checks = (h) => stillNeeded({ home: h, terminals: ['orca'], agents: ['cursor'], platform: 'darwin' }).filter((t) => t.check);
  assert.equal(checks(home)[0].check(), false);
  fs.writeFileSync(path.join(home, '.cursor', 'hooks.json'), JSON.stringify({ hooks: { beforeShellExecution: [{ command: `powershell -EncodedCommand ${hook}` }] } }));
  assert.equal(checks(home)[0].check(), true);
  assert.match(lean(home, ['--doctor', '--no-exec'], { ...process.env, ...NO_PROXY_ENV }), /ok\s+still needed\s+Orca: the first launch/);
});

test('Antigravity app and CLI install only through verified ids, else print the vendor link', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-agy-'));
  const runs = (pm, platform) => antigravityPrereqs(pm, platform, home).map((c) => c.run[0]?.join(' ') ?? 'manual');
  assert.ok(runs('brew', 'darwin').includes('brew install --cask antigravity'));
  assert.ok(runs('brew', 'darwin').every((r) => !r.startsWith('winget')));
  // Without a package route the app is only a note; a missing CLI is a manual step.
  const linux = antigravityPrereqs('brew', 'linux', home);
  assert.ok(linux.some((c) => c.note) && !linux.some((c) => c.note && c.manual));
  assert.deepEqual(antigravityPrereqs('brew', 'darwin', home, false).filter((c) => c.desc.includes('app')), []);
  // The Windows CLI id has no documented scope, so it is never run; only the app (scope user) is.
  assert.ok(antigravityPrereqs(null, 'win32', home).every((c) => c.manual || c.note));
  assert.ok(!runs('winget', 'win32').some((r) => r.includes('AntigravityCLI')));
});

test('core/pins.json: every pin has version, date and a CI job that exists; no plan fetches @latest or an unpinned skill', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const [key, p] of Object.entries(PINS)) {
    assert.match(p.version, /^v?\d+\.\d+\.\d+$/, key);
    assert.match(p.verified, /^\d{4}-\d{2}-\d{2}$/, key);
    assert.ok(new RegExp(`^  ${p.ci}:`, 'm').test(ci), `${key}: no CI job ${p.ci}`);
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const tools = 'serena,playwright,playwright-extension,caveman,i-have-adhd,dcp,codeburn,gsd,autoskills,context-mode';
  const out = ['claude,opencode-v1,copilot-cli,cursor', 'opencode-v2,antigravity,vscode-copilot']
    .map((agents) => lean(home, ['--yes', '--no-exec', '--dry-run', '--agents', agents, '--tools', tools, '--terminal', 'orca'])).join('\n');
  assert.ok(!/@latest/.test(out), 'plan contains @latest');
  for (const line of out.split('\n').filter((l) => /skills[@ ].* add /.test(l))) assert.match(line, /skills@\d[\d.]* add (\S+#[0-9a-f]{40}|estebanmr99\/lean-agents#v\d\S*)\b/, line);
});

test('--doctor reports no pin drift after install and a changed row when a recorded pin differs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']);
  assert.match(lean(home, ['--doctor', '--no-exec']), /ok\s+pinned versions/);
  const file = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.pins.caveman = 'v0.0.1';
  fs.writeFileSync(file, JSON.stringify(state));
  assert.match(lean(home, ['--doctor', '--no-exec']), /changed\s+pin caveman.*installed v0\.0\.1/);
});

test('every agent gets the lean-update skill from the pinned tag, with an undo', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const out = lean(home, ['--yes', '--no-exec', '--dry-run', '--agents', 'claude,opencode-v2,copilot-cli,vscode-copilot,cursor,antigravity', '--tools', 'rtk']);
  const adds = out.split('\n').filter((l) => /--skill lean-update/.test(l));
  for (const flag of ['claude-code', 'opencode', 'github-copilot', 'cursor', 'antigravity-cli']) {
    assert.equal(adds.filter((l) => l.includes(`-a ${flag} `)).length, 1, flag);
  }
  for (const l of adds) assert.match(l, /skills@\d[\d.]* add estebanmr99\/lean-agents#v\d+\.\d+\.\d+ --skill lean-update/);
});

test('--uninstall removes the lean-update skill', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  const log = path.join(bin, 'npx.log');
  fs.writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  lean(home, ['--yes', '--agents', 'claude', '--no-tools', '--no-core', '--no-gh', '--no-bun', '--lang', 'en', '--profile', 'none'], env);
  lean(home, ['--uninstall', '--yes'], env);
  assert.match(fs.readFileSync(log, 'utf8'), /skills@\d[\d.]* remove lean-update -g -y/);
});

test('--update prints old -> new for pins in use; --doctor --json lists them under behind', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'claude', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']);
  const file = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.pins.caveman = 'v0.0.1';
  state.pins['codeburn'] = '0.0.1'; // not installed: must not be reported
  fs.writeFileSync(file, JSON.stringify(state));
  const json = JSON.parse(lean(home, ['--doctor', '--no-exec', '--json']));
  assert.deepEqual(json.behind, [{ tool: 'caveman', installed: 'v0.0.1', pinned: PINS.caveman.version }]);
  const plan = JSON.parse(lean(home, ['--update', '--yes', '--no-exec', '--dry-run', '--json']));
  assert.deepEqual(plan.behind, json.behind);
  const out = lean(home, ['--update', '--yes', '--no-exec']);
  assert.match(out, new RegExp(`caveman: v0\\.0\\.1 -> ${PINS.caveman.version.replace(/\./g, '\\.')}`));
  assert.ok(!/codeburn:/.test(out));
  assert.deepEqual(JSON.parse(lean(home, ['--doctor', '--no-exec', '--json'])).behind, []);
});

test('--update installs a pinned npm tool again when it is behind, and records the command once', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  const log = path.join(bin, 'calls.log');
  for (const name of ['npm', 'npx', 'context-mode', 'rtk']) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $@" >> "${log}"\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LEAN_AGENTS_SKILL_SOURCE: '' };
  const args = ['--yes', '--agents', 'opencode-v1', '--tools', 'context-mode', '--no-gh', '--no-bun', '--lang', 'en', '--profile', 'none'];
  lean(home, args, env);
  assert.ok(!/npm install -g/.test(fs.readFileSync(log, 'utf8')), 'context-mode is on PATH: no install');
  const file = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.pins['context-mode'] = '0.0.1';
  fs.writeFileSync(file, JSON.stringify(state));
  lean(home, ['--update', '--yes'], env);
  assert.match(fs.readFileSync(log, 'utf8'), new RegExp(`npm install -g context-mode@${PINS['context-mode'].version.replace(/\./g, '\\.')}`));
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const descs = after.commands.map((c) => c.desc);
  assert.equal(new Set(descs).size, descs.length, 'no command recorded twice');
});
