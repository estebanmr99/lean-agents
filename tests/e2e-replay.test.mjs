// Replays the 1.3.0 proof artifacts (runs 4 to 9) through the current evaluator, so an evaluator change
// is caught by `npm test` instead of a ~15 min CI dispatch. Fixtures are redacted copies of the e2e-update
// artifact; see tests/fixtures/e2e/README.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateUpdate } from './e2e-update.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'e2e');
const SKILL = fs.readFileSync(path.join(ROOT, 'skills', 'lean-update', 'SKILL.md'), 'utf8');

// The values the workflow passed when these artifacts were collected: the branch under test was 1.2.5 and
// core/pins.json pinned context-mode 2.1.7. The marketplace ref is v2.1.4 in the stopped runs (the update
// never moved it) and v2.1.7 in the completed ones.
const PIN_VERSION = 'v2.1.7';
const CURRENT_VERSION = '1.2.5';
const RELEASE_DIR = '/tmp/x/work/lean-agents/lean-agents';

const fixture = (run, file) => fs.readFileSync(path.join(FIXTURES, `run${run}`, file), 'utf8');
const fixtureJson = (run, file) => JSON.parse(fixture(run, file));

const replay = (run, { pluginRef, yesTurns }) => evaluateUpdate({
  doctor: fixtureJson(run, 'doctor.json'),
  record: fixtureJson(run, 'record.json'),
  pluginList: fixtureJson(run, 'plugin-list.json'),
  pluginRef,
  pinVersion: PIN_VERSION,
  currentVersion: CURRENT_VERSION,
  exitCode: 0,
  transcript: fixture(run, 'transcript.jsonl'),
  firstTurnTranscript: fixture(run, 'transcript-first.jsonl'),
  yesTurns,
  source: 'checkout',
  shimLog: fixture(run, 'shim.log'),
  releaseDir: RELEASE_DIR,
});

// Runs 7, 8 and 9 were product passes found only after an evaluator fix. Runs 4, 5 and 6 were product
// failures; the current evaluator must keep saying so for the reason in the comment.
const RUNS = [
  {
    run: 4,
    pluginRef: 'v2.1.4',
    yesTurns: 0,
    // rtk refused inside OpenCode, so the update never ran.
    failures: [
      'doctor is not ok',
      'tools behind pins: lean-update',
      'install record 1.2.4 is not 1.2.5',
      'marketplace ref v2.1.4 is not v2.1.7',
      'plugin version 2.1.4 is not v2.1.7',
      'no --update call ran the checkout code',
    ],
  },
  {
    run: 5,
    pluginRef: 'v2.1.4',
    yesTurns: 0,
    // The consent was paraphrased ("Update these 2 skill installs ...?"), so the job sent no yes.
    failures: [
      'doctor is not ok',
      'tools behind pins: lean-update',
      'install record 1.2.4 is not 1.2.5',
      'marketplace ref v2.1.4 is not v2.1.7',
      'plugin version 2.1.4 is not v2.1.7',
      'no --update call ran the checkout code',
      'consent question needs exactly one yes turn (got 0)',
      'unanswered question: Update these 2 skill installs (plus the config fixes above)?',
    ],
  },
  {
    run: 6,
    pluginRef: 'v2.1.4',
    yesTurns: 0,
    // A second question ("Do you want me to run it?") before the consent meant no yes was sent.
    failures: [
      'doctor is not ok',
      'tools behind pins: lean-update',
      'install record 1.2.4 is not 1.2.5',
      'marketplace ref v2.1.4 is not v2.1.7',
      'plugin version 2.1.4 is not v2.1.7',
      'no --update call ran the checkout code',
      'consent question needs exactly one yes turn (got 0)',
      'unanswered question: Update these 1 tools?',
    ],
  },
  // `cd "$LEAN_AGENTS_RELEASE_DIR"; ...` (semicolon) is a real update call (fixed in #582).
  { run: 7, pluginRef: 'v2.1.7', yesTurns: 1, failures: [] },
  // The step-6 summary-page offer is allowed as the last question (fixed in #583).
  { run: 8, pluginRef: 'v2.1.7', yesTurns: 1, failures: [] },
  { run: 9, pluginRef: 'v2.1.7', yesTurns: 1, failures: [] },
];

for (const expected of RUNS) {
  test(`e2e replay: run ${expected.run} is ${expected.failures.length ? 'not ok' : 'ok'}`, () => {
    const result = replay(expected.run, expected);
    assert.deepEqual(result.failures, expected.failures);
    assert.equal(result.ok, expected.failures.length === 0);
  });
}

