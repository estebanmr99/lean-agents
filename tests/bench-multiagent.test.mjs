import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitBugs, mergeWorkerChanges, collectChanges, parseMaxUsd, isPositiveInt, fitsHeadroom, costVsSolo, sessionsForMode, renderMultiMarkdown, runOpenCode, summarizeSession, summarizeRuns, totalSessionCost, TASK9_BUG_TESTS, budgetSpent, workerTasks, isMultiagentTask, DEFAULT_TASK } from './bench-multiagent.mjs';
import { parseTokenUsage, TASKS, seededBugReport } from './bench-savings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tests', 'bench-multiagent.mjs');
const tmp = (label) => path.join(os.tmpdir(), `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);

test('round-robin split covers 3 bugs for 1, 2 and 4 workers', () => {
  assert.deepStrictEqual(splitBugs(TASK9_BUG_TESTS, 1), [TASK9_BUG_TESTS]);
  assert.deepStrictEqual(splitBugs(TASK9_BUG_TESTS, 2), [['tests/test_c_2.test.mjs', 'tests/test_a_8.test.mjs'], ['tests/test_b_5.test.mjs']]);
  const w4 = splitBugs(TASK9_BUG_TESTS, 4);
  assert.deepStrictEqual(w4, [['tests/test_c_2.test.mjs'], ['tests/test_b_5.test.mjs'], ['tests/test_a_8.test.mjs'], []]);
  // Every bug is assigned exactly once.
  assert.deepStrictEqual(w4.flat().sort(), [...TASK9_BUG_TESTS].sort());
  assert.strictEqual(sessionsForMode('solo', TASK9_BUG_TESTS), 1);
  assert.strictEqual(sessionsForMode('workers-1', TASK9_BUG_TESTS), 2);
  assert.strictEqual(sessionsForMode('workers-2', TASK9_BUG_TESTS), 3);
  // The empty fourth worker is not started; only 3 workers plus the reviewer run.
  assert.strictEqual(sessionsForMode('workers-4', TASK9_BUG_TESTS), 4);
});

test('task12 splits its four independent parts across 1, 2 and 4 workers', () => {
  const parts = DEFAULT_TASK.parts;
  assert.strictEqual(parts.length, 4);
  assert.strictEqual(isMultiagentTask(DEFAULT_TASK), true);
  assert.deepStrictEqual(workerTasks(DEFAULT_TASK), parts);
  assert.deepStrictEqual(splitBugs(parts, 1), [parts]);
  const w2 = splitBugs(parts, 2);
  assert.deepStrictEqual(w2.map((x) => x.length), [2, 2]);
  assert.deepStrictEqual(w2.flat().map((p) => p.id).sort(), parts.map((p) => p.id).sort());
  const w4 = splitBugs(parts, 4);
  assert.deepStrictEqual(w4.map((x) => x.length), [1, 1, 1, 1]);
  assert.deepStrictEqual(w4.flat(), parts);
  assert.strictEqual(sessionsForMode('solo', parts), 1);
  assert.strictEqual(sessionsForMode('workers-1', parts), 2);
  assert.strictEqual(sessionsForMode('workers-2', parts), 3);
  assert.strictEqual(sessionsForMode('workers-4', parts), 5);
});

test('seeded bug detection counts fixed and left bugs, and reviewer fixes', () => {
  const task = TASKS.find((t) => t.id === 'task12');
  const dir = tmp('bench-multi-bugs');
  fs.mkdirSync(dir, { recursive: true });
  task.setup(dir);
  const before = seededBugReport(dir, task.bugs);
  assert.deepStrictEqual({ total: before.total, fixed: before.fixed, left: before.left }, { total: 3, fixed: 0, left: 3 });
  assert.deepStrictEqual(before.bugs.map((b) => b.fixed), [false, false, false]);

  const strings = path.join(dir, 'lib', 'strings.mjs');
  fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8').replace('max + 1', 'max'));
  const after = seededBugReport(dir, task.bugs);
  assert.deepStrictEqual({ total: after.total, fixed: after.fixed, left: after.left }, { total: 3, fixed: 1, left: 2 });

  const results = [
    { mode: 'workers-2', pass: true, conflict: false, cost: 0.01, pricedCost: 0.02, inputTokens: 10, outputTokens: 5, turns: 2, wallTime: 100, seededBugs: 3, seededBugsFixed: 1, seededBugsFixedByReviewer: 1 },
    { mode: 'workers-2', pass: true, conflict: false, cost: 0.01, pricedCost: 0.02, inputTokens: 10, outputTokens: 5, turns: 2, wallTime: 100, seededBugs: 3, seededBugsFixed: 3, seededBugsFixedByReviewer: 0 },
  ];
  const summary = summarizeRuns(results, ['workers-2'], null);
  assert.strictEqual(summary[0].seededBugs, 3);
  assert.strictEqual(summary[0].seededBugsFixed, 2);
  assert.strictEqual(summary[0].seededBugsFixedByReviewer, 0.5);
  const md = renderMultiMarkdown(summary, null);
  assert.match(md, /\| workers-2 \| 100% \| 2\/3 \(\+0\.5 review\) \|/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('merge copies disjoint worker changes and detects a same-file conflict', () => {
  const root = tmp('bench-multi-merge');
  const base = path.join(root, 'base');
  const w1 = path.join(root, 'w1');
  const w2 = path.join(root, 'w2');
  const merged = path.join(root, 'merged');
  for (const dir of [base, w1, w2, merged]) fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(base, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(base, 'src', 'one.mjs'), 'export const one = 1;\n');
  fs.writeFileSync(path.join(base, 'src', 'two.mjs'), 'export const two = 2;\n');
  fs.writeFileSync(path.join(base, 'tests', 'one.test.mjs'), 'test();\n');
  for (const dir of [w1, w2, merged]) fs.cpSync(base, dir, { recursive: true });

  fs.writeFileSync(path.join(w1, 'src', 'one.mjs'), 'export const one = 10;\n');
  fs.writeFileSync(path.join(w2, 'src', 'two.mjs'), 'export const two = 20;\n');
  const ok = mergeWorkerChanges(merged, [collectChanges(base, w1), collectChanges(base, w2)]);
  assert.strictEqual(ok.conflict, false);
  assert.strictEqual(fs.readFileSync(path.join(merged, 'src', 'one.mjs'), 'utf8'), 'export const one = 10;\n');
  assert.strictEqual(fs.readFileSync(path.join(merged, 'src', 'two.mjs'), 'utf8'), 'export const two = 20;\n');

  // A worker's test edit is not merged.
  fs.writeFileSync(path.join(w1, 'tests', 'one.test.mjs'), 'test("changed");\n');
  const onlySrc = collectChanges(base, w1);
  assert.strictEqual(onlySrc.has('tests/one.test.mjs'), false);

  fs.writeFileSync(path.join(w2, 'src', 'one.mjs'), 'export const one = 99;\n');
  const bad = mergeWorkerChanges(merged, [collectChanges(base, w1), collectChanges(base, w2)]);
  assert.strictEqual(bad.conflict, true);
  assert.ok(bad.files.includes('src/one.mjs'));
  // Nothing is copied on a conflict.
  assert.strictEqual(fs.readFileSync(path.join(merged, 'src', 'one.mjs'), 'utf8'), 'export const one = 10;\n');

  fs.rmSync(root, { recursive: true, force: true });
});

test('--dry-run prints one session count per mode and spawns nothing', () => {
  const home = tmp('bench-multi-dry');
  // An empty PATH would make any child spawn fail, so exit 0 proves no spawn happened.
  const res = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--repeats', '1'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /Plan:/);
  assert.match(res.stdout, /TASK:\s+task12 \(4 parts, 3 seeded bugs\)/);
  assert.match(res.stdout, /solo: 1 sessions per repeat/);
  assert.match(res.stdout, /workers-1: 2 sessions per repeat/);
  assert.match(res.stdout, /workers-2: 3 sessions per repeat/);
  assert.match(res.stdout, /workers-4: 5 sessions per repeat/);
  assert.match(res.stdout, /ESTIMATED SESSIONS: 11/);
  assert.match(res.stdout, /Dry run: exiting 0/);
  assert.strictEqual(fs.existsSync(path.join(home, 'runs')), false);

  // task9 stays selectable and keeps its three-bug split.
  const task9 = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--task', 'task9', '--repeats', '1'], { encoding: 'utf8' });
  assert.strictEqual(task9.status, 0, task9.stderr);
  assert.match(task9.stdout, /TASK:\s+task9 \(3 parts, 0 seeded bugs\)/);
  assert.match(task9.stdout, /ESTIMATED SESSIONS: 10/);

  const unknown = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--task', 'nope'], { encoding: 'utf8' });
  assert.strictEqual(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown task: nope/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('--max-usd is capped at 5 and falls back to 4 for non-numeric input', () => {
  assert.strictEqual(parseMaxUsd('10'), 5);
  assert.strictEqual(parseMaxUsd('2.5'), 2.5);
  assert.strictEqual(parseMaxUsd('nonsense'), 4);
  const home = tmp('bench-multi-usd');
  const res = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--max-usd', '10'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /MAX USD:\s+5\n/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('budget keeps the summed session cost as a floor when the key spend is flat', () => {
  assert.strictEqual(budgetSpent(0, 2), 2);
  assert.strictEqual(budgetSpent(1.5, 0.5), 1.5);
  assert.strictEqual(budgetSpent(0, 0), 0);
});

test('headroom refuses a group whose worst case reaches the cap', () => {
  assert.strictEqual(isPositiveInt('3'), true);
  assert.strictEqual(isPositiveInt('0'), false);
  assert.strictEqual(isPositiveInt('-1'), false);
  assert.strictEqual(isPositiveInt('abc'), false);
  assert.strictEqual(isPositiveInt('2.5'), false);

  // spent 2 + 4 x 0.75 = 5, not below the 5 cap.
  assert.strictEqual(fitsHeadroom(2, 0.75, 4, 5), false);
  assert.strictEqual(fitsHeadroom(2, 0.7, 4, 5), true);
  // The default 0.5 estimate fits a single solo session.
  assert.strictEqual(fitsHeadroom(0, 0.5, 1, 4), true);
});

test('flag validation rejects non-positive counts and dash-leading models', () => {
  const home = tmp('bench-multi-flags');
  const bad = [
    ['--repeats', '0'],
    ['--repeats', '-2'],
    ['--repeats', 'abc'],
    ['--max-runs', '0'],
    ['--timeout', '-5'],
    ['--model', '-x'],
  ];
  for (const args of bad) {
    const res = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', ...args], { encoding: 'utf8' });
    assert.strictEqual(res.status, 2, `${args.join(' ')} -> ${res.status} ${res.stderr}`);
    assert.match(res.stderr, /bench-multiagent:/);
  }
  const ok = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--repeats', '1', '--max-runs', '10', '--timeout', '1000'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  fs.rmSync(home, { recursive: true, force: true });
});

test('cost vs solo uses the median per-run cost of each mode', () => {
  const runs = [
    { mode: 'solo', cost: 0.01, pricedCost: 0.02 },
    { mode: 'solo', cost: 0.03, pricedCost: 0.04 },
    { mode: 'workers-2', cost: 0.04, pricedCost: 0.10 },
    { mode: 'workers-2', cost: 0.06, pricedCost: 0.14 },
  ];
  // Median solo cost 0.02, median workers cost 0.05.
  assert.ok(Math.abs(costVsSolo(runs, null)['workers-2'] - 2.5) < 1e-9);
  // Priced medians: solo 0.03, workers 0.12.
  assert.ok(Math.abs(costVsSolo(runs, { in: 1 })['workers-2'] - 4) < 1e-9);
  assert.strictEqual(costVsSolo([{ mode: 'workers-2', cost: 1 }], null)['workers-2'], null);
});

test('a long-running child is killed on timeout', async () => {
  const spawnImpl = (cmd, args, opts) => spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1e6)'], opts);
  const res = await runOpenCode({
    cwd: ROOT,
    home: tmp('bench-multi-home'),
    prompt: 'x',
    model: 'test/model',
    timeout: 200,
    variant: 'lean',
    key: '',
    spawnImpl,
  });
  assert.strictEqual(res.timedOut, true);
  let alive = false;
  try { process.kill(res.pid, 0); alive = true; } catch {}
  assert.strictEqual(alive, false);
});

test('--prices needs four numbers', () => {
  const home = tmp('bench-multi-prices');
  const bad = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--prices', '1,2,3'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /bench-multiagent: --prices needs 4 numbers: in,cacheRead,cacheWrite,out/);
  const ok = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--prices', '1,0.5,1,2'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
  fs.rmSync(home, { recursive: true, force: true });
});

test('results.md renders a table, seeded bugs and cost vs solo from a hand-made summary', () => {
  const summary = [
    { mode: 'solo', passRate: 1, seededBugs: 3, seededBugsFixed: 1, seededBugsFixedByReviewer: 1, input: { median: 1000 }, output: { median: 100 }, turns: { median: 5 }, time: { median: 2000 }, cost: 0.01, pricedCost: 0.02, costVsSolo: 1 },
    { mode: 'workers-2', passRate: 0.5, seededBugs: 3, seededBugsFixed: 2, seededBugsFixedByReviewer: 0, input: { median: 1600 }, output: { median: 180 }, turns: { median: 9 }, time: { median: 1200 }, cost: 0.02, pricedCost: 0.04, costVsSolo: 2 },
  ];
  const md = renderMultiMarkdown(summary, { in: 1, cacheRead: 0.5, cacheWrite: 1, out: 2 });
  assert.match(md, /\| Mode \| Pass Rate \| Seeded Bugs \| Median In \| Median Out \| Median Turns \| Median Time \| Cost \| Priced Cost \|/);
  assert.match(md, /\| solo \| 100% \| 1\/3 \(\+1 review\) \| 1000 \| 100 \| 5 \| 2000ms \| \$0.0100 \| \$0.0200 \|/);
  assert.match(md, /\| workers-2 \| 50% \| 2\/3 \| 1600 \| 180 \| 9 \| 1200ms \| \$0.0200 \| \$0.0400 \|/);
  assert.match(md, /Cost vs solo:\n- solo: 1\.00x\n- workers-2: 2\.00x/);
  const noPrices = renderMultiMarkdown(summary, null);
  assert.doesNotMatch(noPrices, /Priced Cost/);
  assert.match(noPrices, /workers-2: 2\.00x/);
});

test('session cost is summed from the JSON step usage stream, not the key spend', () => {
  const stream = [
    JSON.stringify({ type: 'step_start' }),
    JSON.stringify({ type: 'step-finish', tokens: { input: 100, output: 20, cache: { read: 5, write: 1 } }, cost: 0.0012 }),
    JSON.stringify({ type: 'step-finish', tokens: { input: 50, output: 10 }, cost: 0.0008 }),
  ].join('\n');
  const usage = parseTokenUsage(stream);
  const solo = summarizeSession({ name: 'solo', usage, wallTime: 123, timedOut: false, status: 0 }, null);
  assert.strictEqual(solo.cost, 0.002);
  assert.strictEqual(solo.inputTokens, 150);
  assert.strictEqual(totalSessionCost([solo]), 0.002);

  const worker = summarizeSession({ name: 'worker-0', usage: parseTokenUsage(stream), wallTime: 100, timedOut: false, status: 0 }, null);
  const results = [
    { mode: 'solo', cost: totalSessionCost([solo]), pricedCost: null, pass: true, conflict: false, inputTokens: 150, outputTokens: 30, turns: 2, wallTime: 123 },
    { mode: 'workers-1', cost: totalSessionCost([worker, worker]), pricedCost: null, pass: true, conflict: false, inputTokens: 300, outputTokens: 60, turns: 4, wallTime: 100 },
  ];
  const summary = summarizeRuns(results, ['solo', 'workers-1'], null);
  assert.ok(summary[0].cost > 0);
  assert.ok(summary[1].cost > 0);
  const md = renderMultiMarkdown(summary, null);
  assert.match(md, /\| solo \| 100% \| n\/a \| 150 \| 30 \| 2 \| 123ms \| \$0\.0020 \|/);
  assert.match(md, /\| workers-1 \| 100% \| n\/a \| 300 \| 60 \| 4 \| 100ms \| \$0\.0040 \|/);
  assert.match(md, /Cost vs solo:\n- solo: 1\.00x\n- workers-1: 2\.00x/);
});

test('workflow exposes task input and a 1-token smoke test before the run', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'bench-multiagent.yml'), 'utf8');
  assert.match(text, /^\s{6}task:\s*$/m);
  assert.match(text, /default: 'task12'/);
  assert.match(text, /max_tokens: 1/);
  assert.ok(text.indexOf('Provider smoke test') > -1);
  assert.ok(text.indexOf('Provider smoke test') < text.indexOf('Run Benchmark'));
  assert.ok(text.indexOf('--task "$TASK"') > text.indexOf('Run Benchmark'));
});

test('every pinned OpenCode install also puts .opencode/bin on GITHUB_PATH', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  // Step = a list item at step indentation plus its indented body.
  const steps = (text) => {
    const blocks = [];
    let current = null;
    for (const line of text.split('\n')) {
      if (/^\s{4,}-\s/.test(line)) {
        if (current) blocks.push(current.join('\n'));
        current = [line];
      } else if (current) {
        current.push(line);
      }
    }
    if (current) blocks.push(current.join('\n'));
    return blocks;
  };
  const offenders = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    for (const step of steps(text)) {
      const runAt = step.search(/^\s*run:/m);
      if (runAt === -1 || step.indexOf('ci-install-opencode-v2.sh') < runAt) continue;
      if (!step.includes('.opencode/bin') || !step.includes('GITHUB_PATH')) offenders.push(name);
    }
  }
  assert.deepStrictEqual(offenders, [], `steps install OpenCode without exporting .opencode/bin: ${offenders.join(', ')}`);
});

test('a session with no usage events costs n/a, not zero', () => {
  const empty = summarizeSession({ name: 'solo', usage: parseTokenUsage('{"type":"step_start"}'), wallTime: 10, timedOut: false, status: 0 }, null);
  assert.strictEqual(empty.cost, null);
  assert.strictEqual(totalSessionCost([empty]), null);

  const results = [{ mode: 'solo', cost: totalSessionCost([empty]), pricedCost: null, pass: false, conflict: false, inputTokens: 0, outputTokens: 0, turns: 0, wallTime: 10 }];
  const md = renderMultiMarkdown(summarizeRuns(results, ['solo'], null), null);
  assert.match(md, /\| solo \| 0% \| n\/a \| 0 \| 0 \| 0 \| 10ms \| n\/a \|/);
  assert.match(md, /- solo: n\/a/);
  assert.doesNotMatch(md, /\$0\.0000/);
});