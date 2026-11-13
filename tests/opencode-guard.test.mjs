// lean-agents never installs or upgrades OpenCode itself, and says so on 1.x. Temp HOME, no external commands.
// The one exception is opt-in `--install-agent opencode-v2` (pinned 2.x installer); 1.x is never installed (#79).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor } from '../scripts/lib/doctor.mjs';
import { leanUpdateCommands } from '../scripts/lib/lean-update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LINE = 'OpenCode 1.x: supported; lean-agents will not upgrade it';
const ALL_V1 = 'claude,opencode-v1,copilot-cli,vscode-copilot,cursor,antigravity';
const ALL_V2 = ALL_V1.replace('opencode-v1', 'opencode-v2'); // v1 and v2 write the same files, so a plan holds one

process.env.LEAN_AGENTS_NODE ??= '24.22.2';

function lean(home, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
const planJson = (home, args) => JSON.parse(lean(home, ['--yes', '--no-exec', '--dry-run', '--json', ...args]));

// True for a command that installs or upgrades OpenCode: a package manager, brew or the install script on `opencode`/`opencode-ai`, or `opencode upgrade`.
// Shell wrappers (`sh -c`, `powershell -Command`) are unwrapped; a bare `brew upgrade` that names no package is not flagged (none exists in the plans).
function touchesOpenCode(argv) {
  const [first, ...rest] = argv;
  const bin = path.basename(first).replace(/\.(cmd|exe)$/i, '');
  const isPkg = (t) => /^(?:[\w@.-]+\/)*(?:[\w-]+\.)?opencode(?:-ai|-(?:linux|darwin|windows)-[\w-]+)?(?:@[\w.-]+)?$/i.test(t);
  if (/^(sh|bash|zsh|cmd|powershell|pwsh)$/.test(bin)) {
    const i = rest.findIndex((t) => /^(-c|\/c|-command)$/i.test(t));
    if (i >= 0) return touchesOpenCode(rest[i + 1].split(/\s+/)) || /opencode\.ai\/install/.test(rest[i + 1]);
  }
  if (/^(npm|pnpm|yarn|bun|brew|winget|scoop|choco|paru|yay|pacman)$/.test(bin)) return rest.some(isPkg);
  if (bin === 'opencode') return /^(upgrade|update)$/.test(rest[0]);
  return /opencode\.ai\/install|sst\/opencode|anomalyco\/opencode/.test(argv.join(' ')) && /curl|wget|iwr|irm|install/.test(argv.join(' '));
}
const offenders = (commands) => commands.flatMap((c) => c.run ?? []).filter(touchesOpenCode).map((a) => a.join(' '));

test('the OpenCode predicate flags every way to install or upgrade it, and nothing else', () => {
  for (const argv of [
    ['npm', 'i', '-g', 'opencode-ai'], ['npm', 'install', '-g', 'opencode-ai@1.19.0'], ['bun', 'add', '-g', 'opencode-ai'],
    ['pnpm', 'add', '-g', 'opencode-ai'], ['brew', 'install', 'sst/tap/opencode'], ['brew', 'upgrade', 'opencode'],
    ['sh', '-c', 'curl -fsSL https://opencode.ai/install | bash'], ['opencode', 'upgrade'], ['opencode', 'update'], ['/opt/homebrew/bin/brew', 'install', 'opencode'],
    ['sh', '-c', 'npm i -g opencode-ai'], ['powershell', '-Command', 'winget install SST.opencode'], ['npm', 'i', '-g', 'opencode-linux-x64'],
  ]) assert.ok(touchesOpenCode(argv), argv.join(' '));
  for (const argv of [
    ['npm', 'i', '-g', '@tarquinen/opencode-dcp@3.1.9'], ['bun', 'add', '-g', 'context-mode'], ['opencode', 'debug', 'config'],
    ['opencode', '--version'], ['npx', '-y', 'skills@1.4.0', 'add', 'x/y', '-a', 'opencode'], ['brew', 'install', 'rtk'],
  ]) assert.ok(!touchesOpenCode(argv), argv.join(' '));
});

test('install plans (OpenCode 1.x and 2.x, every agent and tool) never install or upgrade OpenCode', () => {
  for (const agents of [ALL_V1, ALL_V2]) {
    const j = planJson(tmp(), ['--agents', agents, '--all-tools']);
    assert.ok(j.commands.length > 5, 'plan has commands to check');
    assert.deepEqual(offenders(j.commands), [], agents);
  }
});

test('--update plans never install or upgrade OpenCode', () => {
  for (const agents of [ALL_V1, ALL_V2]) {
    const home = tmp();
    lean(home, ['--yes', '--no-exec', '--agents', agents, '--all-tools']);
    const j = planJson(home, ['--update']);
    assert.ok(j.commands.length > 5, 'plan has commands to check');
    assert.deepEqual(offenders(j.commands), [], agents);
  }
});

test('--migrate plans never install or upgrade OpenCode', () => {
  const home = tmp();
  fs.mkdirSync(path.join(home, '.cursor', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cursor', 'agents', 'x.md'), '---\nname: x\ndescription: Does x\n---\nBe careful.\n');
  fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { gh: { command: 'npx', args: ['-y', 'gh-mcp'] } } }));
  const j = planJson(home, ['--migrate', 'cursor', '--agents', 'claude,opencode-v1']);
  assert.ok(j.commands?.length > 0, 'plan has commands to check');
  assert.deepEqual(offenders(j.commands), []);
});

