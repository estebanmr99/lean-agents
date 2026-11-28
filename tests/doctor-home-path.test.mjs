// #493: doctor shortens home paths to ~ on Windows whatever the drive letter case; POSIX stays case-sensitive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doctor } from '../scripts/lib/doctor.mjs';
import { homeRel, tilde } from '../scripts/lib/fsops.mjs';

function rows(home, files, platform, json = true) {
  const state = { version: '0', commands: [], files, options: { agents: ['copilot-cli'], tools: [], privacy: 'standard', network: {} } };
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state, exec: false, json, platform, run: () => ({ ok: true, out: '' }) }); } finally { process.stdout.write = write; }
  return json ? JSON.parse(out).rows.map((r) => r.item) : out;
}

test('#493: a lowercase drive letter still prints as ~ in doctor --json (Windows)', () => {
  const items = rows('D:\\Data\\me', [{ path: 'd:\\Data\\me\\.copilot\\x.md', hash: 'h' }], 'win32');
  assert.ok(items.includes('~\\.copilot\\x.md'), items.join(' | ')); // literal-tilde: doctor win32 path contract
  assert.ok(!items.some((i) => /Data\\me/i.test(i)));
  const text = rows('D:\\Data\\me', [{ path: 'd:\\Data\\me\\.copilot\\x.md', hash: 'h' }], 'win32', false);
  assert.match(text, /~\\\.copilot\\x\.md/); // literal-tilde: explicit win32 doctor output
  assert.doesNotMatch(text, /Data\\me/i);
});

test('#493: homeRel is case-insensitive on Windows only, and stops at a path boundary', () => {
  assert.equal(homeRel('d:\\DATA\\ME\\a', 'D:\\Data\\me', 'win32'), '~\\a'); // literal-tilde: explicit win32 contract
  assert.equal(homeRel('D:\\Data\\me2\\a', 'D:\\Data\\me', 'win32'), 'D:\\Data\\me2\\a');
  assert.equal(homeRel('/Srv/ME/a', '/Srv/me', 'darwin'), '/Srv/ME/a');
  assert.equal(homeRel('/srv/me/a', '/srv/me', 'linux'), '~/a'); // literal-tilde: explicit linux contract
  assert.equal(homeRel('/srv/me', '/srv/me', 'linux'), '~');
  assert.equal(homeRel('/srv/me/a', '/srv/me/', 'linux'), '~/a'); // literal-tilde: explicit linux contract
});

test('#493: tilde in plan and failure lines matches any case on Windows only', () => {
  assert.equal(tilde('$ x d:\\data\\me\\a D:/Data/me/b', 'D:\\Data\\me', 'win32'), '$ x ~\\a ~/b'); // literal-tilde: explicit win32 tilde contract
  assert.equal(tilde('$ x /Srv/ME/a', '/Srv/me', 'darwin'), '$ x /Srv/ME/a');
});
