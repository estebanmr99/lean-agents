// #515: scripts/release-gate.sh checks the audit file, the open audit issues and the ci.yml run for a SHA.
// Temp repo dir with a stub `gh` on PATH; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'release-gate.sh');
// The gate is bash 3.2, like macOS; Windows has no bash to run it against.
const SKIP = process.platform === 'win32' && 'the gate is a bash script; release.yml runs it on ubuntu-latest';
const SHA = '2be44eb';

const PASSING_AUDIT = '# Audit 9.9.9\n\n## Summary\n\n- ok\n\n## Findings and issues\n\n- none\n';

// A repo dir with docs/audit-9.9.9.md and a `gh` stub that answers with canned JSON.
function fixture({ audit = PASSING_AUDIT, runs = [{ conclusion: 'success' }], issues = [], expectSha = SHA, pin = 'v9.9.9' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-'));
  if (audit !== null) {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'audit-9.9.9.md'), audit);
  }
  if (pin !== null) {
    fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'core', 'pins.json'), JSON.stringify({ pins: { 'lean-update': { version: pin } } }));
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(dir, 'runs.json'), JSON.stringify(runs));
  fs.writeFileSync(path.join(dir, 'issues.json'), JSON.stringify(issues));
  fs.writeFileSync(path.join(dir, 'gh-stub.mjs'), stubSource(dir, expectSha));
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'gh-stub.mjs')}" "$@"\n`);
  fs.chmodSync(gh, 0o755);
  return dir;
}

// The stub prints what gh + the gate's --jq would print for the two calls the gate makes.
// It fails on a run lookup for any commit other than expectSha or any workflow other than ci.yml.
function stubSource(dir, expectSha) {
  return `import fs from 'node:fs';
import path from 'node:path';
const dir = ${JSON.stringify(dir)};
const expectSha = ${JSON.stringify(expectSha)};
const args = process.argv.slice(2);
const jq = args.includes('--jq') ? args[args.indexOf('--jq') + 1] : null;
const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
if (args[0] === 'run' && args[1] === 'list') {
  const commit = flag('--commit');
  const workflow = flag('--workflow');
  if (commit !== expectSha || workflow !== 'ci.yml') {
    console.error('unexpected gh run list: --commit ' + commit + ', --workflow ' + workflow + ' (want ' + expectSha + ', ci.yml)');
    process.exit(1);
  }
  const runs = read('runs.json');
  console.log(jq ? String(runs.filter((r) => r.conclusion === 'success').length) : JSON.stringify(runs));
} else if (args[0] === 'issue' && args[1] === 'list') {
  const issues = read('issues.json');
  if (!jq) { console.log(JSON.stringify(issues)); process.exit(0); }
  for (const i of issues) {
    const names = (i.labels || []).map((l) => l.name);
    console.log((names.includes('release-proof') ? 'exempt' : 'open') + ' ' + i.number);
  }
} else {
  console.error('unexpected gh call: ' + args.join(' '));
  process.exit(1);
}
`;
}

function gate(dir, sha = SHA) {
  const r = spawnSync('bash', [SCRIPT, '9.9.9', sha], {
    cwd: dir,
    encoding: 'utf8',
    env: { PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: dir, GH_TOKEN: 'stub', GITHUB_REPOSITORY: 'o/r' },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// #547: the pin check alone, offline: no gh, no audit file, no git.
function pinsGate(dir, version) {
  const r = spawnSync('bash', [SCRIPT, '--pins-only', version], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('passes with the required headings, no open audit issues and a green ci.yml run', SKIP, () => {
  const r = gate(fixture());
  assert.equal(r.code, 0, r.out);
});

test('fails when the audit uses "## Findings" instead of "## Findings and issues"', SKIP, () => {
  const r = gate(fixture({ audit: PASSING_AUDIT.replace('## Findings and issues', '## Findings') }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs[\\/]audit-9\.9\.9\.md lacks the Summary and Findings and issues sections/);
});

test('fails when the audit file is missing', SKIP, () => {
  const r = gate(fixture({ audit: null }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs[\\/]audit-9\.9\.9\.md is missing/);
});

test('fails when no successful ci.yml run exists for the SHA', SKIP, () => {
  const r = gate(fixture({ runs: [{ conclusion: 'failure' }] }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`no successful ci\\.yml run for ${SHA}`));
});

test('fails when the SHA the gate asks about is not the one passed to it', SKIP, () => {
  const r = gate(fixture(), 'deadbee');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /unexpected gh run list: --commit deadbee/);
});

test('fails on an open audit issue, but release-proof issues are exempt', SKIP, () => {
  const open = gate(fixture({ issues: [{ number: 12, labels: [{ name: 'audit' }] }] }));
  assert.equal(open.code, 1, open.out);
  assert.match(open.out, /open audit issues: #12/);
  const exempt = gate(fixture({ issues: [{ number: 13, labels: [{ name: 'audit' }, { name: 'release-proof' }] }] }));
  assert.equal(exempt.code, 0, exempt.out);
});

test('#547 --pins-only passes when the lean-update pin is the release version', SKIP, () => {
  const r = pinsGate(fixture({ pin: 'v9.9.9' }), '9.9.9');
  assert.equal(r.code, 0, r.out);
});

test('#547 --pins-only fails fast when the lean-update pin lags the release', SKIP, () => {
  const r = pinsGate(fixture({ pin: 'v9.9.8' }), '9.9.9');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::core\/pins\.json lean-update pin is v9\.9\.8; the release must ship its own skill \(set it to v9\.9\.9\)/);
});

test('#547 the full gate fails on a lagging lean-update pin before it calls gh', SKIP, () => {
  const r = gate(fixture({ pin: 'v9.9.8' }));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /lean-update pin is v9\.9\.8/);
  assert.doesNotMatch(r.out, /unexpected gh call/);
});