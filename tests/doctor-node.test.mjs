// --doctor: the Node behind each registered MCP command of a pinned tool, and duplicate skills. Temp HOME, injected env/platform/fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor, npxFailDetail, projectNode } from '../scripts/lib/doctor.mjs';
import { nodeFloorFix, nodeAt } from '../scripts/lib/node-runtime.mjs';
import { preset } from '../scripts/lib/network.mjs';
import { vscodeUserDir } from '../scripts/lib/adapters/vscode-copilot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    absolute24: { command: `${POSIX}/v24.15.0/bin/node`, args: [`${POSIX}/v24.15.0/lib/node_modules/context-mode/cli.mjs`, 'server', '--agent', 'claude-code'] },
    absolute22: { command: `${POSIX}/v22.20.0/bin/node`, args: [`${POSIX}/v22.20.0/lib/node_modules/context-mode/cli.mjs`, 'server', '--agent', 'claude-code'] },
    symlink22: { command: '/h/.nvm/current/bin/node', args: ['/x/node_modules/context-mode/cli.mjs', 'server', '--agent', 'claude-code'] },
    symlink24: { command: '/h/.nvm/alias/n24/bin/node', args: ['/x/node_modules/context-mode/cli.mjs', 'server', '--agent', 'claude-code'] },
    npxAbsolute: { command: `${POSIX}/v24.15.0/bin/npx`, args: ['-y', 'context-mode@2.1.4', 'server', '--agent', 'claude-code'] },
    npxAbsoluteNode: '22.20.0',
    playwrightSymlink: { command: '/h/.nvm/current/bin/npx', args: ['-y', '@playwright/mcp@0.0.83'] },
  },
  win32: {
    platform: 'win32',
    env: { Path: `${WIN}\\v22.20.0`, NVM_SYMLINK: 'C:\\nodejs' },
    fs: fsx([`${WIN}\\v22.20.0\\node.exe`, `${WIN}\\v24.15.0\\node.exe`], { 'C:\\nodejs\\node.exe': `${WIN}\\v22.20.0\\node.exe` }),
    absolute24: { command: `${WIN}\\v24.15.0\\node.exe`, args: [`${WIN}\\v24.15.0\\node_modules\\context-mode\\cli.mjs`, 'server', '--agent', 'claude-code'] },
    absolute22: { command: `${WIN}\\v22.20.0\\node.exe`, args: [`${WIN}\\v22.20.0\\node_modules\\context-mode\\cli.mjs`, 'server', '--agent', 'claude-code'] },
    symlink22: { command: 'C:\\nodejs\\node.exe', args: ['C:\\x\\node_modules\\context-mode\\cli.mjs', 'server', '--agent', 'claude-code'] },
    symlink24: null,
    npxAbsolute: { command: `${WIN}\\v24.15.0\\npx.cmd`, args: ['-y', 'context-mode@2.1.4', 'server', '--agent', 'claude-code'] },
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

test('a context-mode MCP entry without --agent is an error with the fix line (#562)', () => {
  const h = tmp();
  const { args } = OS.linux.absolute24;
  claudeServers(h, { 'context-mode': { command: OS.linux.absolute24.command, args: args.slice(0, -2) } });
  const r = run(h, OS.linux);
  const row = r.rows.find((x) => x.item === 'context-mode agent for claude mcp context-mode');
  assert.equal(row.status, 'error');
  assert.match(row.detail, /--agent <id>/);
  assert.match(row.detail, /Fix: run lean-agents --update/);
  assert.equal(r.ok, false);
});

test('the context-mode agent fix names only the clients --update rewrites; Cursor gets its entry path', () => {
  const entry = { 'context-mode': { command: 'npx', args: ['-y', 'context-mode@2.1.4', 'server'] } };
  const files = [
    [(h) => path.join(h, '.claude.json'), { mcpServers: entry }, 'claude'],
    [(h) => path.join(h, '.cursor', 'mcp.json'), { mcpServers: entry }, 'cursor'],
    [(h) => path.join(h, '.config', 'opencode', 'opencode.json'), { mcp: { servers: entry } }, 'opencode'],
    [(h) => path.join(h, '.copilot', 'mcp-config.json'), { mcpServers: entry }, 'copilot-cli'],
    [(h) => path.join(vscodeUserDir(h), 'mcp.json'), { servers: entry }, 'vscode'],
    [(h) => path.join(vscodeUserDir(h, 'Code - Insiders'), 'mcp.json'), { servers: entry }, 'vscode-insiders'],
  ];
  for (const [atOf, data, client] of files) {
    const h = tmp();
    const at = atOf(h);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, JSON.stringify(data));
    const r = run(h, { fs });
    const row = r.rows.find((x) => x.item === `context-mode agent for ${client} mcp context-mode`);
    assert.ok(row, `${client} row`);
    assert.equal(row.status, 'error');
    if (client === 'cursor') {
      assert.match(row.detail, /remove the context-mode entry from Cursor's mcp\.json \(lean-agents no longer manages it\)/);
      assert.match(row.detail, /~[\\/]\.cursor[\\/]mcp\.json/);
      assert.doesNotMatch(row.detail, /--update/);
    } else {
      assert.match(row.detail, /Fix: run lean-agents --update/, client);
    }
  }
});

test('linux: a symlink that points at Node 24 is ok but marked as able to change', () => {
  const h = tmp();
  claudeServers(h, { 'context-mode': OS.linux.symlink24 });
  const r = run(h, OS.linux);
  assert.equal(r.nodes[0].status, 'ok');
  assert.match(r.rows.find((x) => x.item.startsWith('node for claude mcp')).detail, /can change/);
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

test('context-mode on Node is checked using findNvm, not on PATH', () => {
  const h = tmp();
  const dir = path.join(h, '.nvm');
  const win = process.platform === 'win32';
  const nodeDir = win ? path.join(dir, `v24.15.0`) : path.join(dir, 'versions', 'node', 'v24.15.0');
  const mods = win ? path.join(nodeDir, 'node_modules') : path.join(nodeDir, 'lib', 'node_modules');
  const cli = path.join(mods, 'context-mode', 'package.json');

  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '');
  if (!win) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'nvm.sh'), '');
  }

  const env = win ? { NVM_HOME: dir, USERPROFILE: h } : { NVM_DIR: dir, HOME: h };

  const s = { version: '0', commands: [], files: [], toolNode: { version: '24.15.0' }, options: { agents: ['claude'], tools: ['context-mode'], privacy: 'standard', network: preset('on') } };

  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (st) => { out += st; return true; };
  try { doctor({ home: h, state: s, exec: true, json: true, env, platform: process.platform, run: () => ({ ok: false, out: '' }) }); } finally { process.stdout.write = write; }

  const r = JSON.parse(out);
  const ok = r.rows.find((x) => x.item === 'context-mode on Node 24.15.0');
  assert.ok(ok, 'found the nvm node check');
  assert.equal(ok.status, 'ok');
  assert.equal(ok.detail, cli);
  assert.equal(r.rows.find((x) => x.item === 'context-mode on PATH'), undefined, 'did not fall back to PATH check');
});

