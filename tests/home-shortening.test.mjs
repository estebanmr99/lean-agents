// #506: home shortening is case-insensitive on Windows at every call site, never matches a home inside a longer
// path, and stays byte-identical for ordinary POSIX paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inventory, applyLines } from '../scripts/lib/adopt.mjs';
import { upgradeInventory } from '../scripts/lib/upgrade.mjs';
import { homeRel, tilde } from '../scripts/lib/fsops.mjs';

const j = path.join;
const winHome = path.win32.join('D:\\Data', 'me'); // D:\Data\me
const winFile = path.win32.join(winHome, 'x.json');

test('#506: tilde only shortens the home at the start of a path, never one inside a longer path', () => {
  assert.equal(tilde('/opt/x/home/me/a /opt/me/b', '/opt/me', 'linux'), '/opt/x/home/me/a ~/b');
  assert.equal(tilde('/opt/x/home/me/a', '/home/me', 'linux'), '/opt/x/home/me/a');
  assert.equal(tilde('$ x d:\\data\\me\\a D:/Data/me/b', winHome, 'win32'), '$ x ~\\a ~/b');
  assert.equal(tilde('/opt/me/a', '/opt/me', 'linux'), '~/a');
  assert.equal(homeRel('/opt/me/a', '/opt/me', 'linux'), '~/a');
  assert.equal(homeRel('/opt/ME/a', '/opt/me', 'linux'), '/opt/ME/a');
  assert.equal(homeRel(winFile.toLowerCase(), winHome, 'win32'), '~\\x.json');
});

test('#506: inventory shortens a mixed-case win32 home in a launch path', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'home506-')));
  const home = j(root, 'Data', 'Me');
  fs.mkdirSync(home, { recursive: true });
  const lower = j(root, 'data', 'me');
  fs.writeFileSync(j(home, '.claude.json'), JSON.stringify({ mcpServers: { demo: { command: [j(lower, 'node')] } } }));
  const r = await inventory({ home, env: { PATH: '' }, platform: 'win32', realHome: '/nowhere' });
  const item = r.items.find((i) => i.kind === 'mcp' && i.name === 'demo');
  assert.equal(item.launch.node, '~/node');
});

test('#506: applyLines shortens a mixed-case win32 home', () => {
  const lines = applyLines({
    install: null, rewritten: [{ client: 'claude', name: 'x', file: winFile }], edits: new Map(),
    oldCopies: [], dupSkills: [], stopgaps: [], notes: [], tn: { version: '22.20.0' },
  }, winHome, 'win32');
  assert.ok(lines.some((l) => l.includes('~\\x.json')), lines.join('\n'));
});

test('#506: upgradeInventory shortens config paths under home at its call site', () => {
  const root = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'home506-')));
  const home = j(root, 'Data', 'Me') + path.sep; // a trailing separator still counts as home
  const ocDir = j(home, '.config', 'opencode');
  fs.mkdirSync(j(ocDir, 'agent'), { recursive: true });
  fs.writeFileSync(j(ocDir, 'opencode.json'), '{}');
  fs.writeFileSync(j(ocDir, 'agent', 'a.md'), 'x');
  const r = upgradeInventory({ items: [], opencode: { dataDir: null, sessions: null, major: null } }, { home, platform: 'win32' });
  const f = r.items.find((i) => i.kind === 'file');
  assert.equal(f.file, '~/.config/opencode/agent/a.md');
});