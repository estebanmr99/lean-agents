// #304: doctor row for OpenCode Code Mode. Temp HOME, synthetic config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codeModeRow } from '../scripts/lib/plugin-health.mjs';

function setup(config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-cm-row-'));
  const dir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  if (config) {
    fs.writeFileSync(path.join(dir, 'opencode.jsonc'), `{\n  // synthetic config\n  ${Object.entries(config).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(',\n  ')}\n}\n`);
  }
  return home;
}

test('codeModeRow: no config -> null', () => {
  const h = setup(null);
  assert.equal(codeModeRow(h), null);
});

test('codeModeRow: config exists but no MCP servers -> null', () => {
  const h = setup({ plugins: ['some-plugin'] });
  assert.equal(codeModeRow(h), null);
});

test('codeModeRow: two servers on -> ok', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'] }, s2: { command: ['c2'] } } } });
  const row = codeModeRow(h);
  assert.equal(row.status, 'ok');
  assert.equal(row.detail, 'on for 2 MCP servers');
});

test('codeModeRow: one server codemode false (2.x shape) -> changed', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'], codemode: false }, s2: { command: ['c2'] } } } });
  const row = codeModeRow(h);
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /off for s1 \(codemode: false\)/);
  assert.match(row.detail, /Fix: remove that setting/);
});

test('codeModeRow: 1.x shape (no mcp.servers) -> null, 1.x has no Code Mode', () => {
  const h = setup({ mcp: { s1: { command: ['c1'], codemode: false } } });
  assert.equal(codeModeRow(h), null);
});

test('codeModeRow: execute allow wins over * deny -> ok', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'] } } }, permission: { '*': 'deny', execute: 'allow' } });
  assert.equal(codeModeRow(h).status, 'ok');
});

test('codeModeRow: permission execute deny -> changed', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'] } } }, permission: { execute: 'deny' } });
  const row = codeModeRow(h);
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /off: permission denies execute/);
});

test('codeModeRow: permission * deny -> changed', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'] } } }, permission: { '*': 'deny' } });
  const row = codeModeRow(h);
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /off: permission denies execute/);
});

test('codeModeRow: permission execute object with * deny -> changed', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'] } } }, permission: { execute: { '*': 'deny' } } });
  const row = codeModeRow(h);
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /off: permission denies execute/);
});

test('codeModeRow: both server off and permission deny -> changed naming both', () => {
  const h = setup({ mcp: { servers: { s1: { command: ['c1'], codemode: false } } }, permission: { execute: 'deny' } });
  const row = codeModeRow(h);
  assert.equal(row.status, 'changed');
  assert.match(row.detail, /off for s1 \(codemode: false\) and off: permission denies execute/);
});
