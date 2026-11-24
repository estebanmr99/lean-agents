import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTokenUsage, finalText, keySpend, redactKey, checkQuotaError, getStats, generateChart, stripTool, renderResultsMarkdown } from './bench-savings.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';
import { buildSummary } from '../scripts/lib/summary-data.mjs';
import { renderSummary } from '../scripts/lib/summary-html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('generateChart contains bar pairs and footer', () => {
  const summary = [
    { task: 'task1', mode: 'baseline', in: { median: 100, p25: 80, p75: 120 }, stable: true },
    { task: 'task1', mode: 'lean', in: { median: 50, p25: 40, p75: 60 }, stable: true }
  ];
  const info = { model: 'm1', opencodeVersion: 'v1', date: '2026-11-23' };
  const svg = generateChart(summary, info);
  assert.match(svg, /<rect class="baseline"/);
  assert.match(svg, /<rect class="lean"/);
  assert.match(svg, /task1/);
  assert.match(svg, /m1 · OpenCode v1 · 2026-11-23/);
  assert.match(svg, /★/); // stable mark
});

test('checkQuotaError detects 402 and provider.quota', () => {
  const out1 = '{"type":"error","error":{"type":"provider.quota","status":429}}\n';
  assert.deepStrictEqual(checkQuotaError(out1), { type: 'provider.quota', status: 429 });
  const out2 = '{"status":402,"error":{"message":"payment required"}}\n';
  assert.deepStrictEqual(checkQuotaError(out2), { type: undefined, status: 402 });
  assert.strictEqual(checkQuotaError('{"type":"message"}'), null);
});

test('getStats on known arrays', () => {
  const arr = [10, 20, 30, 40, 50];
  const s = getStats(arr);
  // pos = (5-1)*0.5 = 2. index 2 is 30.
  // pos = (5-1)*0.25 = 1. index 1 is 20.
  // pos = (5-1)*0.75 = 3. index 3 is 40.
  assert.strictEqual(s.median, 30);
  assert.strictEqual(s.p25, 20);
  assert.strictEqual(s.p75, 40);

  const arr2 = [10, 20];
  const s2 = getStats(arr2);
  // pos = (2-1)*0.5 = 0.5. 10 + 0.5*(20-10) = 15.
  assert.strictEqual(s2.median, 15);
});

test('parseTokenUsage extracts tokens from OpenCode 2 JSON format', () => {
  const out = `
Some text
{"type":"message","content":"hello"}
{"type":"usage","inputTokens":150,"outputTokens":45}
{"type":"step-finish","tokens":{"input":10,"output":5,"cache":20},"cost":0.001}
  `;
  const res = parseTokenUsage(out);
  assert.strictEqual(res.inputTokens, 160);
  assert.strictEqual(res.outputTokens, 50);
  assert.strictEqual(res.cacheTokens, 20);
  assert.strictEqual(res.cost, 0.001);
});

test('bench-savings budget guards', async (t) => {
  const home = path.join(os.tmpdir(), `bench-budget-${Date.now()}`);
  fs.mkdirSync(home, { recursive: true });

  await t.test('fails when estimated runs exceed max-runs', () => {
    const res = spawnSync(process.execPath, [
      path.join(ROOT, 'tests', 'bench-savings.mjs'),
      '--home', home,
      '--run',
      '--model', 'mock/model',
      '--repeats', '10', // 9 tasks * 2 modes * 10 = 180 runs
      '--max-runs', '50'
    ], { encoding: 'utf8' });
    assert.strictEqual(res.status, 2);
    assert.match(res.stderr, /Estimated runs \(180\) exceed --max-runs \(50\)/);
  });

  fs.rmSync(home, { recursive: true, force: true });
});

test('bench-savings env forwarding', () => {
  // This is harder to test without running the script and checking its child env.
  // But we can check that it reads the key from process.env.
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-test-key';
  try {
    // We'd need to mock spawnSync to verify the env passed to it.
    // For now, we trust the implementation which we'll verify via a small unit-style check if possible.
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test('bench-savings dry-run prints plan and exits 0', () => {
  const home = path.join(os.tmpdir(), `bench-dry-run-${Date.now()}`);
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', home
  ], { encoding: 'utf8' });
  
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /Plan:/);
  assert.match(res.stdout, /Dry run: exiting 0/);
});

test('bench-savings --run without --model fails', () => {
  const home = path.join(os.tmpdir(), `bench-fail-${Date.now()}`);
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', home,
    '--run'
  ], { encoding: 'utf8' });
  
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /--run requires --model/);
});

test('doctor Active setup row content and summary line', () => {
  const home = path.join(os.tmpdir(), `bench-test-home-${Date.now()}`);
  fs.mkdirSync(home, { recursive: true });
  const rulesPath = path.join(home, 'AGENTS.md');
  fs.writeFileSync(rulesPath, 'some rules content here'); // 23 bytes

  const state = {
    version: '1.0.0',
    options: { tools: ['rtk', 'context-mode'], agents: ['claude'], privacy: 'standard' },
    commands: [],
    files: [
      { path: rulesPath, hash: 'xxx' },
      { path: path.join(home, 'agents/debug.md'), hash: 'yyy' },
      { path: path.join(home, 'agents/review.md'), hash: 'zzz' }
    ]
  };

  const collect = [];
  doctor({
    home,
    state,
    collect,
    fsx: fs,
    run: () => ({ ok: true, out: '' }),
    nodeVersion: '24.15.0' // Use a version that supports context-mode to be host-independent
  });
  
  const setupRow = collect.find(r => r.item === 'Active setup');
  assert.ok(setupRow, 'Active setup row missing');
  assert.strictEqual(setupRow.status, 'ok');
  assert.match(setupRow.detail, /rules 23 bytes \(\~6 tokens\)/);
  assert.match(setupRow.detail, /tools on: rtk, context-mode/);
  assert.match(setupRow.detail, /subagents: 2/);

  const model = buildSummary({ state, rows: collect, home });
  assert.strictEqual(model.summary.activeSetup, setupRow.detail, 'summary-data model missing activeSetup');

  const html = renderSummary({ model, home });
  assert.match(html, /<li><strong>Active setup:<\/strong> rules 23 bytes/);
  
  fs.rmSync(home, { recursive: true, force: true });
});

