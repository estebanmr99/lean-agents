// Release notes "Tool versions": the pins diff and previous-tag lookup, on synthetic pins documents (no git, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffPins, toolVersionsTable } from '../scripts/lib/pins-diff.mjs';
import { previousTag, toolVersionsSection } from '../scripts/release.mjs';

const doc = (pins) => ({ note: 'x', pins });
const prev = doc({
  alpha: { kind: 'npm', version: '1.0.0' },
  beta: { kind: 'skill', version: 'v2.0.0', sha: 'aaa' },
  gone: { kind: 'npm', version: '0.1.0' },
  same: { kind: 'npm', version: '3.0.0' },
  oc: { kind: 'npm', version: '1.19.0', ciOnly: true, hold: 'stay' },
  installer: { kind: 'download', version: 'script', sha256: 'old' },
});
const next = doc({
  alpha: { kind: 'npm', version: '1.1.0' },
  beta: { kind: 'skill', version: 'v2.0.0', sha: 'bbb' },
  fresh: { kind: 'marketplace', version: 'v0.1.0' },
  same: { kind: 'npm', version: '3.0.0' },
  oc: { kind: 'npm', version: '1.20.0', ciOnly: true, hold: 'stay' },
  installer: { kind: 'download', version: 'script', sha256: 'new' },
});

test('diffPins lists bumped, added and removed pins by name and skips unchanged versions', () => {
  assert.deepEqual(diffPins(prev, next), [
    { name: 'alpha', from: '1.0.0', to: '1.1.0', kind: 'npm', change: 'bumped', held: false, ciOnly: false },
    { name: 'fresh', from: null, to: 'v0.1.0', kind: 'marketplace', change: 'added', held: false, ciOnly: false },
    { name: 'gone', from: '0.1.0', to: null, kind: 'npm', change: 'removed', held: false, ciOnly: false },
    { name: 'oc', from: '1.19.0', to: '1.20.0', kind: 'npm', change: 'bumped', held: true, ciOnly: true },
  ]);
});

test('diffPins has nothing to say without a previous document or without changes', () => {
  assert.deepEqual(diffPins(null, next), []);
  assert.deepEqual(diffPins({ note: 'old format' }, next), []);
  assert.deepEqual(diffPins(next, next), []);
  assert.deepEqual(diffPins(doc({}), doc({})), []);
});

test('toolVersionsTable renders one row per change with held and CI-only marks', () => {
  assert.equal(toolVersionsTable([]), '');
  assert.equal(toolVersionsSection(null, next), '');
  assert.equal(toolVersionsSection(next, next), '');
  assert.equal(toolVersionsSection(prev, next), [
    '## Tool versions',
    '',
    '| Tool | From | To | Note |',
    '| --- | --- | --- | --- |',
    '| alpha | 1.0.0 | 1.1.0 |  |',
    '| fresh | - | v0.1.0 | new |',
    '| gone | 0.1.0 | - | removed |',
    '| oc | 1.19.0 | 1.20.0 | held, CI only |',
  ].join('\n'));
});

test('previousTag picks the highest release tag below the version, numerically', () => {
  const tags = ['v0.9.0', 'v0.10.0', 'v0.8.0', 'v1.0.0', 'v1.0.0-rc.1', 'nightly', ''];
  assert.equal(previousTag(tags, '1.0.0'), 'v0.10.0');
  assert.equal(previousTag(tags, '0.10.0'), 'v0.9.0');
  assert.equal(previousTag(tags, '1.1.0'), 'v1.0.0');
  assert.equal(previousTag(tags, '0.8.0'), null);
  assert.equal(previousTag([''], '0.1.0'), null);
});
