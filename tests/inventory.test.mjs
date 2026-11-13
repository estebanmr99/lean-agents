// inventory.mjs: launch styles per OS (injected env, platform and fs), pin matching, skill folders and duplicates. Temp HOME only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchOf, pinOf, classify, skillDirs, duplicateSkills, clients } from '../scripts/lib/inventory.mjs';

// A fake file system: `files` exist, `links` maps a path to its real path.
const fsx = (files = [], links = {}) => ({ existsSync: (p) => files.includes(p) || p in links, realpathSync: (p) => links[p] ?? p });

const POSIX = '/h/.nvm/versions/node';
const WIN = 'C:\\nvm';
const cases = {
  linux: {
    platform: 'linux',
    env: { PATH: `/usr/bin:${POSIX}/v22.20.0/bin`, NVM_DIR: '/h/.nvm' },
    fs: fsx([`${POSIX}/v22.20.0/bin/node`], { '/h/.nvm/current/bin/node': `${POSIX}/v22.20.0/bin/node` }),
    absolute: [`${POSIX}/v24.15.0/bin/node`, 'cli.mjs'],
    symlink: ['/h/.nvm/current/bin/node', 'cli.mjs'],
    absoluteNpx: [`${POSIX}/v24.15.0/bin/npx`, '-y', 'context-mode'],
    // The POSIX npx script runs the first node on PATH, not the one beside it.
    absoluteNpxNode: '22.20.0',
  },
  win32: {
    platform: 'win32',
    env: { Path: `C:\\Windows;${WIN}\\v22.20.0`, NVM_SYMLINK: 'C:\\nodejs' },
    fs: fsx([`${WIN}\\v22.20.0\\node.exe`, `${WIN}\\v24.15.0\\node.exe`], { 'C:\\nodejs\\node.exe': `${WIN}\\v22.20.0\\node.exe` }),
    absolute: [`${WIN}\\v24.15.0\\node.exe`, 'cli.mjs'],
    symlink: ['C:\\nodejs\\node.exe', 'cli.mjs'],
    absoluteNpx: [`${WIN}\\v24.15.0\\npx.cmd`, '-y', 'context-mode'],
    // npx.cmd runs the node.exe beside it.
    absoluteNpxNode: '24.15.0',
  },
};

for (const [name, c] of Object.entries(cases)) {
  const opts = { env: c.env, platform: c.platform, fsx: c.fs };
  test(`launchOf ${name}: absolute node`, () => {
    const l = launchOf(c.absolute, opts);
    assert.equal(l.style, 'absolute');
    assert.equal(l.nodeVersion, '24.15.0');
  });
  test(`launchOf ${name}: symlink resolves to its real version`, () => {
    const l = launchOf(c.symlink, opts);
    assert.equal(l.style, 'symlink');
    assert.equal(l.nodeVersion, '22.20.0');
  });
  test(`launchOf ${name}: bare node takes the first node on PATH`, () => {
    const l = launchOf(['node', 'cli.mjs'], opts);
    assert.equal(l.style, 'path');
    assert.equal(l.nodeVersion, '22.20.0');
  });
  test(`launchOf ${name}: bare npx runs the first node on PATH`, () => {
    const l = launchOf([name === 'win32' ? 'npx.cmd' : 'npx', '-y', 'context-mode'], opts);
    assert.equal(l.style, 'npx-path');
    assert.equal(l.nodeVersion, '22.20.0');
  });
  test(`launchOf ${name}: absolute npx`, () => {
    const l = launchOf(c.absoluteNpx, opts);
    assert.equal(l.style, 'npx-absolute');
    assert.equal(l.nodeVersion, c.absoluteNpxNode);
  });
  test(`launchOf ${name}: no node on PATH gives no version`, () => {
    assert.deepEqual(launchOf(['node'], { ...opts, env: { PATH: '' } }), { style: 'path', node: null, nodeVersion: null });
  });
}

test('launchOf: bun, other commands and url servers have no node', () => {
  assert.equal(launchOf(['bunx', 'x'], {}).style, 'bun');
  assert.equal(launchOf(['uvx', 'serena'], {}).style, 'other');
  assert.deepEqual(launchOf([], {}), { style: 'url', node: null, nodeVersion: null });
});

test('pinOf: matches a pinned npm tool by package name, ignores the rest', () => {
  assert.equal(pinOf(['npx', '-y', 'context-mode@2.1.4', 'server']), 'context-mode');
  assert.equal(pinOf(['/n/v24.15.0/bin/node', '/n/v24.15.0/lib/node_modules/context-mode/cli.mjs', 'server']), 'context-mode');
  assert.equal(pinOf(['npx', '-y', '@playwright/mcp@0.0.83']), 'playwright-mcp');
  assert.equal(pinOf(['my-own-ctx']), null);
  assert.equal(pinOf(['/home/u/.claude/skills/x/run.js']), null);
});

