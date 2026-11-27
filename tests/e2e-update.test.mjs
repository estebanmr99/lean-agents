import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateUpdate, unansweredQuestion, consentDecision, leanUpdateCalled, shimHasUpdateCall, checkoutUpdateCalled, budgetDecision, questionLines } from './e2e-update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const textEvent = (text) => JSON.stringify({ type: 'text', part: { text, messageID: `m${++textEvent.seq}` } });
textEvent.seq = 0;
const transcript = (...texts) => texts.map((text) => textEvent(text)).join('\n');
const toolEvent = (tool, input) => JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool, state: { status: 'completed', input } } });
const skillEvent = () => toolEvent('skill', { id: 'lean-update' });

const good = () => ({
  doctor: { ok: true },
  record: { version: '1.2.6' },
  pluginList: [{ id: 'context-mode@context-mode', version: '2.1.7' }],
  pluginRef: 'v2.1.7',
  pinVersion: 'v2.1.7',
  currentVersion: '1.2.6',
  exitCode: 0,
  transcript: [skillEvent(), transcript('Done. lean-agents is updated.')].join('\n'),
  yesTurns: 0,
  source: 'checkout',
  shimLog: 'lean-agents --update --yes\n',
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
    shimLog: '',
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.failures.length >= 6);
  assert.ok(bad.failures.some((f) => /agent exited 1/.test(f)));
  assert.ok(bad.failures.some((f) => /doctor is not ok/.test(f)));
  assert.ok(bad.failures.some((f) => /install record 1\.2\.4 is not 1\.2\.6/.test(f)));
  assert.ok(bad.failures.some((f) => /marketplace ref v2\.1\.4 is not v2\.1\.7/.test(f)));
  assert.ok(bad.failures.some((f) => /plugin version 2\.1\.4 is not v2\.1\.7/.test(f)));
  assert.ok(bad.failures.some((f) => /lean-update skill was not called/.test(f)));
  assert.ok(bad.failures.some((f) => /no --update call ran the checkout code/.test(f)));
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
  const r = evaluateUpdate({ ...good(), transcript: [skillEvent(), transcript('Done.\n\nAnything else?')].join('\n') });
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /unexpected question: Anything else\?/);
});

test('e2e-update evaluator: a question in an earlier message still counts', () => {
  const r = evaluateUpdate({ ...good(), transcript: [skillEvent(), transcript('Which release should I use?', 'Done. lean-agents is updated.')].join('\n') });
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /unexpected question: Which release should I use\?/);
});

test('unansweredQuestion: plain text transcripts also count, and a clean report returns null', () => {
  assert.equal(unansweredQuestion('line one\nUpdate these 3 tools?'), 'Update these 3 tools?');
  assert.equal(unansweredQuestion('line one\nAll checks passed.'), null);
  assert.equal(unansweredQuestion(''), null);
});

test('consentDecision: only the skill confirmation is answered by the one yes turn', () => {
  assert.deepEqual(consentDecision('plan\nUpdate these 3 tools?'), { action: 'yes', question: 'Update these 3 tools?' });
  assert.deepEqual(consentDecision('Done. lean-agents is updated.'), { action: 'none', question: null });
  assert.equal(consentDecision('Which release should I use?').action, 'fail');
  assert.equal(consentDecision('Update these 3 tools?\nAnything else?').action, 'fail');
  assert.deepEqual(questionLines('Update these 3 tools?\nAnything else?'), ['Update these 3 tools?', 'Anything else?']);
});

test('consentDecision: text deltas of one assistant message are joined before the question check', () => {
  const deltas = [
    JSON.stringify({ type: 'text', part: { text: 'Update these ', messageID: 'same' } }),
    JSON.stringify({ type: 'text', part: { text: '3 tools?', messageID: 'same' } }),
  ].join('\n');
  assert.equal(consentDecision(deltas).action, 'yes');
});

