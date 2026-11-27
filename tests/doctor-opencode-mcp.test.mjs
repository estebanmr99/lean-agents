// --doctor warns when an OpenCode 2 config still carries 1.x MCP names (#556). Temp HOME, stubbed commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctor } from '../scripts/lib/doctor.mjs';
import { preset } from '../scripts/lib/network.mjs';

const j = path.join;

function rowsFor(servers) {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'doctor-mcp-')));
  const dir = j(home, '.config', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(j(dir, 'opencode.jsonc'), JSON.stringify({ mcp: { servers } }, null, 2));
  const state = { version: '0', commands: [], files: [], options: { agents: ['opencode-v2'], tools: [], privacy: 'standard', network: preset('on') } };
  const run = (argv) => ({ ok: argv[0] === 'opencode', out: argv[0] === 'opencode' ? '[]' : '' });
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state, exec: true, json: true, run }); } finally { process.stdout.write = write; fs.rmSync(home, { recursive: true, force: true }); }
  return JSON.parse(out).rows;
}

test('a 2.x config with oauth.clientId or enabled gets one warning row with the 2.x names', () => {
  const rows = rowsFor({
    remote: { type: 'remote', url: 'https://mcp.example.invalid/mcp', enabled: true, oauth: { clientId: 'fake-id', clientSecret: 'fake-secret' } },
  }).filter((r) => r.item === 'opencode mcp 1.x keys');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'changed');
  assert.match(rows[0].detail, /mcp\.servers\.remote\.enabled -> disabled/);
  assert.match(rows[0].detail, /mcp\.servers\.remote\.oauth\.clientId -> oauth\.client_id/);
  assert.match(rows[0].detail, /Fix: rename to the 2\.x names/);
  assert.ok(!rows[0].detail.includes('fake-id') && !rows[0].detail.includes('fake-secret'), 'values stay out of the doctor');
});

test('a config already using the 2.x names gets no warning', () => {
  const rows = rowsFor({
    remote: { type: 'remote', url: 'https://mcp.example.invalid/mcp', disabled: true, oauth: { client_id: 'fake-id', client_secret: 'fake-secret' } },
  }).filter((r) => r.item === 'opencode mcp 1.x keys');
  assert.deepEqual(rows, []);
});