// --doctor: the Node behind each registered MCP command of a pinned tool, and duplicate skills. Temp HOME, injected env/platform/fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../scripts/lib/doctor.mjs';
import { preset } from '../scripts/lib/network.mjs';

const fsx = (files = [], links = {}) => ({ existsSync: (p) => files.includes(p) || p in links, realpathSync: (p) => links[p] ?? p });
const state = { version: '0', commands: [], files: [], options: { agents: ['claude'], tools: [], privacy: 'standard', network: preset('on') } };

function run(home, { env = {}, platform = 'linux', fs: f = fsx() } = {}) {
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state, exec: false, json: true, env, platform, fsx: f }); } finally { process.stdout.write = write; }
  return JSON.parse(out);
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-node-'));
function claudeServers(home, servers) {
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: servers }));
}
const POSIX = '/h/.nvm/versions/node';
const WIN = 'C:\\nvm';
const OS = {
  linux: {
    platform: 'linux',
    env: { PATH: `${POSIX}/v22.20.0/bin`, NVM_DIR: '/h/.nvm' },
    fs: fsx([`${POSIX}/v22.20.0/bin/node`], { '/h/.nvm/current/bin/node': `${POSIX}/v22.20.0/bin/node`, '/h/.nvm/alias/n24/bin/node': `${POSIX}/v24.15.0/bin/node` }),
    absolute24: { command: `${POSIX}/v24.15.0/bin/node`, args: [`${POSIX}/v24.15.0/lib/node_modules/context-mode/cli.mjs`, 'server'] },
    absolute22: { command: `${POSIX}/v22.20.0/bin/node`, args: [`${POSIX}/v22.20.0/lib/node_modules/context-mode/cli.mjs`, 'server'] },
    symlink22: { command: '/h/.nvm/current/bin/node', args: ['/x/node_modules/context-mode/cli.mjs', 'server'] },
    symlink24: { command: '/h/.nvm/alias/n24/bin/node', args: ['/x/node_modules/context-mode/cli.mjs', 'server'] },
    npxAbsolute: { command: `${POSIX}/v24.15.0/bin/npx`, args: ['-y', 'context-mode@2.1.4', 'server'] },
    npxAbsoluteNode: '22.20.0',
    playwrightSymlink: { command: '/h/.nvm/current/bin/npx', args: ['-y', '@playwright/mcp@0.0.83'] },
  },
  win32: {
    platform: 'win32',
    env: { Path: `${WIN}\\v22.20.0`, NVM_SYMLINK: 'C:\\nodejs' },
    fs: fsx([`${WIN}\\v22.20.0\\node.exe`, `${WIN}\\v24.15.0\\node.exe`], { 'C:\\nodejs\\node.exe': `${WIN}\\v22.20.0\\node.exe` }),
    absolute24: { command: `${WIN}\\v24.15.0\\node.exe`, args: [`${WIN}\\v24.15.0\\node_modules\\context-mode\\cli.mjs`, 'server'] },
    absolute22: { command: `${WIN}\\v22.20.0\\node.exe`, args: [`${WIN}\\v22.20.0\\node_modules\\context-mode\\cli.mjs`, 'server'] },
    symlink22: { command: 'C:\\nodejs\\node.exe', args: ['C:\\x\\node_modules\\context-mode\\cli.mjs', 'server'] },
    symlink24: null,
    npxAbsolute: { command: `${WIN}\\v24.15.0\\npx.cmd`, args: ['-y', 'context-mode@2.1.4', 'server'] },
    npxAbsoluteNode: '24.15.0',
    playwrightSymlink: { command: 'C:\\nodejs\\npx.cmd', args: ['-y', '@playwright/mcp@0.0.83'] },
  },
};

