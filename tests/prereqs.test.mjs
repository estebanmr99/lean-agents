import test from 'node:test';
import assert from 'node:assert/strict';
import { planPrereqs, pendingPrereqs, everythingAgents, undoArgv, UNDO_NODE, nvmDirExistedBefore } from '../scripts/lib/prereqs.mjs';

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
  assert.equal(nvm.undo[0][3], '/tmp/x/.nvm');
  assert.equal(nvm.undo[0][4], '/tmp/x', 'the recorded home the undo checks the dir against');
  assert.ok(!nvm.undo[0].includes('rm'));
});

test('Linux: no Xcode or Homebrew, git and unzip manual when no apt, uv by script, rtk by pinned release, bun by pinned zip', () => {
  const steps = planPrereqs(bare('linux', { needsGit: true }));
  assert.deepEqual(ids(steps), ['git', 'unzip', 'nvm', 'node-24', 'uv', 'rtk', 'bun']);
  assert.deepEqual(by(steps, 'git').commands, []);
  assert.match(by(steps, 'git').manual, /^https:\/\/git-scm\.com\//);
  assert.deepEqual(by(steps, 'unzip').commands, []);
  assert.match(by(steps, 'unzip').manual, /^https:\/\/infozip\.sourceforge\.net\//);
  assert.equal(by(steps, 'uv').commands.length, 2);
  const rtk = by(steps, 'rtk');
  assert.equal(rtk.commands.length, 4);
  assert.match(rtk.commands[0].join(' '), /curl.*rtk-x86_64-unknown-linux-musl-v1\.2\.0\.tar\.gz.*github\.com\/rtk-ai\/rtk\/releases\/download\/v1\.2\.0\/rtk-x86_64-unknown-linux-musl\.tar\.gz/);
  assert.equal(rtk.commands[1][3], '70fee7b4a548c43dde94c77e2335550981b0bc2fb013691d8c8109b5bd0eda37');
  assert.deepEqual(rtk.commands[2], ['mkdir', '-p', '/tmp/x/.local/bin']);
  assert.deepEqual(rtk.commands[3], ['tar', '-xzf', '/tmp/x/.cache/lean-agents/rtk-x86_64-unknown-linux-musl-v1.2.0.tar.gz', '-C', '/tmp/x/.local/bin', 'rtk']);
  assert.ok(rtk.undo && rtk.undo.length > 0);
  assert.equal(rtk.undo[0].at(-1), '/tmp/x/.local/bin/rtk');
  assert.equal(by(steps, 'bun').commands.length, 5); // mkdir tmp, download, verify, mkdir, unzip
});

test('Linux arm64: rtk uses aarch64 hash and triple', () => {
  const steps = planPrereqs(bare('linux', { arch: 'arm64' }));
  const rtk = by(steps, 'rtk');
  assert.equal(rtk.commands.length, 4);
  assert.match(rtk.commands[0].join(' '), /curl.*rtk-aarch64-unknown-linux-musl-v1\.2\.0\.tar\.gz.*github\.com\/rtk-ai\/rtk\/releases\/download\/v1\.2\.0\/rtk-aarch64-unknown-linux-musl\.tar\.gz/);
  assert.equal(rtk.commands[1][3], 'f91a06e94e5fad7dfa87946c811a4bcbc500e6da119fd47033f2a8940bf64f93');
  assert.deepEqual(rtk.commands[2], ['mkdir', '-p', '/tmp/x/.local/bin']);
  assert.deepEqual(rtk.commands[3], ['tar', '-xzf', '/tmp/x/.cache/lean-agents/rtk-aarch64-unknown-linux-musl-v1.2.0.tar.gz', '-C', '/tmp/x/.local/bin', 'rtk']);
  assert.ok(rtk.undo && rtk.undo.length > 0);
});

test('Linux with unsupported arch falls back to manual rtk route', () => {
  const steps = planPrereqs(bare('linux', { arch: 'riscv64' }));
  const rtk = by(steps, 'rtk');
  assert.deepEqual(rtk.commands, []);
  assert.match(rtk.manual, /^https:\/\/github\.com\/rtk-ai\/rtk#installation/);
  assert.equal(rtk.undo, null);
});

test('Linux with apt: installs git and unzip using apt-get', () => {
  // Non-root (adds sudo)
  const steps = planPrereqs(bare('linux', { has: { apt: true, sudo: true }, needsGit: true }));
  assert.match(by(planPrereqs(bare('linux', { has: { apt: true }, needsGit: true })), 'git').manual, /git-scm/, 'no sudo and not root: manual');
  const git = by(steps, 'git');
  assert.deepEqual(git.commands[0], ['sudo', '-E', 'apt-get', 'update', '-qq']);
  assert.deepEqual(git.commands[1], ['sudo', '-E', 'apt-get', 'install', '-y', '-qq', '--no-install-recommends', 'git']);
  assert.deepEqual(git.undo[0], ['sudo', '-E', 'apt-get', 'remove', '-y', '-qq', 'git']);

  // Root (no sudo), git skipped, bun installed so unzip skipped/omitted
  const root = planPrereqs(bare('linux', { has: { apt: true, git: true, bun: true }, needsGit: true, root: true }));
  assert.equal(by(root, 'git').skipIf, 'git is on PATH');
  assert.equal(by(root, 'unzip'), undefined); // step omitted because bun is installed
  const rootBare = planPrereqs(bare('linux', { has: { apt: true }, needsGit: true, root: true }));
  assert.deepEqual(by(rootBare, 'unzip').commands[1], ['apt-get', 'install', '-y', '-qq', '--no-install-recommends', 'unzip']); // root: no sudo (the CI container has none)
});

test('Windows: git only when a tool needs it; nvm-windows setup is hash-checked; winget routes', () => {
  const none = planPrereqs(bare('win32', { has: { winget: true } }));
  assert.deepEqual(ids(none), ['nvm', 'node-24', 'uv', 'rtk', 'bun']);
  const nvm = by(none, 'nvm');
  assert.equal(nvm.commands.length, 3);
  assert.match(nvm.commands[1].join(' '), /[0-9a-f]{64}/);
  // nvm is not on this process's PATH right after its setup: the Node 24 step finds nvm.exe through NVM_HOME.
  assert.equal(by(none, 'node-24').commands[0][0], 'powershell');
  assert.match(by(none, 'node-24').commands[0].at(-1), /NVM_HOME.*nvm\.exe'\) install 24/);
  assert.equal(by(none, 'uv').commands[0][0], 'winget');
  assert.equal(by(none, 'rtk').commands[0].includes('rtk-ai.rtk'), true);
  const g = planPrereqs(bare('win32', { has: { winget: true }, needsGit: true }));
  assert.equal(ids(g)[0], 'git');
  assert.deepEqual(by(g, 'git').undo, [['winget', 'uninstall', '--id', 'Git.Git', '-e']]);
  assert.equal(by(planPrereqs(bare('win32', { has: { winget: true, git: true }, needsGit: true })), 'git').skipIf !== null, true);
});

test('Windows without winget: manual links instead of commands', () => {
  const steps = planPrereqs(bare('win32'));
  assert.deepEqual(by(steps, 'uv').commands, []);
  assert.ok(by(steps, 'uv').manual);
});

test('jq is planned only when terminals include warp and agents include claude', () => {
  const needs = planPrereqs(bare('win32', { has: { winget: true }, terminals: ['warp'], agents: ['claude'] }));
  assert.ok(ids(needs).includes('jq'));
  assert.equal(by(needs, 'jq').commands[0].includes('jqlang.jq'), true);

  const skipped = planPrereqs(bare('win32', { has: { winget: true, jq: true }, terminals: ['warp'], agents: ['claude'] }));
  assert.ok(by(skipped, 'jq').skipIf);

  const missingWarp = planPrereqs(bare('win32', { has: { winget: true }, terminals: ['orca'], agents: ['claude'] }));
  assert.ok(!ids(missingWarp).includes('jq'));

  const missingClaude = planPrereqs(bare('win32', { has: { winget: true }, terminals: ['warp'], agents: ['opencode-v2'] }));
  assert.ok(!ids(missingClaude).includes('jq'));

  const mac = planPrereqs(bare('darwin', { terminals: ['warp'], agents: ['claude'] }));
  assert.equal(by(mac, 'jq').commands[0][0], 'brew');
  assert.equal(by(mac, 'jq').undo[0][1], 'uninstall');

  const linux = planPrereqs(bare('linux', { terminals: ['warp'], agents: ['claude'] }));
  assert.deepEqual(by(linux, 'jq').commands, []);
  assert.match(by(linux, 'jq').manual, /^https:/);
});

test('resume stamps skip finished steps and nothing else', () => {
  const steps = planPrereqs(bare('darwin', { done: ['prereq:xcode-clt', 'prereq:homebrew'] }));
  assert.deepEqual(ids(pendingPrereqs(steps)), ['nvm', 'node-24', 'uv', 'rtk', 'bun']);
  assert.equal(by(steps, 'homebrew').skipIf, 'finished in an earlier run');
});

test('proxy env names ride along on steps that download; no values', () => {
  const steps = planPrereqs(bare('linux', { proxyEnv: ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS'] }));
  assert.deepEqual(by(steps, 'nvm').proxyEnv, ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS']);
  assert.deepEqual(by(steps, 'rtk').proxyEnv, ['HTTPS_PROXY', 'NODE_EXTRA_CA_CERTS']);
  assert.equal(by(planPrereqs(bare('linux', { proxyEnv: ['HTTPS_PROXY'], rtkInstall: () => null })), 'rtk').proxyEnv, undefined); // manual: no commands
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
  assert.equal(by(planPrereqs(bare('win32', { has: { bun: true } })), 'bun').skipIf, 'bun is installed');
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
  const run = (home) => { const [cmd, ...args] = undoArgv(undo(home)); return spawnSync(cmd, args, { encoding: 'utf8', env: {} }); };
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
  // Global packages: npm, corepack and lean-agents' own tools do not block the removal; the user's own CLI (scoped or not) does.
  const pkgs = (v, ...names) => { const home = make(v); for (const n of ['npm', 'corepack', 'context-mode', '@opengsd/gsd-core', ...names]) fs.mkdirSync(path.join(home, '.nvm', 'versions', 'node', v, 'lib', 'node_modules', n), { recursive: true }); return home; };
  const clean = pkgs('v24.15.0');
  run(clean);
  assert.equal(fs.existsSync(path.join(clean, '.nvm')), false, 'only npm, corepack and recorded tools');
  const own = pkgs('v24.15.0', 'my-cli');
  assert.match(run(own).stdout, /kept .*my-cli \(v24\.15\.0\)/);
  assert.equal(fs.existsSync(path.join(own, '.nvm')), true);
  const scoped = pkgs('v24.15.0', '@me/tool');
  assert.match(run(scoped).stdout, /@me\/tool/);
  assert.equal(fs.existsSync(path.join(scoped, '.nvm')), true);
  // A recorded home that does not resolve to this ~/.nvm (edited state, other path) removes nothing.
  const elsewhere = make('v24.15.0');
  const [cmd, ...args] = undoArgv(undo(elsewhere));
  const wrong = spawnSync(cmd, [...args.slice(0, 2), path.join(elsewhere, '.nvm'), path.join(elsewhere, 'other'), ...args.slice(4)], { encoding: 'utf8', env: {} });
  assert.match(wrong.stdout, /not the \.nvm of the home/);
  assert.equal(fs.existsSync(path.join(elsewhere, '.nvm')), true);
  for (const h of [partial, ours, mixed, clean, own, scoped, elsewhere]) fs.rmSync(h, { recursive: true, force: true });
});

test('nvm undo is empty when ~/.nvm existed before this run, and runs the Node that runs lean.mjs otherwise', () => {
  const probe = { platform: 'linux', home: '/tmp/x', has: {}, execPath: '/opt/old/bin/node' };
  assert.deepEqual(by(planPrereqs({ ...probe, nvmDirExisted: true }), 'nvm').undo, []);
  const undo = by(planPrereqs(probe), 'nvm').undo;
  assert.equal(undo[0][0], UNDO_NODE);
  assert.ok(!JSON.stringify(undo).includes('/opt/old'));
  assert.equal(undoArgv(undo[0], '/opt/new/bin/node')[0], '/opt/new/bin/node', 'resolved at undo time');
  assert.deepEqual(undoArgv(['rm', 'x']), ['rm', 'x']);
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

test('resuming an interrupted nvm install: ~/.nvm stays ours only when the earlier run recorded an undo for it', () => {
  const probe = { platform: 'linux', home: '/tmp/x', has: {} };
  const undoAfter = (saved, dirExists) => by(planPrereqs({ ...probe, nvmDirExisted: nvmDirExistedBefore(saved, dirExists) }), 'nvm').undo;
  const created = [{ resumeKey: 'prereq:nvm', ok: false, undo: [[UNDO_NODE, '-e', 'x', '/tmp/x/.nvm']] }];
  assert.equal(undoAfter(created, true).length, 1, 'killed after creating ~/.nvm: the undo is kept');
  assert.deepEqual(undoAfter([{ resumeKey: 'prereq:nvm', ok: false, undo: [] }], true), [], 'it existed before: still not ours');
  assert.deepEqual(undoAfter(undefined, true), [], 'first run with ~/.nvm there');
  assert.equal(undoAfter(undefined, false).length, 1, 'first run without ~/.nvm');
});
