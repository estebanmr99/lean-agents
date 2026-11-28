// #548: --update leaves no OpenCode 2 background service behind when its own commands started it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceStopRow, serviceGuard, runningBlocker, OPENCODE_RUNNING, OPENCODE_RUNNING_INSIDE } from '../scripts/lib/opencode-backup.mjs';
import { leanUpdateCommands } from '../scripts/lib/lean-update.mjs';
import { claudeAdapter } from '../scripts/lib/adapters/claude.mjs';
import { copilotAdapter } from '../scripts/lib/adapters/copilot-cli.mjs';
import { cursorAdapter } from '../scripts/lib/adapters/cursor.mjs';
import { antigravityAdapter } from '../scripts/lib/adapters/antigravity.mjs';
import { opencodeV2Adapter } from '../scripts/lib/adapters/opencode-v2.mjs';
import { terminalCommands } from '../scripts/lib/terminals.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRun = (argv) => /^npx -y skills@\S+ (add|remove) /.test(argv.join(' '));
// #546: the RTK OpenCode plugin refresh writes plugins/rtk.ts only (it runs `opencode --version`, no database).
const rtkOpencodeRun = (argv) => /^rtk init -g --opencode( --uninstall)?$/.test(argv.join(' '));

const stop = ['opencode', 'service', 'stop'];

test('no pid before and a new one after: one opencode service stop row', () => {
  const row = serviceStopRow({ before: new Set(), agents: ['opencode-v2'], pids: () => [42] });
  assert.deepEqual(row.run, [stop]);
  assert.match(row.desc, /stop the OpenCode 2 background service/);
});

test('the same pid before and after: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set([7]), agents: ['opencode-v2'], pids: () => [7] }), null);
});

test('a pid before and a new one after: nothing is stopped (not ours)', () => {
  assert.equal(serviceStopRow({ before: new Set([7]), agents: ['opencode-v2'], pids: () => [7, 42] }), null);
});

test('no pid before and none after: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set(), agents: ['opencode-v2'], pids: () => [] }), null);
});

test('OpenCode 2 not configured: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set(), agents: ['claude'], pids: () => [42] }), null);
});

test('cannot list the processes: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set(), agents: ['opencode-v2'], pids: () => { throw new Error('ps failed'); } }), null);
});

test('the before list could not be read: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: null, agents: ['opencode-v2'], pids: () => [42] }), null);
});

// #592: a guarded call (the --doctor probes) stops the service only when the call itself started it.
test('#592: a guard stops the service its call started', () => {
  const ran = [];
  let pids = [];
  const g = serviceGuard({ agents: ['opencode-v2'], pids: () => pids });
  pids = [42];
  g.stop((argv) => ran.push(argv.join(' ')));
  assert.deepEqual(ran, ['opencode service stop']);
});

test('#592: a guard leaves a service that was running before its call', () => {
  const ran = [];
  let pids = [7];
  const g = serviceGuard({ agents: ['opencode-v2'], pids: () => pids });
  pids = [7, 42];
  g.stop((argv) => ran.push(argv));
  assert.deepEqual(ran, []);
});

test('#592: a guard lists nothing and stops nothing without OpenCode 2', () => {
  let listed = 0;
  const ran = [];
  const g = serviceGuard({ agents: ['claude'], pids: () => { listed += 1; return [42]; } });
  g.stop((argv) => ran.push(argv));
  assert.equal(listed, 0);
  assert.deepEqual(ran, []);
});

test('#592: a guard whose process list cannot be read never stops anything', () => {
  const ran = [];
  const g = serviceGuard({ agents: ['opencode-v2'], pids: () => { throw new Error('ps failed'); } });
  g.stop((argv) => ran.push(argv));
  assert.deepEqual(ran, []);
});

test('the refusal names the safe service stop command', () => {
  const r = runningBlocker([{ desc: 'RTK plugin for OpenCode', run: [['rtk', 'init', '-g', '--opencode']] }], () => ['opencode'], {});
  assert.equal(r, OPENCODE_RUNNING);
  assert.match(r, /run 'opencode service stop' \(safe: it stops only the background service\) and close OpenCode windows, then run this again/);
});

// #546: proof run 46050797435: the only planned step was the lean-update skill refresh.
test('#546: a skill refresh does not block on a running OpenCode service', () => {
  assert.equal(runningBlocker(leanUpdateCommands(['opencode-v2']), () => ['opencode'], {}), null);
});

