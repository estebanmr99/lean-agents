// OpenCode session count when the engine Node lacks node:sqlite (#201): counted in a child Node; the note names what was tried.
// The "stub" Node is process.execPath or a missing path, so nothing here needs a shell shim (Windows CI included).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { opencodeInfo } from '../scripts/lib/adopt.mjs';

const j = path.join;
const noSqlite = () => Promise.reject(new Error('no node:sqlite'));

function home({ valid = true } = {}) {
  const h = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'sessions-node-')));
  const dir = j(h, '.local', 'share', 'opencode');
  fs.mkdirSync(dir, { recursive: true });
  const file = j(dir, 'opencode.db');
  if (valid) {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE session (id TEXT); INSERT INTO session VALUES ('a'), ('b'), ('c');");
    db.close();
  } else fs.writeFileSync(file, 'not a database, synthetic');
  return { h, env: { HOME: h }, file };
}

test('node:sqlite present: counted in-process, no note', async () => {
  const { h, env } = home();
  const r = await opencodeInfo(h, env);
  assert.equal(r.sessions, 3); assert.equal(r.note, undefined);
});

test('node:sqlite missing: the tool Node counts', async () => {
  const { h, env } = home();
  const r = await opencodeInfo(h, env, fs, { toolNode: { version: '24.0.0', node: process.execPath }, sqliteImport: noSqlite });
  assert.equal(r.sessions, 3); assert.equal(r.note, undefined);
});

test('node:sqlite missing, tool Node unusable or too old: this Node with --experimental-sqlite counts', async () => {
  const { h, env } = home();
  for (const toolNode of [null, { version: '22.12.0', node: process.execPath }, { version: '24.0.0', node: j(h, 'missing-node') }]) {
    const r = await opencodeInfo(h, env, fs, { toolNode, sqliteImport: noSqlite });
    assert.equal(r.sessions, 3);
  }
});

test('node:sqlite missing and every child fails: sessions null, the note says which Node was tried', async () => {
  const { h, env, file } = home({ valid: false });
  const before = fs.readFileSync(file, 'utf8');
  const r = await opencodeInfo(h, env, fs, { toolNode: { version: '24.0.0', node: process.execPath }, sqliteImport: noSqlite });
  assert.equal(r.sessions, null);
  assert.match(r.note, /node:sqlite is not available on this Node: sessions not counted \(tried Node 24\.0\.0, .*--experimental-sqlite\)/);
  const old = await opencodeInfo(h, env, fs, { toolNode: { version: '22.12.0', node: process.execPath }, sqliteImport: noSqlite });
  assert.doesNotMatch(old.note, /22\.12\.0/); // below 22.13: not tried
  assert.equal(fs.readFileSync(file, 'utf8'), before); // the live file is untouched
});
