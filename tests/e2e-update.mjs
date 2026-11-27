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

const pluginRows = (list) => {
  if (Array.isArray(list)) return list;
  if (Array.isArray(list?.plugins)) return list.plugins;
  if (Array.isArray(list?.installed)) return list.installed;
  return [];
};

// A non-interactive run cannot answer a question. Any assistant message whose last line is a question means the update
// stopped to ask; the skill's own prompts are caught even when the model adds text after them. Plain text works too.
export function unansweredQuestion(transcript) {
  if (!transcript) return null;
  const blocks = [];
  for (const line of transcript.split('\n')) {
    try { const ev = JSON.parse(line); if (ev.type === 'text') blocks.push(String((ev.part || ev).text || '')); } catch {}
  }
  const assistant = finalText(transcript) || transcript;
  for (const block of blocks.length ? blocks : [transcript]) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (last && /\?\s*$/.test(last)) return last;
  }
  const asked = assistant.match(/(?:^|\n)\s*(?:Update these \d+ tools\?|Draft a redacted issue for lean-agents\?)\s*(?:\n|$)/i);
  return asked ? asked[0].trim() : null;
}

// Pure: doctor JSON + install record (state.json) + `claude plugin list --json` (and the marketplace ref/pin).
export function evaluateUpdate({ doctor, record, pluginList, pluginRef, pinVersion, currentVersion, exitCode, transcript, pluginId = 'context-mode@context-mode' }) {
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
  const question = unansweredQuestion(transcript);
  if (question) failures.push(`unanswered question: ${question}`);
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
  const now = await spend();
  const used = Math.max(0, now - start);
  console.log(`key spend for this job: $${used.toFixed(4)} (max $${maxUsd.toFixed(2)})`);
  return used < maxUsd ? 0 : 1;
}

function redact() {
  const input = arg('in');
  const output = arg('out');
  const key = process.env.OPENROUTER_API_KEY;
  if (!input || !fs.existsSync(input)) return;
  const text = fs.readFileSync(input, 'utf8');
  if (output) fs.writeFileSync(output, redactKey(text, key));
  else process.stdout.write(redactKey(text, key));
}

function evaluate() {
  const settings = readJson(arg('settings'));
  const pluginRef = arg('plugin-ref') ?? settings?.extraKnownMarketplaces?.['context-mode']?.source?.ref ?? null;
  const result = evaluateUpdate({
    doctor: readJson(arg('doctor')),
    record: readJson(arg('record')),
    pluginList: readJson(arg('plugin-list')),
    pluginRef,
    pinVersion: arg('pin-version'),
    currentVersion: arg('current-version'),
    exitCode: Number(arg('exit-code') ?? 1),
    transcript: (() => { const f = arg('transcript'); return f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; })(),
  });
  if (arg('out')) fs.writeFileSync(arg('out'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

async function main() {
  const command = process.argv[2];
  if (command === 'spend') return console.log((await spend()).toFixed(6)), 0;
  if (command === 'budget') return budget();
  if (command === 'redact') return redact(), 0;
  if (command === 'evaluate') return evaluate();
  console.error('usage: e2e-update.mjs spend | budget --start <usd> --max-usd <usd> | redact --in <file> --out <file> | evaluate --doctor <file> --record <file> --plugin-list <file> --pin-version <v> --current-version <v> --exit-code <n> --transcript <file> [--settings <file>] [--out <file>]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error(e.message); process.exit(2); });
}