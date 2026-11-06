import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewer, plan, run, latestVersion } from '../scripts/version-watch.mjs';

const pins = { tool: { kind: 'npm', source: 'tool', version: '1.0.0', verified: '2026-11-05', ci: 'real-tools' }, skill: { kind: 'skill', source: 'o/r', version: 'v1.0.0', verified: '2026-11-05', ci: 'real-claude' } };

test('isNewer compares stable x.y.z only', () => {
  assert.ok(isNewer('1.0.0', '1.0.1'));
  assert.ok(isNewer('v1.9.0', 'v1.10.0'));
  assert.ok(!isNewer('1.2.0', '1.2.0'));
  assert.ok(!isNewer('2.0.0', '1.9.9'));
  assert.ok(!isNewer('1.0.0', '1.1.0-rc.1'));
});

test('latestVersion takes the highest stable tag and ignores release candidates', async () => {
  const get = async () => [{ name: 'v1.4.98-rc.9' }, { name: 'v1.4.99' }, { name: 'v1.4.100' }, { name: 'nightly' }];
  assert.equal(await latestVersion(pins.skill, get), 'v1.4.100');
});

// In-memory GitHub: issues opened by run() stay open and keep their comments.
function fakeApi() {
  const issues = [];
  return {
    issues,
    list: async () => issues.map(({ number, title, body, state }) => ({ number, title, body, state })),
    comments: async (n) => issues[n - 1].comments,
    create: async (title, body) => { issues.push({ number: issues.length + 1, title, body, state: 'open', comments: [] }); },
    comment: async (n, body) => { issues[n - 1].comments.push(body); },
  };
}

test('run: first newer version opens one issue, the next version comments, the same version does nothing', async () => {
  const api = fakeApi();
  const log = () => {};
  const withLatest = (npmVersion) => ({ get: async (url) => (url.includes('registry.npmjs.org') ? { version: npmVersion } : [{ name: 'v1.0.0' }]) });
  await run({ pins, ...withLatest('1.1.0'), api, log });
  assert.equal(api.issues.length, 1);
  assert.equal(api.issues[0].title, 'Update available: tool');
  assert.match(api.issues[0].body, /Confirmed to work: `1\.0\.0`[\s\S]*`1\.1\.0`[\s\S]*real-tools/);
  await run({ pins, ...withLatest('1.1.0'), api, log });
  assert.equal(api.issues[0].comments.length, 0);
  await run({ pins, ...withLatest('1.2.0'), api, log });
  assert.equal(api.issues.length, 1);
  assert.equal(api.issues[0].comments.length, 1);
  assert.match(api.issues[0].comments[0], /`1\.2\.0`/);
  await run({ pins, ...withLatest('1.2.0'), api, log });
  assert.equal(api.issues[0].comments.length, 1);
});

test('plan puts the pin note in the issue body', () => {
  const [a] = plan({ tool: { ...pins.tool, note: 'stay on 1.x' } }, { tool: '2.0.0' }, []);
  assert.match(a.body, /Note: stay on 1\.x/);
});

test('plan skips a pin that is current and a failed lookup', () => {
  assert.deepEqual(plan(pins, { tool: '1.0.0', skill: null }, []), []);
});

test('run: an issue the owner closed for a version is not reopened or duplicated, but the next version is reported', async () => {
  const api = fakeApi();
  const get = (v) => async (url) => (url.includes('registry.npmjs.org') ? { version: v } : [{ name: 'v1.0.0' }]);
  await run({ pins, get: get('1.1.0'), api, log: () => {} });
  api.issues[0].state = 'closed';
  await run({ pins, get: get('1.1.0'), api, log: () => {} });
  assert.equal(api.issues.length, 1);
  await run({ pins, get: get('1.2.0'), api, log: () => {} });
  assert.equal(api.issues.length, 2);
  assert.match(api.issues[1].body, /`1\.2\.0`/);
});

test('run keeps going when one lookup fails', async () => {
  const api = fakeApi();
  const get = async (url) => { if (url.includes('registry.npmjs.org')) throw new Error('down'); return [{ name: 'v1.1.0' }]; };
  const actions = await run({ pins, get, api, log: () => {} });
  assert.deepEqual(actions.map((a) => a.key), ['skill']);
});
