// Pins for tools lean-agents cannot install at a fixed version (rtk, uv, gh, the Antigravity cask) and for Bun (#182, #147). Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PINS, pinVersions, toolPins } from '../scripts/lib/pins.mjs';
import { latestVersion, isNewer, notesUrl } from '../scripts/version-watch.mjs';
import { bump } from '../scripts/bump-pins.mjs';

const KEYS = ['rtk', 'uv', 'gh', 'jq', 'antigravity-cask', 'bun'];

test('rtk, uv, gh, the Antigravity cask and Bun are tracked with a source, version and check date', () => {
  assert.deepEqual(toolPins().map((t) => t.key).sort(), [...KEYS].sort());
  for (const k of KEYS) {
    assert.match(PINS[k].version, /^v?\d+\.\d+\.\d+$/, k);
    assert.match(PINS[k].verified, /^\d{4}-\d{2}-\d{2}$/, k);
    assert.ok(PINS[k].source && PINS[k].ci, k);
  }
  for (const k of ['rtk', 'uv', 'gh']) assert.ok(!isNewer(PINS[k].version, PINS[k].min), `${k}: min is not above the known-good version`);
});

test('tool, cask and download pins stay out of state.json pins', () => {
  for (const k of KEYS) assert.equal(pinVersions()[k], undefined, k);
});

test('latestVersion reads tags, a tag prefix and the brew cask', async () => {
  const get = async (url) => {
    if (url.includes('formulae.brew.sh')) return { version: '1.6.0,123456' };
    return [{ name: 'dev-9.9.9-rc.1' }, { name: 'bun-v1.5.0' }, { name: 'bun-v1.4.4' }, { name: 'v2.0.0' }];
  };
  assert.equal(await latestVersion({ kind: 'cask', source: 'antigravity-cli' }, get), '1.6.0');
  assert.equal(await latestVersion({ kind: 'download', source: 'oven-sh/bun', tagPrefix: 'bun-' }, get), 'v1.5.0');
  assert.equal(await latestVersion({ kind: 'tool', source: 'cli/cli' }, get), 'v2.0.0');
  assert.equal(notesUrl({ kind: 'download', source: 'oven-sh/bun', tagPrefix: 'bun-' }, 'v1.5.0'), 'https://github.com/oven-sh/bun/releases/tag/bun-v1.5.0');
});

test('daily bump moves a tool pin after 14 days, and never touches the cask or Bun', async () => {
  const text = JSON.stringify({ pins: {
    uv: { kind: 'tool', source: 'astral-sh/uv', version: '0.13.7', min: '0.13.7', verified: '2026-11-01', ci: 'real-tools' },
    cask: { kind: 'cask', source: 'antigravity-cli', version: '1.5.11', verified: '2026-11-01', ci: 'real-antigravity' },
    bun: { kind: 'download', source: 'oven-sh/bun', tagPrefix: 'bun-', version: '1.4.4', verified: '2026-11-01', ci: 'real-bun', sha256: {} },
  } }, null, 2).replace(/^ {4}"(uv|cask|bun)"/gm, '    "$1"').replace(/\n {6}/g, ' ').replace(/\n {4}\}/g, ' }');
  const get = async (url) => {
    if (url.includes('/releases/tags/')) return { published_at: '2026-11-02T00:00:00Z' };
    return [{ name: '0.13.9' }];
  };
  const r = await bump({ text, get, now: Date.parse('2026-11-18T00:00:00Z'), today: '2026-11-18', log: () => {} });
  assert.deepEqual(r.changes.map((c) => [c.key, c.to]), [['uv', '0.13.9']]);
  assert.match(r.text, /"min": "0.13.7"/);
});
