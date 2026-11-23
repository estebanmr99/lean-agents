import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTokenUsage } from './bench-savings.mjs';
import { doctor } from '../scripts/lib/doctor.mjs';
import { buildSummary } from '../scripts/lib/summary-data.mjs';
import { renderSummary } from '../scripts/lib/summary-html.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('parseTokenUsage extracts tokens from OpenCode 2 JSON format', () => {
  const out = `
Some text
{"type":"message","content":"hello"}
{"type":"usage","inputTokens":150,"outputTokens":45}
{"type":"usage","inputTokens":10,"outputTokens":5}
  `;
  const res = parseTokenUsage(out);
  assert.strictEqual(res.inputTokens, 160);
  assert.strictEqual(res.outputTokens, 50);
});

test('bench-savings dry-run prints plan and exits 0', () => {
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', '/tmp/bench-test-home'
  ], { encoding: 'utf8' });
  
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /Plan:/);
  assert.match(res.stdout, /Dry run: exiting 0/);
});

test('bench-savings --run without --model fails', () => {
  const res = spawnSync(process.execPath, [
    path.join(ROOT, 'tests', 'bench-savings.mjs'),
    '--home', '/tmp/bench-test-home',
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
  doctor({ home, state, collect, fsx: fs, run: () => ({ ok: true, out: '' }) });
  
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
