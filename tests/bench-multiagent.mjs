#!/usr/bin/env node
// Multi-agent benchmark harness (#404, PR 3 of 4): one agent versus N workers plus a reviewer on task9.
// Usage: node tests/bench-multiagent.mjs --home <throwaway dir> --dry-run
//        node tests/bench-multiagent.mjs --home <dir> --run --model <provider/model#variant> [--prices ...]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseTokenUsage, priceUsage, keySpend, redactKey, getStats, TASKS, setupVariant } from './bench-savings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && i < process.argv.length - 1) return process.argv[i + 1];
  return null;
};

const TASK9 = TASKS.find((t) => t.id === 'task9');
// The three independent bugs in task9: src/c/modc2.mjs, src/b/modb5.mjs, src/a/moda8.mjs.
export const TASK9_BUG_TESTS = ['tests/test_c_2.test.mjs', 'tests/test_b_5.test.mjs', 'tests/test_a_8.test.mjs'];
export const DEFAULT_MODES = ['solo', 'workers-1', 'workers-2', 'workers-4'];
export const REVIEWER_PROMPT = 'Review the changes in this repo (git diff) for mistakes; fix any you find; do not edit test files.';

// Deterministic harness split: no model coordinator, worker i gets bug i, i+n, i+2n...
export function splitBugs(bugFiles, n) {
  const out = Array.from({ length: n }, () => []);
  bugFiles.forEach((file, i) => out[i % n].push(file));
  return out;
}

// Owner budget cap: never more than USD 5 for one run.
export function parseMaxUsd(raw) {
  const n = parseFloat(raw);
  return Math.min(5, Number.isFinite(n) ? n : 5);
}

export function sessionsForMode(mode) {
  if (mode === 'solo') return 1;
  const n = parseInt(String(mode).split('-')[1], 10);
  // A worker with no bug to fix is not started, so it costs no session.
  return splitBugs(TASK9_BUG_TESTS, n).filter((files) => files.length > 0).length + 1;
}

function walk(dir, base, out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) walk(full, base, out);
    else out.set(rel, fs.readFileSync(full, 'utf8'));
  }
  return out;
}

// Changed non-test files in a worker copy, compared with the pristine fixture.
export function collectChanges(baseDir, workerDir) {
  const baseFiles = walk(baseDir, baseDir);
  const workerFiles = walk(workerDir, workerDir);
  const changes = new Map();
  for (const [rel, content] of workerFiles) {
    if (rel.startsWith('tests/')) continue;
    if (baseFiles.get(rel) !== content) changes.set(rel, content);
  }
  for (const rel of baseFiles.keys()) {
    if (!rel.startsWith('tests/') && !workerFiles.has(rel)) changes.set(rel, null);
  }
  return changes;
}

// Two workers changing the same file to different content is a conflict, and the run fails.
export function mergeWorkerChanges(mergeDir, changesList) {
  const seen = new Map();
  let conflict = false;
  for (const changes of changesList) {
    for (const [rel, content] of changes) {
      if (seen.has(rel) && seen.get(rel) !== content) conflict = true;
      seen.set(rel, content);
    }
  }
  if (!conflict) {
    for (const [rel, content] of seen) {
      const full = path.join(mergeDir, rel);
      if (content === null) {
        fs.rmSync(full, { force: true });
      } else {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
      }
    }
  }
  return { conflict, files: [...seen.keys()] };
}

function initGit(dir) {
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
  spawnSync('git', ['-C', dir, '-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-qm', 'base'], { encoding: 'utf8' });
}

function sessionEnv(home) {
  const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home };
  if (process.env.NVM_DIR) env.NVM_DIR = process.env.NVM_DIR;
  if (process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  return env;
}

function runOpenCode({ cwd, home, prompt, model, timeout, variant, logPath, key }) {
  return new Promise((resolve) => {
    const args = ['run', '--standalone', '--agent', 'build', '--format', 'json', '--model', model, prompt];
    const start = Date.now();
    const child = spawn('opencode', args, { cwd, env: sessionEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const done = (status) => {
      clearTimeout(timer);
      if (logPath) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, redactKey(stdout, key));
      }
      resolve({ stdout, stderr, status, timedOut, wallTime: Date.now() - start, usage: parseTokenUsage(stdout) });
    };
    child.on('error', (e) => { stderr += String(e.message || e); done(-1); });
    child.on('close', (code) => done(code));
  });
}

