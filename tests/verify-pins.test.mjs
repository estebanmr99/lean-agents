import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../scripts/verify-pins.mjs';

const pins = {
  a: { source: '@s/a', version: '1.0.0', integrity: 'sha512-ok', node: '>=24.0.0' },
  b: { source: 'o/b', version: 'v2.0.0', sha: 'c'.repeat(40) },
};
const upstream = (integrity, sha, node = '>=24.0.0') => async (url) => {
  if (url.includes('registry.npmjs.org')) return { dist: { integrity }, engines: { node } };
  if (url.includes('/git/ref/tags/')) return { object: { type: 'commit', sha } };
  throw new Error(`unexpected ${url}`);
};

test('verify: matching integrity and sha pass', async () => {
  assert.deepEqual(await verify(pins, upstream('sha512-ok', 'c'.repeat(40))), []);
});
test('verify: a changed or missing engines.node is reported', async () => {
  assert.match((await verify(pins, upstream('sha512-ok', 'c'.repeat(40), '>=25.0.0')))[0], /^a: engines\.node >=25\.0\.0 != pinned >=24\.0\.0/);
  const none = async (url) => (url.includes('registry.npmjs.org') ? { dist: { integrity: 'sha512-ok' } } : upstream('', 'c'.repeat(40))(url));
  assert.match((await verify(pins, none))[0], /engines\.node undefined/);
});
test('verify: a republished package or a moved tag is reported', async () => {
  const bad = await verify(pins, upstream('sha512-other', 'd'.repeat(40)));
  assert.equal(bad.length, 2);
  assert.match(bad[0], /^a: integrity/);
  assert.match(bad[1], /^b: v2\.0\.0 is d+/);
});
