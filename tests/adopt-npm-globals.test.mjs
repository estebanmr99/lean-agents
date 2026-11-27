// #465: --adopt lists every global npm package under every nvm Node (read-only): all packages, the active Node, and the
// not-active / version-differs / engines-unmet flags. Temp HOME with a fake nvm; nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { npmGlobals } from '../scripts/lib/inventory.mjs';
import { meetsEngines } from '../scripts/lib/node-runtime.mjs';
import { inventory } from '../scripts/lib/adopt.mjs';
import { treeHash } from './fixtures/handbuilt.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');

// Two Nodes, the new one default. Non-pinned globals: one only on the old Node, one on both at different versions, one whose
// engines the new Node fails, and one that is fine. A bundled npm folder must not show up as a user global.
function seeded() {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'adopt-globals-')));
  const win = process.platform === 'win32';
  const root = j(home, '.nvm');
  const nodesDir = win ? root : j(root, 'versions', 'node');
  const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  fs.mkdirSync(nodesDir, { recursive: true });
  if (!win) fs.writeFileSync(j(root, 'nvm.sh'), '');
  const add = (version, pkgs) => {
    const dir = j(nodesDir, `v${version}`);
    const node = j(dir, win ? 'node.exe' : j('bin', 'node'));
    put(node, '#!/bin/sh\nexit 0\n');
    if (!win) fs.chmodSync(node, 0o755);
    for (const [name, meta] of Object.entries(pkgs)) put(j(dir, win ? 'node_modules' : j('lib', 'node_modules'), ...name.split('/'), 'package.json'), JSON.stringify({ name, ...meta }));
  };
  add('22.20.0', {
    'legacy-cli': { version: '0.9.1' },
    '@scope/tool': { version: '1.0.0' },
    'bad-cli': { name: 'bad;name', version: '1.0.0' },
  });
  // A folder whose package.json is unreadable keeps its folder name and a null version.
  put(j(nodesDir, 'v22.20.0', win ? 'node_modules' : j('lib', 'node_modules'), 'broken-pkg', 'package.json'), '{ not json');
  add('24.15.0', {
    '@scope/tool': { version: '2.0.0' },
    'fresh-cli': { version: '1.2.0', engines: { node: '>=22' } },
    'needs-newer': { version: '3.0.0', engines: { node: '>=26' } },
    npm: { version: '10.0.0' },
  });
  let env;
  if (win) {
    fs.symlinkSync(j(nodesDir, 'v24.15.0'), j(home, 'nodejs'), 'junction');
    env = { HOME: home, NVM_HOME: root, NVM_SYMLINK: j(home, 'nodejs'), PATH: j(nodesDir, 'v24.15.0') };
  } else {
    fs.mkdirSync(j(root, 'alias'), { recursive: true });
    fs.writeFileSync(j(root, 'alias', 'default'), 'v24.15.0\n');
    env = { HOME: home, NVM_DIR: root, PATH: j(nodesDir, 'v24.15.0', 'bin') };
  }
  return { home, env, oldDir: j(nodesDir, 'v22.20.0'), newDir: j(nodesDir, 'v24.15.0') };
}

const byName = (g, name) => g.packages.filter((p) => p.name === name);
const quote = (s) => process.platform === 'win32' ? `"${s}"` : `'${s}'`;

test('meetsEngines reads the ranges npm packages declare', () => {
  assert.equal(meetsEngines('24.15.0', '>=22'), true);
  assert.equal(meetsEngines('22.20.0', '>=24.15.0'), false);
  assert.equal(meetsEngines('20.19.0', '^20.19.0 || >=22.12.0'), true);
  assert.equal(meetsEngines('21.0.0', '^20.19.0 || >=22.12.0'), false);
  assert.equal(meetsEngines('22.12.0', '^20.19.0 || >=22.12.0'), true);
  assert.equal(meetsEngines('1.2.9', '~1.2.3'), true);
  assert.equal(meetsEngines('1.3.0', '~1.2.3'), false);
  assert.equal(meetsEngines('18.4.2', '18.x'), true);
  assert.equal(meetsEngines('19.0.0', '18.x'), false);
  assert.equal(meetsEngines('20.0.0', 'node'), null); // not a range we can read: never flagged
  assert.equal(meetsEngines('20.0.0', null), null);
});

