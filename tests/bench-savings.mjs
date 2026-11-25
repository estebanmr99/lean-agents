#!/usr/bin/env node
// Savings benchmark harness (#370)
// Usage: node tests/bench-savings.mjs --home <throwaway dir> [--run] --model <provider/model#variant> [--out <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'bench-savings');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && i < process.argv.length - 1) return process.argv[i + 1];
  return null;
};

// The budget stop reads the key's own spend, not model-reported cost (#103). With BYOK the model cost is billed to the
// provider account and reported as byok_usage (credits stay ~0), so both count.
// GET https://openrouter.ai/api/v1/key -> data.usage + data.byok_usage (USD, all time); source: openrouter.ai/docs/api/reference/limits, 2026-11-23.
// VERIFY: byok_usage is the provider's list-price cost (logs show $0.00 cost for BYOK rows).
export async function keySpend(key, fetchFn = fetch) {
  const res = await fetchFn('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
  const d = res.ok ? (await res.json())?.data : undefined;
  if (typeof d?.usage !== 'number' || typeof d?.byok_usage !== 'number') throw new Error(`key usage unavailable (HTTP ${res.status})`);
  return d.usage + d.byok_usage;
}

// Raw logs are uploaded as artifacts; the model runs shell with the key in its env, so strip it.
export const redactKey = (text, key) => (key ? text.split(key).join('[REDACTED]') : text);

// Exported for tests
export function checkQuotaError(out) {
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const ev = JSON.parse(trimmed);
      const err = ev.error || ev;
      if (err.type === 'provider.quota' || err.status === 402 || ev.status === 402) {
        return { type: err.type, status: err.status || ev.status };
      }
    } catch {}
  }
  return null;
}

// Exported for tests
export function getStats(arr) {
  if (arr.length === 0) return { median: 0, p25: 0, p75: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const getP = (p) => {
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  };
  return { median: getP(0.5), p25: getP(0.25), p75: getP(0.75) };
}

// Only the assistant's own text: the raw stream also holds tool output (the files it read), which would pass answer checks for free.
export function finalText(out) {
  const parts = [];
  for (const line of out.split('\n')) {
    try { const ev = JSON.parse(line); if (ev.type === 'text') parts.push(String((ev.part || ev).text || '')); } catch {}
  }
  return parts.join('\n');
}

export function parseTokenUsage(out) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let turns = 0;
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const ev = JSON.parse(trimmed);
      // VERIFY: the first CI run (2026-11-23) parsed 0 tokens from `type: "step-finish"` with top-level `tokens`.
      // Accept the step-finish part nested as `part` or flat, `_` or `-` in the type, and `cache` as a number or {read, write}.
      if (ev.type === 'usage') {
        inputTokens += (ev.inputTokens || 0);
        outputTokens += (ev.outputTokens || 0);
      } else if (/^step[-_]finish$/.test(ev.type)) {
        turns += 1;
        const part = ev.part && ev.part.tokens ? ev.part : ev;
        const t = part.tokens || {};
        inputTokens += (t.input || 0);
        outputTokens += (t.output || 0) + (t.reasoning || 0);
        // A bare number has no read/write split; count it as read (the cheaper, common case).
        if (typeof t.cache === 'number') {
          cacheRead += t.cache;
          cacheTokens += t.cache;
        } else {
          cacheRead += (t.cache?.read || 0);
          cacheWrite += (t.cache?.write || 0);
          cacheTokens += (t.cache?.read || 0) + (t.cache?.write || 0);
        }
        if (typeof part.cost === 'number') cost += part.cost;
      }
    } catch {}
  }
  return { inputTokens, outputTokens, cacheTokens, cacheRead, cacheWrite, cost, turns };
}

// VERIFY: whether tokens.input already excludes cached tokens (check OpenCode docs).
export function priceUsage(usage, prices) {
  return (
    ((usage.inputTokens || 0) * (prices.in || 0) +
      (usage.cacheRead || 0) * (prices.cacheRead || 0) +
      (usage.cacheWrite || 0) * (prices.cacheWrite || 0) +
      (usage.outputTokens || 0) * (prices.out || 0)) /
    1e6
  );
}