test('the lean-update flow installs only the skill, for every agent', () => {
  const cmds = leanUpdateCommands(ALL_V1.split(',').concat('opencode-v2'));
  assert.ok(cmds.length >= 5);
  assert.deepEqual(offenders(cmds), []);
});

test('the guard fails when a plan gets an OpenCode install by hand', () => {
  const j = planJson(tmp(), ['--agents', 'claude,opencode-v1']);
  assert.deepEqual(offenders([...j.commands, { run: [['npm', 'i', '-g', 'opencode-ai']] }]), ['npm i -g opencode-ai']);
});

function doctorRows(agents, extra = {}) {
  const state = { version: 'test', options: { agents, tools: [], privacy: 'standard' }, files: [], commands: [], ...extra };
  const lines = [];
  const log = console.log;
  console.log = (l) => lines.push(String(l));
  try { doctor({ home: tmp(), state, exec: false, json: false }); } finally { console.log = log; }
  return lines;
}

test('--doctor says OpenCode 1.x is supported and will not be upgraded (text and --json)', () => {
  assert.ok(doctorRows(['opencode-v1']).some((l) => /^ok\s+OpenCode 1\.x: supported; lean-agents will not upgrade it\s*$/.test(l)));
  assert.ok(!doctorRows(['opencode-v2', 'claude']).join('\n').includes(LINE));
  const home = tmp();
  lean(home, ['--yes', '--no-exec', '--agents', 'opencode-v1']);
  const json = JSON.parse(lean(home, ['--doctor', '--no-exec', '--json']));
  assert.ok(JSON.stringify(json).includes(LINE), 'the JSON rows carry the line');
});

test('the lean-update skill hands the OpenCode 2 upgrade to the user, with a backup first, and never runs it', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills', 'lean-update', 'SKILL.md'), 'utf8');
  assert.match(text, /OpenCode 2/);
  assert.match(text, /upgrading OpenCode is the user's own step/);
  assert.match(text, /opencode\.db/);
  assert.match(text, /never runs the (OpenCode )?upgrade/i);
});

test('--install-agent never installs OpenCode 1.x; opencode-v2 plans only the pinned 2.x installer', { skip: process.platform === 'win32' && 'Windows route is VERIFY' }, () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', tmp(), '--install-agent', 'opencode-v1', '--dry-run'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /never installed or removed/);
  const plan = lean(tmp(), ['--install-agent', 'opencode-v2', '--dry-run']);
  assert.match(plan, /opencode-installer\.sh --version 2\.2\.5 --no-modify-path/);
  assert.ok(!/opencode-ai|opencode upgrade|opencode uninstall/.test(plan), 'plan touches 1.x or the OpenCode uninstaller');
});
