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

// Owner budget cap: never more than USD 5 for one run. Non-numeric input falls back to 4.
export function parseMaxUsd(raw) {
  const n = parseFloat(raw);
  return Math.min(5, Number.isFinite(n) ? n : 4);
}

export function isPositiveInt(raw) {
  return /^\d+$/.test(String(raw)) && parseInt(raw, 10) > 0;
}

// A group of N parallel sessions may only start if its worst case still fits the cap.
export function fitsHeadroom(spent, est, sessions, maxUsd) {
  return spent + sessions * est < maxUsd;
}

// Cost vs solo compares the median per-run cost of each mode with solo's median.
// With --prices the token-priced cost is used instead of the provider-reported cost.
export function costVsSolo(runs, prices) {
  const median = (rs) => getStats(rs.map((r) => (prices ? (r.pricedCost || 0) : r.cost))).median;
  const solo = runs.filter((r) => r.mode === 'solo');
  const base = solo.length > 0 ? median(solo) : 0;
  const out = {};
  for (const mode of new Set(runs.map((r) => r.mode))) {
    const rs = runs.filter((r) => r.mode === mode);
    out[mode] = base > 0 ? median(rs) / base : null;
  }
  return out;
}

const liveChildren = new Set();

export function killChild(child) {
  if (!child) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }
  liveChildren.delete(child);
}

export function killAllLive() {
  for (const child of [...liveChildren]) killChild(child);
}

let cleanupHandlersInstalled = false;
export function installCleanupHandlers() {
  if (cleanupHandlersInstalled) return;
  cleanupHandlersInstalled = true;
  process.on('exit', killAllLive);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(signal, () => { killAllLive(); process.exit(code); });
  }
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
  spawnSync('git', ['-C', dir, '-c', 'user.name=bench', '-c', 'user.email=bench@example.com', 'commit', '-qm', 'base'], { encoding: 'utf8' });
}

function sessionEnv(home) {
  const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home };
  if (process.env.NVM_DIR) env.NVM_DIR = process.env.NVM_DIR;
  if (process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  return env;
}

export function runOpenCode({ cwd, home, prompt, model, timeout, variant, logPath, key, spawnImpl = spawn }) {
  return new Promise((resolve) => {
    const args = ['run', '--standalone', '--agent', 'build', '--format', 'json', '--model', model, prompt];
    const start = Date.now();
    const child = spawnImpl('opencode', args, {
      cwd,
      env: sessionEnv(home),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    liveChildren.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
    }, timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const done = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      liveChildren.delete(child);
      if (logPath) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, redactKey(stdout, key));
      }
      resolve({
        stdout, stderr, status, timedOut,
        pid: child.pid,
        signal: child.signalCode,
        wallTime: Date.now() - start,
        usage: parseTokenUsage(stdout),
      });
    };
    child.on('error', (e) => { stderr += String(e.message || e); killChild(child); done(-1); });
    child.on('close', (code) => done(code));
  });
}

// Setup runs for every session home before any worker starts, so installers never race.
function prepareSessions(specs, { variant }) {
  for (const spec of specs) {
    fs.mkdirSync(spec.home, { recursive: true });
    const setup = setupVariant({ root: ROOT, home: spec.home, variant, env: sessionEnv(spec.home) });
    if (!setup.ok) throw new Error(`lean setup failed for ${spec.name} (exit ${setup.status})`);
  }
}

async function runSession(spec, { model, timeout, variant, outDir, key, runLabel, spawnImpl }) {
  const res = await runOpenCode({
    cwd: spec.workdir,
    home: spec.home,
    prompt: spec.prompt,
    model,
    timeout,
    variant,
    key,
    spawnImpl,
    logPath: path.join(outDir, 'raw', `${runLabel}-${spec.name}.jsonl`),
  });
  return { name: spec.name, workdir: spec.workdir, ...res };
}

const BUDGET_POLL_MS = 30000;
const START_EST_USD = 0.5;

function createBudget({ key, maxUsd }) {
  let startSpend = 0;
  let spent = 0;
  let est = START_EST_USD;
  return {
    async init() { startSpend = await keySpend(key); spent = 0; },
    async refresh() {
      const now = await keySpend(key);
      spent = Math.max(spent, now - startSpend);
      return spent;
    },
    get spent() { return spent; },
    get est() { return est; },
    observeRun(cost, sessions) {
      if (sessions > 0) est = Math.max(est, cost / sessions);
    },
    async requireHeadroom(sessions) {
      await this.refresh();
      if (!fitsHeadroom(spent, est, sessions, maxUsd)) {
        throw new Error(`Budget headroom: $${spent.toFixed(4)} spent + ${sessions} x $${est.toFixed(4)} est >= $${maxUsd} cap. Stopping.`);
      }
    },
  };
}

