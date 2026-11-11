import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { satisfies, minVersion, findNvm, installedNodes, resolveToolNodes, nodeSkipLine } from '../scripts/lib/node-runtime.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-node-'));
// A fake nvm tree with the given Node versions; no real nvm or Node is involved.
function fakeNvm(versions, win = false) {
  const dir = tmp();
  if (!win) fs.writeFileSync(path.join(dir, 'nvm.sh'), '');
  for (const v of versions) {
    const d = win ? path.join(dir, `v${v}`) : path.join(dir, 'versions', 'node', `v${v}`);
    fs.mkdirSync(win ? d : path.join(d, 'bin'), { recursive: true });
    fs.writeFileSync(win ? path.join(d, 'node.exe') : path.join(d, 'bin', 'node'), '');
  }
  return { win, dir };
}
const pins = { 'context-mode': { node: '>=24.15.0' }, 'gsd-core': { node: '>=24.0.0' } };

test('satisfies: >= with 1 to 3 parts, a missing range accepts anything, other ranges throw', () => {
  assert.ok(satisfies('24.15.0', '>=24.15.0') && satisfies('v25.0.0', '>=24.15') && satisfies('18.0.0', '>=18') && satisfies('1.0.0', undefined));
  assert.ok(!satisfies('24.14.9', '>=24.15.0') && !satisfies('22.20.0', '>=24'));
  assert.deepEqual(minVersion('>=24'), [24, 0, 0]);
  assert.throws(() => satisfies('22.0.0', '^24'), /unsupported node range/);
});

test('findNvm: POSIX NVM_DIR counts only inside the target home (or for the real home), else <home>/.nvm; nvm-windows needs NVM_HOME; nothing otherwise', () => {
  const home = tmp();
  const dir = path.join(home, 'nvm');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'nvm.sh'), '');
  assert.deepEqual(findNvm({ env: { NVM_DIR: dir }, home, platform: 'linux', realHome: '/real' }), { win: false, dir });
  assert.deepEqual(findNvm({ env: { NVM_DIR: dir }, home: tmp(), platform: 'linux', realHome: home }), null, 'outside the target home and the target is not the real home');
  assert.deepEqual(findNvm({ env: { NVM_DIR: dir }, home: dir, platform: 'linux', realHome: dir }), { win: false, dir }, 'real home: NVM_DIR is used');
  const h2 = tmp();
  fs.mkdirSync(path.join(h2, '.nvm'));
  fs.writeFileSync(path.join(h2, '.nvm', 'nvm.sh'), '');
  assert.deepEqual(findNvm({ env: { NVM_DIR: dir }, home: h2, platform: 'linux', realHome: '/real' }), { win: false, dir: path.join(h2, '.nvm') }, 'a foreign NVM_DIR falls back to <home>/.nvm');
  assert.equal(findNvm({ env: {}, home: tmp(), platform: 'linux', realHome: '/real' }), null);
  const w = fakeNvm([], true);
  assert.deepEqual(findNvm({ env: { NVM_HOME: w.dir }, home: '/nope', platform: 'win32' }), { win: true, dir: w.dir });
  assert.equal(findNvm({ env: { NVM_DIR: dir }, home, platform: 'win32' }), null);
});

test('installedNodes skips a folder without its node binary (a failed install)', () => {
  const nvm = fakeNvm(['24.22.2']);
  fs.mkdirSync(path.join(nvm.dir, 'versions', 'node', 'v24.30.0'), { recursive: true });
  assert.deepEqual(installedNodes(nvm).map((n) => n.version), ['24.22.2']);
  assert.equal(resolveToolNodes({ pins, active: '22.20.0', nvm }).toolNode.version, '24.22.2');
  const w = fakeNvm([], true);
  fs.mkdirSync(path.join(w.dir, 'v24.30.0'));
  assert.deepEqual(installedNodes(w), []);
});

test('installedNodes: lowest first, POSIX and Windows layouts', () => {
  const p = installedNodes(fakeNvm(['24.22.2', '22.20.0', '24.15.0']));
  assert.deepEqual(p.map((n) => n.version), ['22.20.0', '24.15.0', '24.22.2']);
  assert.ok(p[1].node.endsWith(path.join('v24.15.0', 'bin', 'node')) && p[1].modules.endsWith(path.join('lib', 'node_modules')));
  const w = installedNodes(fakeNvm(['24.15.0'], true).dir && fakeNvm(['24.15.0'], true));
  assert.ok(w[0].node.endsWith(path.join('v24.15.0', 'node.exe')) && w[0].pathDir === w[0].dir);
});

test('resolveToolNodes: nothing fails on a new enough Node', () => {
  assert.deepEqual(resolveToolNodes({ pins, active: '24.15.0' }), { toolNode: null, skipped: [] });
});

test('resolveToolNodes: reuses the lowest installed Node that meets the highest floor', () => {
  const nvm = fakeNvm(['22.20.0', '24.11.0', '24.15.1', '24.22.2']);
  const r = resolveToolNodes({ pins, active: '22.20.0', nvm });
  assert.equal(r.toolNode.version, '24.15.1');
  assert.equal(r.toolNode.install, undefined);
});

test('resolveToolNodes: installs the newest of the floor major when none fits, and keeps nothing else', () => {
  const nvm = fakeNvm(['22.20.0', '24.11.0']);
  const r = resolveToolNodes({ pins, active: '22.20.0', nvm, latest: (major) => `${major}.22.2` });
  assert.equal(r.toolNode.version, '24.22.2');
  assert.equal(r.toolNode.install, 24);
  assert.ok(r.toolNode.node.endsWith(path.join('v24.22.2', 'bin', 'node')));
});

test('resolveToolNodes: no nvm skips each tool with the one-line reason; nvm-windows cannot install', () => {
  const r = resolveToolNodes({ pins: { 'context-mode': pins['context-mode'] }, active: '22.20.0', nvm: null });
  assert.equal(r.toolNode, null);
  assert.equal(r.skipped[0].line, 'context-mode needs Node >=24.15.0, found 22.20.0: skipped. Install nvm or Node 24.15+, then run --update.');
  assert.equal(nodeSkipLine('context-mode', '>=24.15.0', '22.20.0'), r.skipped[0].line);
  assert.equal(resolveToolNodes({ pins, active: '22.20.0', nvm: fakeNvm(['24.11.0'], true), latest: () => '24.22.2' }).toolNode, null);
});
