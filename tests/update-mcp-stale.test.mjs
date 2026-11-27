// --update renames leftover 1.x MCP keys in an already-2.x config (#556). Temp HOME, no real binaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { undo } from '../scripts/lib/fsops.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function lean(home, args) {
  const env = { PATH: path.dirname(process.execPath), HOME: home, ...(process.env.NVM_DIR && { NVM_DIR: process.env.NVM_DIR }) };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}

function seededHome(snippet) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'update-mcp-stale-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--lang', 'en']);
  const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  const original = `{
  // keep this comment
  "mcp": {
    "servers": {
      "remote": {
        "type": "remote",
        "url": "https://mcp.example.invalid/mcp",
        ${snippet}
      }
    }
  }
}
`;
  fs.writeFileSync(file, original);
  return { home, file, original };
}

const cases = [
  ['oauth.clientId', '"oauth": { "clientId": "{env:CLIENT_ID}" }', (s) => assert.deepEqual(s.oauth, { client_id: '{env:CLIENT_ID}' })],
  ['oauth.clientSecret', '"oauth": { "clientSecret": "{env:CLIENT_SECRET}" }', (s) => assert.deepEqual(s.oauth, { client_secret: '{env:CLIENT_SECRET}' })],
  ['oauth.callbackPort', '"oauth": { "callbackPort": 8080 }', (s) => assert.deepEqual(s.oauth, { callback_port: 8080 })],
  ['oauth.redirectUri', '"oauth": { "redirectUri": "http://127.0.0.1/cb" }', (s) => assert.deepEqual(s.oauth, { redirect_uri: 'http://127.0.0.1/cb' })],
  ['enabled:false', '"enabled": false', (s) => { assert.equal(s.disabled, true); assert.equal(s.enabled, undefined); }],
  ['enabled:true', '"enabled": true', (s) => assert.equal(s.enabled, undefined)],
];

test('--update renames each leftover 1.x key in mcp.servers, plans nothing again, and undo restores the bytes', () => {
  for (const [label, snippet, check] of cases) {
    const s = seededHome(snippet);
    lean(s.home, ['--update', '--yes', '--no-exec']);
    const text = fs.readFileSync(s.file, 'utf8');
    assert.match(text, /\/\/ keep this comment/, `${label}: comment kept`);
    check(parse(text).mcp.servers.remote);
    assert.ok(!text.includes('"clientId"') && !text.includes('"clientSecret"') && !text.includes('"callbackPort"') && !text.includes('"redirectUri"'), `${label}: no 1.x oauth key left`);
    const after = fs.readFileSync(s.file, 'utf8');
    const dry = lean(s.home, ['--update', '--yes', '--no-exec', '--dry-run', '--json']);
    const row = JSON.parse(dry).files.find((f) => path.basename(f.path) === 'opencode.jsonc');
    assert.equal(row.status, 'unchanged', `${label}: second --update plans nothing`);
    lean(s.home, ['--update', '--yes', '--no-exec']);
    assert.equal(fs.readFileSync(s.file, 'utf8'), after, `${label}: second --update changes nothing`);
    // Same journal --uninstall and --update --undo reverse: the latest entry for this file.
    const state = JSON.parse(fs.readFileSync(path.join(s.home, '.config', 'lean-agents', 'state.json'), 'utf8'));
    const entry = state.files.filter((f) => f.path === s.file).at(-1);
    undo([entry], [path.dirname(s.file)]);
    assert.equal(fs.readFileSync(s.file, 'utf8'), s.original, `${label}: undo restores the original bytes`);
    fs.rmSync(s.home, { recursive: true, force: true });
  }
});

test('--update removes enabled:true from a seeded managed 2.x MCP entry', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'update-mcp-enabled-'));
  lean(home, ['--yes', '--no-exec', '--agents', 'opencode-v2', '--tools', 'playwright', '--lang', 'en']);
  const file = path.join(home, '.config', 'opencode', 'opencode.jsonc');
  const conf = parse(fs.readFileSync(file, 'utf8'));
  conf.mcp.servers.playwright.enabled = true;
  fs.writeFileSync(file, JSON.stringify(conf));
  lean(home, ['--update', '--yes', '--no-exec']);
  const entry = parse(fs.readFileSync(file, 'utf8')).mcp.servers.playwright;
  assert.equal(entry.enabled, undefined);
  assert.ok(Array.isArray(entry.command) && entry.command.length, 'the managed command stays');
  fs.rmSync(home, { recursive: true, force: true });
});

test('--update keeps a snake_case target that already exists and reports the skipped stale key', () => {
  const s = seededHome('"oauth": { "clientId": "{env:OLD}", "client_id": "{env:NEW}" }');
  const out = lean(s.home, ['--update', '--yes', '--no-exec']);
  assert.match(out, /left stale keys alone: mcp\.servers\.remote\.oauth\.clientId \(oauth\.client_id already set\)/);
  assert.deepEqual(parse(fs.readFileSync(s.file, 'utf8')).mcp.servers.remote.oauth, { clientId: '{env:OLD}', client_id: '{env:NEW}' });
  fs.rmSync(s.home, { recursive: true, force: true });
});