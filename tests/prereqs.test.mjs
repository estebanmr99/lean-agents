import test from 'node:test';
import assert from 'node:assert/strict';
import { planPrereqs, pendingPrereqs, everythingAgents } from '../scripts/lib/prereqs.mjs';

// Synthetic probes: platform is injected, so every table runs on every OS and nothing touches the machine.
const bare = (platform, extra = {}) => ({ platform, arch: 'x64', home: platform === 'win32' ? 'D:\\tools\\home' : '/tmp/x', has: {}, ...extra });
const ids = (steps) => steps.map((s) => s.id);
const by = (steps, id) => steps.find((s) => s.id === id);

test('fresh Mac: CLT, Homebrew, nvm, Node 24, uv, rtk, bun in order', () => {
  const steps = planPrereqs(bare('darwin'));
  assert.deepEqual(ids(steps), ['xcode-clt', 'homebrew', 'nvm', 'node-24', 'uv', 'rtk', 'bun']);
  assert.deepEqual(by(steps, 'uv').commands, [['brew', 'install', 'uv']]); // brew is planned, so it counts
  assert.deepEqual(by(steps, 'bun').commands, [['brew', 'install', 'oven-sh/bun/bun']]);
  for (const s of steps) {
    assert.equal(s.needsConsent, true);
    assert.equal(s.resumeKey, `prereq:${s.id}`);
    assert.ok(s.label && s.why && Array.isArray(s.commands));
  }
});

test('Mac with brew, CLT and everything: all steps skipped', () => {
  const has = { clt: true, brew: true, nvm: true, uv: true, rtk: true, bun: true };
  const steps = planPrereqs(bare('darwin', { has, nodeActive: '24.15.0' }));
  assert.deepEqual(pendingPrereqs(steps), []);
});

test('user Node >=22.20 is kept: Node 24 is added under nvm, never replaced', () => {
  const steps = planPrereqs(bare('darwin', { has: { clt: true, brew: true, nvm: true }, nodeActive: '22.20.0' }));
  const n = by(steps, 'node-24');
  assert.equal(n.skipIf, null);
  assert.equal(n.commands[0].join(' ').includes('nvm install 24'), true);
  assert.equal(by(planPrereqs(bare('darwin', { has: { nvm: true }, nodeActive: '22.20.0', nvmNodes: ['24.15.0'] })), 'node-24').skipIf !== null, true);
});

test('Mac without nvm: installer keeps the shell profile alone and undo removes only the nvm dir', () => {
  const nvm = by(planPrereqs(bare('darwin')), 'nvm');
  assert.ok(nvm.commands[1].includes('PROFILE=/dev/null'));
  assert.equal(nvm.undo[0].at(-1), '/tmp/x/.nvm');
  assert.ok(!nvm.undo[0].includes('rm'));
});

test('Linux: no Xcode or Homebrew, uv by script, rtk manual, bun by pinned zip', () => {
  const steps = planPrereqs(bare('linux'));
  assert.deepEqual(ids(steps), ['nvm', 'node-24', 'uv', 'rtk', 'bun']);
  assert.equal(by(steps, 'uv').commands.length, 2);
  assert.deepEqual(by(steps, 'rtk').commands, []);
  assert.match(by(steps, 'rtk').manual, /^https:/);
  assert.equal(by(steps, 'bun').commands.length, 5); // mkdir tmp, download, verify, mkdir, unzip
});

test('Windows: git only when a tool needs it; nvm-windows setup is hash-checked; winget routes', () => {
  const none = planPrereqs(bare('win32', { has: { winget: true } }));
  assert.deepEqual(ids(none), ['nvm', 'node-24', 'uv', 'rtk', 'bun']);
  const nvm = by(none, 'nvm');
  assert.equal(nvm.commands.length, 3);
  assert.match(nvm.commands[1].join(' '), /[0-9a-f]{64}/);
  assert.equal(by(none, 'uv').commands[0][0], 'winget');
  assert.equal(by(none, 'rtk').commands[0].includes('rtk-ai.rtk'), true);
  const g = planPrereqs(bare('win32', { has: { winget: true }, needsGit: true }));
  assert.equal(ids(g)[0], 'git');
  assert.equal(by(planPrereqs(bare('win32', { has: { winget: true, git: true }, needsGit: true })), 'git').skipIf !== null, true);
});

test('Windows without winget: manual links instead of commands', () => {
  const steps = planPrereqs(bare('win32'));
  assert.deepEqual(by(steps, 'uv').commands, []);
  assert.ok(by(steps, 'uv').manual);
});

test('resume stamps skip finished steps and nothing else', () => {
  const steps = planPrereqs(bare('darwin', { done: ['prereq:xcode-clt', 'prereq:homebrew'] }));
  assert.deepEqual(ids(pendingPrereqs(steps)), ['nvm', 'node-24', 'uv', 'rtk', 'bun']);
  assert.equal(by(steps, 'homebrew').skipIf, 'finished in an earlier run');
});