export const TASKS = [
  {
    id: 'task0',
    prompt: 'Reply with the single word OK and nothing else.',
    check: (_dir, stdout) => (stdout || '').trim().toUpperCase() === 'OK',
  },
  {
    id: 'task1',
    prompt: 'Rename the variable "data" to "state" in index.mjs',
    check: (dir) => fs.readFileSync(path.join(dir, 'index.mjs'), 'utf8').includes('const state ='),
  },
  {
    id: 'task2',
    prompt: 'Implement a multiply function in math.mjs that multiplies two numbers and export it',
    check: (dir) => fs.readFileSync(path.join(dir, 'math.mjs'), 'utf8').includes('export function multiply'),
  },
  {
    id: 'task3',
    prompt: 'Remove index.mjs',
    check: (dir) => !fs.existsSync(path.join(dir, 'index.mjs')),
  },
  {
    id: 'task4',
    prompt: 'Find which function in big.mjs throws the error ERR_X and explain why',
    setup: (dir) => {
      let content = '';
      for (let i = 0; i < 3000; i++) {
        if (i === 1500) {
          content += `export function culprit() { throw new Error('ERR_X'); }\n`;
        } else {
          content += `export function func${i}() { return ${i}; }\n`;
        }
      }
      fs.writeFileSync(path.join(dir, 'big.mjs'), content);
    },
    check: (dir, stdout) => stdout.toLowerCase().includes('culprit'),
  },
  {
    id: 'task5',
    prompt: 'Run the test suite (node --test) and fix the one failing test',
    setup: (dir) => {
      fs.writeFileSync(path.join(dir, 'app.mjs'), 'export const val = 1;\n');
      fs.writeFileSync(path.join(dir, 'app.test.mjs'), `
import test from 'node:test';
import assert from 'node:assert';
import { val } from './app.mjs';
test('failing test', () => { assert.strictEqual(val, 2); });
      `);
    },
    check: (dir) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_TEST_WORKER_ID;
      const res = spawnSync(process.execPath, ['--test'], { cwd: dir, env });
      return res.status === 0;
    },
  },
  {
    id: 'task6',
    prompt: 'Run the tests and fix the failure in tests/fail.test.mjs',
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      let content = "import test from 'node:test';\nimport assert from 'node:assert';\n";
      for (let i = 0; i < 59; i++) {
        content += `test('pass${i}', () => { assert.strictEqual(1, 1); });\n`;
      }
      content += `test('fail', () => { assert.strictEqual(1, 2); });\n`;
      fs.writeFileSync(path.join(dir, 'tests', 'fail.test.mjs'), content);
    },
    check: (dir) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_TEST_WORKER_ID;
      const res = spawnSync(process.execPath, ['--test'], { cwd: dir, env });
      return res.status === 0;
    },
  },
  {
    id: 'task7',
    prompt: 'Rename the configuration key "retryLimit" to "maxRetries" everywhere',
    setup: (dir) => {
      for (let i = 0; i < 30; i++) {
        const filename = `file${i}.js`;
        let content = `// File ${i}\n`;
        if (i % 10 === 0) {
          content += `const config = { retryLimit: ${i} };\nconsole.log(config.retryLimit);\n`;
        } else {
          content += `console.log("no config here");\n`;
        }
        fs.writeFileSync(path.join(dir, filename), content);
      }
    },
    check: (dir) => {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
      let foundOld = false;
      let countNew = 0;
      for (const f of files) {
        const content = fs.readFileSync(path.join(dir, f), 'utf8');
        if (content.includes('retryLimit')) foundOld = true;
        if (content.includes('maxRetries')) countNew += (content.match(/maxRetries/g) || []).length;
      }
      return !foundOld && countNew >= 3;
    },
  },
  {
    id: 'task8',
    prompt: 'Which function threw and on which line in logs/app.log?',
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
      let content = '';
      for (let i = 0; i < 5000; i++) {
        if (i === 2500) {
          content += `ERROR: Uncaught Error: something went wrong\n    at buggyFunction (app.js:123:45)\n    at Object.<anonymous> (app.js:1:1)\n`;
        } else {
          content += `INFO: [${new Date().toISOString()}] Step ${i} completed\n`;
        }
      }
      fs.writeFileSync(path.join(dir, 'logs', 'app.log'), content);
    },
    check: (dir, stdout) => {
      const lower = (stdout || '').toLowerCase();
      return lower.includes('buggyfunction') && lower.includes('123');
    },
  },
  {
    id: 'task9',
    prompt: 'Run the tests with node --test and fix every failing test without editing the test files.',
    long: true,
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'math.mjs'), 'export function add(a, b) { return a - b; } // bug 1\n');
      fs.writeFileSync(path.join(dir, 'src', 'string.mjs'), 'export function upper(s) { return s.toLowerCase(); } // bug 2\n');
      fs.writeFileSync(path.join(dir, 'src', 'logic.mjs'), 'export function isTrue(v) { return false; } // bug 3\n');
      fs.writeFileSync(path.join(dir, 'src', 'index.mjs'), 'export * from "./math.mjs";\nexport * from "./string.mjs";\nexport * from "./logic.mjs";\n');
      for (let i = 1; i <= 6; i++) {
        fs.writeFileSync(path.join(dir, 'src', `filler${i}.mjs`), `export function noop${i}() { return ${i}; }\n`);
      }
      const testContent = "import test from 'node:test';\n" +
                          "import assert from 'node:assert';\n" +
                          "import { add, upper, isTrue } from '../src/index.mjs';\n\n" +
                          "test('add', () => assert.strictEqual(add(2, 3), 5));\n" +
                          "test('upper', () => assert.strictEqual(upper('hello'), 'HELLO'));\n" +
                          "test('isTrue', () => assert.strictEqual(isTrue(true), true));\n";
      fs.writeFileSync(path.join(dir, 'tests', 'all.test.mjs'), testContent);
      fs.writeFileSync(path.join(dir, '.test-hash'), testContent);
    },
    check: (dir) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_TEST_WORKER_ID;
      const res = spawnSync(process.execPath, ['--test'], { cwd: dir, env });
      const orig = fs.readFileSync(path.join(dir, '.test-hash'), 'utf8');
      const current = fs.readFileSync(path.join(dir, 'tests', 'all.test.mjs'), 'utf8');
      return res.status === 0 && orig === current;
    },
  },
  {
    id: 'task10',
    prompt: 'Add a --json flag that prints the result as JSON, with a test for it, and document it in README.',
    long: true,
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'lib', 'parse.mjs'), 'export function parse(input) { return input.split(","); }\n');
      fs.writeFileSync(path.join(dir, 'lib', 'format.mjs'), 'export function format(parsed) { return parsed.join(" | "); }\n');
      fs.writeFileSync(path.join(dir, 'cli.mjs'), "import { parse } from './lib/parse.mjs';\n" +
                                                  "import { format } from './lib/format.mjs';\n" +
                                                  "const input = process.argv[2] || 'a,b';\n" +
                                                  "console.log(format(parse(input)));\n");
      fs.writeFileSync(path.join(dir, 'README.md'), '# CLI\nUsage: node cli.mjs <input>\n');
      fs.writeFileSync(path.join(dir, 'tests', 'cli.test.mjs'), "import test from 'node:test';\n" +
                                                                "import assert from 'node:assert';\n" +
                                                                "import { parse } from '../lib/parse.mjs';\n" +
                                                                "test('parse', () => assert.deepStrictEqual(parse('a,b'), ['a', 'b']));\n");
    },
    check: (dir) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_TEST_WORKER_ID;
      const res = spawnSync(process.execPath, ['cli.mjs', '--json', 'x,y'], { cwd: dir, env });
      let validJson = false;
      try {
        const out = JSON.parse(res.stdout.toString().trim());
        if (Array.isArray(out) && out[0] === 'x' && out[1] === 'y') validJson = true;
      } catch (e) {}
      const testRes = spawnSync(process.execPath, ['--test'], { cwd: dir, env });
      const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
      return validJson && testRes.status === 0 && readme.includes('--json');
    },
  },
  {
    id: 'task11',
    prompt: 'Extract the duplicated block into one function and keep all tests passing.',
    long: true,
    setup: (dir) => {
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      let content = '';
      for (let i = 0; i < 50; i++) {
        content += `export function f${i}() { return ${i}; }\n`;
      }
      for (let i = 1; i <= 5; i++) {
        content += `\nexport function processThing${i}(data) {\n` +
                   `  let result = data;\n` +
                   `  // duplicated block start\n` +
                   `  const step1 = result + 1;\n` +
                   `  const step2 = step1 * 2;\n` +
                   `  const UNIQUE_MARKER = "DUPLICATED_BLOCK_MARKER_STRING";\n` +
                   `  result = step2 + UNIQUE_MARKER.length;\n` +
                   `  // duplicated block end\n` +
                   `  return result + ${i};\n` +
                   `}\n`;
        for (let j = 0; j < 10; j++) {
           content += `export function f${i}_${j}() { return ${j}; }\n`;
        }
      }
      fs.writeFileSync(path.join(dir, 'legacy.mjs'), content);
      fs.writeFileSync(path.join(dir, 'tests', 'legacy.test.mjs'), "import test from 'node:test';\n" +
                                                                    "import assert from 'node:assert';\n" +
                                                                    "import { processThing1, processThing5 } from '../legacy.mjs';\n" +
                                                                    "test('process1', () => assert.strictEqual(processThing1(0), 33));\n" +
                                                                    "test('process5', () => assert.strictEqual(processThing5(0), 37));\n");
    },
    check: (dir) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      delete env.NODE_TEST_WORKER_ID;
      const testRes = spawnSync(process.execPath, ['--test'], { cwd: dir, env });
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs'));
      let markerCount = 0;
      for (const f of files) {
        const text = fs.readFileSync(path.join(dir, f), 'utf8');
        markerCount += (text.match(/DUPLICATED_BLOCK_MARKER_STRING/g) || []).length;
      }
      return testRes.status === 0 && markerCount === 1;
    },
  },
];