test('npxFailDetail extracts the first error line and appends a hint for broken cache', () => {
  assert.equal(npxFailDetail(''), '');
  assert.equal(npxFailDetail(undefined), '');
  assert.match(npxFailDetail('npm error code ENOENT\nnpm error path C:\\c\\npm-cache\\_npx\\a1b2c3\\package.json', { home: '/h', env: {} }), /^npm error code ENOENT \(broken npx cache entry: delete C:\\c\\npm-cache\\_npx\\a1b2c3, then run again\)$/);
  assert.doesNotMatch(npxFailDetail('npm error request to https://user:pw@example.com:3128/x failed', { home: '/h', env: {} }), /:pw@/);
  assert.equal(npxFailDetail('some stdout\nError: unexpected\nmore lines'), 'Error: unexpected');
  assert.equal(
    npxFailDetail('npm error enoent Could not read package.json: npm-cache\\_npx\\beef\\package.json'),
    'npm error enoent Could not read package.json: npm-cache\\_npx\\beef\\package.json (broken npx cache entry: delete npm-cache\\_npx\\beef, then run again)'
  );
});

test('projectNode: no package.json up to home -> null', () => {
  const h = tmp();
  const nested = path.join(h, 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(projectNode({ cwd: nested, home: h, nodeVersion: '24.1.0' }), null);

  const fakeFsx = {
    existsSync: (p) => p === path.resolve('/package.json'),
    readFileSync: () => '{"engines":{"node":">=22"}}',
  };
  assert.equal(projectNode({ cwd: path.join(h, 'sub'), home: h, nodeVersion: '24.1.0', fsx: fakeFsx }), null);
});

test('projectNode: package.json without engines -> null', () => {
  const h = tmp();
  const proj = path.join(h, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'no-engines' }));
  assert.equal(projectNode({ cwd: proj, home: h, nodeVersion: '24.1.0' }), null);

  fs.writeFileSync(path.join(proj, 'package.json'), '{invalid json');
  assert.equal(projectNode({ cwd: proj, home: h, nodeVersion: '24.1.0' }), null);
});

