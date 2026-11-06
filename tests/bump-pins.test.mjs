import test from 'node:test';
import assert from 'node:assert/strict';
import { pickVersion, applyBump, bump } from '../scripts/bump-pins.mjs';

const NOW = Date.parse('2026-11-06T00:00:00Z');
const ago = (d) => new Date(NOW - d * 86400000).toISOString();
const npm = { kind: 'npm', source: '@scope/tool', version: '1.0.0', verified: '2026-10-01', ci: 'real-tools' };
const skill = { kind: 'skill', source: 'o/r', version: 'v1.0.0', verified: '2026-10-01', ci: 'real-claude' };

test('npm: newest stable version at least 14 days old; younger and prerelease versions are skipped', async () => {
  const get = async () => ({ time: { created: ago(99), '1.0.0': ago(60), '1.1.0': ago(20), '1.2.0': ago(3), '1.3.0-rc.1': ago(30) } });
  assert.deepEqual(await pickVersion(npm, get, NOW), { version: '1.1.0', date: ago(20).slice(0, 10) });
});

test('skill: the newest tag needs a release at least 14 days old', async () => {
  const get = (published) => async (url) => (url.includes('/tags?') ? [{ name: 'v1.1.0' }] : { published_at: published });
  assert.equal((await pickVersion(skill, get(ago(15)), NOW)).version, 'v1.1.0');
  assert.equal(await pickVersion(skill, get(ago(2)), NOW), null);
});

test('applyBump edits one pin line and keeps the rest byte for byte', () => {
  const text = '{\n  "pins": {\n    "a": { "version": "1.0.0", "verified": "2026-10-01", "ci": "x" },\n    "b": { "version": "1.0.0", "verified": "2026-10-01", "ci": "x" }\n  }\n}\n';
  const out = applyBump(text, 'a', '1.1.0', '2026-11-06');
  assert.equal(out, text.replace('"a": { "version": "1.0.0", "verified": "2026-10-01"', '"a": { "version": "1.1.0", "verified": "2026-11-06"'));
});

test('bump leaves lean-update alone, reports failures and moves nothing when nothing is newer', async () => {
  const text = JSON.stringify({ pins: { tool: npm, 'lean-update': { ...skill, version: 'v0.7.0' }, broken: { ...npm, source: 'broken' } } }, null, 2);
  const get = async (url) => { if (url.includes('broken')) throw new Error('404'); return { time: { '1.1.0': ago(20) } }; };
  const logs = [];
  const { changes, text: out } = await bump({ text, get, now: NOW, log: (l) => logs.push(l) });
  assert.deepEqual(changes.map((c) => [c.key, c.from, c.to]), [['tool', '1.0.0', '1.1.0']]);
  assert.equal(JSON.parse(out).pins['lean-update'].version, 'v0.7.0');
  assert.match(logs[0], /^! broken/);
});