// --- Prescribed questions from skills/lean-update/SKILL.md ---------------------------------------------
// Each test extracts its wording from the skill, so a rewording breaks the test instead of silently
// letting the e2e job drift away from the evaluator.

const textEvent = (text) => JSON.stringify({ type: 'text', part: { text, messageID: `m${++textEvent.seq}` } });
textEvent.seq = 0;
const transcript = (...texts) => texts.map((text) => textEvent(text)).join('\n');
const skillEvent = () => JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'skill', state: { status: 'completed', input: { id: 'lean-update' } } } });

const good = () => ({
  doctor: { ok: true },
  record: { version: CURRENT_VERSION },
  pluginList: [{ id: 'context-mode@context-mode', version: '2.1.7' }],
  pluginRef: 'v2.1.7',
  pinVersion: 'v2.1.7',
  currentVersion: CURRENT_VERSION,
  exitCode: 0,
  transcript: [skillEvent(), transcript('Done. lean-agents is updated.')].join('\n'),
  yesTurns: 0,
  source: 'checkout',
  shimLog: 'lean-agents --update --yes\n',
});

const skillConsent = () => SKILL.match(/ask the question word for word: `([^`]+)`/)?.[1];
const skillIssueDraft = () => SKILL.match(/Ask: "([^"]+)"/)?.[1];

// One consent turn, then one assistant message after the yes. The last line is the offer under test.
const afterYes = (lastLine) => {
  const first = transcript(`Here is the plan.\n\n${skillConsent().replace('N', '3')}`);
  return evaluateUpdate({
    ...good(),
    transcript: [skillEvent(), first, transcript(`Done. lean-agents is updated.\n\n${lastLine}`)].join('\n'),
    firstTurnTranscript: first,
    yesTurns: 1,
  });
};

test('prescribed question: consent `Update these N tools?` fails when no yes turn follows', () => {
  assert.equal(skillConsent(), 'Update these N tools?');
  const first = transcript(`Here is the plan.\n\n${skillConsent().replace('N', '3')}`);
  const result = evaluateUpdate({ ...good(), transcript: [skillEvent(), first].join('\n'), firstTurnTranscript: first, yesTurns: 0 });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /needs exactly one yes turn \(got 0\)/);
});

test('prescribed question: a run-it ask after the yes is unanswered; the skill asks no second question', () => {
  // #581 removed the extra run-it question: the consent is the only question before the run, so an ask
  // that arrives after the yes is a question the non-interactive job cannot answer.
  assert.match(SKILL, /ask no other question in that message/);
  const result = afterYes('Do you want me to run it?');
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /unanswered question: Do you want me to run it\?/);
});

test('prescribed question: the step-6 summary-page offer is allowed as the last line after the yes', () => {
  // The skill prescribes the question word for word (#579); the test pins it.
  assert.ok(SKILL.includes('`The summary page is at <path>. Want me to open it?`'));
  const result = afterYes('The summary page is at /tmp/x/summary.html. Want me to open it?');
  assert.equal(result.ok, true, result.failures.join('; '));
});

test('prescribed question: the restore offer only follows a failed read-back, so that run is not ok', () => {
  // No quoted question in the skill for this offer either: pin the exact sentence it is based on.
  assert.ok(SKILL.includes('keep the backup, say where it is, and offer to restore.'));
  const result = evaluateUpdate({
    ...good(),
    doctor: { ok: false, behind: [{ tool: 'context-mode', installed: '2.1.4', pinned: '2.1.7' }] },
    transcript: [
      skillEvent(),
      transcript(`Here is the plan.\n\n${skillConsent().replace('N', '3')}`),
      transcript('The read-back still shows a tool behind. Do you want me to restore the backup?'),
    ].join('\n'),
    firstTurnTranscript: transcript(`Here is the plan.\n\n${skillConsent().replace('N', '3')}`),
    yesTurns: 1,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join(' '), /unanswered question: The read-back still shows a tool behind\. Do you want me to restore the backup\?/);
});

test('prescribed question: the issue-draft ask is allowed as the last line after the yes', () => {
  assert.equal(skillIssueDraft(), 'Draft a redacted issue for lean-agents?');
  const result = afterYes(skillIssueDraft());
  assert.equal(result.ok, true, result.failures.join('; '));
});