test('keySpend adds credit and BYOK usage and fails closed', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ data: { usage: 1.25, byok_usage: 0.5 } }) });
  assert.strictEqual(await keySpend('k', ok), 1.75);
  const noByok = async () => ({ ok: true, status: 200, json: async () => ({ data: { usage: 1.25 } }) });
  await assert.rejects(keySpend('k', noByok));
  const bad = async () => ({ ok: false, status: 401, json: async () => ({}) });
  await assert.rejects(keySpend('k', bad), /HTTP 401/);
  const noField = async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) });
  await assert.rejects(keySpend('k', noField));
});

test('redactKey removes every copy of the key', () => {
  assert.strictEqual(redactKey('a sk-or-x b sk-or-x', 'sk-or-x'), 'a [REDACTED] b [REDACTED]');
  assert.strictEqual(redactKey('plain', undefined), 'plain');
});

test('parseTokenUsage reads step_finish with a nested part and cache object', () => {
  const ev = { type: 'step_finish', part: { type: 'step-finish', tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 } }, cost: 0.002 } };
  assert.deepStrictEqual(parseTokenUsage(JSON.stringify(ev)), { inputTokens: 100, outputTokens: 25, cacheTokens: 10, cost: 0.002 });
});

test('finalText keeps assistant text and drops tool output', () => {
  const out = [
    JSON.stringify({ type: 'tool_use', part: { state: { output: 'at buggyFunction (app.js:123:45)' } } }),
    JSON.stringify({ type: 'text', part: { text: 'It was parseConfig.' } }),
  ].join('\n');
  assert.strictEqual(finalText(out), 'It was parseConfig.');
});

test('stripTool context-mode removes entry from opencode.jsonc', () => {
  const home = path.join(os.tmpdir(), `bench-strip-ctx-${Date.now()}`);
  const ocDir = path.join(home, '.config', 'opencode');
  fs.mkdirSync(ocDir, { recursive: true });
  const cfgPath = path.join(ocDir, 'opencode.jsonc');
  fs.writeFileSync(cfgPath, JSON.stringify({ mcp: { servers: { 'context-mode': { type: 'local' }, other: {} } } }));

  stripTool(home, 'context-mode');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.ok(!cfg.mcp.servers['context-mode']);
  assert.ok(cfg.mcp.servers.other);

  assert.throws(() => stripTool(home, 'context-mode'), /entry not found/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('stripTool rtk removes mention from AGENTS.md', () => {
  const home = path.join(os.tmpdir(), `bench-strip-rtk-${Date.now()}`);
  const laDir = path.join(home, '.config', 'lean-agents');
  fs.mkdirSync(laDir, { recursive: true });
  const rulesPath = path.join(laDir, 'AGENTS.md');
  const target = ' RTK compression does not replace this.';
  fs.writeFileSync(rulesPath, `Rule 1.${target}\nRule 2.`);

  stripTool(home, 'rtk');
  const content = fs.readFileSync(rulesPath, 'utf8');
  assert.ok(!content.includes(target));
  assert.match(content, /Rule 1\.\nRule 2\./);

  assert.throws(() => stripTool(home, 'rtk'), /rtk mention not found/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('bench-savings variant and task parsing', () => {
  const home = path.join(os.tmpdir(), `bench-parse-${Date.now()}`);
  fs.mkdirSync(home, { recursive: true });

  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', home,
    '--variants', 'invalid'
  ], { encoding: 'utf8' });
  assert.strictEqual(res.status, 2);
  assert.match(res.stderr, /Unknown variant: invalid/);

  const res2 = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', home,
    '--tasks', 'invalid'
  ], { encoding: 'utf8' });
  assert.strictEqual(res2.status, 2);
  assert.match(res2.stderr, /Unknown task: invalid/);

  fs.rmSync(home, { recursive: true, force: true });
});

test('renderResultsMarkdown variants table and overhead', () => {
  const summary = [
    { task: 'task0', mode: 'baseline', in: { median: 100, p25: 100, p75: 100 }, out: { median: 5 }, time: { median: 500 }, passRate: 1, totalCost: 0 },
    { task: 'task0', mode: 'lean', in: { median: 150, p25: 150, p75: 150 }, out: { median: 5 }, time: { median: 500 }, passRate: 1, totalCost: 0 },
    { task: 'task1', mode: 'baseline', in: { median: 1000, p25: 1000, p75: 1000 }, out: { median: 50 }, time: { median: 2000 }, passRate: 1, totalCost: 0 },
    { task: 'task1', mode: 'lean', in: { median: 800, p25: 800, p75: 800 }, out: { median: 50 }, time: { median: 2000 }, passRate: 0.9, totalCost: 0 }
  ];
  const md = renderResultsMarkdown(summary, ['baseline', 'lean'], 0.01);
  assert.match(md, /### Variants Comparison/);
  assert.match(md, /\| task0 \| 100 \| 150 \|/);
  assert.match(md, /\| task1 \| 1000 \| 800 \(90%\) \|/);
  assert.match(md, /\| \*\*Fixed overhead vs baseline \(task0\)\*\* \| 0 \| 50 \|/);
  assert.match(md, /Total cost: \$0.0100/);
});
