#!/usr/bin/env node
// Savings benchmark harness (#370)
// Usage: node tests/bench-savings.mjs --home <throwaway dir> [--run] --model <provider/model#variant> [--out <dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'bench-savings');
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : null; };

// Exported for tests
export function parseTokenUsage(out) {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of out.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const ev = JSON.parse(line);
      // VERIFY: OpenCode 2 JSON event format for token reporting
      if (ev.type === 'usage') {
        inputTokens += (ev.inputTokens || 0);
        outputTokens += (ev.outputTokens || 0);
      }
    } catch {}
  }
  return { inputTokens, outputTokens };
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
];

async function main() {
  const HOME = arg('home');
  const MODEL = arg('model');
  const RUN = process.argv.includes('--run');
  const OUT = arg('out') || (HOME ? path.join(HOME, 'bench-out') : null);

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

  console.log(`Plan:`);
  console.log(`  HOME:  ${HOME}`);
  console.log(`  MODEL: ${MODEL || '(none)'}`);
  console.log(`  OUT:   ${OUT}`);
  console.log(`  TASKS: ${TASKS.length}`);

  if (!RUN) {
    console.log(`\nDry run: exiting 0. Pass --run and --model to execute.`);
    process.exit(0);
  }

  const results = [];

  for (const task of TASKS) {
    for (const mode of ['baseline', 'lean']) {
      const runHome = path.join(HOME, `run-${task.id}-${mode}`);
      const workdir = path.join(runHome, 'workspace');
      fs.mkdirSync(workdir, { recursive: true });
      fs.cpSync(FIXTURES, workdir, { recursive: true });

      console.log(`\nRunning ${task.id} (${mode})...`);
      
      const childEnv = { PATH: process.env.PATH || '', ...(process.env.NVM_DIR ? { NVM_DIR: process.env.NVM_DIR } : {}), HOME: runHome, USERPROFILE: runHome };

      if (mode === 'lean') {
        const leanArgs = ['scripts/lean.mjs', '--home', runHome, '--yes', '--agents', 'opencode-v2'];
        console.log(`  Setup: node ${leanArgs.join(' ')}`);
        const leanRes = spawnSync(process.execPath, [path.join(ROOT, leanArgs[0]), ...leanArgs.slice(1)], { env: childEnv });
        if (leanRes.status !== 0) {
          console.error(`  Lean setup failed`);
        }
      }

      const args = ['run', '--format', 'json', '--model', MODEL, task.prompt];
      console.log(`  Exec: opencode ${args.join(' ')}`);

      const start = Date.now();
      const res = spawnSync('opencode', args, {
        cwd: workdir,
        env: childEnv,
        encoding: 'utf8',
      });
      const wallTime = Date.now() - start;

      const { inputTokens, outputTokens } = parseTokenUsage(res.stdout || '');
      const pass = task.check(workdir);

      console.log(`  Pass: ${pass}, In: ${inputTokens}, Out: ${outputTokens}, Time: ${wallTime}ms`);
      
      results.push({
        task: task.id,
        mode,
        pass,
        inputTokens,
        outputTokens,
        wallTime,
      });
    }
  }

  if (OUT) {
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    
    let md = '| Task | Mode | Pass | In Tokens | Out Tokens | Time (ms) |\n';
    md += '|---|---|---|---|---|---|\n';
    for (const r of results) {
      md += `| ${r.task} | ${r.mode} | ${r.pass ? '✅' : '❌'} | ${r.inputTokens} | ${r.outputTokens} | ${r.wallTime} |\n`;
    }
    fs.writeFileSync(path.join(OUT, 'results.md'), md);
    console.log(`\nWrote results to ${OUT}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
