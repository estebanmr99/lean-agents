// The summary model is built from synthetic state, doctor rows and applied output; every text goes through redactText.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummary } from '../scripts/lib/summary-data.mjs';
import { loginRows } from '../scripts/lib/logins.mjs';
import { tildePath } from './helpers/home-path.mjs';

const home = '/opt/lean-home';
const applied = {
  ok: false,
  files: ['.claude/CLAUDE.md', '.config/opencode/opencode.json'],
  commands: [{ desc: 'install rtk', ok: true, exit: 0 }, { desc: `install tool in ${home}/bin`, ok: false, exit: 1 }],
  errors: [`install tool in ${home}/bin failed for dev@example.com`],
  version: '0.9.0',
};
const rows = [
  { item: 'lean-agents', status: 'ok', detail: 'v0.9.0' },
  { item: '~/.claude/CLAUDE.md', status: 'changed', detail: 'edited since install' },
  { item: 'Copilot extension', status: 'skipped', detail: 'managed by VS Code' },
  { item: 'claude on PATH', status: 'error', detail: `not found in ${home}/bin token=ghp_abcdefgh12345678` }, // gitleaks:allow (fake value: the test asserts it is never printed)
];
const logins = loginRows({ agents: ['claude'], gh: true, exec: false });

test('model groups installed, kept, skipped, updated and the doctor result', () => {
  const m = buildSummary({ rows, applied, logins, updated: ['claude'], home, env: {} });
  assert.deepEqual(m.summary.installed, ['.claude/CLAUDE.md', '.config/opencode/opencode.json', 'install rtk']);
  assert.deepEqual(m.summary.kept, [tildePath('.claude', 'CLAUDE.md')]);
  assert.deepEqual(m.summary.skipped, ['Copilot extension']);
  assert.deepEqual(m.summary.updated, ['claude']);
  assert.equal(m.ok, false);
  assert.deepEqual(m.summary.doctor.counts, { ok: 1, changed: 1, skipped: 1, error: 1 });
  assert.equal(m.summary.doctor.problems.length, 1);
  assert.equal(m.version, '0.9.0');
  assert.deepEqual(m.action.logins.map((l) => l.command), ['gh auth login', 'claude auth login']);
});

test('no home path, email or token survives anywhere in the model', () => {
  const s = JSON.stringify(buildSummary({ rows, applied, logins, home, env: {} }));
  assert.doesNotMatch(s, /\/opt\/lean-home|example\.com|ghp_/);
  assert.match(s, /~\/bin/);
});

test('env values are redacted too', () => {
  const env = { HTTPS_PROXY: 'http://proxy.internal.test:8080' };
  const m = buildSummary({ rows: [{ item: 'x', status: 'error', detail: 'via http://proxy.internal.test:8080' }], home, env });
  assert.doesNotMatch(JSON.stringify(m), /proxy\.internal\.test/);
});

test('fresh machine: empty input gives an ok, empty model', () => {
  const m = buildSummary({});
  assert.equal(m.ok, true);
  assert.deepEqual(m.summary.installed, []);
  assert.deepEqual(m.action.logins, []);
});

test('state version is the fallback when applied has none', () => {
  assert.equal(buildSummary({ state: { version: '1.2.3' } }).version, '1.2.3');
});
