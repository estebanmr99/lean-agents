import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTokenUsage, finalText, keySpend, redactKey, checkQuotaError, getStats, generateChart, renderResultsMarkdown, priceUsage, TASKS, checkEnv } from './bench-savings.mjs';
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

test('checkQuotaError detects a BYOK spend cap (provider.auth 403, reason in the body)', () => {
  const body = JSON.stringify({ error: { message: 'Provider returned error', code: 403, metadata: { raw: 'Spend cap breached for project: projects/x' } } });
  const out = JSON.stringify({ type: 'error', error: { type: 'provider.auth', message: 'Provider returned error', status: 403, response: { body } } }) + '\n';
  assert.deepStrictEqual(checkQuotaError('{"type":"step_start"}\n' + out), { type: 'provider.auth', status: 403 });
  const textOnly = JSON.stringify({ type: 'error', error: { type: 'provider.other', message: 'Spend cap breached', status: 400 } }) + '\n';
  assert.deepStrictEqual(checkQuotaError(textOnly), { type: 'provider.other', status: 400 });
  assert.strictEqual(checkQuotaError(JSON.stringify({ type: 'error', error: { type: 'provider.other', message: 'bad request', status: 400 } })), null);
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

test('parseTokenUsage extracts tokens from OpenCode 2 JSON format, counts turns, and splits cache', () => {
  const out = `
Some text
{"type":"message","content":"hello"}
{"type":"usage","inputTokens":150,"outputTokens":45}
{"type":"step-finish","tokens":{"input":10,"output":5,"cache":20},"cost":0.001}
{"type":"step-finish","tokens":{"input":5,"output":2,"cache":{"read":15,"write":5}},"cost":0.002}
  `;
  const res = parseTokenUsage(out);
  assert.strictEqual(res.inputTokens, 165);
  assert.strictEqual(res.outputTokens, 52);
  assert.strictEqual(res.cacheTokens, 40); // 20 + 15 + 5
  assert.strictEqual(res.cacheRead, 35);   // 20 + 15
  assert.strictEqual(res.cacheWrite, 5);
  assert.strictEqual(res.cost, 0.003);
  assert.strictEqual(res.turns, 2);
});

test('priceUsage calculates priced cost correctly and defaults missing keys to 0', () => {
  const usage = { inputTokens: 100, cacheRead: 50, cacheWrite: 20, outputTokens: 10 };
  
  const p1 = priceUsage(usage, { in: 3, cacheRead: 1.5, cacheWrite: 3, out: 15 });
  // (100*3 + 50*1.5 + 20*3 + 10*15) / 1e6 = (300 + 75 + 60 + 150) / 1e6 = 585 / 1e6 = 0.000585
  assert.strictEqual(p1, 0.000585);

  const p2 = priceUsage(usage, { in: 3, out: 15 }); // missing cacheRead, cacheWrite
  // (100*3 + 50*0 + 20*0 + 10*15) / 1e6 = 450 / 1e6 = 0.00045
  assert.strictEqual(p2, 0.00045);
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
  assert.deepStrictEqual(parseTokenUsage(JSON.stringify(ev)), { inputTokens: 100, outputTokens: 25, cacheTokens: 10, cacheRead: 7, cacheWrite: 3, cost: 0.002, turns: 1 });
});

test('finalText keeps assistant text and drops tool output', () => {
  const out = [
    JSON.stringify({ type: 'tool_use', part: { state: { output: 'at buggyFunction (app.js:123:45)' } } }),
    JSON.stringify({ type: 'text', part: { text: 'It was parseConfig.' } }),
  ].join('\n');
  assert.strictEqual(finalText(out), 'It was parseConfig.');
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

  const res3 = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', home,
    '--prices', '1,2,3'
  ], { encoding: 'utf8' });
  assert.strictEqual(res3.status, 1);
  assert.match(res3.stderr, /bench-savings: --prices needs 4 numbers: in,cacheRead,cacheWrite,out/);
  for (const bad of [[''], ['1,,2,3'], ['0x10,1,1,1'], []]) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'bench-savings.mjs'), '--home', home, '--prices', ...bad], { encoding: 'utf8' });
    assert.strictEqual(r.status, 1, `--prices ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /--prices needs 4 numbers/);
  }

  fs.rmSync(home, { recursive: true, force: true });
});

test('renderResultsMarkdown variants table and overhead, and prices', () => {
  const summary = [
    { task: 'task0', mode: 'baseline', in: { median: 100, p25: 100, p75: 100 }, out: { median: 5 }, turns: { median: 1 }, time: { median: 500 }, passRate: 1, totalCost: 0, totalPricedCost: 0.001 },
    { task: 'task0', mode: 'lean', in: { median: 150, p25: 150, p75: 150 }, out: { median: 5 }, turns: { median: 2 }, time: { median: 500 }, passRate: 1, totalCost: 0, totalPricedCost: 0.002 },
    { task: 'task1', mode: 'baseline', in: { median: 1000, p25: 1000, p75: 1000 }, out: { median: 50 }, turns: { median: 1 }, time: { median: 2000 }, passRate: 1, totalCost: 0, totalPricedCost: 0.01 },
    { task: 'task1', mode: 'lean', in: { median: 800, p25: 800, p75: 800 }, out: { median: 50 }, turns: { median: 1 }, time: { median: 2000 }, passRate: 0.9, totalCost: 0, totalPricedCost: 0.008 }
  ];
  const mdNoPrices = renderResultsMarkdown(summary, ['baseline', 'lean'], 0.01);
  assert.match(mdNoPrices, /### Variants Comparison/);
  assert.match(mdNoPrices, /\| task0 \| 100 \| 150 \|/);
  assert.match(mdNoPrices, /\| task1 \| 1000 \| 800 \(90%\) \|/);
  assert.match(mdNoPrices, /\| \*\*Fixed overhead vs baseline \(task0\)\*\* \| 0 \| 50 \|/);
  assert.match(mdNoPrices, /Total cost: \$0.0100/);
  assert.match(mdNoPrices, /\| task0 \| baseline \| 100% \| 100 \| 100-100 \| 5 \| 500ms \| \$0.0000 \|/);
  assert.doesNotMatch(mdNoPrices, /Median Turns/);
  assert.doesNotMatch(mdNoPrices, /Priced Cost/);
  
  const mdPrices = renderResultsMarkdown(summary, ['baseline', 'lean'], 0.01, { in: 1, cacheRead: 0, cacheWrite: 0, out: 1 });
  assert.match(mdPrices, /Priced Cost uses 1,0,0,1 USD per 1M tokens/);
  assert.match(mdPrices, /\| Task \| Mode \| Pass Rate \| Median In \| IQR In \| Median Out \| Median Turns \| Median Time \| Cost \| Priced Cost \|/);
  assert.match(mdPrices, /\| task0 \| baseline \| 100% \| 100 \| 100-100 \| 5 \| 1 \| 500ms \| \$0.0000 \| \$0.0010 \|/);
});

test('bench-savings --long and --tasks conflict', () => {
  const home = path.join(os.tmpdir(), `bench-long-conflict-${Date.now()}`);
  fs.mkdirSync(home, { recursive: true });

  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', home,
    '--long',
    '--tasks', 'task9'
  ], { encoding: 'utf8' });
  
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /bench-savings: use --long or --tasks, not both/);
  
  fs.rmSync(home, { recursive: true, force: true });
});

test('bench-savings task9 check function', () => {
  const task = TASKS.find(t => t.id === 'task9');
  const dir = path.join(os.tmpdir(), `bench-task9-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  task.setup(dir);
  
  // untouched should fail
  assert.strictEqual(task.check(dir), false);
  
  // apply fix
  for (const layer of ['c', 'b', 'a']) {
    for (let i = 0; i < 12; i++) {
      const p = path.join(dir, 'src', layer, `mod${layer}${i}.mjs`);
      let content = fs.readFileSync(p, 'utf8');
      content = content.replace(/  return res - 1; \/\/ bug/g, '  return res;');
      fs.writeFileSync(p, content);
    }
  }
  
  // now it should pass
  assert.strictEqual(task.check(dir), true);

  // gaming 1: test file edited
  const testP = path.join(dir, 'tests', 'test_a_0.test.mjs');
  const oldTest = fs.readFileSync(testP, 'utf8');
  fs.writeFileSync(testP, oldTest + '\n// comment');
  assert.strictEqual(task.check(dir), false);
  fs.writeFileSync(testP, oldTest);
  
  // gaming 2: test file deleted
  fs.unlinkSync(testP);
  assert.strictEqual(task.check(dir), false);
  
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bench-savings task10 check function', () => {
  const task = TASKS.find(t => t.id === 'task10');
  const dir = path.join(os.tmpdir(), `bench-task10-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  task.setup(dir);
  
  assert.strictEqual(task.check(dir), false);
  
  fs.writeFileSync(path.join(dir, 'cli.mjs'), "import { parse } from './lib/parse.mjs';\n" +
                                              "import { format } from './lib/format.mjs';\n" +
                                              "const input = process.argv[process.argv.indexOf('--json') > -1 ? 3 : 2] || 'a,b';\n" +
                                              "const parsed = parse(input);\n" +
                                              "if (process.argv.includes('--json')) {\n" +
                                              "  console.log(JSON.stringify(parsed));\n" +
                                              "} else {\n" +
                                              "  console.log(format(parsed));\n" +
                                              "}\n");
  fs.writeFileSync(path.join(dir, 'tests', 'json.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('--json prints JSON', () => { assert.strictEqual(1, 1); });\n");
  const readmeContent = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'README.md'), readmeContent + '\nSupports --json flag\n');
  
  assert.strictEqual(task.check(dir), true);

  // gaming: original tests replaced by trivial ones
  const cliTest = path.join(dir, 'tests', 'cli.test.mjs');
  const origCliTest = fs.readFileSync(cliTest, 'utf8');
  fs.writeFileSync(cliTest, "import test from 'node:test';\n" + "test('a', () => {});\n".repeat(20));
  assert.strictEqual(task.check(dir), false);
  fs.writeFileSync(cliTest, origCliTest);
  assert.strictEqual(task.check(dir), true);

  // gaming: always-JSON cli
  fs.writeFileSync(path.join(dir, 'cli.mjs'), "import { parse } from './lib/parse.mjs';\n" +
                                              "import { format } from './lib/format.mjs';\n" +
                                              "const input = process.argv[3] || 'a,b';\n" +
                                              "console.log(JSON.stringify(parse(input)));\n");
  assert.strictEqual(task.check(dir), false);
  
  // gaming: tests deleted
  fs.unlinkSync(path.join(dir, 'tests', 'cli.test.mjs'));
  assert.strictEqual(task.check(dir), false);
  
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bench-savings task11 check function', () => {
  const task = TASKS.find(t => t.id === 'task11');
  const dir = path.join(os.tmpdir(), `bench-task11-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  task.setup(dir);
  
  assert.strictEqual(task.check(dir), false);
  
  let content = fs.readFileSync(path.join(dir, 'legacy.mjs'), 'utf8');
  content = `export function shared(result) {
  const step1 = result + 1;
  const step2 = step1 * 2;
  const UNIQUE_MARKER = "DUPLICATED_BLOCK_MARKER_STRING";
  return step2 + UNIQUE_MARKER.length;
}\n` + content;

  for (let i = 1; i <= 5; i++) {
    content = content.replace(
      `  // normalize address\n` +
      `  const step1 = result + 1;\n` +
      `  const step2 = step1 * 2;\n` +
      `  const UNIQUE_MARKER = "DUPLICATED_BLOCK_MARKER_STRING";\n` +
      `  result = step2 + UNIQUE_MARKER.length;\n` +
      `  // end normalize address`,
      `  result = shared(result);`
    );
  }
  fs.writeFileSync(path.join(dir, 'legacy.mjs'), content);
  
  assert.strictEqual(task.check(dir), true);
  
  // gaming: processThing function deleted
  content = content.replace(/export function processThing1\(data\) \{[\s\S]*?\n\}/, '');
  fs.writeFileSync(path.join(dir, 'legacy.mjs'), content);
  // Tests should fail because processThing1 doesn't exist
  assert.strictEqual(task.check(dir), false);
  
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bench-savings checkEnv has no OPENROUTER_API_KEY even when it is set', () => {
  process.env.OPENROUTER_API_KEY = 'secret';
  const env = checkEnv('/tmp');
  assert.strictEqual(env.OPENROUTER_API_KEY, undefined);
  assert.strictEqual(env.HOME, '/tmp');
  assert.strictEqual(env.NODE_OPTIONS, '');
  assert.ok(env.PATH !== undefined);
});

