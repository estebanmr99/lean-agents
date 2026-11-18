// --upgrade-agent opencode apply (P5 of #80 part 2): translates managed + user-translatable rows on the live config only.
// Temp HOME, no real OpenCode. Not wired to lean.mjs yet (P6); this drives upgradeApply directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { inventory } from '../scripts/lib/adopt.mjs';
import { upgradeInventory, upgradeApply } from '../scripts/lib/upgrade.mjs';
import { undo } from '../scripts/lib/fsops.mjs';
import { opencodeV2Adapter } from '../scripts/lib/adapters/opencode-v2.mjs';
import { loadCore } from '../scripts/lib/render.mjs';
import { npmSpec } from '../scripts/lib/pins.mjs';
import { seedWorkPc, treeHash } from './fixtures/handbuilt.mjs';

const j = path.join;
const ROOT = path.resolve(import.meta.dirname, '..');
const skip = process.platform === 'win32' && 'the real-opencode job covers Windows paths';
const STAMP = { verified: true };

async function setup(tools = ['ponytail', 'dcp', 'context-mode']) {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'upgrade-apply-')));
  seedWorkPc(home);
  const inv = upgradeInventory(await inventory({ home, env: { HOME: home, PATH: '' }, platform: process.platform, realHome: '/nowhere' }), { home });
  const opts = { tools, network: {}, terminals: [], platform: 'linux', env: {}, shell: 'default', ponytailMode: 'lite' };
  const adapter = opencodeV2Adapter({ home, core: loadCore(ROOT), profile: null, opts, rulesPath: j(home, 'rules.md') });
  return { home, inv, adapter, backupDir: j(home, 'bk'), cfg: j(home, '.config', 'opencode', 'opencode.jsonc') };
}
const read = (f) => parse(fs.readFileSync(f, 'utf8'));

test('apply refuses without a verified backup stamp (the P3 stub never has one)', { skip }, async () => {
  const s = await setup();
  const before = treeHash(s.home);
  assert.throws(() => upgradeApply({ ...s }), /no verified session backup/);
  assert.throws(() => upgradeApply({ ...s, stamp: { verified: false } }), /no verified session backup/);
  assert.equal(treeHash(s.home), before);
});

test('translates the team-machine config, keeps user-manual keys, never touches the 1.x data folder', { skip }, async () => {
  const s = await setup();
  const data = j(s.home, '.local', 'share', 'opencode');
  const dataBefore = treeHash(data);
  const r = upgradeApply({ ...s, stamp: STAMP });
  assert.equal(treeHash(data), dataBefore);
  const c = read(s.cfg);
  assert.deepEqual(c.agents.reviewer, { mode: 'subagent' });
  assert.equal(c.agent, undefined);
  assert.deepEqual(Object.keys(c.mcp), ['servers']);
  assert.ok(c.mcp.servers.issues.environment.ISSUES_TOKEN, 'user MCP env moved intact');
  assert.ok(c.mcp.servers['context-mode'], 'managed MCP rewritten by the adapter');
  assert.ok(c.plugins.includes('team-npm-plugin@1.2.0') && c.plugins.includes('@scope/other-plugin@2.0.0'));
  assert.ok(c.plugins.includes(npmSpec('ponytail')) && c.plugins.includes(npmSpec('opencode-dcp')));
  assert.equal(c.plugin.length, 1, 'the local .ts plugin stays for the migrate skill');
  assert.match(c.plugin[0], /team-notify\.ts$/);
  assert.equal(c.compaction.buffer, 20000);
  assert.equal(c.compaction.reserved, undefined);
  assert.equal(c.update, 'disable');
  assert.equal(c.autoupdate, undefined);
  assert.deepEqual(c.policies, [{ effect: 'deny', action: 'provider.use', resource: 'opencode' }]);
  assert.deepEqual(c.keybinds, { leader: 'ctrl+x' });
  assert.deepEqual(c.permission, { bash: 'ask' });
  assert.match(fs.readFileSync(s.cfg, 'utf8'), /\/\/ team keys/);
  assert.ok(fs.existsSync(j(s.home, '.config', 'opencode', 'dcp.jsonc')));
  for (let i = 1; i <= 7; i++) assert.ok(fs.existsSync(j(s.home, '.config', 'opencode', 'skills', `team-skill-${i}`, 'scripts', 'run.sh')));
  assert.ok(fs.existsSync(j(s.home, '.config', 'opencode', 'plugins', 'team-notify.ts')));
  assert.ok(r.entries.length > 0);
});

test('a second run changes nothing and undo restores the original config bytes', { skip }, async () => {
  const s = await setup();
  const original = fs.readFileSync(s.cfg, 'utf8');
  const first = upgradeApply({ ...s, stamp: STAMP });
  const after = fs.readFileSync(s.cfg, 'utf8');
  const again = upgradeApply({ ...s, stamp: STAMP, adapter: { actions: s.adapter.actions } });
  assert.ok(again.planned.every((p) => ['unchanged', 'skip'].includes(p.status)), again.text);
  assert.equal(fs.readFileSync(s.cfg, 'utf8'), after);
  undo(first.entries, [j(s.home, '.config', 'opencode')]);
  assert.equal(fs.readFileSync(s.cfg, 'utf8'), original);
  assert.ok(!fs.existsSync(j(s.home, '.config', 'opencode', 'dcp.jsonc')));
});

test('a user dcp.jsonc keeps its values', { skip }, async () => {
  const s = await setup();
  fs.writeFileSync(j(s.home, '.config', 'opencode', 'dcp.jsonc'), '{ "compress": { "maxContextLimit": 123456 } }\n');
  upgradeApply({ ...s, stamp: STAMP });
  const d = read(j(s.home, '.config', 'opencode', 'dcp.jsonc'));
  assert.equal(d.compress.maxContextLimit, 123456);
  assert.equal(d.compress.minContextLimit, 100000);
});

test('an adapter action outside the config dir is refused', { skip }, async () => {
  const s = await setup();
  const bad = { actions: [{ kind: 'file', path: j(s.home, '.local', 'share', 'opencode', 'x'), content: 'x' }] };
  assert.throws(() => upgradeApply({ ...s, adapter: bad, stamp: STAMP }), /outside/);
});

test('a 2.x value already in the file wins and the 1.x source key is kept; an unparseable file is refused', { skip }, async () => {
  const s = await setup();
  fs.writeFileSync(s.cfg, '{ "autoupdate": true, "update": "disable", "compaction": { "reserved": 1, "buffer": 2 } }\n');
  const inv = upgradeApply({ ...s, inv: { items: s.inv.items }, stamp: STAMP, dryRun: true });
  const after = inv.planned.find((p) => p.path === s.cfg).after;
  const c = parse(after);
  assert.equal(c.update, 'disable'); assert.equal(c.autoupdate, true);
  assert.equal(c.compaction.buffer, 2); assert.equal(c.compaction.reserved, 1);
  fs.writeFileSync(s.cfg, '{ not json');
  assert.throws(() => upgradeApply({ ...s, stamp: STAMP }), /could not be parsed/);
});
