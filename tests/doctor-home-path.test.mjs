// #493: doctor shortens home paths to ~ on Windows whatever the drive letter case; POSIX stays case-sensitive.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doctor } from '../scripts/lib/doctor.mjs';
import { homeRel, tilde } from '../scripts/lib/fsops.mjs';

function rows(home, files, platform) {
  const state = { version: '0', commands: [], files, options: { agents: ['copilot-cli'], tools: [], privacy: 'standard', network: {} } };
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home, state, exec: false, json: true, platform, run: () => ({ ok: true, out: '' }) }); } finally { process.stdout.write = write; }
  return JSON.parse(out).rows.map((r) => r.item);
}

test('#493: a lowercase drive letter still prints as ~ in doctor --json (Windows)', () => {
  const items = rows('C:\\Users\\u', [{ path: 'c:\\Users\\u\\.copilot\\x.md', hash: 'h' }], 'win32');
  assert.ok(items.includes('~\\.copilot\\x.md'), items.join(' | '));
  assert.ok(!items.some((i) => /Users\\u/i.test(i)));
});

test('#493: homeRel is case-insensitive on Windows only, and stops at a path boundary', () => {
  assert.equal(homeRel('c:\\USERS\\u\\a', 'C:\\Users\\u', 'win32'), '~\\a');
  assert.equal(homeRel('C:\\Users\\u2\\a', 'C:\\Users\\u', 'win32'), 'C:\\Users\\u2\\a');
  assert.equal(homeRel('/Users/U/a', '/Users/u', 'darwin'), '/Users/U/a');
  assert.equal(homeRel('/home/u/a', '/home/u', 'linux'), '~/a');
  assert.equal(homeRel('/home/u', '/home/u', 'linux'), '~');
});

test('#493: tilde in plan and failure lines matches any case on Windows only', () => {
  assert.equal(tilde('$ x c:\\users\\u\\a C:/Users/u/b', 'C:\\Users\\u', 'win32'), '$ x ~\\a ~/b');
  assert.equal(tilde('$ x /Users/U/a', '/Users/u', 'darwin'), '$ x /Users/U/a');
});