// Exported for tests
export function renderResultsMarkdown(summary, variants, totalCost = 0, prices = null) {
  let md = '| Task | Mode | Pass Rate | Median In | IQR In | Median Out | Median Time | Cost |\n';
  if (prices) {
    md = '| Task | Mode | Pass Rate | Median In | IQR In | Median Out | Median Turns | Median Time | Cost | Priced Cost |\n';
    md += '|---|---|---|---|---|---|---|---|---|---|\n';
  } else {
    md += '|---|---|---|---|---|---|---|---|\n';
  }
  for (const s of summary) {
    const iqrIn = `${s.in.p25.toFixed(0)}-${s.in.p75.toFixed(0)}`;
    const stableMark = s.stable ? ' ★' : '';
    if (prices) {
      md += `| ${s.task} | ${s.mode} | ${(s.passRate * 100).toFixed(0)}% | ${s.in.median.toFixed(0)}${stableMark} | ${iqrIn} | ${s.out.median.toFixed(0)} | ${s.turns.median.toFixed(0)} | ${s.time.median.toFixed(0)}ms | $${s.totalCost.toFixed(4)} | $${s.totalPricedCost.toFixed(4)} |\n`;
    } else {
      md += `| ${s.task} | ${s.mode} | ${(s.passRate * 100).toFixed(0)}% | ${s.in.median.toFixed(0)}${stableMark} | ${iqrIn} | ${s.out.median.toFixed(0)} | ${s.time.median.toFixed(0)}ms | $${s.totalCost.toFixed(4)} |\n`;
    }
  }

  // Variants table
  md += '\n### Variants Comparison (Input Tokens)\n\n';
  md += `| Task | ${variants.join(' | ')} |\n`;
  md += `|---|${variants.map(() => '---|').join('')}\n`;
  const tasks = [...new Set(summary.map(s => s.task))];
  for (const taskId of tasks) {
    const row = [taskId];
    for (const v of variants) {
      const s = summary.find(sm => sm.task === taskId && sm.mode === v);
      if (!s) { row.push('-'); continue; }
      let cell = s.in.median.toFixed(0);
      if (s.passRate < 1) cell += ` (${(s.passRate * 100).toFixed(0)}%)`;
      row.push(cell);
    }
    md += `| ${row.join(' | ')} |\n`;
  }
  const overheadRow = ['**Fixed overhead vs baseline (task0)**'];
  const baseTask0 = summary.find(s => s.task === 'task0' && s.mode === 'baseline')?.in.median ?? 0;
  for (const v of variants) {
    if (v === 'baseline') { overheadRow.push('0'); continue; }
    const vTask0 = summary.find(s => s.task === 'task0' && s.mode === v)?.in.median;
    overheadRow.push(vTask0 !== undefined ? (vTask0 - baseTask0).toFixed(0) : '-');
  }
  md += `| ${overheadRow.join(' | ')} |\n`;

  const leanMedians = summary.filter(s => s.mode === 'lean');
  const baselineMedians = summary.filter(s => s.mode === 'baseline');
  if (variants.includes('lean') && variants.includes('baseline')) {
    let totalPctSaved = 0;
    let taskCount = 0;
    for (const lm of leanMedians) {
      const bm = baselineMedians.find(b => b.task === lm.task);
      if (bm && bm.in.median > 0) {
        totalPctSaved += (bm.in.median - lm.in.median) / bm.in.median;
        taskCount++;
      }
    }
    const avgPctSaved = taskCount > 0 ? (totalPctSaved / taskCount) * 100 : 0;
    md += `\nlean vs baseline: input tokens ${avgPctSaved >= 0 ? '-' : '+'}${Math.abs(avgPctSaved).toFixed(1)}% (median over tasks)\n`;
  }
  md += `\nTotal cost: $${totalCost.toFixed(4)}\n`;
  if (prices) md += `\nPriced Cost uses ${prices.in},${prices.cacheRead},${prices.cacheWrite},${prices.out} USD per 1M tokens (in, cache read, cache write, out) and assumes input excludes cached tokens (VERIFY).\n`;
  return md;
}