test('proxy env names ride along on steps that download; no values', () => {
  const steps = planPrereqs(bare('linux', { proxyEnv: ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS'] }));
  assert.deepEqual(by(steps, 'nvm').proxyEnv, ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS']);
  assert.equal(by(steps, 'rtk').proxyEnv, undefined); // manual: no commands
});

test('planning is pure: the same probe gives the same plan and does not mutate it', () => {
  const p = bare('darwin', { done: ['prereq:nvm'] });
  const snap = JSON.stringify(p);
  assert.deepEqual(planPrereqs(p), planPrereqs(p));
  assert.equal(JSON.stringify(p), snap);
});

test('downloads create their folder and the Node 24 step carries NVM_DIR', () => {
  const steps = planPrereqs(bare('linux'));
  assert.ok(by(steps, 'nvm').commands[0].includes('--create-dirs'));
  assert.equal(by(steps, 'node-24').commands[0][0], 'env');
  assert.ok(by(steps, 'node-24').commands[0].includes('NVM_DIR=/tmp/x/.nvm'));
  assert.equal(by(steps, 'bun').commands[0][1], '-e'); // mkdir of the download folder runs before the bun download
});

test('bun step keeps the undo of the install it plans, and a manual hint when there is no route', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const b = by(planPrereqs(bare(platform, { has: { winget: true } })), 'bun');
    assert.ok(b.undo.length > 0, `${platform}: undo`);
    assert.equal(b.manual, undefined);
  }
  const none = by(planPrereqs(bare('linux', { bunInstall: () => null })), 'bun');
  assert.deepEqual(none.commands, []);
  assert.equal(none.undo, null);
  assert.match(none.manual, /^https:\/\/bun\.sh\//);
});

test('Homebrew installer is the commit-pinned script, hash-checked before it runs', () => {
  const [fetchCmd, verify, run] = by(planPrereqs(bare('darwin')), 'homebrew').commands;
  assert.match(fetchCmd.at(-1), /Homebrew\/install\/[0-9a-f]{40}\/install\.sh$/);
  assert.match(verify.at(-1), /^[0-9a-f]{64}$/);
  assert.equal(run[0], 'env');
});

// The nvm undo script, run for real against a synthetic ~/.nvm in a temp dir.
test('nvm undo removes a partial or lean-only ~/.nvm and keeps one with the user\'s own Node', async () => {
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const undo = (home) => by(planPrereqs({ platform: 'linux', home, has: {} }), 'nvm').undo[0];
  const make = (...versions) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-nvm-'));
    for (const v of versions) fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', v), { recursive: true });
    fs.mkdirSync(path.join(home, '.nvm'), { recursive: true });
    return home;
  };
  const run = (home) => spawnSync(undo(home)[0], undo(home).slice(1), { encoding: 'utf8' });
  const partial = make();
  run(partial);
  assert.equal(fs.existsSync(path.join(partial, '.nvm')), false);
  const ours = make('v24.15.0');
  run(ours);
  assert.equal(fs.existsSync(path.join(ours, '.nvm')), false);
  const mixed = make('v24.15.0', 'v20.11.0');
  const r = run(mixed);
  assert.equal(fs.existsSync(path.join(mixed, '.nvm', 'versions', 'node', 'v20.11.0')), true);
  assert.match(r.stdout, /kept .*v20\.11\.0/);
  for (const h of [partial, ours, mixed]) fs.rmSync(h, { recursive: true, force: true });
});

test('nvm undo is empty when ~/.nvm existed before this run, and names node from PATH otherwise', () => {
  const probe = { platform: 'linux', home: '/tmp/x', has: {}, execPath: '/opt/old/bin/node' };
  assert.deepEqual(by(planPrereqs({ ...probe, nvmDirExisted: true }), 'nvm').undo, []);
  const undo = by(planPrereqs(probe), 'nvm').undo;
  assert.equal(undo[0][0], 'node');
  assert.ok(!JSON.stringify(undo).includes('/opt/old'));
});

test('--everything agents: Claude Code + OpenCode 2; Windows adds the team agents found and lists the rest', () => {
  assert.deepEqual(everythingAgents({ platform: 'darwin', detected: { 'copilot-cli': '1' } }), { agents: ['claude', 'opencode-v2'], skipped: [] });
  assert.deepEqual(everythingAgents({ platform: 'win32', detected: { 'copilot-cli': '1', antigravity: '1' } }),
    { agents: ['claude', 'opencode-v2', 'copilot-cli', 'antigravity'], skipped: ['vscode-copilot'] });
  assert.deepEqual(everythingAgents({ platform: 'win32' }).skipped, ['copilot-cli', 'vscode-copilot', 'antigravity']);
});

test('--everything team preset leaves Antigravity out of a --project run', () => {
  const r = everythingAgents({ platform: 'win32', detected: { antigravity: '1', 'copilot-cli': '1' }, project: true });
  assert.deepEqual(r, { agents: ['claude', 'opencode-v2', 'copilot-cli'], skipped: ['vscode-copilot'] });
});
