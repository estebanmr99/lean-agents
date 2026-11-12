// skills/coordinate/coord-watch.sh against fake worker transcripts in a temp dir: one case per exit reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The watcher is bash; Windows has no bash 3.2 to test against.
const SKIP = { skip: process.platform === 'win32' };
const WATCH = path.join(ROOT, 'skills', 'coordinate', 'coord-watch.sh');

// Start the watcher on a transcript that says "working", then run `change(dir)` once it has had time to take its baseline.
function watch(change, extra = [], initial = 'working...\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-coord-'));
  const log = path.join(dir, 'worker.log');
  fs.writeFileSync(log, initial);
  const child = spawn('bash', [WATCH, 's1', ...(extra.includes('--read') ? [] : ['--file', log]), '--interval', '0.1', '--max-polls', '60', ...extra.map((a) => a.replace('$DIR', dir))], { encoding: 'utf8' });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const done = new Promise((resolve) => child.on('close', (code) => resolve({ code, out: out.trim() })));
  setTimeout(() => change(dir, log), 400);
  return done;
}
const append = (log, text) => fs.appendFileSync(log, text);

test('plan written', SKIP, async () => {
  const r = await watch((dir) => fs.writeFileSync(path.join(dir, 'plan.md'), '# plan\n'), ['--plan', '$DIR/plan.md']);
  assert.deepEqual(r, { code: 0, out: 's1: plan file written' });
});

test('new PR URL, ignoring one already on screen', SKIP, async () => {
  const r = await watch((_, log) => append(log, 'opened https://github.com/o/r/pull/8\n'), [], 'old https://github.com/o/r/pull/7\n');
  assert.deepEqual(r, { code: 0, out: 's1: new PR URL https://github.com/o/r/pull/8' });
});

test('question or menu', SKIP, async () => {
  const r = await watch((_, log) => append(log, 'Do you want to proceed? (y/n)\n'));
  assert.deepEqual(r, { code: 0, out: 's1: menu/question' });
});

test('usage limit', SKIP, async () => {
  const r = await watch((_, log) => append(log, 'Claude usage limit reached\n'));
  assert.deepEqual(r, { code: 0, out: 's1: limit' });
});

test('error', SKIP, async () => {
  const r = await watch((_, log) => append(log, 'API Error: 500\n'));
  assert.deepEqual(r, { code: 0, out: 's1: error' });
});

test('turn ended: a status block, then the screen stops changing', SKIP, async () => {
  const r = await watch((_, log) => append(log, 'done: x\nverified: y\nblocked: none\nnext: review\n'));
  assert.deepEqual(r, { code: 0, out: 's1: turn ended' });
});

test('nothing happens: times out with exit 2', SKIP, async () => {
  const r = await watch(() => {}, ['--max-polls', '3']);
  assert.deepEqual(r, { code: 2, out: 's1: timeout' });
});

test('--read runs a command for the screen', SKIP, async () => {
  const r = await watch((dir) => fs.writeFileSync(path.join(dir, 'screen.txt'), 'rate limit hit\n'), ['--read', 'cat "$DIR/screen.txt"']);
  assert.deepEqual(r, { code: 0, out: 's1: limit' });
});