async function runSession({ name, workdir, home, prompt, model, timeout, variant, outDir, key, budget, runLabel }) {
  await budget();
  fs.mkdirSync(home, { recursive: true });
  const setup = setupVariant({ root: ROOT, home, variant, env: sessionEnv(home) });
  if (!setup.ok) throw new Error(`lean setup failed for ${name} (exit ${setup.status})`);
  const res = await runOpenCode({
    cwd: workdir,
    home,
    prompt,
    model,
    timeout,
    variant,
    key,
    logPath: path.join(outDir, 'raw', `${runLabel}-${name}.jsonl`),
  });
  return { name, workdir, ...res };
}

function summarizeSession(res, prices) {
  const u = res.usage;
  return {
    name: res.name,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    turns: u.turns,
    cost: u.cost,
    pricedCost: prices ? priceUsage(u, prices) : null,
    wallTime: res.wallTime,
    timedOut: res.timedOut,
    exit: res.status,
  };
}

export function renderMultiMarkdown(summary, prices) {
  let md = prices
    ? '| Mode | Pass Rate | Median In | Median Out | Median Turns | Median Time | Cost | Priced Cost |\n'
    : '| Mode | Pass Rate | Median In | Median Out | Median Turns | Median Time | Cost |\n';
  md += prices ? '|---|---|---|---|---|---|---|---|\n' : '|---|---|---|---|---|---|---|\n';
  const solo = summary.find((s) => s.mode === 'solo');
  for (const s of summary) {
    const ratio = solo && solo.cost > 0 ? s.cost / solo.cost : null;
    const cells = [
      s.mode,
      `${(s.passRate * 100).toFixed(0)}%`,
      s.input.median.toFixed(0),
      s.output.median.toFixed(0),
      s.turns.median.toFixed(0),
      `${s.time.median.toFixed(0)}ms`,
      `$${s.cost.toFixed(4)}`,
    ];
    if (prices) cells.push(`$${(s.pricedCost || 0).toFixed(4)}`);
    md += `| ${cells.join(' | ')} |\n`;
    s._costVsSolo = ratio;
  }
  md += '\nCost vs solo:\n';
  for (const s of summary) {
    md += `- ${s.mode}: ${s._costVsSolo === null ? '-' : `${s._costVsSolo.toFixed(2)}x`}\n`;
  }
  if (prices) md += `\nPriced Cost uses ${prices.in},${prices.cacheRead},${prices.cacheWrite},${prices.out} USD per 1M tokens (in, cache read, cache write, out) and assumes input excludes cached tokens (VERIFY).\n`;
  return md;
}

