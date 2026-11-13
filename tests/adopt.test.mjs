// --adopt dry run against a seeded hand-built HOME: each class shows up, the JSON shape is stable, nothing is written, no secrets leak.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../scripts/lib/adopt.mjs';
import { seedHandbuilt, treeHash, SECRETS } from './fixtures/handbuilt.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
const skip = process.platform === 'win32' && 'the real-tool-node job covers Windows paths';

async function seeded() {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'adopt-')));
  const nodes = j(home, '.nvm', 'versions', 'node');
  fs.mkdirSync(j(home, '.nvm'), { recursive: true });
  fs.writeFileSync(j(home, '.nvm', 'nvm.sh'), '');
  const seed = await seedHandbuilt(home, {
    old: { dir: j(nodes, 'v22.20.0'), version: '22.20.0' }, neu: { dir: j(nodes, 'v24.15.0'), version: '24.15.0' }, link: j(home, '.nvm', 'current'),
  });
  const env = { PATH: j(nodes, 'v22.20.0', 'bin'), NVM_DIR: j(home, '.nvm'), HOME: home };
  return { home, env, seed };
}
const run = ({ home, env }) => inventory({ home, env, platform: process.platform, realHome: '/nowhere', });
const find = (r, kind, name, client) => r.items.find((i) => i.kind === kind && i.name === name && (!client || i.client === client));

test('dry run: every class shows up with the planned action', { skip }, async () => {
  const s = await seeded();
  const r = await run(s);
  assert.equal(r.version, 1);
  assert.deepEqual(Object.keys(r).sort(), ['items', 'ok', 'opencode', 'os', 'plan', 'stopgaps', 'toolNode', 'version']);

  const bare = find(r, 'mcp', 'context-mode', 'claude');
  assert.equal(bare.owner, 'managed'); assert.equal(bare.launch.style, 'npx-path'); assert.ok(bare.status.includes('wrong-node')); assert.equal(bare.action, 'reinstall');
  const link = find(r, 'mcp', 'ctx-link');
  assert.equal(link.launch.style, 'symlink'); assert.equal(link.launch.nodeVersion, '22.20.0'); assert.ok(link.status.includes('wrong-node'));
  const relay = find(r, 'mcp', 'relay');
  assert.equal(relay.owner, 'user'); assert.equal(relay.action, 'keep'); assert.equal(find(r, 'mcp', 'remote').owner, 'user');

  assert.deepEqual(find(r, 'plugin', 'ghost@nowhere').status, ['stale']);
  assert.equal(find(r, 'plugin', 'ghost@nowhere').owner, 'user'); assert.equal(find(r, 'plugin', 'ghost@nowhere').action, 'ask');
  assert.equal(find(r, 'plugin', 'context-mode@context-mode').action, 'keep');
  assert.equal(find(r, 'hook', 'PreToolUse:rtk').owner, 'managed');
  assert.equal(find(r, 'hook', 'PreToolUse:echo').owner, 'user');
  assert.equal(find(r, 'hook', 'PreToolUse:mytool').owner, 'user'); // its --api-key argument is never printed

  const rtk = find(r, 'plugin', 'plugins/rtk.ts');
  assert.equal(rtk.owner, 'user'); assert.equal(rtk.action, 'keep');
  assert.ok(find(r, 'plugin', 'context-mode', 'opencode').status.includes('duplicate')); // plugin and MCP
  assert.ok(r.items.some((i) => i.client === 'opencode' && i.kind === 'plugin' && i.status.includes('stale')));

  const dups = r.items.filter((i) => i.kind === 'skill' && i.name === 'dup-demo');
  assert.equal(dups.length, 2); assert.ok(dups.every((d) => d.status.includes('duplicate') && d.action === 'ask'));

  const npm = r.items.filter((i) => i.kind === 'npm');
  assert.equal(npm.length, 2); assert.ok(npm.every((n) => n.status.includes('duplicate')));
  assert.deepEqual(npm.map((n) => [n.node, n.action]), [['22.20.0', 'remove'], ['24.15.0', 'upgrade']]); // old copy goes, the tool Node's copy is upgraded
  assert.equal(r.toolNode.source, 'reuse'); assert.equal(r.toolNode.version, '24.15.0');

  assert.deepEqual(r.stopgaps.map((x) => x.file).sort(), ['~/.config/opencode/plugins/orca-status-tui-shim.js', '~/.local/bin/copilot-usage']);
  assert.ok(r.stopgaps.every((x) => /managed/.test(x.replaceWith)));
  assert.ok(r.plan.length > 0 && r.ok === false);
  assert.equal(r.opencode.major, 1);
  if (s.seed.sessions !== null) assert.equal(r.opencode.sessions, 3); else assert.equal(r.opencode.sessions, null);
});

test('dry run writes nothing and never leaks env or header values', { skip }, async () => {
  const s = await seeded();
  const before = treeHash(s.home);
  const r = await run(s);
  const cli = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt', '--json'], { encoding: 'utf8', env: { ...process.env, NVM_DIR: s.env.NVM_DIR, PATH: s.env.PATH } });
  assert.equal(cli.status, 0, cli.stderr);
  const printed = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt'], { encoding: 'utf8' });
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(treeHash(s.home), before);
  assert.equal(JSON.parse(cli.stdout).version, 1);
  for (const text of [JSON.stringify(r), cli.stdout, cli.stderr, printed.stdout, printed.stderr]) for (const secret of SECRETS) assert.ok(!text.includes(secret));
  assert.match(printed.stdout, /dry run/);
});

test('--undo, --keep-backup and --confirm-removals need --adopt', () => {
  for (const flag of ['--undo', '--keep-backup', '--confirm-removals']) {
    const r = spawnSync(process.execPath, [LEAN, '--home', os.tmpdir(), flag], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /go with --adopt/);
  }
});

