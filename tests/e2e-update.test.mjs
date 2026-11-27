import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateUpdate, unansweredQuestion } from './e2e-update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const textEvent = (text) => JSON.stringify({ type: 'text', part: { text } });
const transcript = (...texts) => texts.map(textEvent).join('\n');

const good = () => ({
  doctor: { ok: true },
  record: { version: '1.2.6' },
  pluginList: [{ id: 'context-mode@context-mode', version: '2.1.7' }],
  pluginRef: 'v2.1.7',
  pinVersion: 'v2.1.7',
  currentVersion: '1.2.6',
  exitCode: 0,
  transcript: transcript('Done. lean-agents is updated.'),
});

test('e2e-update evaluator: a complete run passes and tolerates a leading v', () => {
  const r = evaluateUpdate(good());
  assert.deepEqual(r.failures, []);
  assert.equal(r.ok, true);
  const withPlainVersion = evaluateUpdate({ ...good(), pluginList: [{ id: 'context-mode@context-mode', version: 'v2.1.7' }] });
  assert.equal(withPlainVersion.ok, true);
});

test('e2e-update evaluator: every unmet condition is reported', () => {
  const bad = evaluateUpdate({
    ...good(),
    doctor: { ok: false },
    record: { version: '1.2.4' },
    pluginRef: 'v2.1.4',
    pluginList: [{ id: 'context-mode@context-mode', version: '2.1.4' }],
    exitCode: 1,
    transcript: transcript('Update these 3 tools?'),
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.failures.length, 6);
  assert.ok(bad.failures.some((f) => /agent exited 1/.test(f)));
  assert.ok(bad.failures.some((f) => /doctor is not ok/.test(f)));
  assert.ok(bad.failures.some((f) => /install record 1\.2\.4 is not 1\.2\.6/.test(f)));
  assert.ok(bad.failures.some((f) => /marketplace ref v2\.1\.4 is not v2\.1\.7/.test(f)));
  assert.ok(bad.failures.some((f) => /plugin version 2\.1\.4 is not v2\.1\.7/.test(f)));
  assert.ok(bad.failures.some((f) => /unanswered question/.test(f)));
});

test('e2e-update evaluator: tools left behind pins fail even when doctor is ok', () => {
  const r = evaluateUpdate({ ...good(), doctor: { ok: true, behind: [{ tool: 'context-mode', installed: '2.1.4', pinned: '2.1.7' }] } });
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /tools behind pins: context-mode/);
});

test('e2e-update evaluator: a missing plugin list, record and pin fail instead of throwing', () => {
  const r = evaluateUpdate({ ...good(), record: null, pluginList: null, pinVersion: null });
  assert.equal(r.ok, false);
  assert.ok(r.failures.some((f) => /install record missing/.test(f)));
  assert.ok(r.failures.some((f) => /plugin context-mode@context-mode is not installed/.test(f)));
  assert.ok(r.failures.some((f) => /plugin pin unknown/.test(f)));
});

test('e2e-update evaluator: plugin lists shaped as { plugins } work', () => {
  const r = evaluateUpdate({ ...good(), pluginList: { plugins: [{ name: 'context-mode@context-mode', version: '2.1.7' }] } });
  assert.equal(r.ok, true, r.failures.join('; '));
});

test('e2e-update evaluator: a final question means the run waited for a human', () => {
  const r = evaluateUpdate({ ...good(), transcript: transcript('Done.\n\nAnything else?') });
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /unanswered question: Anything else\?/);
});

test('e2e-update evaluator: a question in an earlier message still counts', () => {
  const r = evaluateUpdate({ ...good(), transcript: transcript('Which release should I use?', 'Done. lean-agents is updated.') });
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /unanswered question: Which release should I use\?/);
});

test('unansweredQuestion: plain text transcripts also count, and a clean report returns null', () => {
  assert.equal(unansweredQuestion('line one\nUpdate these 3 tools?'), 'Update these 3 tools?');
  assert.equal(unansweredQuestion('line one\nAll checks passed.'), null);
  assert.equal(unansweredQuestion(''), null);
});

test('e2e-update workflow: manual only, read-only token, capped budget and pinned actions', () => {
  const file = path.join(ROOT, '.github', 'workflows', 'e2e-update.yml');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(text, /^  (push|pull_request|schedule):/m);
  assert.match(text, /^permissions:\n  contents: read$/m);
  assert.match(text, /max_usd:[\s\S]*?default: '0.5'/);
  assert.match(text, /from_version:[\s\S]*?default: '1\.2\.4'/);
  assert.match(text, /model:[\s\S]*?default: 'openrouter\/deepseek\/deepseek-v4\.1-flash-1017'/);
  assert.match(text, /opencode run --agent build/);
  assert.match(text, /opencode serve --service/);
  assert.match(text, /ci-install-opencode-v2\.sh[\s\S]*?export PATH="\$HOME\/\.opencode\/bin/);
  assert.match(text, /name: Start the OpenCode service[\s\S]*?OPENROUTER_API_KEY: \${{ secrets\.OPENROUTER_API_KEY }}/);
  assert.match(text, /service did not start/);
  assert.match(text, /name: Record the key spend at job start/);
  assert.doesNotMatch(text, /spend-before-agent/);
  assert.match(text, /\[ -f "\$E2E_RAW\/\$name" \] \|\| continue/);
  assert.match(text, /\.agents\/skills\/lean-update\/SKILL\.md/);
  assert.match(text, /tests\/e2e-update\.mjs evaluate/);
  assert.doesNotMatch(text, /echo\s+.*OPENROUTER_API_KEY/);
  assert.doesNotMatch(text, /set -x/);
});