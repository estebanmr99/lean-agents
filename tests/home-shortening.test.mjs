// #506: home shortening is case-insensitive on Windows at every call site, never matches a home inside a longer
// path, and stays byte-identical for ordinary POSIX paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inventory, applyLines, relIn } from '../scripts/lib/adopt.mjs';
import { upgradeInventory } from '../scripts/lib/upgrade.mjs';
import { homeRel, tilde, describe } from '../scripts/lib/fsops.mjs';
import { configHome } from '../scripts/lib/system.mjs';

const j = path.join;
const winHome = path.win32.join('D:\\Data', 'me'); // D:\Data\me
const winFile = path.win32.join(winHome, 'x.json');

// A fake fs over the given files only: the win32 fixture paths never touch the runner's disk.
const fakeFs = (files, dirs = new Map()) => ({
  existsSync: (p) => files.has(p) || dirs.has(p),
  readFileSync: (p) => {
    if (!files.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    return files.get(p);
  },
  readdirSync: (p) => dirs.get(p) ?? [],
  realpathSync: (p) => p,
});

test('#506: tilde only shortens the home at the start of a path, never one inside a longer path', () => {
  assert.equal(tilde('/opt/x/home/me/a /opt/me/b', '/opt/me', 'linux'), '/opt/x/home/me/a ~/b'); // literal-tilde: explicit platform contract
  assert.equal(tilde('/opt/x/home/me/a', '/home/me', 'linux'), '/opt/x/home/me/a');
  assert.equal(tilde('$ x d:\\data\\me\\a D:/Data/me/b', winHome, 'win32'), '$ x ~\\a ~/b'); // literal-tilde: explicit win32 contract
  assert.equal(tilde('/opt/me/a', '/opt/me', 'linux'), '~/a'); // literal-tilde: explicit linux contract
  // A file:// URL still starts the home after `//`, so the URL cannot leak the full home path.
  assert.equal(tilde('file:///opt/me/x --a=/opt/me/y', '/opt/me', 'linux'), 'file://~/x --a=~/y'); // literal-tilde: explicit linux contract
  assert.equal(homeRel('/opt/me/a', '/opt/me', 'linux'), '~/a'); // literal-tilde: explicit linux contract
  assert.equal(homeRel('/opt/ME/a', '/opt/me', 'linux'), '/opt/ME/a');
  assert.equal(homeRel(winFile.toLowerCase(), winHome, 'win32'), '~\\x.json'); // literal-tilde: explicit win32 contract
});

test('#506: inventory shortens a mixed-case win32 home in a launch path', async () => {
  const file = j(winHome, '.claude.json');
  const node = path.win32.join('d:\\data\\me', 'node');
  const fsx = fakeFs(new Map([[file, JSON.stringify({ mcpServers: { demo: { command: [node] } } })]]));
  const r = await inventory({ home: winHome, env: { PATH: '' }, platform: 'win32', realHome: '/nowhere', fsx });
  const item = r.items.find((i) => i.kind === 'mcp' && i.name === 'demo');
  assert.match(item.launch.node, /^~[\\/]node$/);
});

test('#506: applyLines shortens a mixed-case win32 home', () => {
  const lines = applyLines({
    install: null, rewritten: [{ client: 'claude', name: 'x', file: winFile }], edits: new Map(),
    oldCopies: [], dupSkills: [], stopgaps: [], notes: [], tn: { version: '22.20.0' },
  }, winHome, 'win32');
  assert.ok(lines.some((l) => l.includes('~\\x.json')), lines.join('\n')); // literal-tilde: applyLines called with explicit win32
});

test('#506: upgradeInventory shortens config paths under home at its call site', () => {
  const fixture = (home) => {
    const ocDir = j(configHome(home), 'opencode');
    const agentDir = j(ocDir, 'agent');
    const file = j(ocDir, 'opencode.jsonc');
    const skill = j(agentDir, 'a.md');
    const files = new Map([[file, '{}'], [skill, 'x']]);
    const dirs = new Map([[agentDir, [{ name: 'a.md', isFile: () => true, isDirectory: () => false }]]]);
    return { fsx: fakeFs(files, dirs), item: (r) => r.items.find((i) => i.kind === 'file') };
  };
  // No trailing separator, then a trailing one: both still count as home.
  for (const home of [winHome, winHome + path.sep]) {
    const { fsx, item } = fixture(home);
    const r = upgradeInventory({ items: [], opencode: { dataDir: null, sessions: null, major: null } }, { home, platform: 'win32', fsx });
    assert.match(item(r).file, /^~[\\/]\.config[\\/]opencode[\\/]agent[\\/]a\.md$/);
  }
});

test('#506: describe shortens a mixed-case win32 home', () => {
  const planned = [{ status: 'create', path: path.win32.join('D:\\Data\\me', 'x') }];
  assert.equal(describe(planned, winHome, false, 'win32'), `  create    ~${path.win32.sep}x`);
});

test('#506: relIn keeps a mixed-case win32 path relative to home', () => {
  assert.equal(relIn(winHome, winFile.toLowerCase(), 'win32'), 'x.json');
});