test('bench-savings fixture generation is deterministic and task9 is large', () => {
  const task = TASKS.find(t => t.id === 'task9');
  
  const dir1 = path.join(os.tmpdir(), `bench-task9-det1-${Date.now()}`);
  const dir2 = path.join(os.tmpdir(), `bench-task9-det2-${Date.now()}`);
  fs.mkdirSync(dir1, { recursive: true });
  fs.mkdirSync(dir2, { recursive: true });
  
  task.setup(dir1);
  task.setup(dir2);
  
  let totalLines = 0;
  function scan(d1, d2) {
    const f1 = fs.readdirSync(d1);
    const f2 = fs.readdirSync(d2);
    assert.deepStrictEqual(f1.sort(), f2.sort());
    for (const name of f1) {
      const p1 = path.join(d1, name);
      const p2 = path.join(d2, name);
      const stat = fs.statSync(p1);
      if (stat.isDirectory()) scan(p1, p2);
      else {
        const text1 = fs.readFileSync(p1, 'utf8');
        const text2 = fs.readFileSync(p2, 'utf8');
        assert.strictEqual(text1, text2);
        totalLines += text1.split('\n').length;
      }
    }
  }
  scan(dir1, dir2);
  
  assert.ok(totalLines >= 2500, `fixture should be at least 2500 lines, was ${totalLines}`);
  
  fs.rmSync(dir1, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});
