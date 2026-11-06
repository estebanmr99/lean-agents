import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bump } from '../scripts/pins-latest.mjs';
import { plan, run, TITLE } from '../scripts/ci-latest-report.mjs';
import { PINS, pinVersions } from '../scripts/lib/pins.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const jobs = [...ci.matchAll(/^  ([a-z0-9-]+):\n([\s\S]*?)(?=^  [a-z0-9-]+:\n|(?![\s\S]))/gm)].filter((m) => ci.indexOf(m[0]) > ci.indexOf('\njobs:'));

test('bump moves a pin forward only', async () => {
  const pins = { a: { kind: 'npm', source: 'a', version: '1.0.0' }, b: { kind: 'npm', source: 'b', version: '2.0.0' }, c: { kind: 'npm', source: 'c', version: '1.0.0' } };
  const versions = { a: '1.1.0', b: '1.9.0' };
  const moved = await bump(pins, async (url) => { const k = url.split('/').at(-2); if (!versions[k]) throw new Error('boom'); return { version: versions[k] }; });
  assert.deepEqual(moved, [{ key: 'a', from: '1.0.0', to: '1.1.0' }]);
  assert.equal(pins.b.version, '2.0.0');
  assert.equal(pins.c.version, '1.0.0');
});

test('ciOnly pins stay out of state.json pins and have a CI job', () => {
  const ciOnly = Object.entries(PINS).filter(([, p]) => p.ciOnly).map(([k]) => k);
  assert.deepEqual(ciOnly.sort(), ['claude-code', 'copilot-cli', 'opencode-v1']);
  for (const k of ciOnly) assert.ok(!(k in pinVersions()), k);
});

// In-memory GitHub, like tests/version-watch.test.mjs.
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

test('report: first failure opens one issue, a new run comments, the same run does nothing, a closed issue is replaced', async () => {
  const api = fakeApi();
  const go = (runId) => run({ api, failed: ['real-claude'], runUrl: `https://example.test/runs/${runId}`, runId }, () => {});
  await go('1');
  assert.equal(api.issues.length, 1);
  assert.equal(api.issues[0].title, TITLE);
  assert.match(api.issues[0].body, /- real-claude/);
  await go('1');
  assert.equal(api.issues[0].comments.length, 0);
  await go('2');
  assert.equal(api.issues[0].comments.length, 1);
  await go('2');
  assert.equal(api.issues[0].comments.length, 1);
  api.issues[0].state = 'closed';
  await go('3');
  assert.equal(api.issues.length, 2);
});

test('report: plan ignores other issues', () => {
  assert.equal(plan([{ number: 1, title: 'Update available: x', state: 'open', body: '', comments: [] }], { failed: ['j'], runUrl: 'u', runId: '9' }).type, 'create');
});

test('ci.yml: every job has a timeout, every real job waits for the docs-only check, and the daily run installs the latest pins', () => {
  const names = jobs.map((m) => m[1]);
  assert.ok(names.length > 20);
  for (const [, name, body] of jobs) {
    assert.match(body, /^    timeout-minutes: /m, `${name}: no timeout-minutes`);
    if (!['changes', 'lint', 'test'].includes(name)) assert.match(body, /^    needs: changes\n    if: needs\.changes\.outputs\.code == 'true'/m, `${name}: not behind the docs-only check`);
    if (/^(real-|bench-)/.test(name) && body.includes('actions/checkout')) assert.match(body, /uses: \.\/\.github\/actions\/latest-pins/, `${name}: ignores the latest run`);
  }
});

test('required checks in docs/branch-protection.md exist as jobs in ci.yml or secret-scan.yml', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'branch-protection.md'), 'utf8');
  const scan = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'secret-scan.yml'), 'utf8');
  const contexts = [...doc.matchAll(/"context": "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(contexts.length >= 8);
  for (const c of contexts) {
    const job = c.replace(/ \(.*\)$/, '');
    assert.ok(new RegExp(`^  ${job}:`, 'm').test(ci + scan), `${c}: no such job`);
  }
});