test('projectNode: nested cwd finds parent package.json with range checks', () => {
  const h = tmp();
  const proj = path.join(h, 'proj');
  const nested = path.join(proj, 'sub', 'nested');
  fs.mkdirSync(nested, { recursive: true });

  const pkgPath = path.join(proj, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify({ engines: { node: '>=22' } }));
  const ok24 = projectNode({ cwd: nested, home: h, nodeVersion: '24.1.0' });
  assert.equal(ok24.status, 'ok');
  assert.equal(ok24.item, 'project Node');
  assert.equal(ok24.detail, 'Node 24.1.0 fits engines.node >=22 in ~/proj/package.json; VS Code or Cursor started outside this shell can resolve another Node');

  fs.writeFileSync(pkgPath, JSON.stringify({ engines: { node: '22.12.0' } }));
  const note24 = projectNode({ cwd: nested, home: h, nodeVersion: '24.1.0' });
  assert.equal(note24.status, 'note');
  assert.equal(note24.detail, 'Node 24.1.0 is active but ~/proj/package.json asks for engines.node 22.12.0: run nvm use (or your version manager) in this project; VS Code or Cursor started outside this shell can resolve another Node');

  assert.equal(projectNode({ cwd: nested, home: h, nodeVersion: '22.5.0' }).status, 'note', 'below an exact pin');
  fs.writeFileSync(pkgPath, JSON.stringify({ engines: { node: '^22' } }));
  assert.match(projectNode({ cwd: nested, home: h, nodeVersion: '24.1.0' }).detail, /\^22, which lean-agents does not check/);
  fs.writeFileSync(pkgPath, JSON.stringify({ engines: { node: '22.12.0' } }));
  const ok22 = projectNode({ cwd: nested, home: h, nodeVersion: '22.12.0' });
  assert.equal(ok22.status, 'ok');
  assert.equal(ok22.detail, 'Node 22.12.0 fits engines.node 22.12.0 in ~/proj/package.json; VS Code or Cursor started outside this shell can resolve another Node');
});

test('doctor: with exec false and a cwd at a temp project includes a project Node row', () => {
  const h = tmp();
  const proj = path.join(h, 'my-app');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ engines: { node: '>=22' } }));

  const rows = [];
  doctor({ home: h, state, exec: false, cwd: proj, nodeVersion: '24.1.0', collect: rows });
  const row = rows.find((r) => r.item === 'project Node');
  assert.ok(row, 'found project Node row');
  assert.equal(row.status, 'ok');
  assert.equal(row.detail, 'Node 24.1.0 fits engines.node >=22 in ~/my-app/package.json; VS Code or Cursor started outside this shell can resolve another Node');
  const leanIdx = rows.findIndex((r) => r.item === 'lean-agents');
  const projIdx = rows.findIndex((r) => r.item === 'project Node');
  assert.equal(projIdx, leanIdx + 2);
});

test('nodeFloorFix: returns nvm use <version> for highest fit, else install line', () => {
  const floor = '>=22.20.0';
  const nvm = { win: false, dir: '/h/.nvm' };
  const nodes = [
    nodeAt(nvm, '/h/.nvm/versions/node/v22.12.0', '22.12.0'),
    nodeAt(nvm, '/h/.nvm/versions/node/v24.11.0', '24.11.0'),
  ];
  assert.equal(nodeFloorFix(floor, nodes), 'nvm use 24.11.0');
  assert.equal(nodeFloorFix(floor, [nodes[0]]), 'nvm install 22 && nvm use 22');
  assert.equal(nodeFloorFix(floor, []), 'nvm install 22 && nvm use 22');
});

test('doctor: node for lean-agents row added for managed and unmanaged', () => {
  const h = tmp();
  let rows = [];
  doctor({ home: h, state: null, exec: false, nodeVersion: '24.0.0', collect: rows });
  let row = rows.find(r => r.item === 'node for lean-agents');
  assert.equal(row.status, 'ok');
  assert.equal(row.detail, 'Node 24.0.0');

  rows = [];
  doctor({ home: h, state: null, exec: false, nodeVersion: '22.12.0', collect: rows });
  row = rows.find(r => r.item === 'node for lean-agents');
  assert.equal(row.status, 'error');
  assert.match(row.detail, /Node 22\.12\.0 is older than/);

  rows = [];
  doctor({ home: h, state, exec: false, nodeVersion: '24.0.0', collect: rows });
  row = rows.find(r => r.item === 'node for lean-agents');
  assert.equal(row.status, 'ok');
});
