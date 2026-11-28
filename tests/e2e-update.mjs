#!/usr/bin/env node
// Helpers for the e2e-update workflow (#561): the pass/fail evaluator, the key-spend budget guard and transcript
// redaction. The evaluator is pure so it can be unit-tested with synthetic doctor, record and plugin-list objects.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { keySpend, redactKey, finalText } from './bench-savings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i < process.argv.length - 1 ? process.argv[i + 1] : null;
};

const readJson = (file) => {
  if (!file || !fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

const normal = (v) => String(v ?? '').replace(/^v/, '');

// The skill asks `Update these N tools?`, but a model may name the rows ("Update these 2 skill installs?"). Accept
// words and hyphens on one line plus one optional parenthetical ("(plus the config fixes above)"); a second
// question, punctuation, or anything else still fails.
const CONSENT = /^Update these \d+ [A-Za-z][A-Za-z -]{0,39}(?: \([^?()\n]{1,80}\))?\?$/i;

// A second way to ask for the same yes ("Do you want me to run it?") is redundant, not a second decision.
const RUN_ASK = /^(?:Do you want me to|Shall I|Should I|Want me to|Can I) (?:run|apply|proceed|go ahead|do)(?: it| this| that| the update| the plan)?\?$/i;

// The skill's after-update offers: the summary page (SKILL.md step 6 "Hand-off") and the optional issue draft
// (step 7). Both come after the work, so leaving one unanswered ends a non-interactive run cleanly.
export const AFTER_OFFER = /^(?=[^\n]*\bsummary(?: page|\.html)\b)[^?\n]{0,400}\b(?:Do you want me to|Would you like me to|Want me to|Shall I|Should I|Can I) open it\?$|^Draft a redacted issue for lean-agents\?$/i;

export function assistantText(transcript) {
  if (!transcript) return '';
  const order = [];
  const byMessage = new Map();
  let parsedAny = false;
  for (const line of transcript.split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    parsedAny = true;
    if (ev.type !== 'text') continue;
    const part = ev.part || ev;
    const text = String(part.text || '');
    if (!text) continue;
    const id = part.messageID || part.id || `event-${order.length}`;
    if (!byMessage.has(id)) { byMessage.set(id, ''); order.push(id); }
    byMessage.set(id, byMessage.get(id) + text);
  }
  return order.length ? order.map((id) => byMessage.get(id)).join('\n') : parsedAny ? '' : transcript;
}

// The skill's confirmation is the one question the e2e job answers for the user. Every other question, or a second
// question, means the update waited for a human.
export function questionLines(transcript) {
  if (!transcript) return [];
  return assistantText(transcript).split('\n').map((l) => l.trim()).filter(Boolean).filter((l) => /\?\s*$/.test(l));
}

export function consentDecision(transcript) {
  const questions = questionLines(transcript);
  if (!questions.length) return { action: 'none', question: null };
  const last = questions[questions.length - 1];
  if (CONSENT.test(last)) {
    const other = questions.slice(0, -1).find((q) => !RUN_ASK.test(q));
    if (!other) return { action: 'yes', question: last };
    return { action: 'fail', question: other };
  }
  return { action: 'fail', question: questions[0] };
}

// OpenCode's skill tool is `type: "tool_use"` with `part.tool: "skill"` and `part.state.input.id`. Accept any tool
// event that names the skill so a direct file read still counts as tool use, but plain assistant text does not.
export function leanUpdateCalled(transcript) {
  if (!transcript) return false;
  for (const line of transcript.split('\n')) {
    try {
      const ev = JSON.parse(line);
      if (ev.type !== 'tool_use' && ev.type !== 'tool') continue;
      if (/lean-update/i.test(JSON.stringify(ev.part || ev))) return true;
    } catch {}
  }
  return false;
}

// `--update --dry-run` only prints the plan, so it does not count as an update anywhere below.
const hasDryRun = (command) => /(^|\s)--dry-run(\s|$)/.test(command);

export const shimHasUpdateCall = (log) =>
  String(log ?? '').split('\n').some((line) => /(^|\s)--update(\s|$)/.test(line) && !hasDryRun(line));

// A shell tool can also run the checkout directly: `cd <release dir> && node scripts/lean.mjs --update`. Accept the
// literal release dir and the `$LEAN_AGENTS_RELEASE_DIR` reference the workflow exports.
export function checkoutUpdateCalled(transcript, releaseDir) {
  if (!transcript) return false;
  const targets = ['\\$\\{?LEAN_AGENTS_RELEASE_DIR\\}?'];
  if (releaseDir) targets.unshift(String(releaseDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const cd = new RegExp(`(^|\\s)cd\\s+["']?(?:${targets.join('|')})["']?(?=\\s|;|&&|\\|\\||$)`);
  for (const line of transcript.split('\n')) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type !== 'tool_use' && ev.type !== 'tool') continue;
    const part = ev.part || ev;
    const input = part.state?.input || part.input || {};
    const command = String(input.command ?? input.cmd ?? '');
    const script = command.search(/scripts[\\/]lean\.mjs/);
    const into = cd.exec(command);
    if (script >= 0 && into && into.index < script && /(^|\s)--update(\s|$)/.test(command) && !hasDryRun(command)) return true;
  }
  return false;
}

// Exit 1 is the spend cap; exit 2 means the budget API could not be read, which is a different failure.
export function budgetDecision({ used, maxUsd, error } = {}) {
  if (error) return { action: 'error', code: 2, message: `budget check failed (exit 2): ${error}` };
  if (!Number.isFinite(used) || !Number.isFinite(maxUsd)) {
    return { action: 'error', code: 2, message: 'budget check failed (exit 2): start and max_usd must be numbers' };
  }
  if (used >= maxUsd) return { action: 'kill', code: 1, message: `cap hit: key spend $${used.toFixed(4)} reached max_usd $${maxUsd.toFixed(2)}` };
  return { action: 'continue', code: 0, message: `key spend for this job: $${used.toFixed(4)} (max $${maxUsd.toFixed(2)})` };
}

const pluginRows = (list) => {
  if (Array.isArray(list)) return list;
  if (Array.isArray(list?.plugins)) return list.plugins;
  if (Array.isArray(list?.installed)) return list.installed;
  return [];
};

// A non-interactive run cannot answer a question. Any assistant message whose last line is a question means the update
// stopped to ask; the skill's own prompts are caught even when the model adds text after them. Plain text works too.
// Once the one yes turn answered the consent, a redundant run-it ask in the same first-turn text is not unanswered.
export function unansweredQuestion(transcript, { consentAnswered = false } = {}) {
  if (!transcript) return null;
  const blocks = [];
  for (const line of transcript.split('\n')) {
    try { const ev = JSON.parse(line); if (ev.type === 'text') blocks.push(String((ev.part || ev).text || '')); } catch {}
  }
  const assistant = finalText(transcript) || transcript;
  for (const block of blocks.length ? blocks : [transcript]) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last || !/\?\s*$/.test(last)) continue;
    if (consentAnswered && CONSENT.test(last)) {
      const earlier = lines.slice(0, -1).filter((l) => /\?\s*$/.test(l));
      if (earlier.every((q) => RUN_ASK.test(q))) continue;
    }
    return last;
  }
  if (consentAnswered) return null;
  const asked = assistant.match(/(?:^|\n)\s*(?:Update these \d+ [A-Za-z][A-Za-z -]{0,39}(?: \([^?()\n]{1,80}\))?\?|Draft a redacted issue for lean-agents\?)\s*(?:\n|$)/i);
  return asked ? asked[0].trim() : null;
}