async function main() {
  const HOME = arg('home');
  const MODEL = arg('model');
  const RUN = process.argv.includes('--run');
  const OUT = arg('out') || (HOME ? path.join(HOME, 'bench-out') : null);
  const REPEATS = parseInt(arg('repeats') || '10', 10);
  const MAX_RUNS = parseInt(arg('max-runs') || '200', 10);
  const MAX_USD = Math.min(4.5, parseFloat(arg('max-usd') || '4.5') || 4.5);
  const VARIANTS = (arg('variants') || process.env.VARIANTS || 'baseline,lean').split(',');
  const LONG_TASKS = ['task9', 'task10', 'task11'];
  if (process.argv.includes('--long') && arg('tasks')) {
    console.error(`bench-savings: use --long or --tasks, not both`);
    process.exit(1);
  }
  const TASKS_TO_RUN = (arg('tasks') || process.env.TASKS || '') ? (arg('tasks') || process.env.TASKS).split(',') : process.argv.includes('--long') ? LONG_TASKS : TASKS.map(t => t.id);

  let parsedPrices = null;
  const pricesArg = arg('prices');
  if (process.argv.includes('--prices')) {
    const raw = (pricesArg || '').split(',');
    const parts = raw.map(Number);
    if (raw.length !== 4 || raw.some(p => !/^\d+(\.\d+)?$/.test(p.trim()))) {
      console.error(`bench-savings: --prices needs 4 numbers: in,cacheRead,cacheWrite,out`);
      process.exit(1);
    }
    parsedPrices = { in: parts[0], cacheRead: parts[1], cacheWrite: parts[2], out: parts[3] };
  }

  // No rtk-only or context-mode-only variant: on OpenCode 2 lean installs nothing for rtk (#179), so those equal rules and lean.
  const ALLOWED_VARIANTS = ['baseline', 'rules', 'lean'];
  for (const v of VARIANTS) {
    if (!ALLOWED_VARIANTS.includes(v)) {
      console.error(`Unknown variant: ${v}. Allowed: ${ALLOWED_VARIANTS.join(', ')}`);
      process.exit(2);
    }
  }
  for (const tid of TASKS_TO_RUN) {
    if (!TASKS.find(t => t.id === tid)) {
      console.error(`Unknown task: ${tid}`);
      process.exit(2);
    }
  }

  if (!HOME || path.resolve(HOME) === path.resolve(os.homedir())) {
    console.error('--home <throwaway dir> is required and must not be the real HOME');
    process.exit(2);
  }

  if (RUN && !MODEL) {
    console.error('--run requires --model <provider/model#variant>');
    process.exit(2);
  }

  fs.mkdirSync(HOME, { recursive: true });
  if (OUT) fs.mkdirSync(OUT, { recursive: true });

  const totalEstimatedRuns = TASKS_TO_RUN.length * VARIANTS.length * REPEATS;
  console.log(`Plan:`);
  console.log(`  HOME:           ${HOME}`);
  console.log(`  MODEL:          ${MODEL || '(none)'}`);
  console.log(`  OUT:            ${OUT}`);
  console.log(`  REPEATS:        ${REPEATS}`);
  console.log(`  VARIANTS:       ${VARIANTS.join(',')}`);
  console.log(`  TASKS:          ${TASKS_TO_RUN.length} (${TASKS_TO_RUN.join(',')})`);
  console.log(`  ESTIMATED RUNS: ${totalEstimatedRuns}`);
  console.log(`  MAX RUNS:       ${MAX_RUNS}`);
  console.log(`  MAX USD:        ${MAX_USD}`);

  if (RUN && totalEstimatedRuns > MAX_RUNS) {
    console.error(`Error: Estimated runs (${totalEstimatedRuns}) exceed --max-runs (${MAX_RUNS})`);
    process.exit(2);
  }

  if (!RUN) {
    console.log(`\nDry run: exiting 0. Pass --run and --model to execute.`);
    process.exit(0);
  }

  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) {
    console.error('--run needs OPENROUTER_API_KEY');
    process.exit(2);
  }
  // Fail closed: no spend reading, no run.
  const spentSoFar = async (start) => { try { return (await keySpend(KEY)) - start; } catch (e) { console.error(`Budget check failed: ${e.message}. Stopping.`); return Infinity; } };
  let startSpend;
  try { startSpend = await keySpend(KEY); } catch (e) { console.error(`Budget check failed: ${e.message}`); process.exit(2); }
  const results = [];
  let totalCost = 0;
  let consecutiveEmptyErrors = 0;
  const RAW_DIR = path.join(ROOT, 'raw');
  fs.mkdirSync(RAW_DIR, { recursive: true });

  for (const taskId of TASKS_TO_RUN) {
    const task = TASKS.find(t => t.id === taskId);
    for (const mode of VARIANTS) {
      for (let n = 1; n <= REPEATS; n++) {
        if (totalCost >= MAX_USD) {
          console.warn(`Budget reached ($${totalCost.toFixed(4)} >= $${MAX_USD}). Stopping.`);
          break;
        }

        const runHome = path.join(HOME, `run-${task.id}-${mode}-${n}`);
        const workdir = path.join(runHome, 'workspace');
        fs.mkdirSync(workdir, { recursive: true });
        fs.cpSync(FIXTURES, workdir, { recursive: true });
        if (task.setup) task.setup(workdir);

        console.log(`\nRunning ${task.id} (${mode}) repeat ${n}/${REPEATS}...`);
        
        const childEnv = { 
          PATH: process.env.PATH || '', 
          ...(process.env.NVM_DIR ? { NVM_DIR: process.env.NVM_DIR } : {}), 
          HOME: runHome, 
          USERPROFILE: runHome 
        };
        if (process.env.OPENROUTER_API_KEY) {
          childEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
        }

        if (mode !== 'baseline') {
          const leanTools = mode === 'rules' ? '--no-tools' : '--tools';
          const leanToolsVal = mode === 'rules' ? [] : ['rtk,context-mode'];
          const leanArgs = ['scripts/lean.mjs', '--home', runHome, '--yes', '--agents', 'opencode-v2', leanTools, ...leanToolsVal];
          console.log(`  Setup: node ${leanArgs.join(' ')}`);
          // Setup needs no model key.
          const { OPENROUTER_API_KEY: _k, ...setupEnv } = childEnv;
          const leanRes = spawnSync(process.execPath, [path.join(ROOT, leanArgs[0]), ...leanArgs.slice(1)], { env: setupEnv, encoding: 'utf8' });
          if (leanRes.status !== 0) {
            console.error(`  Lean setup failed with exit code ${leanRes.status}:\n${(() => { const lines = redactKey(`${leanRes.stdout || ''}\n${leanRes.stderr || ''}`, KEY).split('\n'); return [...lines.filter((l) => /^\s*! /.test(l)), '...', ...lines.slice(-40)].join('\n'); })()}`);
            process.exit(1);
          }
        }

        // --standalone: each run gets a private server; the shared background service keeps its port across temp HOMEs.
        // --agent build in both modes: lean sets default_agent to plan, which stops headless runs at the plan.
        const args = ['run', '--standalone', '--agent', 'build', '--format', 'json', '--model', MODEL, task.prompt];
        console.log(`  Exec: opencode ${args.join(' ')}`);

        const start = Date.now();
        const res = spawnSync('opencode', args, {
          cwd: workdir,
          env: childEnv,
          encoding: 'utf8',
        });
        const wallTime = Date.now() - start;

        const rawLogPath = path.join(RAW_DIR, `${task.id}-${mode}-${n}.jsonl`);
        fs.writeFileSync(rawLogPath, redactKey(res.stdout || '', KEY));

        const quotaErr = checkQuotaError(res.stdout || '');
        if (quotaErr) {
          console.error(`\nQuota stop: type=${quotaErr.type}, status=${quotaErr.status}. Stopping.`);
          process.exit(2);
        }

        const usage = parseTokenUsage(res.stdout || '');
        const pricedCost = parsedPrices ? priceUsage(usage, parsedPrices) : null;
        // Event types only (no content), so a wrong parser shows up in the log.
        const types = [...new Set((res.stdout || '').split('\n').map((l) => { try { return JSON.parse(l).type; } catch { return null; } }).filter(Boolean))];
        
        const isOnlyError = types.length > 0 && types.every(t => t === 'error');
        if (usage.inputTokens === 0 && isOnlyError) {
          consecutiveEmptyErrors++;
        } else {
          consecutiveEmptyErrors = 0;
        }
        if (consecutiveEmptyErrors >= 2) {
          console.error(`\nStopping: zero tokens and only error events twice in a row.`);
          process.exit(2);
        }

        console.log(`  Events: ${types.join(', ') || 'none'}; exit ${res.status}`);
        totalCost = Math.max(totalCost + usage.cost, await spentSoFar(startSpend));
        console.log(`  Spent so far (key usage): $${totalCost.toFixed(4)}`);
        const pass = task.check(workdir, finalText(res.stdout || ''));

        console.log(`  Pass: ${pass}, In: ${usage.inputTokens}, Out: ${usage.outputTokens}, Cache: ${usage.cacheTokens}, Cost: $${usage.cost.toFixed(4)}, Time: ${wallTime}ms`);
        
        results.push({
          task: task.id,
          mode,
          repeat: n,
          pass,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheTokens: usage.cacheTokens,
          cacheRead: usage.cacheRead,
          cacheWrite: usage.cacheWrite,
          turns: usage.turns,
          cost: usage.cost,
          pricedCost,
          wallTime,
        });
      }
      if (totalCost >= MAX_USD) break;
    }
    if (totalCost >= MAX_USD) break;
  }

  if (OUT) {
    const opencodeVersion = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    const leanCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

    // Aggregates
    const summary = [];
    for (const taskId of TASKS_TO_RUN) {
      for (const mode of VARIANTS) {
        const taskResults = results.filter(r => r.task === taskId && r.mode === mode);
        if (taskResults.length === 0) continue;

        summary.push({
          task: taskId,
          mode,
          passRate: taskResults.filter(r => r.pass).length / taskResults.length,
          in: getStats(taskResults.map(r => r.inputTokens)),
          out: getStats(taskResults.map(r => r.outputTokens)),
          turns: getStats(taskResults.map(r => r.turns)),
          cost: getStats(taskResults.map(r => r.cost)),
          time: getStats(taskResults.map(r => r.wallTime)),
          totalCost: taskResults.reduce((sum, r) => sum + r.cost, 0),
          totalPricedCost: parsedPrices ? taskResults.reduce((sum, r) => sum + r.pricedCost, 0) : null,
        });
      }
    }

    for (const taskId of TASKS_TO_RUN) {
      const lean = summary.find(s => s.task === taskId && s.mode === 'lean');
      const base = summary.find(s => s.task === taskId && s.mode === 'baseline');
      if (lean && base) {
        const stable = lean.passRate === base.passRate && (lean.in.p75 < base.in.p25 || base.in.p75 < lean.in.p25);
        lean.stable = stable;
        base.stable = stable;
      }
    }

    const totalInput = results.reduce((sum, r) => sum + r.inputTokens, 0);

    const resultsJson = {
      date: new Date().toISOString().split('T')[0],
      model: MODEL,
      opencodeVersion,
      leanCommit,
      runUrl,
      repeats: REPEATS,
      variants: VARIANTS,
      prices: parsedPrices,
      totalInput,
      tasks: summary,
      raw: results
    };
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(resultsJson, null, 2));
    
    const md = renderResultsMarkdown(summary, VARIANTS, totalCost, parsedPrices);
    fs.writeFileSync(path.join(OUT, 'results.md'), md);

    // SVG Chart only if baseline and lean are present
    if (VARIANTS.includes('baseline') && VARIANTS.includes('lean')) {
      const chartSvg = generateChart(summary, resultsJson);
      fs.writeFileSync(path.join(OUT, 'chart.svg'), chartSvg);
    }

    console.log(`\nWrote results to ${OUT}`);
    console.log(md);
  }
}