test('e2e-update evaluator: one consent question plus one yes turn passes', () => {
  const first = transcript('Here is the plan.\n\nUpdate these 3 tools?');
  const r = evaluateUpdate({
    ...good(),
    transcript: [skillEvent(), first, transcript('Done. lean-agents is updated.')].join('\n'),
    firstTurnTranscript: first,
    yesTurns: 1,
  });
  assert.equal(r.ok, true, r.failures.join('; '));
});

test('e2e-update evaluator: an unanswered or repeated consent question fails', () => {
  const first = transcript('Here is the plan.\n\nUpdate these 3 tools?');
  const base = { ...good(), transcript: [skillEvent(), first, transcript('Done. lean-agents is updated.')].join('\n'), firstTurnTranscript: first };
  assert.match(evaluateUpdate({ ...base, yesTurns: 0 }).failures.join(' '), /needs exactly one yes turn \(got 0\)/);
  assert.match(evaluateUpdate({ ...base, yesTurns: 2 }).failures.join(' '), /more than one yes turn: 2/);
});

test('e2e-update evaluator: the lean-update skill must be called, and the final message must not be empty', () => {
  assert.equal(leanUpdateCalled(good().transcript), true);
  assert.equal(leanUpdateCalled(transcript('I used the lean-update skill.')), false);
  assert.equal(leanUpdateCalled(''), false);
  const noSkill = evaluateUpdate({ ...good(), transcript: transcript('Done. lean-agents is updated.') });
  assert.match(noSkill.failures.join(' '), /lean-update skill was not called/);
  const empty = evaluateUpdate({ ...good(), transcript: skillEvent() });
  assert.match(empty.failures.join(' '), /final assistant message is empty/);
});

test('e2e-update evaluator: checkout needs an --update call through the shim, npm does not', () => {
  assert.equal(shimHasUpdateCall('lean-agents --update --yes'), true);
  assert.equal(shimHasUpdateCall('npx -y lean-agents@1.2.6 --update --yes'), true);
  assert.equal(shimHasUpdateCall('lean-agents --doctor --json'), false);
  assert.match(evaluateUpdate({ ...good(), shimLog: '' }).failures.join(' '), /no --update call ran the checkout code/);
  const npm = evaluateUpdate({ ...good(), source: 'npm', shimLog: '' });
  assert.equal(npm.ok, true, npm.failures.join('; '));
});

test('e2e-update evaluator: a shell tool that runs --update inside the release dir also passes', () => {
  const releaseDir = path.join('/opt', 'lean-agents');
  const command = `cd "${releaseDir}" && node scripts/lean.mjs --update --yes`;
  const r = evaluateUpdate({
    ...good(),
    shimLog: '',
    releaseDir,
    transcript: [skillEvent(), toolEvent('bash', { command }), transcript('Done. lean-agents is updated.')].join('\n'),
  });
  assert.equal(r.ok, true, r.failures.join('; '));
  assert.equal(checkoutUpdateCalled(toolEvent('bash', { command: 'cd "$LEAN_AGENTS_RELEASE_DIR" && node scripts/lean.mjs --update --yes' }), releaseDir), true);
});

test('e2e-update evaluator: a shell tool that only ran --doctor does not pass', () => {
  const releaseDir = path.join('/opt', 'lean-agents');
  const r = evaluateUpdate({
    ...good(),
    shimLog: '',
    releaseDir,
    transcript: [skillEvent(), toolEvent('bash', { command: `cd "${releaseDir}" && node scripts/lean.mjs --doctor --json` }), transcript('Done. lean-agents is updated.')].join('\n'),
  });
  assert.equal(r.ok, false);
  assert.match(r.failures.join(' '), /no --update call ran the checkout code/);
});

