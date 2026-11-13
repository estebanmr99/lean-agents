// --upgrade-agent opencode (#173): per-file plugin reasons, non-plugin files skipped, local tui.json plugins named by folder.
// Synthetic HOME shaped like the #145 report (opencode-v1, six user plugin files, two tui.json plugins).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inventory } from '../scripts/lib/adopt.mjs';
import { upgradeInventory } from '../scripts/lib/upgrade.mjs';

const j = path.join;
const skip = process.platform === 'win32' && 'the real-upgrade job covers Windows paths';

async function seed() {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'upgrade-reasons-')));
  const oc = j(home, '.config', 'opencode');
  const put = (rel, text) => { fs.mkdirSync(path.dirname(j(oc, rel)), { recursive: true }); fs.writeFileSync(j(oc, rel), text); };
  put('plugins/uses-command.js', 'export default (api) => { api.command.register({}); }\n');
  put('plugins/plain.ts', 'export default {}\n');
  put('plugins/package.json', '{"type":"commonjs"}\n');
  put('plugins/node_modules/dep/index.js', 'export {}\n');
  put('plugins/alpha-tui/tui.js', 'api.command.register({})\n');
  put('plugins/beta-tui/tui.js', 'export default {}\n');
  const url = (f) => pathToFileURL(j(oc, 'plugins', f)).href;
  put('tui.json', JSON.stringify({ plugin: [url('alpha-tui/tui.js'), url('beta-tui/tui.js')] }));
  put('opencode.jsonc', '{ "experimental": { "x": 1 }, "permission": { "bash": "ask" } }\n');
  const inv = await inventory({ home, env: { HOME: home, PATH: '' }, platform: process.platform, realHome: '/nowhere' });
  const r = upgradeInventory(inv, { home });
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}
const up = (r, name) => r.items.find((i) => i.upgrade && i.name === name)?.upgrade;

test('a plugin file gets the api.command reason only when it uses api.command', { skip }, async () => {
  const r = await seed();
  assert.match(up(r, 'plugins/uses-command.js').reason, /api\.keymap/);
  assert.doesNotMatch(up(r, 'plugins/plain.ts').reason, /api\.command/);
  assert.match(up(r, 'plugins/plain.ts').reason, /not proven/);
});

test('package.json and node_modules are not listed as plugins', { skip }, async () => {
  const names = (await seed()).items.filter((i) => i.kind === 'plugin').map((i) => i.name);
  assert.ok(!names.some((n) => /package\.json|node_modules/.test(n)), names.join());
});

test('local tui.json plugins are named by folder and stay distinct', { skip }, async () => {
  const r = await seed();
  assert.equal(up(r, 'alpha-tui/tui.js').class, 'user-manual');
  assert.equal(up(r, 'beta-tui/tui.js').class, 'user-manual');
  assert.ok(!r.items.some((i) => i.name === 'file:tui.js'));
});

test('experimental and permission stay user-manual with a stated reason', { skip }, async () => {
  const r = await seed();
  for (const k of ['experimental', 'permission']) { assert.equal(up(r, k).class, 'user-manual'); assert.match(up(r, k).reason, /VERIFY/); }
});
