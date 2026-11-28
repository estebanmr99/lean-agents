// The fresh-machine failure step prints the tail of the engine's step logs, masked. Runs the step's script under pwsh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/fresh-machine.yml'), 'utf8').split('\n');

// The `run: |` body of the named step, dedented: lines indented deeper than the `run:` key.
function stepScript(name) {
  const at = yml.findIndex((l) => l === `      - name: ${name}`);
  assert.notEqual(at, -1, `step ${name} not found`);
  const body = [];
  for (const l of yml.slice(at + 1)) {
    if (/^      - /.test(l) || /^  \S/.test(l)) break;
    body.push(l);
  }
  const run = body.findIndex((l) => l === '        run: |');
  assert.notEqual(run, -1, `${name}: no run block`);
  return body.slice(run + 1).filter((l) => l.trim() !== '').map((l) => l.slice(10)).join('\n');
}

test('the step-log step tails the fresh HOME logs, masked, and nothing else', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-logs-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const runnerTemp = path.join(tmp, 'runner');
  const logs = path.join(runnerTemp, 'fresh-home', '.config', 'lean-agents', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
  lines.push(`copied from ${path.join(runnerTemp, 'fresh-home', 'bin')}`);
  lines.push('user tester at host');
  lines.push('url https://user:pw123@example.invalid/x and mail dev@example.invalid');
  lines.push('token ghp_EXAMPLEEXAMPLE0123 api_key=abc123secret');
  fs.writeFileSync(path.join(logs, '2026-01-01T00-00-00-000Z.log'), lines.join('\n') + '\n');
  const script = path.join(tmp, 'step.ps1');
  fs.writeFileSync(script, stepScript('Show fresh-machine step logs'));

  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: tmp, RUNNER_TEMP: runnerTemp, USERNAME: 'tester' },
  });
  if (r.error) return t.skip('pwsh not on PATH');
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  assert.match(out, /== 2026-01-01T00-00-00-000Z\.log \(last 200 lines\)/);
  assert.match(out, /^line 55$/m);
  assert.match(out, /^line 250$/m);
  assert.doesNotMatch(out, /^line 54$/m);
  assert.doesNotMatch(out, /ghp_|pw123|abc123secret|dev@example|tester|fresh-home/);
  assert.match(out, /<token>/);
  assert.match(out, /<redacted-url>/);
  assert.match(out, /<email>/);
  assert.match(out, /<user>/);
  assert.match(out, /api_key=<redacted>/);
});
