// scripts/ci-timing.mjs against a synthetic gh payload (no network, no gh).
import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, summarize, format } from '../scripts/ci-timing.mjs';

const t = (m) => new Date(Date.UTC(2026, 10, 18, 10, m)).toISOString();
const job = (name, s, e) => ({ name, startedAt: t(s), completedAt: t(e) });
const RUNS = {
  1: [job('lint', 0, 1), job('package (macos-latest)', 9, 10), job('test (ubuntu-latest, 22)', 1, 2)],
  2: [job('lint', 0, 1), job('package (macos-latest)', 3, 4), job('real-windows', 1, 2)],
  3: [job('lint', 0, 1), { name: 'skipped', startedAt: '0001-01-01T00:00:00Z', completedAt: '0001-01-01T00:00:00Z' }],
};

test('collect asks gh for completed pull_request runs and summarize reports wall, last job and queue', () => {
  const calls = [];
  const exec = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify([1, 2, 3].map((id) => ({ databaseId: id, createdAt: t(0) })));
    return JSON.stringify({ jobs: RUNS[args[2]] });
  };
  const s = summarize(collect(exec, 3));
  assert.match(calls[0], /--event pull_request --status completed --limit 3/);
  assert.deepEqual([s.runs, s.median, s.p90], [3, 4, 10]);
  assert.deepEqual(s.lastJob[0], { name: 'package (macos-latest)', count: 2 });
  assert.equal(s.queue[0].name, 'package (macos-latest)');
  assert.deepEqual([s.queue[0].median, s.queue[0].max], [3, 9]);
  assert.ok(!s.queue.some((q) => q.name === 'skipped'));
  assert.match(format(s), /median 4 min, p90 10 min/);
});

test('summarize of no runs does not throw', () => {
  assert.equal(summarize([]).median, null);
});
