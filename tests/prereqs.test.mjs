import test from 'node:test';
import assert from 'node:assert/strict';
import { planPrereqs, pendingPrereqs } from '../scripts/lib/prereqs.mjs';

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
  assert.deepEqual(nvm.undo, [['rm', '-rf', '/tmp/x/.nvm']]);
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
