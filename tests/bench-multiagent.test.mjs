import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitBugs, mergeWorkerChanges, collectChanges, parseMaxUsd, sessionsForMode, renderMultiMarkdown, TASK9_BUG_TESTS } from './bench-multiagent.mjs';

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
  assert.strictEqual(sessionsForMode('solo'), 1);
  assert.strictEqual(sessionsForMode('workers-1'), 2);
  assert.strictEqual(sessionsForMode('workers-2'), 3);
  // The empty fourth worker is not started; only 3 workers plus the reviewer run.
  assert.strictEqual(sessionsForMode('workers-4'), 4);
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
  assert.match(res.stdout, /solo: 1 sessions per repeat/);
  assert.match(res.stdout, /workers-1: 2 sessions per repeat/);
  assert.match(res.stdout, /workers-2: 3 sessions per repeat/);
  assert.match(res.stdout, /workers-4: 4 sessions per repeat/);
  assert.match(res.stdout, /ESTIMATED SESSIONS: 10/);
  assert.match(res.stdout, /Dry run: exiting 0/);
  assert.strictEqual(fs.existsSync(path.join(home, 'runs')), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('--max-usd is capped at 5', () => {
  assert.strictEqual(parseMaxUsd('10'), 5);
  assert.strictEqual(parseMaxUsd('2.5'), 2.5);
  assert.strictEqual(parseMaxUsd('nonsense'), 5);
  const home = tmp('bench-multi-usd');
  const res = spawnSync(process.execPath, [SCRIPT, '--home', home, '--dry-run', '--max-usd', '10'], { encoding: 'utf8' });
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /MAX USD:\s+5\n/);
  fs.rmSync(home, { recursive: true, force: true });
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

test('results.md renders a table and cost vs solo from a hand-made summary', () => {
  const summary = [
    { mode: 'solo', passRate: 1, input: { median: 1000 }, output: { median: 100 }, turns: { median: 5 }, time: { median: 2000 }, cost: 0.01, pricedCost: 0.02 },
    { mode: 'workers-2', passRate: 0.5, input: { median: 1600 }, output: { median: 180 }, turns: { median: 9 }, time: { median: 1200 }, cost: 0.02, pricedCost: 0.04 },
  ];
  const md = renderMultiMarkdown(summary, { in: 1, cacheRead: 0.5, cacheWrite: 1, out: 2 });
  assert.match(md, /\| Mode \| Pass Rate \| Median In \| Median Out \| Median Turns \| Median Time \| Cost \| Priced Cost \|/);
  assert.match(md, /\| solo \| 100% \| 1000 \| 100 \| 5 \| 2000ms \| \$0.0100 \| \$0.0200 \|/);
  assert.match(md, /\| workers-2 \| 50% \| 1600 \| 180 \| 9 \| 1200ms \| \$0.0200 \| \$0.0400 \|/);
  assert.match(md, /Cost vs solo:\n- solo: 1\.00x\n- workers-2: 2\.00x/);
  const noPrices = renderMultiMarkdown(summary, null);
  assert.doesNotMatch(noPrices, /Priced Cost/);
  assert.match(noPrices, /workers-2: 2\.00x/);
});