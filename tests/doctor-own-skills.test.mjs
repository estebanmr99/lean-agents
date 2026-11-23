// --doctor: identical skill copies lean-agents installed itself are reported as ok, not note (#368).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { doctor, ownSkills } from '../scripts/lib/doctor.mjs';
import { leanUpdateCommands } from '../scripts/lib/lean-update.mjs';
import { preset } from '../scripts/lib/network.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-own-skills-'));

function runDoctor(home, state) {
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state, exec: false, json: true, env: {}, platform: 'linux', fsx: fs }); } finally { process.stdout.write = write; }
  return JSON.parse(out);
}

test('ownSkills: null state gives empty set, lean-update command record derives lean-update', () => {
  assert.equal(ownSkills(null).size, 0);
  assert.equal(ownSkills({}).size, 0);

  const cmd = leanUpdateCommands(['claude'])[0];
  const state = { commands: [cmd] };
  const own = ownSkills(state);
  assert.ok(own.has('lean-update'));

  // Saved records keep only desc/ok/undo; other `remove` commands must not count.
  const saved = ownSkills({ commands: [
    { desc: 'Caveman skills for Claude Code', ok: true, undo: [['npx', '-y', 'skills@1.7.4', 'remove', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'claude-code', '-g', '-y']] },
    { desc: 'other', ok: true, undo: [['npm', 'remove', '-g', 'my-skills-tool']] },
  ] });
  assert.deepEqual([...saved].sort(), ['caveman', 'caveman-compress', 'caveman-stats']);
});

test('duplicate skills: identical own skill copies are ok, differing copies are changed, unmanaged identical copies are note', () => {
  const h = tmp();
  const put = (dir, name, text) => {
    const d = path.join(h, dir, 'skills', name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), text);
  };

  put('.agents', 'lean-update', 'same content');
  put('.claude', 'lean-update', 'same content');

  put('.agents', 'diff-own', 'content 1');
  put('.claude', 'diff-own', 'content 2');

  put('.agents', 'unmanaged', 'same content');
  put('.claude', 'unmanaged', 'same content');

  const diffCmd = {
    desc: 'diff-own skill',
    ok: true,
    run: [['npx', '-y', 'skills@1.4.1', 'add', 'https://example.com/repo', '--skill', 'diff-own', '-a', 'claude-code', '-g', '-y']],
    undo: [['npx', '-y', 'skills@1.4.1', 'remove', 'diff-own', '-g', '-y']],
  };

  const state = {
    version: '0',
    commands: [{ ...leanUpdateCommands(['claude'])[0], ok: true }, diffCmd],
    files: [],
    options: { agents: ['claude'], tools: [], privacy: 'standard', network: preset('on') },
  };

  const r = runDoctor(h, state);
  const rows = Object.fromEntries(r.rows.filter((x) => x.item.startsWith('duplicate skill ')).map((x) => [x.item.slice(16), x]));

  assert.equal(rows['lean-update'].status, 'ok');
  assert.match(rows['lean-update'].detail, /identical copies that lean-agents installed \(the Skills CLI writes one per agent folder\)/);

  assert.equal(rows['diff-own'].status, 'changed');
  assert.match(rows['diff-own'].detail, /the copies differ/);

  assert.equal(rows.unmanaged.status, 'note');
  assert.match(rows.unmanaged.detail, /the copies are identical/);
  assert.match(rows.unmanaged.detail, /Keep one folder/);

  assert.equal(r.ok, true);
});
