// Wall-clock of recent pull_request ci.yml runs: median and p90, the job that finished last, the jobs that waited longest for a runner.
//   node scripts/ci-timing.mjs [N=30] [--json]      (needs `gh` logged in; read-only)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const min = (a, b) => (new Date(b) - new Date(a)) / 60000;
const round = (n) => Math.round(n * 10) / 10;

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

// runs: [{ createdAt, jobs: [{ name, startedAt, completedAt }] }]. Jobs that never started (skipped) are ignored.
export function summarize(runs) {
  const walls = [];
  const last = {};
  const waits = {};
  for (const r of runs) {
    const jobs = r.jobs.filter((j) => j.startedAt && j.completedAt && !j.startedAt.startsWith('0001'));
    if (!jobs.length) continue;
    const end = jobs.reduce((a, b) => (new Date(b.completedAt) > new Date(a.completedAt) ? b : a));
    walls.push(min(r.createdAt, end.completedAt));
    last[end.name] = (last[end.name] || 0) + 1;
    for (const j of jobs) (waits[j.name] ||= []).push(min(r.createdAt, j.startedAt));
  }
  walls.sort((a, b) => a - b);
  const queue = Object.entries(waits)
    .map(([name, w]) => ({ name, median: round(pct(w.sort((a, b) => a - b), 0.5)), max: round(w[w.length - 1]), runs: w.length }))
    .sort((a, b) => b.median - a.median)
    .slice(0, 5);
  return {
    runs: walls.length,
    median: walls.length ? round(pct(walls, 0.5)) : null,
    p90: walls.length ? round(pct(walls, 0.9)) : null,
    lastJob: Object.entries(last).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    queue,
  };
}

export function collect(exec, n = 30) {
  const gh = (args) => JSON.parse(exec(args));
  const list = gh(['run', 'list', '--workflow', 'ci.yml', '--event', 'pull_request', '--status', 'completed', '--limit', String(n), '--json', 'databaseId,createdAt']);
  return list.map((r) => ({ createdAt: r.createdAt, jobs: gh(['run', 'view', String(r.databaseId), '--json', 'jobs']).jobs }));
}

export function format(s) {
  const lines = [`${s.runs} runs: median ${s.median} min, p90 ${s.p90} min (run created to last job end)`, '', 'last job to finish   runs'];
  for (const j of s.lastJob.slice(0, 5)) lines.push(`${j.name.padEnd(36)} ${j.count}`);
  lines.push('', 'queue wait (job start minus run creation)   median  max');
  for (const q of s.queue) lines.push(`${q.name.padEnd(44)} ${String(q.median).padStart(6)} ${String(q.max).padStart(5)}`);
  return lines.join('\n');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const n = Number(args.find((a) => /^\d+$/.test(a))) || 30;
  const exec = (a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const s = summarize(collect(exec, n));
  console.log(args.includes('--json') ? JSON.stringify(s, null, 2) : format(s));
}
