import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketplaceDrift, parseLsRemote } from '../scripts/lib/marketplace-sha.mjs';

const sha = (c) => c.repeat(40);
const pins = {
  'ponytail-plugin': { kind: 'marketplace', source: 'DietrichGebert/ponytail', version: 'v5.3.3', sha: sha('a') },
  'context-mode-plugin': { kind: 'marketplace', source: 'mksglu/context-mode', version: 'v2.1.7', sha: sha('b') },
  'npm-thing': { kind: 'npm', source: 'x/npm', version: '1.0.0' },
};

test('marketplaceDrift: matching tags are not drift', () => {
  const resolve = (repo, tag) => ({ 'DietrichGebert/ponytail': sha('a'), 'mksglu/context-mode': sha('b') })[repo];
  assert.deepEqual(marketplaceDrift(pins, resolve), []);
});

test('marketplaceDrift: a moved tag is reported with pinned and actual shas', () => {
  const resolve = (repo) => (repo === 'mksglu/context-mode' ? sha('c') : sha('a'));
  assert.deepEqual(marketplaceDrift(pins, resolve), [
    { key: 'context-mode-plugin', tag: 'v2.1.7', pinned: sha('b'), actual: sha('c') },
  ]);
});

test('marketplaceDrift: a tag that cannot be resolved throws', () => {
  const resolve = (repo) => { if (repo === 'mksglu/context-mode') throw new Error('no tag v2.1.7'); return sha('a'); };
  assert.throws(() => marketplaceDrift(pins, resolve), /no tag v2\.1\.7/);
});

test('marketplaceDrift: an unvalidated repo or tag never reaches the resolver', () => {
  const resolve = () => { throw new Error('resolver must not run'); };
  assert.throws(() => marketplaceDrift({ x: { kind: 'marketplace', source: 'a/b; rm -rf /', version: 'v1', sha: sha('a') } }, resolve), /bad marketplace repo or tag/);
  assert.throws(() => marketplaceDrift({ x: { kind: 'marketplace', source: 'a/b', version: 'v1 $(id)', sha: sha('a') } }, resolve), /bad marketplace repo or tag/);
});

test('marketplaceDrift: a marketplace pin without a sha fails instead of being skipped', () => {
  const resolve = () => sha('a');
  assert.throws(() => marketplaceDrift({ x: { kind: 'marketplace', source: 'a/b', version: 'v1' } }, resolve), /no sha/);
});

test('parseLsRemote: an annotated tag uses the peeled sha', () => {
  const out = `${sha('d')}\trefs/tags/v1.0.0\n${sha('e')}\trefs/tags/v1.0.0^{}\n`;
  assert.equal(parseLsRemote(out, 'v1.0.0'), sha('e'));
  assert.equal(parseLsRemote(`${sha('d')}\trefs/tags/v1.0.0\n`, 'v1.0.0'), sha('d'));
  assert.equal(parseLsRemote('', 'v1.0.0'), undefined);
});