// --adopt flags a skill one client reads from two folders (#176), also when the copies are links.
// Synthetic temp HOME; nothing real is read. Skill name: demo-skill.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../scripts/lib/adopt.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
const skip = process.platform === 'win32' && 'symlinks need privileges on Windows';
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const skillRows = (r) => r.items.filter((i) => i.kind === 'skill' && i.name === 'demo-skill');
const run = (h) => inventory({ home: h, env: { HOME: h, PATH: '/usr/bin' }, platform: process.platform, realHome: '/nowhere' });

// dirs: which of .agents, .claude, .cursor hold the skill; 'link' makes all but .agents links to the .agents folder.
function home(dirs, mode = 'copy', texts = {}) {
  const h = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'dupes-')));
  const real = j(h, '.agents', 'skills', 'demo-skill');
  if (dirs.includes('.agents')) put(j(real, 'SKILL.md'), texts['.agents'] ?? 'demo\n');
  for (const d of dirs.filter((x) => x !== '.agents')) {
    const at = j(h, d, 'skills', 'demo-skill');
    if (mode === 'link') { fs.mkdirSync(path.dirname(at), { recursive: true }); fs.symlinkSync(real, at); }
    else put(j(at, 'SKILL.md'), texts[d] ?? 'demo\n');
  }
  return h;
}

test('work-PC layout as real copies: all three folders are flagged, with clients, hashes and the fix', { skip }, async () => {
  const rows = skillRows(await run(home(['.agents', '.claude', '.cursor'])));
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.status.includes('duplicate')); assert.equal(r.action, 'ask');
    assert.equal(r.differs, false); assert.equal(r.linked, false);
    assert.match(r.fix, /keep one folder \(e\.g\. ~\/\.agents\/skills\)/); assert.match(r.fix, /after a backup/);
  }
  const by = Object.fromEntries(rows.map((r) => [r.file.split('/')[1], r.clients])); // each folder: the clients that read it together with another copy
  assert.deepEqual(by, { '.agents': ['cursor', 'opencode'], '.claude': ['opencode'], '.cursor': ['cursor'] });
  const hashes = Object.values(rows.find((r) => r.file.startsWith('~/.agents')).hashes);
  assert.equal(hashes.length, 3); // the .agents row sees all three folders
  assert.ok(hashes.every((x) => /^[0-9a-f]{8}$/.test(x) && x === hashes[0]));
});

test('work-PC layout as links to one folder (the Skills CLI layout) is still flagged', { skip }, async () => {
  const rows = skillRows(await run(home(['.agents', '.claude', '.cursor'], 'link')));
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.status.includes('duplicate') && r.linked === true && r.differs === false));
  assert.match(rows[0].fix, /links/);
});

test('copies that differ say so, with a different short hash per folder', { skip }, async () => {
  const rows = skillRows(await run(home(['.agents', '.claude'], 'copy', { '.claude': 'older\n' })));
  assert.ok(rows.every((r) => r.status.includes('duplicate') && r.differs === true && r.clients.join() === 'opencode'));
  assert.equal(new Set(Object.values(rows[0].hashes)).size, 2);
});

test('~/.claude/skills + ~/.cursor/skills alone: no client reads both, so nothing is flagged', { skip }, async () => {
  const rows = skillRows(await run(home(['.claude', '.cursor'])));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => !r.status.includes('duplicate') && r.action === 'keep'));
});

test('the CLI text row names the clients and the fix; env is only PATH, NVM_DIR and HOME', { skip }, () => {
  const h = home(['.agents', '.claude']);
  const env = { PATH: process.env.PATH, NVM_DIR: j(h, '.nvm'), HOME: h };
  const text = spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt'], { encoding: 'utf8', env }).stdout;
  assert.match(text, /skill demo-skill {2}\[duplicate\]/);
  assert.match(text, /opencode loads it twice/);
  assert.match(text, /keep one folder/);
});

test('--adopt --yes --confirm-removals never deletes a link target', { skip }, () => {
  const h = home(['.agents', '.claude'], 'link');
  const env = { PATH: process.env.PATH, NVM_DIR: j(h, '.nvm'), HOME: h };
  spawnSync(process.execPath, [LEAN, '--home', h, '--no-exec', '--adopt', '--yes', '--confirm-removals'], { encoding: 'utf8', env });
  assert.ok(fs.existsSync(j(h, '.agents', 'skills', 'demo-skill', 'SKILL.md')));
  assert.ok(fs.existsSync(j(h, '.claude', 'skills', 'demo-skill', 'SKILL.md')));
});