for (const [name, c] of Object.entries(OS)) {
  const row = (r, server) => r.rows.find((x) => x.item === `node for claude mcp ${server}`);
  const check = (servers) => { const h = tmp(); claudeServers(h, servers); return run(h, c); };

  test(`${name}: an absolute Node 24 entry is ok`, () => {
    const r = check({ 'context-mode': c.absolute24 });
    assert.equal(row(r, 'context-mode').status, 'ok');
    assert.equal(r.nodes[0].style, 'absolute');
    assert.equal(r.nodes[0].nodeVersion, '24.15.0');
    assert.equal(r.ok, true);
  });
  test(`${name}: an absolute entry on too old a Node is flagged`, () => {
    const r = check({ 'context-mode': c.absolute22 });
    assert.equal(row(r, 'context-mode').status, 'error');
    assert.match(row(r, 'context-mode').detail, /needs Node >=24\.15\.0 but this entry runs Node 22\.20\.0/);
    assert.equal(r.ok, false);
  });
  test(`${name}: a symlink Node that points at 22 is flagged`, () => {
    const r = check({ 'context-mode': c.symlink22 });
    assert.equal(r.nodes[0].style, 'symlink');
    assert.equal(row(r, 'context-mode').status, 'error');
  });
  test(`${name}: a bare node and a bare npx follow PATH and are flagged`, () => {
    const r = check({ a: { command: 'node', args: ['/x/node_modules/context-mode/cli.mjs'] }, b: { command: 'npx', args: ['-y', 'context-mode'] } });
    assert.deepEqual(r.nodes.map((n) => n.style), ['path', 'npx-path']);
    assert.deepEqual(r.nodes.map((n) => n.status), ['error', 'error']);
  });
  test(`${name}: an absolute npx runs ${c.npxAbsoluteNode}`, () => {
    const r = check({ 'context-mode': c.npxAbsolute });
    assert.equal(r.nodes[0].style, 'npx-absolute');
    assert.equal(r.nodes[0].nodeVersion, c.npxAbsoluteNode);
    assert.equal(r.nodes[0].status, c.npxAbsoluteNode === '24.15.0' ? 'ok' : 'error');
  });
  test(`${name}: a symlink Node is fine for a tool that needs only Node 18`, () => {
    const r = check({ playwright: c.playwrightSymlink });
    assert.equal(r.nodes[0].status, 'ok');
    assert.match(row(r, 'playwright').detail, /follows nvm use or PATH/);
  });
  test(`${name}: servers of your own are not listed`, () => {
    const r = check({ mine: { command: 'my-own-ctx', args: [] } });
    assert.deepEqual(r.nodes, []);
  });
}

test('linux: a symlink that points at Node 24 is ok but marked as able to change', () => {
  const h = tmp();
  claudeServers(h, { 'context-mode': OS.linux.symlink24 });
  const r = run(h, OS.linux);
  assert.equal(r.nodes[0].status, 'ok');
  assert.match(r.rows.find((x) => x.item.startsWith('node for')).detail, /can change/);
});

test('JSON: nodes and skills are always arrays; the home is shown as ~', () => {
  const h = tmp();
  claudeServers(h, { 'context-mode': OS.linux.absolute24 });
  const r = run(h, OS.linux);
  assert.ok(Array.isArray(r.nodes) && Array.isArray(r.skills));
  assert.ok(!JSON.stringify(r.nodes).includes(h));
});

test('duplicate skills: same content is a note, different content is changed; the doctor stays ok', () => {
  const h = tmp();
  const put = (dir, name, text) => {
    const d = path.join(h, dir, 'skills', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), text);
  };
  put('.agents', 'same', 'a'); put('.claude', 'same', 'a');
  put('.agents', 'diff', 'a'); put('.claude', 'diff', 'b');
  put('.agents', 'orca-cli', 'o'); put('.claude', 'orca-cli', 'o');
  const r = run(h, { fs });
  const rows = Object.fromEntries(r.rows.filter((x) => x.item.startsWith('duplicate skill ')).map((x) => [x.item.slice(16), x]));
  assert.equal(rows.same.status, 'note');
  assert.equal(rows.diff.status, 'changed');
  assert.match(rows.diff.detail, /differ; winner: unknown \(load order\)/);
  assert.match(rows['orca-cli'].detail, /Orca installs this skill/);
  assert.equal(r.skills.length, 3);
  assert.deepEqual(r.skills.find((s) => s.name === 'diff').dirs.map((d) => d.replaceAll('\\', '/')), ['~/.agents/skills', '~/.claude/skills']);
  assert.ok(r.skills[0].agents.includes('opencode'));
  assert.equal(r.ok, true);
});

test('no duplicate when each agent reads one folder', () => {
  const h = tmp();
  fs.mkdirSync(path.join(h, '.claude', 'skills', 'x'), { recursive: true });
  fs.writeFileSync(path.join(h, '.claude', 'skills', 'x', 'SKILL.md'), 'x');
  assert.deepEqual(run(h, { fs }).skills, []);
});
