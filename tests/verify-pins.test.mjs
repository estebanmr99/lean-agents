import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../scripts/verify-pins.mjs';

const pins = {
  a: { source: '@s/a', version: '1.0.0', integrity: 'sha512-ok' },
  b: { source: 'o/b', version: 'v2.0.0', sha: 'c'.repeat(40) },
};
const upstream = (integrity, sha) => async (url) => {
  if (url.includes('registry.npmjs.org')) return { dist: { integrity } };
  if (url.includes('/git/ref/tags/')) return { object: { type: 'commit', sha } };
  throw new Error(`unexpected ${url}`);
};

test('verify: matching integrity and sha pass', async () => {
  assert.deepEqual(await verify(pins, upstream('sha512-ok', 'c'.repeat(40))), []);
});
test('verify: a republished package or a moved tag is reported', async () => {
  const bad = await verify(pins, upstream('sha512-other', 'd'.repeat(40)));
  assert.equal(bad.length, 2);
  assert.match(bad[0], /^a: integrity/);
  assert.match(bad[1], /^b: v2\.0\.0 is d+/);
});
