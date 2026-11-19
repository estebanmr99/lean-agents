// --adopt labels (#174): a copy newer than the pin is kept, a duplicate under a Node below the tool floor is removed,
// and each text row names its source file. Synthetic temp HOME with fake Nodes; nothing real is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adoptPlan, inventory } from '../scripts/lib/adopt.mjs';
import { PINS } from '../scripts/lib/pins.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
const skip = process.platform === 'win32' && 'the real-tool-node job covers Windows paths';
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const pin = PINS['context-mode'].version;
const [maj, min, pat] = pin.split('.').map(Number);
const newer = `${maj}.${min}.${pat + 3}`;
const older = `${maj}.${min}.${pat - 1}`;

// copies: [[node version, package version], ...]; an MCP launch makes the tool Node resolve.
function home(copies) {
  const h = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'drift-')));
  put(j(h, '.nvm', 'nvm.sh'), '');
  for (const [node, v] of copies) {
    const dir = j(h, '.nvm', 'versions', 'node', `v${node}`);
    put(j(dir, 'bin', 'node'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(j(dir, 'bin', 'node'), 0o755);
    put(j(dir, 'lib', 'node_modules', 'context-mode', 'package.json'), JSON.stringify({ name: 'context-mode', version: v }));
  }
  put(j(h, '.claude.json'), JSON.stringify({ mcpServers: { 'context-mode': { command: 'npx', args: ['-y', `context-mode@${pin}`, 'server'] } } }));
  return h;
}
const run = (h) => inventory({ home: h, env: { NVM_DIR: j(h, '.nvm'), HOME: h, PATH: '/usr/bin' }, platform: process.platform, realHome: '/nowhere' });
const npm = (r) => r.items.filter((i) => i.kind === 'npm');

test('a copy newer than the pin is kept, an older one is upgraded', { skip }, async () => {
  const c = npm(await run(home([['24.15.0', newer], ['24.20.0', older]])));
  const by = Object.fromEntries(c.map((i) => [i.name.replace(/^.*@/, ''), i]));
  assert.ok(by[newer].status.includes('newer') && !by[newer].status.includes('drift')); assert.equal(by[newer].action, 'keep');
  assert.ok(by[older].status.includes('drift')); assert.equal(by[older].action, 'upgrade');
});

test('a duplicate under a Node below the tool floor is removed, the target Node copy is kept', { skip }, async () => {
  const r = await run(home([['24.11.0', '1.0.161'], ['24.22.2', newer]]));
  const [low, high] = npm(r);
  assert.equal(low.node, '24.11.0'); assert.ok(low.status.includes('below-floor')); assert.equal(low.action, 'remove');
  assert.equal(high.node, '24.22.2'); assert.equal(high.action, 'keep');
});

test('the same plugin in the server config and tui.json is two needed rows with their own source file', { skip }, () => {
  const h = home([]);
  const oc = j(h, '.config', 'opencode');
  put(j(oc, 'opencode.jsonc'), '{ "plugin": ["@tarquinen/opencode-dcp@latest"] }');
  put(j(oc, 'tui.json'), '{ "plugin": ["@tarquinen/opencode-dcp@latest"] }');
  const env = { PATH: process.env.PATH, NVM_DIR: j(h, '.nvm'), HOME: h }; // no inherited XDG_* or other vars
  const r = spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt', '--json'], { encoding: 'utf8', env });
  const rows = JSON.parse(r.stdout).items.filter((i) => i.name === '@tarquinen/opencode-dcp@latest');
  assert.deepEqual(rows.map((i) => i.file).sort(), ['~/.config/opencode/opencode.jsonc', '~/.config/opencode/tui.json']);
  assert.ok(rows.every((i) => !i.status.includes('duplicate')));
  const text = spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt'], { encoding: 'utf8', env }).stdout;
  const lines = text.split('\n').filter((l) => l.includes('opencode-dcp'));
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.includes('opencode.jsonc')) && lines.some((l) => l.includes('tui.json')));
});

// #204: a pre-release is older than its release and compares by its numeric core; equal versions stay unflagged.
test('a pre-release copy is drift below its pin, newer when its core is above the pin, and unflagged when equal', { skip }, async () => {
  const one = async (v) => npm(await run(home([['24.20.0', v]])))[0].status;
  assert.ok((await one(`${maj}.${min}.${pat}-beta.1`)).includes('drift'));
  assert.ok((await one(`${maj}.${min}.${pat + 1}-beta.1`)).includes('newer'));
  assert.deepEqual(await one(pin), []);
});