test('#546: the OpenCode CLI upgrade still blocks on a running service', () => {
  const up = { tool: 'opencode-v2', desc: 'upgrade opencode-v2 2.2.5 -> 2.2.7', run: [['npm', 'i', '-g', 'opencode-ai@2.2.7']] };
  assert.equal(runningBlocker([up], () => ['opencode'], {}), OPENCODE_RUNNING);
});

test('#546: inside OpenCode the fix never tells the agent to stop its own service', () => {
  const up = { tool: 'opencode-v2', desc: 'upgrade opencode-v2 2.2.5 -> 2.2.7', run: [['npm', 'i', '-g', 'opencode-ai@2.2.7']] };
  const r = runningBlocker([up], () => ['opencode'], { OPENCODE: '1' });
  assert.equal(r, OPENCODE_RUNNING_INSIDE);
  assert.equal(r, 'you are running inside OpenCode: close this OpenCode session, then run `lean-agents --update` from a terminal');
  assert.doesNotMatch(r, /service stop/);
});

// #546: the rule is one bullet: outside OpenCode the service stop stays, inside it is never run.
test('#546: the lean-update skill never tells an agent inside OpenCode to stop the service', () => {
  const text = fs.readFileSync(path.join(ROOT, 'skills', 'lean-update', 'SKILL.md'), 'utf8');
  const rules = text.split('\n').filter((l) => /opencode service stop/.test(l));
  assert.equal(rules.length, 1, 'one bullet covers both cases');
  assert.match(rules[0], /outside OpenCode/);
  assert.match(rules[0], /you are running inside OpenCode/);
  assert.match(rules[0], /never run `opencode service stop`/);
});

// #546: proof run 46052801952: inside OpenCode the RTK plugin refresh is a files-only step.
test('#546: the RTK OpenCode plugin refresh does not block inside OpenCode', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const core = { agents: [], mcp: {} };
  const opts = { tools: ['rtk'], terminals: [], network: {}, platform: 'linux', env: {}, shell: 'default' };
  const commands = opencodeV2Adapter({ home, core, profile: null, opts, rulesPath: path.join(home, 'rules.md') }).commands;
  assert.ok(commands.some((c) => c.desc === 'RTK plugin for OpenCode'), 'the RTK command is planned');
  assert.equal(runningBlocker(commands, () => ['opencode'], { OPENCODE: '1' }), null);
  fs.rmSync(home, { recursive: true, force: true });
});

// #546: filesOnly skips the running-OpenCode check, so only a Skills CLI add/remove or the RTK plugin refresh may carry it.
test('#546: only Skills CLI add/remove or the RTK OpenCode plugin refresh carry filesOnly', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const core = { agents: [], mcp: {} };
  const opts = { tools: ['caveman', 'rtk'], terminals: ['orca'], network: {}, platform: 'linux', env: {}, shell: 'default' };
  const commands = [
    ...claudeAdapter({ home, core, profile: null, opts, rulesPath: path.join(home, 'AGENTS.md'), adhdCommand: null }).commands,
    ...copilotAdapter({ home, core, profile: null, opts, rules: '' }).commands,
    ...cursorAdapter({ home, core, opts }).commands,
    ...antigravityAdapter({ home, core, profile: null, opts, rules: '', adhdCommand: null }).commands,
    ...opencodeV2Adapter({ home, core, profile: null, opts, rulesPath: path.join(home, 'rules.md') }).commands,
    ...terminalCommands({ home, terminals: ['orca'], agents: ['claude'], network: {}, env: {}, system: false, platform: 'linux' }),
    ...leanUpdateCommands(['claude', 'opencode-v2']),
  ];
  const skills = commands.filter((c) => (c.run ?? []).some(skillRun));
  assert.ok(skills.length >= 7, `every skill refresh was checked (${skills.length})`);
  assert.deepEqual(skills.filter((c) => !c.filesOnly).map((c) => c.desc), [], 'every Skills CLI add/remove is filesOnly');
  const others = commands.filter((c) => c.filesOnly && !(c.run ?? []).some(skillRun));
  assert.deepEqual(others.map((c) => c.desc), ['RTK plugin for OpenCode'], 'no other filesOnly command');
  for (const c of commands.filter((x) => x.filesOnly)) {
    for (const argv of c.run) assert.ok(skillRun(argv) || rtkOpencodeRun(argv), `${c.desc}: ${argv.join(' ')}`);
    for (const argv of c.undo ?? []) assert.ok(skillRun(argv) || rtkOpencodeRun(argv), `${c.desc} undo: ${argv.join(' ')}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
});