const lean = (home, args) => spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--adopt', ...args], { encoding: 'utf8', env: { ...process.env, NVM_DIR: j(home, '.nvm'), PATH: `${j(home, '.nvm', 'versions', 'node', 'v22.20.0', 'bin')}${path.delimiter}${process.env.PATH}` } });

test('apply re-registers the managed MCPs, keeps user files, and --undo restores every byte', { skip }, async () => {
  const s = await seeded();
  const before = treeHash(s.home);
  const claude = j(s.home, '.claude.json');
  const dry = lean(s.home, []);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(treeHash(s.home), before, 'dry run writes nothing');

  const r = lean(s.home, ['--yes', '--keep-backup']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const servers = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
  assert.match(servers['context-mode'].command, /v24\.15\.0/); assert.deepEqual(servers['context-mode'].args.slice(-1), ['server']);
  assert.match(servers['ctx-link'].command, /v24\.15\.0/);
  assert.equal(servers.relay.command, 'node'); // the user's own entry
  assert.ok(fs.existsSync(j(s.home, '.agents', 'skills', 'dup-demo')), 'no --confirm-removals: the duplicate skill stays');
  assert.ok(fs.existsSync(j(s.home, '.local', 'bin', 'copilot-usage')), 'its managed replacement is not installed: the stopgap stays');
  const state = JSON.parse(fs.readFileSync(j(s.home, '.config', 'lean-agents', 'state.json'), 'utf8'));
  assert.ok(state.adopt.files.length >= 2 && fs.existsSync(state.adopt.backupDir));
  assert.equal(fs.statSync(state.adopt.backupDir).mode & 0o077, 0, 'backup is owner-only');

  const u = lean(s.home, ['--undo']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  const { readdirSync } = fs;
  assert.deepEqual(readdirSync(j(s.home, '.config')).filter((n) => n.startsWith('lean-agents')), []);
  // state.json and the backup are gone: only then is the tree the seeded one again
  assert.equal(treeHash(s.home), before);
});

test('--confirm-removals deletes the duplicate skill after backing it up, and --undo copies it back', { skip }, async () => {
  const s = await seeded();
  const before = treeHash(s.home);
  const r = lean(s.home, ['--yes', '--keep-backup', '--confirm-removals']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(j(s.home, '.agents', 'skills', 'dup-demo')));
  assert.ok(fs.existsSync(j(s.home, '.claude', 'skills', 'dup-demo', 'SKILL.md')));
  const u = lean(s.home, ['--undo']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  assert.equal(treeHash(s.home), before);
});

test('a stopgap goes only when its managed replacement is in state.json, after a backup, and --undo brings it back', { skip }, async () => {
  const s = await seeded();
  const dir = j(s.home, '.config', 'lean-agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(j(dir, 'state.json'), JSON.stringify({ version: '0', options: { migrateOnly: true, agents: [], tools: ['copilot-usage'], terminals: [], privacy: 'standard' }, files: [], commands: [] }));
  const stop = j(s.home, '.local', 'bin', 'copilot-usage');
  const orca = j(s.home, '.config', 'opencode', 'plugins', 'orca-status-tui-shim.js');
  const r = lean(s.home, ['--yes', '--keep-backup', '--confirm-removals']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(stop)); assert.ok(fs.existsSync(orca), 'Orca is not in state.json: its shim stays');
  assert.equal(lean(s.home, ['--undo']).status, 0);
  assert.equal(fs.readFileSync(stop, 'utf8'), '#!/bin/sh\n');
  assert.equal(JSON.parse(fs.readFileSync(j(dir, 'state.json'), 'utf8')).adopt, undefined);
});

test('--undo reverts only our keys in a file the user edited since', { skip }, async () => {
  const s = await seeded();
  assert.equal(lean(s.home, ['--yes', '--keep-backup']).status, 0);
  const claude = j(s.home, '.claude.json');
  const j1 = JSON.parse(fs.readFileSync(claude, 'utf8'));
  j1.mcpServers.mine = { command: 'mine' };
  fs.writeFileSync(claude, JSON.stringify(j1));
  const u = lean(s.home, ['--undo']);
  assert.equal(u.status, 0, u.stdout + u.stderr);
  const back = JSON.parse(fs.readFileSync(claude, 'utf8')).mcpServers;
  assert.equal(back.mine.command, 'mine');
  assert.equal(back['context-mode'].command, 'npx');
});

test('an empty HOME has nothing to adopt', { skip }, async () => {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'adopt-empty-')));
  const r = await inventory({ home, env: {}, platform: process.platform, realHome: '/nowhere' });
  assert.deepEqual(r.items, []); assert.equal(r.ok, true); assert.equal(r.opencode.major, null);
});

test('an empty hook command is skipped and a plugin URL query is not printed', async () => {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'adopt-edge-')));
  fs.mkdirSync(j(home, '.claude'), { recursive: true });
  fs.writeFileSync(j(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '  ' }] }] } }));
  fs.mkdirSync(j(home, '.config', 'opencode'), { recursive: true });
  fs.writeFileSync(j(home, '.config', 'opencode', 'opencode.json'), JSON.stringify({ plugin: ['https://example.com/p.js?key=qsecret-1'] }));
  const r = await inventory({ home, env: { PATH: '' }, platform: process.platform, realHome: '/nowhere' });
  assert.equal(r.items.filter((i) => i.kind === 'hook').length, 0);
  assert.ok(!JSON.stringify(r).includes('qsecret-1'));
  fs.rmSync(home, { recursive: true, force: true });
});