test('classify: the pin range decides, a symlink or PATH entry is fragile', () => {
  assert.deepEqual(classify({ style: 'absolute', nodeVersion: '24.15.0' }, 'context-mode'), { status: 'ok', range: '>=24.15.0', fragile: false });
  assert.equal(classify({ style: 'symlink', nodeVersion: '22.20.0' }, 'context-mode').status, 'wrong-node');
  assert.equal(classify({ style: 'symlink', nodeVersion: '22.20.0' }, 'context-mode').fragile, true);
  assert.equal(classify({ style: 'path', nodeVersion: null }, 'context-mode').status, 'unknown');
  assert.equal(classify({ style: 'path', nodeVersion: '22.20.0' }, 'playwright-mcp').status, 'ok');
});

test('skillDirs: the folders each agent reads', () => {
  const h = path.join(os.tmpdir(), 'inv-home');
  const base = (...p) => path.join(h, ...p);
  assert.deepEqual(skillDirs('claude', h), [base('.claude', 'skills')]);
  assert.deepEqual(skillDirs('cursor', h), [base('.cursor', 'skills'), base('.agents', 'skills')]);
  assert.deepEqual(skillDirs('copilot', h), [base('.copilot', 'skills'), base('.agents', 'skills')]);
  const oc = skillDirs('opencode-v2', h);
  assert.deepEqual(oc.slice(1), [base('.agents', 'skills'), base('.claude', 'skills')]);
  assert.ok(oc[0].endsWith(path.join('opencode', 'skills')));
  assert.deepEqual(skillDirs('antigravity', h), []);
});

test('clients: MCP files per client live under the given home', () => {
  const h = path.join(os.tmpdir(), 'inv-home');
  const all = clients(h);
  assert.ok(all.length >= 6);
  for (const c of all) assert.ok(c.file.startsWith(h), c.file);
});

function skillHome() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-skills-'));
  const put = (dir, name, text, extra) => {
    const d = path.join(h, dir, 'skills', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), text);
    if (extra) fs.writeFileSync(path.join(d, 'extra.txt'), extra);
  };
  return { h, put };
}

test('duplicateSkills: same content and different content, single copies ignored', () => {
  const { h, put } = skillHome();
  put('.agents', 'same', '# same');
  put('.claude', 'same', '# same');
  put('.agents', 'diff', '# one');
  put('.claude', 'diff', '# one', 'more');
  put('.agents', 'only', '# only');
  const dirs = skillDirs('opencode-v2', h);
  const d = duplicateSkills(dirs);
  assert.deepEqual(d.map((x) => x.name), ['diff', 'same']);
  assert.equal(d.find((x) => x.name === 'same').differs, false);
  assert.equal(d.find((x) => x.name === 'diff').differs, true);
  assert.equal(d[0].winner, 'unknown (load order)');
  assert.deepEqual(d[0].dirs, [path.join(h, '.agents', 'skills'), path.join(h, '.claude', 'skills')]);
});

test('duplicateSkills: a folder that is a link to the other is one copy', { skip: process.platform === 'win32' }, () => {
  const { h, put } = skillHome();
  put('.agents', 'linked', '# linked');
  fs.mkdirSync(path.join(h, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(h, '.agents', 'skills', 'linked'), path.join(h, '.claude', 'skills', 'linked'));
  assert.deepEqual(duplicateSkills(skillDirs('opencode-v2', h)), []);
});

test('launchOf: a Homebrew-style link is a fixed path, not an nvm link; the real path gives the version', () => {
  const brew = fsx([], { '/opt/homebrew/bin/node': `${POSIX}/v24.15.0/bin/node` });
  const l = launchOf(['/opt/homebrew/bin/node', 'cli.mjs'], { env: { NVM_DIR: '/h/.nvm' }, platform: 'linux', fsx: brew });
  assert.equal(l.style, 'absolute');
  assert.equal(l.nodeVersion, '24.15.0');
  assert.equal(classify(l, 'context-mode').fragile, false);
});

test('duplicateSkills: an unreadable skill file gives the unreadable marker instead of throwing', () => {
  const { h, put } = skillHome();
  put('.agents', 'same', '# same');
  put('.claude', 'same', '# same');
  const real = { ...fs, readFileSync: (p, ...a) => { if (String(p).includes(`${path.sep}.claude${path.sep}`)) throw new Error('EACCES'); return fs.readFileSync(p, ...a); } };
  const [d] = duplicateSkills(skillDirs('opencode-v2', h), real);
  assert.deepEqual(d.shas.map((s) => s === 'unreadable'), [false, true]);
  assert.equal(d.unreadable, true);
  assert.equal(d.differs, true);
});
