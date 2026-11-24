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

// The key is shared and has no OpenRouter credit limit, so the budget stop reads the key's own spend, not model-reported cost (#103).
// GET https://openrouter.ai/api/v1/key -> data.usage (USD, all time); source: openrouter.ai/docs/api/reference/limits, 2026-11-23.
export async function keySpend(key, fetchFn = fetch) {
  const res = await fetchFn('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
  const usage = res.ok ? (await res.json())?.data?.usage : undefined;
  if (typeof usage !== 'number') throw new Error(`key usage unavailable (HTTP ${res.status})`);
  return usage;
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

// Exported for tests
export function parseTokenUsage(out) {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheTokens = 0;
  let cost = 0;
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
        const part = ev.part && ev.part.tokens ? ev.part : ev;
        const t = part.tokens || {};
        inputTokens += (t.input || 0);
        outputTokens += (t.output || 0) + (t.reasoning || 0);
        cacheTokens += typeof t.cache === 'number' ? t.cache : ((t.cache?.read || 0) + (t.cache?.write || 0));
        if (typeof part.cost === 'number') cost += part.cost;
      }
    } catch {}
  }
  return { inputTokens, outputTokens, cacheTokens, cost };
}

const TASKS = [
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
      const res = spawnSync(process.execPath, ['--test'], { cwd: dir });
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
      const res = spawnSync(process.execPath, ['--test'], { cwd: dir });
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
];

async function main() {
  const HOME = arg('home');
  const MODEL = arg('model');
  const RUN = process.argv.includes('--run');
  const OUT = arg('out') || (HOME ? path.join(HOME, 'bench-out') : null);
  const REPEATS = parseInt(arg('repeats') || '10', 10);
  const MAX_RUNS = parseInt(arg('max-runs') || '200', 10);
  const MAX_USD = Math.min(4.5, parseFloat(arg('max-usd') || '4.5') || 4.5);

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

  const totalEstimatedRuns = TASKS.length * 2 * REPEATS;
  console.log(`Plan:`);
  console.log(`  HOME:           ${HOME}`);
  console.log(`  MODEL:          ${MODEL || '(none)'}`);
  console.log(`  OUT:            ${OUT}`);
  console.log(`  REPEATS:        ${REPEATS}`);
  console.log(`  TASKS:          ${TASKS.length}`);
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

  for (const task of TASKS) {
    for (const mode of ['baseline', 'lean']) {
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

        if (mode === 'lean') {
          const leanArgs = ['scripts/lean.mjs', '--home', runHome, '--yes', '--agents', 'opencode-v2', '--tools', 'rtk,context-mode'];
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
        const args = ['run', '--standalone', '--format', 'json', '--model', MODEL, task.prompt];
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
        const pass = task.check(workdir, res.stdout || '');

        console.log(`  Pass: ${pass}, In: ${usage.inputTokens}, Out: ${usage.outputTokens}, Cache: ${usage.cacheTokens}, Cost: $${usage.cost.toFixed(4)}, Time: ${wallTime}ms`);
        
        results.push({
          task: task.id,
          mode,
          repeat: n,
          pass,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheTokens: usage.cacheTokens,
          cost: usage.cost,
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
    const modes = ['baseline', 'lean'];
    for (const task of TASKS) {
      for (const mode of modes) {
        const taskResults = results.filter(r => r.task === task.id && r.mode === mode);
        if (taskResults.length === 0) continue;

        summary.push({
          task: task.id,
          mode,
          passRate: taskResults.filter(r => r.pass).length / taskResults.length,
          in: getStats(taskResults.map(r => r.inputTokens)),
          out: getStats(taskResults.map(r => r.outputTokens)),
          cost: getStats(taskResults.map(r => r.cost)),
          time: getStats(taskResults.map(r => r.wallTime)),
          totalCost: taskResults.reduce((sum, r) => sum + r.cost, 0),
        });
      }
    }

    for (const task of TASKS) {
      const lean = summary.find(s => s.task === task.id && s.mode === 'lean');
      const base = summary.find(s => s.task === task.id && s.mode === 'baseline');
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
      totalInput,
      tasks: summary,
      raw: results
    };
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(resultsJson, null, 2));
    
    let md = '| Task | Mode | Pass Rate | Median In | IQR In | Median Out | Median Time | Cost |\n';
    md += '|---|---|---|---|---|---|---|---|\n';
    for (const s of summary) {
      const iqrIn = `${s.in.p25.toFixed(0)}-${s.in.p75.toFixed(0)}`;
      const stableMark = s.stable ? ' ★' : '';
      md += `| ${s.task} | ${s.mode} | ${(s.passRate * 100).toFixed(0)}% | ${s.in.median.toFixed(0)}${stableMark} | ${iqrIn} | ${s.out.median.toFixed(0)} | ${s.time.median.toFixed(0)}ms | $${s.totalCost.toFixed(4)} |\n`;
    }

    const leanMedians = summary.filter(s => s.mode === 'lean');
    const baselineMedians = summary.filter(s => s.mode === 'baseline');
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
    md += `\nTotal cost: $${totalCost.toFixed(4)}\n`;

    fs.writeFileSync(path.join(OUT, 'results.md'), md);

    // SVG Chart
    const chartSvg = generateChart(summary, resultsJson);
    fs.writeFileSync(path.join(OUT, 'chart.svg'), chartSvg);

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
  svg += `<style>text { fill: currentColor; } .baseline { fill: #1f6feb; } .lean { fill: #238636; }</style>`;
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
      svg += `<line x1="${x25}" y1="${yBase + barHeight/2}" x2="${x75}" y2="${yBase + barHeight/2}" stroke="currentColor" stroke-width="1.5" />`;
      svg += `<text x="${margin.left + w + 5}" y="${yBase + barHeight - 5}">${Math.round(base.in.median)}</text>`;
    }

    if (lean) {
      const w = scale(lean.in.median);
      svg += `<rect class="lean" x="${margin.left}" y="${yBase + barHeight}" width="${w}" height="${barHeight}" />`;
      const x25 = margin.left + scale(lean.in.p25);
      const x75 = margin.left + scale(lean.in.p75);
      svg += `<line x1="${x25}" y1="${yBase + barHeight * 1.5}" x2="${x75}" y2="${yBase + barHeight * 1.5}" stroke="currentColor" stroke-width="1.5" />`;
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
