// --upgrade-agent opencode dry run against a seeded hand-built HOME: each class shows up, translations are right, the JSON shape is stable,
// nothing is written, no env or header values are printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../scripts/lib/adopt.mjs';
import { upgradeInventory, TRANSLATIONS } from '../scripts/lib/upgrade.mjs';
import { seedHandbuilt, treeHash, SECRETS } from './fixtures/handbuilt.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
const skip = process.platform === 'win32' && 'the real-upgrade job covers Windows paths';

async function seeded() {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'upgrade-')));
  const nodes = j(home, '.nvm', 'versions', 'node');
  fs.mkdirSync(j(home, '.nvm'), { recursive: true });
  fs.writeFileSync(j(home, '.nvm', 'nvm.sh'), '');
  await seedHandbuilt(home, { old: { dir: j(nodes, 'v22.20.0'), version: '22.20.0' }, neu: { dir: j(nodes, 'v24.15.0'), version: '24.15.0' }, link: j(home, '.nvm', 'current') });
  const env = { PATH: j(nodes, 'v22.20.0', 'bin'), NVM_DIR: j(home, '.nvm'), HOME: home };
  return { home, env };
}
const doc = async ({ home, env }) => upgradeInventory(await inventory({ home, env, platform: process.platform, realHome: '/nowhere' }), { home });
const up = (r, name, kind) => r.items.find((i) => i.upgrade && i.name === name && (!kind || i.kind === kind));

test('every class appears and translation rows give the right before/after', { skip }, async () => {
  const r = await doc(await seeded());
  assert.equal(r.version, 1);
  assert.deepEqual(Object.keys(r.upgrade).sort(), ['backup', 'binary', 'counts', 'from', 'layout', 'plan', 'to']);
  const classes = new Set(r.items.filter((i) => i.upgrade).map((i) => i.upgrade.class));
  assert.deepEqual([...classes].sort(), ['managed', 'user-manual', 'user-translatable']);

  const pair = (n, k) => [up(r, n, k).upgrade.class, up(r, n, k).upgrade.before, up(r, n, k).upgrade.after];
  assert.deepEqual(pair('agent.reviewer'), ['user-translatable', 'agent.reviewer', 'agents.reviewer']);
  assert.deepEqual(pair('mine', 'mcp'), ['user-translatable', 'mcp.mine', 'mcp.servers.mine']);
  assert.deepEqual(pair('some-npm-plugin@1.0.0', 'plugin'), ['user-translatable', 'plugin some-npm-plugin@1.0.0', 'plugins[]']);
  assert.deepEqual(pair('compaction.reserved'), ['user-translatable', 'compaction.reserved', 'compaction.buffer']);
  assert.deepEqual(pair('autoupdate'), ['user-translatable', 'autoupdate: false', 'update: "disable"']);
  assert.deepEqual(pair('disabled_providers'), ['user-translatable', 'disabled_providers[]', 'policies: deny provider.use']);
  assert.equal(up(r, 'context-mode', 'plugin').upgrade.class, 'managed');
  assert.equal(up(r, 'agent/lean.md').upgrade.class, 'managed');
  assert.equal(up(r, 'agents/mine.md').upgrade.class, 'user-translatable');

  assert.equal(up(r, 'keybinds').upgrade.class, 'user-manual'); assert.match(up(r, 'keybinds').upgrade.reason, /VERIFY/);
  assert.match(up(r, 'provider').upgrade.reason, /no verified 2\.x key/);
  assert.match(up(r, 'plugins/rtk.ts').upgrade.reason, /api\.keymap/);
  assert.match(up(r, 'plugins/orca-status-tui-shim.js').upgrade.reason, /stopgap/);
  assert.ok(TRANSLATIONS.every((t) => t.source));
});

test('the CLI dry run prints the table and --json the doc, writes nothing and leaks no values', { skip }, async () => {
  const s = await seeded();
  const before = treeHash(s.home);
  const args = [LEAN, '--home', s.home, '--no-exec', '--upgrade-agent', 'opencode'];
  const env = { ...process.env, NVM_DIR: s.env.NVM_DIR, PATH: s.env.PATH };
  const text = spawnSync(process.execPath, args, { encoding: 'utf8', env });
  const json = spawnSync(process.execPath, [...args, '--dry-run', '--json'], { encoding: 'utf8', env });
  assert.equal(text.status, 0, text.stderr); assert.equal(json.status, 0, json.stderr);
  assert.match(text.stdout, /managed, \d+ translatable, \d+ manual/);
  assert.match(text.stdout, /compaction\.reserved -> compaction\.buffer/);
  const r = JSON.parse(json.stdout);
  assert.equal(r.upgrade.from, 'opencode-v1');
  assert.equal(treeHash(s.home), before, 'dry run writes nothing');
  for (const out of [text.stdout, json.stdout]) for (const v of SECRETS) assert.ok(!out.includes(v), `${v} leaked`);
});

test('apply and --undo are not in this release yet', { skip }, async () => {
  const { home } = await seeded();
  for (const extra of [['--yes'], ['--yes', '--json'], ['--undo']]) {
    const r = spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--upgrade-agent', 'opencode', ...extra], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /not in this release yet/);
  }
});

test('the lean-migrate skill is opt-in: only with --tools lean-migrate', { skip }, async () => {
  const { home } = await seeded();
  const plan = (tools) => spawnSync(process.execPath, [LEAN, '--home', home, '--no-exec', '--dry-run', '--yes', '--agents', 'claude', ...tools], { encoding: 'utf8' }).stdout + '';
  assert.doesNotMatch(plan(['--all-tools']), /--skill lean-migrate/);
  assert.match(plan(['--tools', 'lean-migrate']), /--skill lean-migrate -a claude-code -g -y/);
});