test('budgetDecision: below the cap continues, at or above it kills, an API error is exit 2', () => {
  assert.equal(budgetDecision({ used: 0.25, maxUsd: 0.5 }).code, 0);
  assert.equal(budgetDecision({ used: 0.5, maxUsd: 0.5 }).code, 1);
  assert.match(budgetDecision({ used: 0.9, maxUsd: 0.5 }).message, /cap hit/);
  const api = budgetDecision({ error: 'key usage unavailable (HTTP 503)' });
  assert.equal(api.code, 2);
  assert.match(api.message, /budget check failed \(exit 2\)/);
  assert.equal(budgetDecision({ used: 0.1, maxUsd: 0.5 }).action, 'continue');
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
  assert.match(text, /source:[\s\S]*?default: 'checkout'[\s\S]*?- checkout[\s\S]*?- npm/);
  assert.match(text, /from_version must be a semver version/);
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
  // Job-level env must not set HOME (only the prepare step exports it through GITHUB_ENV).
  assert.doesNotMatch(text, /^    env:$/m);
});

test('e2e-update workflow: the service state comes from status output, not its exit code', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-update.yml'), 'utf8');
  assert.match(text, /svc_state\(\) \{ opencode service status 2>\/dev\/null \| head -1; \}/);
  assert.match(text, /\[ "\$\(svc_state\)" = stopped \]/);
  assert.match(text, /\[ "\$state" != stopped \]/);
  assert.doesNotMatch(text, /if ! opencode service status/);
  assert.match(text, /ps -eo pid,args \| awk '\/\[o\]pencode serve --service\/\{print \$1\}'/);
  assert.match(text, /kill \$pids/);
  assert.doesNotMatch(text, /pkill|killall/);
  assert.match(text, /--- service status ---[\s\S]*?service-ps\.txt/);
});

test('e2e-update workflow: every agent run has a per-run timeout that fails the run', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-update.yml'), 'utf8');
  assert.match(text, /timeout 1800 "\$@"/);
  assert.match(text, /\[ "\$code" -eq 124 \]/);
  assert.match(text, /::error::opencode run timed out/);
});

test('e2e-update workflow: HOME and artifacts live under RUNNER_TEMP, not next to the checkout', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-update.yml'), 'utf8');
  assert.doesNotMatch(text, /github\.workspace\s*\}\}\/\.\./);
  assert.match(text, /name: Prepare the throwaway home[\s\S]*?mkdir -p "\$HOME"/);
  assert.match(text, /echo "HOME=\$HOME"[\s\S]*?>> "\$GITHUB_ENV"/);
  assert.match(text, /path: \$\{\{ runner\.temp \}\}\/e2e-out\//);
});

test('e2e-update workflow: checkout mode serves the packed branch and the branch skill', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-update.yml'), 'utf8');
  assert.match(text, /npm pack --silent/);
  assert.match(text, /checkout-prefix\/bin\/lean-agents/);
  assert.match(text, /shim\/npx/);
  assert.match(text, /shim\.log/);
  assert.match(text, /LEAN_AGENTS_RELEASE_DIR/);
  assert.match(text, /cp -R skills\/lean-update\/\./);
  assert.match(text, /export PATH="\$E2E_RAW\/shim:\$PATH"/);
  assert.match(text, /gh release view/);
});

test('e2e-update workflow: the spend watchdog polls every 20 s and kills only the run PID', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-update.yml'), 'utf8');
  assert.match(text, /run_watched\(\)/);
  assert.match(text, /sleep 20/);
  assert.match(text, /kill "\$run_pid"/);
  assert.match(text, /cap hit:/);
  assert.match(text, /budget check failed \(exit 2\)/);
  assert.doesNotMatch(text, /pkill/);
  assert.match(text, /budget --start "\$start" --max-usd "\$MAX_USD"/);
});

test('e2e-update workflow: one consent turn, then the evaluator checks every pass rule', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'e2e-update.yml'), 'utf8');
  assert.match(text, /opencode run --continue --agent build/);
  assert.match(text, /consent --transcript/);
  assert.match(text, /E2E_RAW\/yes-turns/);
  assert.match(text, /--first-turn "\$E2E_RAW\/transcript-first\.jsonl"/);
  assert.match(text, /--yes-turns "\$yes_turns"/);
  assert.match(text, /--source "\$SOURCE"/);
  assert.match(text, /--shim-log "\$E2E_RAW\/shim\.log"/);
});