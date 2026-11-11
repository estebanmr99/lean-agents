// arrayAdd with `legacy`: a pin lean-agents wrote earlier (recorded in state) moves to the new pin on rerun.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { plan, apply, undo } from '../scripts/lib/fsops.mjs';

const edit = (value) => ({ path: ['plugin'], value, mode: 'arrayAdd', legacy: ['@scope/pkg'] });

function setup(initial) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-arrayadd-'));
  const file = path.join(home, 'opencode.jsonc');
  if (initial !== undefined) fs.writeFileSync(file, initial);
  const backups = path.join(home, 'backups');
  let files = [];
  // One engine run; state.files accumulates like lean.mjs does.
  const run = (value, stamp) => {
    const planned = plan([{ kind: 'json', path: file, edits: [edit(value)] }], [home], files);
    files = [...files, ...apply(planned, path.join(backups, stamp), home, [home])];
    return planned;
  };
  const list = () => JSON.parse(fs.readFileSync(file, 'utf8')).plugin;
  return { home, file, run, list, files: () => files };
}

test('a pin we wrote moves to the new pin, one entry, uninstall removes it', () => {
  const t = setup();
  t.run('@scope/pkg@1.0.0', 'a');
  assert.deepEqual(t.list(), ['@scope/pkg@1.0.0']);
  t.run('@scope/pkg@2.0.0', 'b');
  assert.deepEqual(t.list(), ['@scope/pkg@2.0.0']);
  t.run('@scope/pkg@2.0.0', 'c');
  assert.deepEqual(t.list(), ['@scope/pkg@2.0.0']);
  undo(t.files(), [t.home]);
  assert.ok(!fs.existsSync(t.file) || !JSON.parse(fs.readFileSync(t.file, 'utf8')).plugin?.includes('@scope/pkg@2.0.0'));
});

test('a rerun leaves no backup of a file we created; a file the user edited still gets one', () => {
  const t = setup();
  t.run('@scope/pkg@1.0.0', 'a');
  t.run('@scope/pkg@2.0.0', 'b');
  assert.ok(!fs.existsSync(path.join(t.home, 'backups', 'b')));
  fs.writeFileSync(t.file, JSON.stringify({ plugin: ['@scope/pkg@2.0.0'], mine: 1 }));
  t.run('@scope/pkg@3.0.0', 'c');
  assert.ok(fs.existsSync(path.join(t.home, 'backups', 'c')));
});

test('a version the user typed stays, even next to our state', () => {
  const t = setup('{ "plugin": ["@scope/pkg@9.9.9", "other"] }\n');
  const planned = t.run('@scope/pkg@2.0.0', 'a');
  assert.deepEqual(t.list(), ['@scope/pkg@9.9.9', 'other']);
  assert.match(planned[0].note, /kept your values/);
});

test('user entry survives bump and uninstall of a pre-existing list', () => {
  const t = setup('{ "plugin": ["other"] }\n');
  t.run('@scope/pkg@1.0.0', 'a');
  t.run('@scope/pkg@2.0.0', 'b');
  assert.deepEqual(t.list(), ['other', '@scope/pkg@2.0.0']);
  undo(t.files(), [t.home]);
  assert.deepEqual(t.list(), ['other']);
});
