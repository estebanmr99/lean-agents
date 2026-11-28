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
const STEP = 'Show fresh-machine step logs';

// The raw lines of the named step, from its `- name:` line to the next step or job.
function stepLines(name) {
  const at = yml.findIndex((l) => l === `      - name: ${name}`);
  assert.notEqual(at, -1, `step ${name} not found`);
  const body = [];
  for (const l of yml.slice(at + 1)) {
    if (/^      - /.test(l) || /^  \S/.test(l)) break;
    body.push(l);
  }
  return body;
}

// The `run: |` body of the named step, dedented: lines indented deeper than the `run:` key.
function stepScript(name) {
  const body = stepLines(name);
  const run = body.findIndex((l) => l === '        run: |');
  assert.notEqual(run, -1, `${name}: no run block`);
  return body.slice(run + 1).filter((l) => l.trim() !== '').map((l) => l.slice(10)).join('\n');
}

test('the step-log step sits in the windows job, runs on failure only, under PowerShell', () => {
  const windows = yml.findIndex((l) => l === '  windows:');
  const linux = yml.findIndex((l) => l === '  linux:');
  const at = yml.findIndex((l) => l === `      - name: ${STEP}`);
  assert.ok(windows !== -1 && linux !== -1 && windows < at && at < linux, 'step must sit between windows: and linux:');
  const body = stepLines(STEP);
  assert.ok(body.includes('        if: failure()'), 'missing if: failure()');
  assert.ok(body.includes('        shell: powershell'), 'missing shell: powershell');
});

test('the step-log step tails the fresh HOME logs, masked, and nothing else', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-logs-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const runnerTemp = path.join(tmp, 'runner');
  const home = path.join(runnerTemp, 'fresh-home');
  const logs = path.join(home, '.config', 'lean-agents', 'logs');
  fs.mkdirSync(logs, { recursive: true });
  const script = path.join(tmp, 'step.ps1');
  fs.writeFileSync(script, stepScript(STEP));
  assert.match(stepScript(STEP).split('\n')[0], /^\$ErrorActionPreference/, 'dedent: first script line');

  const extras = [
    `copied from ${path.join(home, 'bin')}`,
    `forward slash ${home.replace(/\\/g, '/')}/bin`,
    `upper case ${home.toUpperCase()}\\bin`,
    'user tester at host LABHOST',
    'url https://user:pw123@example.com/x and mail dev@example.com',
    'token ghp_EXAMPLEEXAMPLE0123 api_key=abc123secret',
    'Authorization: Basic dXNlcjpwYXNz',
    'aws AKIAEXAMPLE1234567 gcp AIzaSyEXAMPLE0123456789abc',
    'tokens ya29.EXAMPLEtokenvalue sk_live_EXAMPLEKEY0123',
    'aws_secret_access_key=EXAMPLEKEYEXAMPLEKEYEXAMPLEKEYEXAMPLEKEY',
    'env value supersecretvalue',
  ];
  const lines = [...Array.from({ length: 250 }, (_, i) => `line ${i + 1}`), ...extras];
  fs.writeFileSync(path.join(logs, '2026-01-01T00-00-00-000Z.log'), lines.join('\n') + '\n');

  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: tmp,
      RUNNER_TEMP: runnerTemp,
      USERNAME: 'tester',
      COMPUTERNAME: 'LABHOST',
      LEAN_TEST_TOKEN: 'supersecretvalue',
    },
  });
  if (r.error) return t.skip('pwsh not on PATH');
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout;
  // The tail is the last 200 lines: base line N is the (51 + extras) th line onward.
  const first = 51 + extras.length;
  assert.match(out, /== 2026-01-01T00-00-00-000Z\.log \(last 200 lines\)/);
  assert.match(out, new RegExp(`^line ${first}$`, 'm'));
  assert.match(out, /^line 250$/m);
  assert.doesNotMatch(out, new RegExp(`^line ${first - 1}$`, 'm'));
  assert.doesNotMatch(out, /ghp_|pw123|abc123secret|dev@example|tester|LABHOST|fresh-home|dXNlcjpwYXNz|supersecretvalue/i);
  assert.doesNotMatch(out, /AKIAEXAMPLE|AIzaSy|ya29\.EXAMPLE|sk_live_EXAMPLE|aws_secret_access_key=EXAMPLE/);
  assert.match(out, /<token>/);
  assert.match(out, /<redacted-url>/);
  assert.match(out, /<email>/);
  assert.match(out, /<user>/);
  assert.match(out, /<host>/);
  assert.match(out, /<redacted>/);
  assert.match(out, /api_key=<redacted>/);
  assert.match(out, /Authorization: Basic <token>/);
  assert.match(out, /~/);
});
