import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bump } from '../scripts/pins-latest.mjs';
import { bump as bumpPins, render } from '../scripts/bump-pins.mjs';
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

test('bump skips a held pin, logs one held line, and still bumps an unheld pin', async () => {
  const text = '{\n  "pins": {\n    "held": { "kind": "npm", "source": "held-pkg", "version": "1.19.0", "hold": "owner decision" },\n    "free": { "kind": "npm", "source": "free-pkg", "version": "1.0.0" }\n  }\n}';
  const get = async () => ({ time: { '1.19.0': '2026-01-01T00:00:00Z', '2.0.0': '2026-10-01T00:00:00Z' } });
  const logs = [];
  const { text: out, changes } = await bumpPins({ text, get, now: Date.parse('2026-11-10T00:00:00Z'), log: (m) => logs.push(m) });
  assert.deepEqual(changes.map((c) => c.key), ['free']);
  assert.deepEqual(logs, ['held: held 1.19.0 (owner decision)']);
  assert.equal(JSON.parse(out).pins.held.version, '1.19.0');
  assert.equal(JSON.parse(out).pins.free.version, '2.0.0');
});

test('bump fills node from the new version and the PR table flags a raised floor and one above lean floor', async () => {
  const text = '{\n  "pins": {\n    "codeburn": { "kind": "npm", "source": "codeburn", "version": "0.9.27", "verified": "2026-11-05", "node": ">=22.13.0", "ci": "real-tools", "integrity": "sha512-old" },\n    "ctx": { "kind": "npm", "source": "ctx", "version": "2.1.4", "verified": "2026-11-05", "node": ">=24.15.0", "ci": "real-claude", "integrity": "sha512-old" }\n  }\n}';
  const engines = { codeburn: '>=22.15.0', ctx: '>=24.15.0' };
  const get = async (url) => {
    if (/\/(0\.9\.28|2\.1\.7)$/.test(url)) return { dist: { integrity: 'sha512-new' }, engines: { node: engines[url.split('/').at(-2)] } };
    return { time: url.endsWith('/codeburn') ? { '0.9.27': '2026-01-01T00:00:00Z', '0.9.28': '2026-10-01T00:00:00Z' } : { '2.1.4': '2026-01-01T00:00:00Z', '2.1.7': '2026-10-01T00:00:00Z' } };
  };
  const { text: out, changes } = await bumpPins({ text, get, now: Date.parse('2026-11-10T00:00:00Z'), log: () => {} });
  assert.equal(JSON.parse(out).pins.codeburn.node, '>=22.15.0');
  const body = render(changes);
  assert.match(body, /\| codeburn \| 0\.9\.27 \| 0\.9\.28 \| >=22\.13\.0 → >=22\.15\.0 ⚠ raised \|/);
  assert.match(body, /\| ctx \| 2\.1\.4 \| 2\.1\.7 \| >=24\.15\.0 → >=24\.15\.0 ⚠ above lean floor \|/);
});

test('ciOnly pins stay out of state.json pins and have a CI job', () => {
  const ciOnly = Object.entries(PINS).filter(([, p]) => p.ciOnly).map(([k]) => k);
  assert.deepEqual(ciOnly.sort(), ['claude-code', 'copilot-cli', 'opencode-v1', 'opencode-v2']);
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
    if (!['changes', 'lint', 'test'].includes(name)) assert.match(body, /^    needs: (changes|\[changes, [a-z-]+\])\n    if: needs\.changes\.outputs\.code == 'true'/m, `${name}: not behind the docs-only check`);
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

test('changes job: only docs, assets and root Markdown count as docs-only', () => {
  const re = new RegExp(ci.match(/grep -qvE '([^']+)'/)[1].replace(/\\\./g, '\\.'));
  const codeFor = (files) => files.some((f) => !re.test(f));
  assert.equal(codeFor(['docs/SPEC.md', 'README.md', 'CHANGELOG.md', 'assets/a.png']), false);
  for (const f of ['core/AGENTS.md', 'skills/token-audit/SKILL.md', 'core/agents/explore.md', '.github/workflows/ci.yml', 'scripts/lean.mjs']) assert.equal(codeFor([f]), true, f);
});
