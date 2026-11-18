// Login rows use injected probes: no real command runs, no credential is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginRows } from '../scripts/lib/logins.mjs';
import { quiet } from '../scripts/lib/system.mjs';

const stub = (ok = true) => { const calls = []; return { calls, run: (argv) => { calls.push(argv); return { ok, out: 'user@example.com ghp_abcdefgh12345678' }; }, have: () => true }; };
const by = (rows, tool) => rows.find((r) => r.tool === tool);

test('exec off: command text only, nothing runs', () => {
  const s = stub();
  const rows = loginRows({ agents: ['claude', 'opencode-v2', 'copilot-cli', 'antigravity', 'vscode-copilot'], gh: true, exec: false, ...s });
  assert.deepEqual(rows.map((r) => r.tool), ['gh', 'claude', 'opencode', 'copilot', 'antigravity', 'vscode-copilot']);
  assert.ok(rows.every((r) => r.state === 'unknown' && r.login));
  assert.equal(s.calls.length, 0);
});

test('only gh and claude have a verified read-only status command', () => {
  const s = stub(true);
  const rows = loginRows({ agents: ['claude', 'opencode-v1', 'copilot-cli', 'antigravity'], gh: true, exec: true, ...s });
  assert.deepEqual(s.calls, [['gh', 'auth', 'status'], ['claude', 'auth', 'status']]);
  assert.equal(by(rows, 'gh').state, 'ok');
  assert.equal(by(rows, 'claude').state, 'ok');
  for (const t of ['opencode', 'copilot', 'antigravity']) assert.equal(by(rows, t).state, 'unknown');
});

test('a failing status means needed; a missing binary stays unknown', () => {
  assert.equal(by(loginRows({ gh: true, exec: true, ...stub(false) }), 'gh').state, 'needed');
  assert.equal(by(loginRows({ gh: true, exec: true, run: stub().run, have: () => null }), 'gh').state, 'unknown');
});

test('outbound off: no probe runs', () => {
  const s = stub();
  assert.equal(by(loginRows({ gh: true, exec: true, outbound: 'off', ...s }), 'gh').state, 'unknown');
  assert.equal(s.calls.length, 0);
});

test('rows never carry probe output', () => {
  const rows = loginRows({ agents: ['claude'], gh: true, exec: true, ...stub() });
  assert.doesNotMatch(JSON.stringify(rows), /example\.com|ghp_/);
});

test('no agents and no gh: empty checklist', () => {
  assert.deepEqual(loginRows({ exec: true, ...stub() }), []);
});

test('a probe that timed out or was killed is unknown, not needed (#284)', () => {
  const run = () => ({ ok: false, failed: true, out: '' });
  assert.equal(by(loginRows({ gh: true, exec: true, run, have: () => true }), 'gh').state, 'unknown');
  // the real probe wrapper marks a timeout as failed and a plain non-zero exit as an answer
  assert.equal(quiet([process.execPath, '-e', 'setTimeout(() => {}, 5000)'], 300).failed, true);
  const no = quiet([process.execPath, '-e', 'process.exit(1)']);
  assert.deepEqual([no.ok, no.failed], [false, false]);
});