test('npmGlobals lists every package under every Node, marks the active one and flags the copies', () => {
  const s = seeded();
  const g = npmGlobals({ dir: j(s.home, '.nvm'), win: process.platform === 'win32' }, { env: s.env });
  assert.equal(g.active, '24.15.0');
  assert.deepEqual(g.nodes.map((n) => [n.version, n.active]), [['22.20.0', false], ['24.15.0', true]]);

  const sorted = g.packages.map((p) => [p.node, p.name, p.version]);
  assert.deepEqual(sorted, [
    ['22.20.0', '@scope/tool', '1.0.0'],
    ['22.20.0', 'bad;name', '1.0.0'],
    ['22.20.0', 'broken-pkg', null],
    ['22.20.0', 'legacy-cli', '0.9.1'],
    ['24.15.0', '@scope/tool', '2.0.0'],
    ['24.15.0', 'fresh-cli', '1.2.0'],
    ['24.15.0', 'needs-newer', '3.0.0'],
  ]);
  assert.deepEqual(byName(g, 'legacy-cli')[0].status, ['not-active']);
  assert.deepEqual(byName(g, 'broken-pkg')[0].status, ['not-active']);
  assert.deepEqual(byName(g, 'bad;name')[0].status, ['not-active']);
  assert.deepEqual(byName(g, '@scope/tool').map((p) => p.status), [['version-differs'], ['version-differs']]);
  assert.deepEqual(byName(g, 'needs-newer')[0].status, ['engines-unmet']);
  assert.deepEqual(byName(g, 'fresh-cli')[0].status, []);
  assert.equal(g.packages.some((p) => p.name === 'npm'), false); // bundled with Node, not a user global
  assert.deepEqual(g.cleanup, [
    { name: 'broken-pkg', folder: 'broken-pkg', node: '22.20.0', dir: s.oldDir },
    { name: 'legacy-cli', folder: 'legacy-cli', node: '22.20.0', dir: s.oldDir },
  ]); // a name with a shell metacharacter gets no cleanup line
});

test('inventory puts npmGlobals in the report with ~ paths and adds no plan step', async () => {
  const s = seeded();
  const r = await inventory({ home: s.home, env: s.env, platform: process.platform, realHome: '/nowhere' });
  assert.deepEqual(r.npmGlobals.nodes.map((n) => [n.version, n.active]), [['22.20.0', false], ['24.15.0', true]]);
  assert.equal(r.npmGlobals.nodes[0].dir, `~${s.oldDir.slice(s.home.length)}`);
  assert.deepEqual(r.npmGlobals.cleanup, [
    `npm uninstall -g broken-pkg --prefix ${quote(`~${s.oldDir.slice(s.home.length)}`)}`,
    `npm uninstall -g legacy-cli --prefix ${quote(`~${s.oldDir.slice(s.home.length)}`)}`,
  ]);
  assert.deepEqual(r.plan.filter((l) => /legacy-cli|fresh-cli|needs-newer/.test(l)), []); // --yes never touches them
});

test('--adopt and --adopt --json print the globals and write nothing', () => {
  const s = seeded();
  const before = treeHash(s.home);
  const cli = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt', '--json'], { encoding: 'utf8', env: s.env });
  assert.equal(cli.status, 0, cli.stderr);
  const g = JSON.parse(cli.stdout).npmGlobals;
  assert.deepEqual(Object.keys(g).sort(), ['active', 'cleanup', 'nodes', 'packages']);
  assert.equal(g.active, '24.15.0');
  assert.deepEqual(g.packages.filter((p) => p.name === 'legacy-cli').map((p) => p.status), [['not-active']]);
  assert.deepEqual(g.packages.filter((p) => p.name === 'needs-newer').map((p) => p.status), [['engines-unmet']]);
  assert.equal(g.packages.find((p) => p.name === 'broken-pkg').version, null);
  assert.equal(g.packages.find((p) => p.name === 'bad;name').version, '1.0.0');
  assert.equal(g.cleanup.some((l) => l.includes('bad;name')), false);

  const text = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt'], { encoding: 'utf8', env: s.env });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Global npm packages under nvm \(active Node: 24\.15\.0\):/);
  for (const line of ['* 24.15.0   fresh-cli@1.2.0', 'legacy-cli@0.9.1  [not-active]', 'needs-newer@3.0.0  [engines-unmet]', 'broken-pkg@unknown', 'bad;name@1.0.0']) assert.ok(text.stdout.includes(line), line);
  assert.match(text.stdout, /Cleanup \(listed only, nothing runs automatically\):/);
  assert.ok(text.stdout.includes(`- npm uninstall -g legacy-cli --prefix ${quote(`~${s.oldDir.slice(s.home.length)}`)}`));
  assert.equal(text.stdout.includes('npm uninstall -g bad;name'), false);

  assert.equal(treeHash(s.home), before);
  assert.ok(fs.existsSync(j(s.oldDir, process.platform === 'win32' ? 'node_modules' : j('lib', 'node_modules'), 'legacy-cli', 'package.json')));
});