// Exported for tests
export function generateChart(res, info) {
  const tasks = [...new Set(res.map(r => r.task))];
  const margin = { top: 50, right: 150, bottom: 70, left: 120 };
  const barHeight = 20;
  const taskGap = 25;
  const height = margin.top + margin.bottom + tasks.length * (barHeight * 2 + taskGap);
  const width = 800;
  const chartWidth = width - margin.left - margin.right;
  const maxVal = Math.max(...res.map(r => r.in?.p75 || 0), 100) * 1.1;
  const scale = (val) => (val / maxVal) * chartWidth;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12" fill="currentColor">`;
  svg += `<rect width="100%" height="100%" fill="none" />`;
  svg += `<style>text { fill: #1f2328; } line { stroke: #1f2328; } .baseline { fill: #1f6feb; } .lean { fill: #238636; } @media (prefers-color-scheme: dark) { text { fill: #e6edf3; } line { stroke: #e6edf3; } }</style>`;
  svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-size="16" font-weight="bold">Input Tokens (Median &amp; IQR): Lean vs Baseline</text>`;

  tasks.forEach((taskId, i) => {
    const yBase = margin.top + i * (barHeight * 2 + taskGap);
    const lean = res.find(r => r.task === taskId && r.mode === 'lean');
    const base = res.find(r => r.task === taskId && r.mode === 'baseline');

    svg += `<text x="${margin.left - 10}" y="${yBase + barHeight + 5}" text-anchor="end">${taskId}</text>`;

    if (base) {
      const w = scale(base.in.median);
      svg += `<rect class="baseline" x="${margin.left}" y="${yBase}" width="${w}" height="${barHeight}" />`;
      const x25 = margin.left + scale(base.in.p25);
      const x75 = margin.left + scale(base.in.p75);
      svg += `<line x1="${x25}" y1="${yBase + barHeight/2}" x2="${x75}" y2="${yBase + barHeight/2}" stroke-width="1.5" />`;
      svg += `<text x="${margin.left + w + 5}" y="${yBase + barHeight - 5}">${Math.round(base.in.median)}</text>`;
    }

    if (lean) {
      const w = scale(lean.in.median);
      svg += `<rect class="lean" x="${margin.left}" y="${yBase + barHeight}" width="${w}" height="${barHeight}" />`;
      const x25 = margin.left + scale(lean.in.p25);
      const x75 = margin.left + scale(lean.in.p75);
      svg += `<line x1="${x25}" y1="${yBase + barHeight * 1.5}" x2="${x75}" y2="${yBase + barHeight * 1.5}" stroke-width="1.5" />`;
      svg += `<text x="${margin.left + w + 5}" y="${yBase + barHeight * 2 - 5}">${Math.round(lean.in.median)}${lean.stable ? ' ★' : ''}</text>`;
    }
  });

  const footer = `${info.model} · OpenCode ${info.opencodeVersion} · ${info.date} · run ${process.env.GITHUB_RUN_ID || 'local'}`;
  svg += `<text x="${width / 2}" y="${height - 25}" text-anchor="middle" font-size="11" opacity="0.7">${footer}</text>`;
  svg += `<rect class="baseline" x="${width - 130}" y="${margin.top}" width="12" height="12" /> <text x="${width - 110}" y="${margin.top + 10}">Baseline</text>`;
  svg += `<rect class="lean" x="${width - 130}" y="${margin.top + 20}" width="12" height="12" /> <text x="${width - 110}" y="${margin.top + 30}">Lean</text>`;
  svg += `<text x="${width - 130}" y="${margin.top + 55}" font-size="10">★ = stable (non-overlapping IQRs)</text>`;
  svg += `</svg>`;
  return svg;
}


if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
