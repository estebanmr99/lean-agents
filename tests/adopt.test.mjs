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

test('--undo, --keep-backup and --confirm-removals are parsed but rejected in this release', () => {
  for (const flag of ['--undo', '--keep-backup', '--confirm-removals']) {
    const r = spawnSync(process.execPath, [LEAN, '--home', os.tmpdir(), '--adopt', flag], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not in this release yet/);
  }
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