// Launch every session in the group together, but refuse the group up front when the
// worst-case estimate does not fit, and kill all live sessions if the poll crosses the cap.
async function runGroup(specs, opts, budget) {
  await budget.requireHeadroom(specs.length);
  prepareSessions(specs, opts);

  let pollError = null;
  let overBudget = false;
  const timer = setInterval(async () => {
    if (pollError || overBudget) return;
    try {
      await budget.refresh();
      if (budget.spent >= opts.maxUsd) {
        overBudget = true;
        killAllLive();
      }
    } catch (e) {
      pollError = e;
      killAllLive();
    }
  }, BUDGET_POLL_MS);

  try {
    const settled = await Promise.allSettled(specs.map((spec) => runSession(spec, opts)));
    if (pollError) throw new Error(`Budget check failed: ${pollError.message}. Stopping.`);
    if (overBudget) throw new Error(`Budget reached ($${budget.spent.toFixed(4)} >= $${opts.maxUsd}). Stopping.`);
    const failed = settled.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    return settled.map((r) => r.value);
  } finally {
    clearInterval(timer);
  }
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
  for (const s of summary) {
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
  }
  md += '\nCost vs solo:\n';
  for (const s of summary) {
    md += `- ${s.mode}: ${s.costVsSolo == null ? '-' : `${s.costVsSolo.toFixed(2)}x`}\n`;
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
  const rawRepeats = arg('repeats');
  const rawMaxRuns = arg('max-runs');
  const rawTimeout = arg('timeout');
  for (const [name, raw] of [['--repeats', rawRepeats], ['--max-runs', rawMaxRuns], ['--timeout', rawTimeout]]) {
    if (raw !== null && !isPositiveInt(raw)) {
      console.error(`bench-multiagent: ${name} must be a positive integer`);
      process.exit(2);
    }
  }
  const REPEATS = rawRepeats === null ? 3 : parseInt(rawRepeats, 10);
  const MAX_RUNS = rawMaxRuns === null ? 200 : parseInt(rawMaxRuns, 10);
  const MAX_USD = parseMaxUsd(arg('max-usd') || '4');
  const VARIANT = arg('variant') || 'lean';
  const TIMEOUT = rawTimeout === null ? 900000 : parseInt(rawTimeout, 10);
  const MODES = (arg('modes') || process.env.MODES || DEFAULT_MODES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

  if (MODEL && MODEL.startsWith('-')) {
    console.error(`bench-multiagent: --model must not start with '-': ${MODEL}`);
    process.exit(2);
  }

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

  const budget = createBudget({ key: KEY, maxUsd: MAX_USD });
  try { await budget.init(); } catch (e) { console.error(`Budget check failed: ${e.message}`); process.exit(2); }

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
        const opts = { model: MODEL, timeout: TIMEOUT, variant: VARIANT, outDir: OUT, key: KEY, runLabel, maxUsd: MAX_USD };
        const costBefore = await budget.refresh();
        let finalDir;

        if (mode === 'solo') {
          finalDir = path.join(runRoot, 'workspace');
          TASK9.setup(finalDir);
          initGit(finalDir);
          const [res] = await runGroup([{
            name: 'solo', workdir: finalDir, home: path.join(runRoot, 'home-solo'), prompt: TASK9.prompt,
          }], opts, budget);
          record.sessions.push(summarizeSession(res, parsedPrices));
          record.wallTime = res.wallTime;
        } else {
          const workerCount = parseInt(mode.split('-')[1], 10);
          const split = splitBugs(TASK9_BUG_TESTS, workerCount).filter((files) => files.length > 0);
          const workerSpecs = split.map((files, i) => {
            const workdir = path.join(runRoot, `worker-${i}`);
            TASK9.setup(workdir);
            initGit(workdir);
            return {
              name: `worker-${i}`, workdir, home: path.join(runRoot, `home-worker-${i}`),
              prompt: `Run node --test ${files.join(' ')} and fix those failing tests without editing test files.`,
            };
          });
          const workerResults = await runGroup(workerSpecs, opts, budget);
          workerResults.forEach((res) => record.sessions.push(summarizeSession(res, parsedPrices)));

          finalDir = path.join(runRoot, 'merged');
          TASK9.setup(finalDir);
          initGit(finalDir);
          const changes = workerResults.map((res) => collectChanges(baseDir, res.workdir));
          const merge = mergeWorkerChanges(finalDir, changes);
          record.conflict = merge.conflict;
          const maxWorkerTime = Math.max(...workerResults.map((res) => res.wallTime), 0);
          if (!merge.conflict) {
            const [reviewer] = await runGroup([{
              name: 'reviewer', workdir: finalDir, home: path.join(runRoot, 'home-reviewer'), prompt: REVIEWER_PROMPT,
            }], opts, budget);
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
        // A run's cost is its real key-spend delta over the whole record.
        record.cost = (await budget.refresh()) - costBefore;
        record.pricedCost = parsedPrices ? record.sessions.reduce((s, x) => s + (x.pricedCost || 0), 0) : null;
        budget.observeRun(record.cost, record.sessions.length);
        console.log(`  Pass: ${record.pass}, Conflict: ${record.conflict}, Sessions: ${record.sessions.length}, In: ${record.inputTokens}, Out: ${record.outputTokens}, Cost: $${record.cost.toFixed(4)}, Time: ${record.wallTime}ms`);
        results.push(record);
      }
    }
  } catch (e) {
    stopped = true;
    console.error(`\nStopping: ${e.message}`);
  }
  const totalCost = budget.spent;

  if (OUT) {
    const opencodeVersion = spawnSync('opencode', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    const leanCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() || 'unknown';
    const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

    const summary = [];
    const ratios = costVsSolo(results, parsedPrices);
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
        costVsSolo: ratios[mode] ?? null,
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
  installCleanupHandlers();
  main().catch((e) => { console.error(e); process.exit(1); });
}