async function main() {
  const HOME = arg('home');
  const MODEL = arg('model');
  const RUN = process.argv.includes('--run');
  const DRY = process.argv.includes('--dry-run');
  const OUT = arg('out') || (HOME ? path.join(HOME, 'bench-out') : null);
  const REPEATS = parseInt(arg('repeats') || '3', 10);
  const MAX_RUNS = parseInt(arg('max-runs') || '200', 10);
  const MAX_USD = parseMaxUsd(arg('max-usd') || '4');
  const VARIANT = arg('variant') || 'lean';
  const TIMEOUT = parseInt(arg('timeout') || '900000', 10);
  const MODES = (arg('modes') || process.env.MODES || DEFAULT_MODES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

  let parsedPrices = null;
  if (process.argv.includes('--prices')) {
    const raw = (arg('prices') || '').split(',');
    const parts = raw.map(Number);
    if (raw.length !== 4 || raw.some((p) => !/^\d+(\.\d+)?$/.test(p.trim()))) {
      console.error('bench-multiagent: --prices needs 4 numbers: in,cacheRead,cacheWrite,out');
      process.exit(1);
    }
    parsedPrices = { in: parts[0], cacheRead: parts[1], cacheWrite: parts[2], out: parts[3] };
  }

  if (!['baseline', 'lean'].includes(VARIANT)) {
    console.error(`Unknown variant: ${VARIANT}. Allowed: baseline, lean`);
    process.exit(2);
  }
  for (const mode of MODES) {
    if (!/^solo$/.test(mode) && !/^workers-[124]$/.test(mode)) {
      console.error(`Unknown mode: ${mode}. Allowed: solo, workers-1, workers-2, workers-4`);
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

  const sessionsPerRepeat = MODES.reduce((sum, mode) => sum + sessionsForMode(mode), 0);
  const totalSessions = sessionsPerRepeat * REPEATS;
  console.log('Plan:');
  console.log(`  HOME:             ${HOME}`);
  console.log(`  MODEL:            ${MODEL || '(none)'}`);
  console.log(`  OUT:              ${OUT}`);
  console.log(`  REPEATS:          ${REPEATS}`);
  console.log(`  VARIANT:          ${VARIANT}`);
  console.log(`  MODES:            ${MODES.join(',')}`);
  for (const mode of MODES) console.log(`    ${mode}: ${sessionsForMode(mode)} sessions per repeat`);
  console.log(`  SESSIONS/REPEAT:  ${sessionsPerRepeat}`);
  console.log(`  ESTIMATED SESSIONS: ${totalSessions}`);
  console.log(`  MAX RUNS:         ${MAX_RUNS}`);
  console.log(`  MAX USD:          ${MAX_USD}`);
  console.log(`  SESSION TIMEOUT:  ${TIMEOUT}ms`);

  if (RUN && totalSessions > MAX_RUNS) {
    console.error(`Error: Estimated sessions (${totalSessions}) exceed --max-runs (${MAX_RUNS})`);
    process.exit(2);
  }

  if (!RUN || DRY) {
    console.log(`\nDry run: exiting 0. Pass --run and --model to execute.`);
    process.exit(0);
  }

  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) {
    console.error('--run needs OPENROUTER_API_KEY');
    process.exit(2);
  }

  let startSpend;
  try { startSpend = await keySpend(KEY); } catch (e) { console.error(`Budget check failed: ${e.message}`); process.exit(2); }
  let totalCost = 0;
  // Hard stop before every session, not just between runs.
  const budget = async () => {
    let spent;
    try { spent = (await keySpend(KEY)) - startSpend; } catch (e) { throw new Error(`Budget check failed: ${e.message}. Stopping.`); }
    totalCost = Math.max(totalCost, spent);
    if (totalCost >= MAX_USD) throw new Error(`Budget reached ($${totalCost.toFixed(4)} >= $${MAX_USD}). Stopping.`);
  };

  const results = [];
  let stopped = false;
  try {
    for (const mode of MODES) {
      for (let n = 1; n <= REPEATS; n++) {
        const runRoot = path.join(HOME, 'runs', `${mode}-${n}`);
        fs.mkdirSync(runRoot, { recursive: true });
        const baseDir = path.join(runRoot, 'base');
        fs.mkdirSync(baseDir, { recursive: true });
        TASK9.setup(baseDir);
        const runLabel = `${mode}-${n}`;
        console.log(`\nRunning ${mode} repeat ${n}/${REPEATS}...`);

        const record = { mode, repeat: n, pass: false, conflict: false, sessions: [], wallTime: 0 };
        let finalDir;

        if (mode === 'solo') {
          finalDir = path.join(runRoot, 'workspace');
          TASK9.setup(finalDir);
          initGit(finalDir);
          const res = await runSession({
            name: 'solo', workdir: finalDir, home: path.join(runRoot, 'home-solo'), prompt: TASK9.prompt,
            model: MODEL, timeout: TIMEOUT, variant: VARIANT, outDir: OUT, key: KEY, budget, runLabel,
          });
          record.sessions.push(summarizeSession(res, parsedPrices));
          record.wallTime = res.wallTime;
        } else {
          const workerCount = parseInt(mode.split('-')[1], 10);
          const split = splitBugs(TASK9_BUG_TESTS, workerCount).filter((files) => files.length > 0);
          const workerRuns = split.map((files, i) => {
            const workdir = path.join(runRoot, `worker-${i}`);
            TASK9.setup(workdir);
            initGit(workdir);
            const prompt = `Run node --test ${files.join(' ')} and fix those failing tests without editing test files.`;
            return runSession({
              name: `worker-${i}`, workdir, home: path.join(runRoot, `home-worker-${i}`), prompt,
              model: MODEL, timeout: TIMEOUT, variant: VARIANT, outDir: OUT, key: KEY, budget, runLabel,
            });
          });
          const workerResults = await Promise.all(workerRuns);
          workerResults.forEach((res) => record.sessions.push(summarizeSession(res, parsedPrices)));

          finalDir = path.join(runRoot, 'merged');
          TASK9.setup(finalDir);
          initGit(finalDir);
          const changes = workerResults.map((res) => collectChanges(baseDir, res.workdir));
          const merge = mergeWorkerChanges(finalDir, changes);
          record.conflict = merge.conflict;
          const maxWorkerTime = Math.max(...workerResults.map((res) => res.wallTime), 0);
          if (!merge.conflict) {
            const reviewer = await runSession({
              name: 'reviewer', workdir: finalDir, home: path.join(runRoot, 'home-reviewer'), prompt: REVIEWER_PROMPT,
              model: MODEL, timeout: TIMEOUT, variant: VARIANT, outDir: OUT, key: KEY, budget, runLabel,
            });
            record.sessions.push(summarizeSession(reviewer, parsedPrices));
            record.wallTime = maxWorkerTime + reviewer.wallTime;
          } else {
            console.error(`  Conflict: two workers changed the same file. Run fails.`);
            record.wallTime = maxWorkerTime;
          }
        }

        record.pass = !record.conflict && TASK9.check(finalDir);
        record.inputTokens = record.sessions.reduce((s, x) => s + x.inputTokens, 0);
        record.outputTokens = record.sessions.reduce((s, x) => s + x.outputTokens, 0);
        record.turns = record.sessions.reduce((s, x) => s + x.turns, 0);
        record.cost = record.sessions.reduce((s, x) => s + x.cost, 0);
        record.pricedCost = parsedPrices ? record.sessions.reduce((s, x) => s + (x.pricedCost || 0), 0) : null;
        try { totalCost = Math.max(totalCost, (await keySpend(KEY)) - startSpend); } catch {}
        console.log(`  Pass: ${record.pass}, Conflict: ${record.conflict}, Sessions: ${record.sessions.length}, In: ${record.inputTokens}, Out: ${record.outputTokens}, Cost: $${record.cost.toFixed(4)}, Time: ${record.wallTime}ms`);
        results.push(record);
      }
    }
  } catch (e) {
    stopped = true;
    console.error(`\nStopping: ${e.message}`);
  }

  if (OUT) {
    const opencodeVersion = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    const leanCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

    const summary = [];
    for (const mode of MODES) {
      const rs = results.filter((r) => r.mode === mode);
      if (rs.length === 0) continue;
      summary.push({
        mode,
        runs: rs.length,
        passRate: rs.filter((r) => r.pass).length / rs.length,
        conflicts: rs.filter((r) => r.conflict).length,
        input: getStats(rs.map((r) => r.inputTokens)),
        output: getStats(rs.map((r) => r.outputTokens)),
        turns: getStats(rs.map((r) => r.turns)),
        time: getStats(rs.map((r) => r.wallTime)),
        cost: rs.reduce((sum, r) => sum + r.cost, 0),
        pricedCost: parsedPrices ? rs.reduce((sum, r) => sum + r.pricedCost, 0) : null,
      });
    }

    const resultsJson = {
      date: new Date().toISOString().split('T')[0],
      model: MODEL,
      variant: VARIANT,
      opencodeVersion,
      leanCommit,
      runUrl,
      repeats: REPEATS,
      modes: MODES,
      prices: parsedPrices,
      stopped,
      totalCost,
      summary,
      runs: results,
    };
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(resultsJson, null, 2));
    const md = renderMultiMarkdown(summary, parsedPrices);
    fs.writeFileSync(path.join(OUT, 'results.md'), md);
    console.log(`\nWrote results to ${OUT}`);
    console.log(md);
  }

  if (stopped) process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}