// Pure: doctor JSON + install record (state.json) + `claude plugin list --json` (and the marketplace ref/pin).
export function evaluateUpdate({ doctor, record, pluginList, pluginRef, pinVersion, currentVersion, exitCode, transcript, firstTurnTranscript = null, yesTurns = 0, source = 'checkout', shimLog = '', releaseDir = null, pluginId = 'context-mode@context-mode' }) {
  const failures = [];
  if (exitCode !== 0) failures.push(`agent exited ${exitCode}`);
  if (doctor?.ok !== true) failures.push('doctor is not ok');
  if (Array.isArray(doctor?.behind) && doctor.behind.length) failures.push(`tools behind pins: ${doctor.behind.map((b) => b?.tool ?? b).join(', ')}`);
  if (!currentVersion) failures.push('current version unknown');
  else if (record?.version !== currentVersion) failures.push(`install record ${record?.version ?? 'missing'} is not ${currentVersion}`);
  if (!pinVersion) failures.push('plugin pin unknown');
  else if (normal(pluginRef) !== normal(pinVersion)) failures.push(`marketplace ref ${pluginRef ?? 'missing'} is not ${pinVersion}`);
  const plugin = pluginRows(pluginList).find((p) => p?.id === pluginId || p?.name === pluginId);
  if (!plugin) failures.push(`plugin ${pluginId} is not installed`);
  else if (normal(plugin.version) !== normal(pinVersion)) failures.push(`plugin version ${plugin.version ?? 'missing'} is not ${pinVersion}`);
  if (!leanUpdateCalled(transcript)) failures.push('lean-update skill was not called');
  if (!String(finalText(transcript ?? '')).trim()) failures.push('final assistant message is empty');
  if (source === 'checkout' && !shimHasUpdateCall(shimLog) && !checkoutUpdateCalled(transcript, releaseDir)) failures.push('no --update call ran the checkout code');

  const consent = consentDecision(firstTurnTranscript ?? transcript);
  let questions = questionLines(transcript);
  if (consent.action === 'yes') {
    if (yesTurns !== 1) failures.push(`consent question needs exactly one yes turn (got ${yesTurns})`);
    if (yesTurns === 1) {
      const i = questions.findIndex((q) => CONSENT.test(q));
      if (i >= 0) questions = questions.filter((q, j) => j > i || (!CONSENT.test(q) && !RUN_ASK.test(q)));
      if (questions.length && AFTER_OFFER.test(questions[questions.length - 1])) questions = questions.slice(0, -1);
    }
  } else if (consent.action === 'fail') {
    failures.push(`unexpected question: ${consent.question}`);
  }
  if (yesTurns > 1) failures.push(`more than one yes turn: ${yesTurns}`);
  if (questions.length) failures.push(`unanswered question: ${questions[questions.length - 1]}`);
  return { ok: failures.length === 0, failures };
}