// PC run (#179): a drift copy in the tool Node with its MCP already on that Node is still upgraded by --adopt --yes.
test('a drift copy in the tool Node is installed even when no MCP is rewritten', { skip }, async () => {
  const h = home([['24.15.0', older]]);
  const dir = j(h, '.nvm', 'versions', 'node', 'v24.15.0');
  put(j(h, '.claude.json'), JSON.stringify({ mcpServers: { 'context-mode': { command: j(dir, 'bin', 'node'), args: [j(dir, 'lib', 'node_modules', 'context-mode', 'cli.mjs'), 'server'] } } }));
  const plan = async () => adoptPlan(await run(h), { home: h, env: { NVM_DIR: j(h, '.nvm'), HOME: h, PATH: '/usr/bin' }, platform: process.platform, realHome: '/nowhere', state: null });
  const p = await plan();
  assert.equal(p.rewritten.length, 0);
  assert.deepEqual([p.install?.have, p.install?.node.version], [older, '24.15.0']);
  // a copy newer than the pin is kept: nothing to install
  put(j(dir, 'lib', 'node_modules', 'context-mode', 'package.json'), JSON.stringify({ name: 'context-mode', version: newer }));
  assert.equal((await plan()).install, null);
});

// PC run (#179): the npm copies' own pins set the tool Node floor, so context-mode (>=24.15.0) is never installed on Node 22.
test('a drift copy on a Node below the pin floor is not upgraded in place', { skip }, async () => {
  const h = home([['22.17.0', older]]);
  // no context-mode MCP: only the npm copy names its pin (the PC had Playwright, >=18, as the only MCP)
  put(j(h, '.claude.json'), JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['-y', `@playwright/mcp@${PINS['playwright-mcp'].version}`] } } }));
  const r = await run(h);
  assert.equal(r.toolNode.range, PINS['context-mode'].node);
  assert.equal(r.toolNode.version, null);
  const env = { NVM_DIR: j(h, '.nvm'), HOME: h, PATH: '/usr/bin' };
  const p = adoptPlan(r, { home: h, env, platform: process.platform, realHome: '/nowhere', state: null });
  assert.equal(p.install, null);
  assert.ok(p.notes.some((n) => n.includes(`no installed Node meets ${PINS['context-mode'].node}`)));
  // with a Node that meets the floor, the pin goes there
  put(j(h, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'node'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(j(h, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'node'), 0o755);
  const r2 = await run(h);
  assert.equal(r2.toolNode.version, '24.15.0');
  const p2 = adoptPlan(r2, { home: h, env, platform: process.platform, realHome: '/nowhere', state: null });
  assert.equal(p2.install?.node.version, '24.15.0');
  // the 22.17.0 copy is removed in the same run (with a yes): a second --adopt --yes would be refused
  assert.deepEqual(p2.oldCopies.map((c) => [c.node.version, c.version]), [['22.17.0', older]]);
  // kept instead: a copy newer than the pin, or one a user's own MCP runs on
  const r3 = await run(h);
  const c22 = r3.items.find((i) => i.kind === 'npm' && i.node === '22.17.0');
  Object.assign(c22, { status: ['newer'], action: 'keep' });
  r3.items.push({ ...c22, node: '24.15.0', status: ['drift'], action: 'upgrade' }); // something else makes this run install the pin
  const p3 = adoptPlan(r3, { home: h, env, platform: process.platform, realHome: '/nowhere', state: null });
  assert.ok(p3.install);
  assert.equal(p3.oldCopies.length, 0, 'a newer copy is not removed');
  put(j(h, '.claude.json'), JSON.stringify({ mcpServers: { mine: { command: j(h, '.nvm', 'versions', 'node', 'v22.17.0', 'bin', 'node'), args: ['/opt/mine/server.js'] } } }));
  const p4 = adoptPlan(await run(h), { home: h, env, platform: process.platform, realHome: '/nowhere', state: null });
  assert.equal(p4.oldCopies.length, 0);
  assert.ok(p4.notes.some((n) => n.includes('under Node 22.17.0 stays: your claude mine runs on that Node')), p4.notes.join('\n'));
});

// PC run (#179): the dry run shows what --yes does, the pin's target Node and the removal, in text and --json.
test('--adopt --dry-run lists the install into the tool Node and the old copy it removes', { skip }, () => {
  const h = home([['22.17.0', older]]);
  put(j(h, '.claude.json'), JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['-y', `@playwright/mcp@${PINS['playwright-mcp'].version}`] } } }));
  put(j(h, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'node'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(j(h, '.nvm', 'versions', 'node', 'v24.15.0', 'bin', 'node'), 0o755);
  const env = { PATH: process.env.PATH, NVM_DIR: j(h, '.nvm'), HOME: h };
  const want = [`install context-mode@${pin} into Node 24.15.0`, `npm uninstall the old context-mode@${older} under Node 22.17.0 (needs a yes, or --confirm-removals)`];
  const json = JSON.parse(spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt', '--json'], { encoding: 'utf8', env }).stdout);
  assert.ok(json.apply.some((l) => l.startsWith(want[0])), json.apply.join('\n'));
  assert.ok(json.apply.includes(want[1]), json.apply.join('\n'));
  const text = spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt'], { encoding: 'utf8', env }).stdout;
  assert.match(text, /--yes does:\n {2}- install context-mode@\S+ into Node 24\.15\.0/);
  assert.ok(text.includes(want[1]));
});
