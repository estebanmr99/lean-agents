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

test('a 2.x config with each stale 1.x MCP key gets one warning row with the 2.x name', () => {
  const cases = [
    ['enabled', true, 'mcp.servers.remote.enabled -> disabled'],
    ['oauth.clientId', 'fake-id', 'mcp.servers.remote.oauth.clientId -> oauth.client_id'],
    ['oauth.clientSecret', 'fake-secret', 'mcp.servers.remote.oauth.clientSecret -> oauth.client_secret'],
    ['oauth.callbackPort', 8080, 'mcp.servers.remote.oauth.callbackPort -> oauth.callback_port'],
    ['oauth.redirectUri', 'http://127.0.0.1/cb', 'mcp.servers.remote.oauth.redirectUri -> oauth.redirect_uri'],
  ];
  for (const [key, value, expected] of cases) {
    const server = { type: 'remote', url: 'https://mcp.example.invalid/mcp' };
    if (key.startsWith('oauth.')) server.oauth = { [key.slice(6)]: value }; else server[key] = value;
    const rows = rowsFor({ remote: server }).filter((r) => r.item === 'opencode mcp 1.x keys');
    assert.equal(rows.length, 1, key);
    assert.equal(rows[0].status, 'changed');
    assert.match(rows[0].detail, new RegExp(expected.replace(/[.]/g, '\\.')));
    assert.match(rows[0].detail, /Fix: run lean-agents --update/);
    assert.ok(!rows[0].detail.includes(String(value)), `${key}: value leaked into the doctor`);
  }
});

test('a config already using the 2.x names gets no warning', () => {
  const rows = rowsFor({
    remote: { type: 'remote', url: 'https://mcp.example.invalid/mcp', disabled: true, oauth: { client_id: 'fake-id', client_secret: 'fake-secret' } },
  }).filter((r) => r.item === 'opencode mcp 1.x keys');
  assert.deepEqual(rows, []);
});