async function spend() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  return keySpend(key);
}

async function budget() {
  const start = Number(arg('start'));
  const maxUsd = Number(arg('max-usd'));
  if (!Number.isFinite(start) || !Number.isFinite(maxUsd)) throw new Error('budget needs --start and --max-usd');
  let now;
  try {
    now = await spend();
  } catch (e) {
    const decision = budgetDecision({ error: e.message });
    console.error(decision.message);
    return decision.code;
  }
  const decision = budgetDecision({ used: Math.max(0, now - start), maxUsd });
  console.log(decision.message);
  return decision.code;
}

function consent() {
  const file = arg('transcript');
  const text = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const decision = consentDecision(text);
  console.log(decision.action === 'fail' ? `fail: ${decision.question}` : decision.action);
  return decision.action === 'fail' ? 1 : 0;
}

// Any OpenRouter-shaped key goes, not only the one in the env; an empty key fails the step so nothing is published
// on the strength of a redaction that could not match the real key (#579).
const redactAll = (text, key) => redactKey(text, key).replace(/sk-or-[A-Za-z0-9_-]{10,}/g, 'sk-or-REDACTED');

function redact() {
  const input = arg('in');
  const output = arg('out');
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) { console.error('redact: OPENROUTER_API_KEY is empty or unset'); return 1; }
  if (!input || !fs.existsSync(input)) return 0;
  const text = fs.readFileSync(input, 'utf8');
  if (output) fs.writeFileSync(output, redactAll(text, key));
  else process.stdout.write(redactAll(text, key));
  return 0;
}

function evaluate() {
  const settings = readJson(arg('settings'));
  const pluginRef = arg('plugin-ref') ?? settings?.extraKnownMarketplaces?.['context-mode']?.source?.ref ?? null;
  const transcript = (() => { const f = arg('transcript'); return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; })();
  const firstTurn = (() => { const f = arg('first-turn'); return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; })();
  const shimLog = (() => { const f = arg('shim-log'); return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; })();
  const result = evaluateUpdate({
    doctor: readJson(arg('doctor')),
    record: readJson(arg('record')),
    pluginList: readJson(arg('plugin-list')),
    pluginRef,
    pinVersion: arg('pin-version'),
    currentVersion: arg('current-version'),
    exitCode: Number(arg('exit-code') ?? 1),
    transcript,
    firstTurnTranscript: firstTurn,
    yesTurns: Number(arg('yes-turns') ?? 0),
    source: arg('source') ?? 'checkout',
    shimLog,
    releaseDir: arg('release-dir'),
  });
  if (arg('out')) fs.writeFileSync(arg('out'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

async function main() {
  const command = process.argv[2];
  if (command === 'spend') return console.log((await spend()).toFixed(6)), 0;
  if (command === 'budget') return budget();
  if (command === 'consent') return consent();
  if (command === 'redact') return redact();
  if (command === 'evaluate') return evaluate();
  console.error('usage: e2e-update.mjs spend | budget --start <usd> --max-usd <usd> | consent --transcript <file> | redact --in <file> --out <file> | evaluate --doctor <file> --record <file> --plugin-list <file> --pin-version <v> --current-version <v> --exit-code <n> --transcript <file> [--first-turn <file>] [--yes-turns <n>] [--source checkout|npm] [--shim-log <file>] [--release-dir <path>] [--settings <file>] [--out <file>]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error(e.message); process.exit(2); });
}