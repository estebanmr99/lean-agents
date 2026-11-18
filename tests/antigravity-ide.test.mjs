// Antigravity IDE folders and the VS Code extension are detected by existence only (#216). Temp HOME, no real agy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { antigravityFootprint } from '../scripts/lib/system.mjs';
import { inventory } from '../scripts/lib/adopt.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';

const j = path.join;
const tmp = () => fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'lean-agy-ide-')));
function seed(home) {
  for (const d of ['antigravity-ide', 'antigravity-cli', 'antigravity']) fs.mkdirSync(j(home, '.gemini', d), { recursive: true });
  fs.mkdirSync(j(home, '.vscode', 'extensions', 'google.google-antigravity-1.0.0'), { recursive: true });
  fs.mkdirSync(j(home, '.vscode', 'extensions', 'other.ext-1.0.0'), { recursive: true });
}
const names = (list) => list.map((f) => f.name);

test('footprint: empty HOME finds nothing, seeded HOME finds folders and the extension', () => {
  const home = tmp();
  assert.deepEqual(antigravityFootprint(home), []);
  seed(home);
  assert.deepEqual(names(antigravityFootprint(home)), ['antigravity-ide', 'antigravity-cli', 'antigravity (legacy)', 'vscode extension Google.google-antigravity']);
});

test('adopt lists them as user-owned, keep, and writes nothing', async () => {
  const home = tmp();
  seed(home);
  const tree = () => fs.readdirSync(home, { recursive: true }).sort().join();
  const before = tree();
  const r = await inventory({ home, env: { PATH: '' }, platform: process.platform, realHome: '/nowhere' });
  const ide = r.items.filter((i) => i.kind === 'ide');
  assert.equal(ide.length, 4);
  assert.ok(ide.every((i) => i.owner === 'user' && i.action === 'keep' && i.client === 'antigravity'));
  assert.equal(tree(), before);
});

function doctorRows(home) {
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state: null, exec: false, json: true, run: () => ({ ok: true, out: '' }) }); } finally { process.stdout.write = write; }
  return JSON.parse(out).rows;
}

test('doctor: one row when found, none when absent', () => {
  const home = tmp();
  assert.equal(doctorRows(home).some((r) => r.item === 'antigravity ide'), false);
  seed(home);
  const row = doctorRows(home).find((r) => r.item === 'antigravity ide');
  assert.equal(row.status, 'ok');
  assert.match(row.detail, /antigravity-ide.*Google\.google-antigravity/);
});

test('doctor lists the Antigravity proxy and CA variables as set or not set, never values', () => {
  const keep = { ...process.env };
  for (const n of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'NODE_USE_SYSTEM_CA', 'http_proxy', 'https_proxy', 'no_proxy']) delete process.env[n];
  process.env.SSL_CERT_FILE = '/opt/x/ca-secret.pem';
  try {
    const net = doctorRows(tmp()).filter((r) => r.item === 'network env').map((r) => r.detail);
    assert.ok(net.includes('SSL_CERT_FILE=set'));
    for (const n of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA']) assert.ok(net.includes(`${n}=not set`), n);
    assert.equal(net.some((l) => l.includes('ca-secret')), false);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in keep)) delete process.env[k];
    Object.assign(process.env, keep);
  }
});
