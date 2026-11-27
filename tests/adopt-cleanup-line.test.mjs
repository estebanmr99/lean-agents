// #525: the printed cleanup line uses the folder name, quotes the prefix for the platform's shell, and the
// printed list strips bidi and zero-width characters. Temp HOME with a fake nvm; nothing is written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../scripts/lib/adopt.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
const WIN = process.platform === 'win32';
const quote = (s) => WIN ? `"${s}"` : `'${s}'`;

// Two Nodes, the new one default: a package on the old Node is `not-active`, so it gets a cleanup line.
function seeded(packages, { rootName = '.nvm' } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'adopt-cleanup-')));
  const root = j(home, rootName);
  const nodesDir = WIN ? root : j(root, 'versions', 'node');
  const put = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  fs.mkdirSync(nodesDir, { recursive: true });
  if (!WIN) fs.writeFileSync(j(root, 'nvm.sh'), '');
  const add = (version, pkgs) => {
    const dir = j(nodesDir, `v${version}`);
    const node = j(dir, WIN ? 'node.exe' : j('bin', 'node'));
    put(node, '#!/bin/sh\nexit 0\n');
    if (!WIN) fs.chmodSync(node, 0o755);
    for (const [folder, meta] of Object.entries(pkgs)) put(j(dir, WIN ? 'node_modules' : j('lib', 'node_modules'), ...folder.split('/'), 'package.json'), JSON.stringify({ name: folder, ...meta }));
  };
  add('22.20.0', packages);
  add('24.15.0', {});
  const oldDir = j(nodesDir, 'v22.20.0');
  let env;
  if (WIN) {
    fs.symlinkSync(j(nodesDir, 'v24.15.0'), j(home, 'nodejs'), 'junction');
    env = { HOME: home, NVM_HOME: root, NVM_SYMLINK: j(home, 'nodejs'), PATH: j(nodesDir, 'v24.15.0') };
  } else {
    fs.mkdirSync(j(root, 'alias'), { recursive: true });
    fs.writeFileSync(j(root, 'alias', 'default'), 'v24.15.0\n');
    env = { HOME: home, NVM_DIR: root, PATH: j(nodesDir, 'v24.15.0', 'bin') };
  }
  return { home, env, oldDir };
}

test('a global whose package.json name differs from its folder gets no cleanup line', async () => {
  const s = seeded({ 'real-folder': { name: 'npm-check', version: '1.0.0' } });
  const r = await inventory({ home: s.home, env: s.env, platform: process.platform, realHome: '/nowhere' });
  assert.deepEqual(r.npmGlobals.packages.map((p) => p.name), ['npm-check']); // still listed
  assert.deepEqual(r.npmGlobals.cleanup, []);
});

test('a mismatched folder does not earn a line for a genuine folder of the same name', async () => {
  const s = seeded({ 'real-folder': { name: 'npm-check', version: '1.0.0' }, 'npm-check': { name: 'npm-check', version: '2.0.0' } });
  const r = await inventory({ home: s.home, env: s.env, platform: process.platform, realHome: '/nowhere' });
  assert.deepEqual(r.npmGlobals.cleanup, [`npm uninstall -g npm-check --prefix ${quote(`~${s.oldDir.slice(s.home.length)}`)}`]);
});

test('the cleanup line quotes a prefix that contains a space', async () => {
  const s = seeded({ 'legacy-cli': { version: '0.9.1' } }, { rootName: '.nvm dir' });
  const r = await inventory({ home: s.home, env: s.env, platform: process.platform, realHome: '/nowhere' });
  const prefix = `~${s.oldDir.slice(s.home.length)}`;
  assert.match(prefix, / /);
  assert.deepEqual(r.npmGlobals.cleanup, [`npm uninstall -g legacy-cli --prefix ${quote(prefix)}`]);
});

test('the printed list strips bidi overrides and zero-width characters', () => {
  const s = seeded({ evil: { name: 'e\u202evil\u200b', version: '1.0\u202e.0\u200b' } });
  const cli = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt'], { encoding: 'utf8', env: s.env });
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(cli.stdout.includes('evil@1.0.0'), cli.stdout);
  assert.equal(cli.stdout.includes('\u202e'), false);
  assert.equal(cli.stdout.includes('\u200b'), false);
});