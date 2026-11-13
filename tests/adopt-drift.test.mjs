// --adopt labels (#174): a copy newer than the pin is kept, a duplicate under a Node below the tool floor is removed,
// and each text row names its source file. Synthetic temp HOME with fake Nodes; nothing real is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../scripts/lib/adopt.mjs';
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
  const r = spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt', '--json'], { encoding: 'utf8', env: { ...process.env, NVM_DIR: j(h, '.nvm'), HOME: h } });
  const rows = JSON.parse(r.stdout).items.filter((i) => i.name === '@tarquinen/opencode-dcp@latest');
  assert.deepEqual(rows.map((i) => i.file).sort(), ['~/.config/opencode/opencode.jsonc', '~/.config/opencode/tui.json']);
  assert.ok(rows.every((i) => !i.status.includes('duplicate')));
  const text = spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt'], { encoding: 'utf8', env: { ...process.env, NVM_DIR: j(h, '.nvm'), HOME: h } }).stdout;
  const lines = text.split('\n').filter((l) => l.includes('opencode-dcp'));
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => l.includes('opencode.jsonc')) && lines.some((l) => l.includes('tui.json')));
});
