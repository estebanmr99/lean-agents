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
const PASSING_AUDIT = '# Audit 9.9.9\n\n## Summary\n\n- ok\n\n## Findings and issues\n\n- none\n';

// Runs git with a fixed identity and no signing, so the fixtures never read or write the real HOME's config.
function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}
const headSha = (dir) => git(dir, 'rev-parse', 'HEAD');

// A repo dir with docs/audit-9.9.9.md, a committed copy of the gate and a `gh` stub that answers with canned JSON.
function fixture({ audit = PASSING_AUDIT, runs = [{ conclusion: 'success' }], issues = [], pin = 'v9.9.9' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-'));
  // The gate reads core/pins.json next to itself, so the fixture carries a copy of the script.
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, scriptIn(dir));
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
  fs.writeFileSync(path.join(dir, 'gh-stub.mjs'), stubSource(dir));
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'gh-stub.mjs')}" "$@"\n`);
  fs.chmodSync(gh, 0o755);
  // #587: the gate reads core/ and scripts/ from the checkout, so the fixture is a committed repo.
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

// The stub prints what gh + the gate's --jq would print for the two calls the gate makes.
// It fails on a run lookup for any commit other than HEAD or any workflow other than ci.yml.
function stubSource(dir) {
  return `import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
const jq = args.includes('--jq') ? args[args.indexOf('--jq') + 1] : null;
const flag = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
if (args[0] === 'run' && args[1] === 'list') {
  const commit = flag('--commit');
  const workflow = flag('--workflow');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  if (commit !== head || workflow !== 'ci.yml') {
    console.error('unexpected gh run list: --commit ' + commit + ', --workflow ' + workflow + ' (want ' + head + ', ci.yml)');
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

const scriptIn = (dir) => path.join(dir, 'scripts', 'release-gate.sh');

// cwd defaults to the script's checkout; #587 review: a caller in another repo must not change what is gated.
function runGate(dir, args, cwd = dir) {
  const r = spawnSync('bash', [scriptIn(dir), ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: dir, GH_TOKEN: 'stub', GITHUB_REPOSITORY: 'o/r' },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

// Gates the given SHA, HEAD by default.
const gate = (dir, sha = headSha(dir)) => runGate(dir, ['9.9.9', sha]);

// #547: the pin check alone, offline: no gh, no audit file.
function pinsGate(dir, version) {
  const r = spawnSync('bash', [scriptIn(dir), '--pins-only', version], {
    cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('passes with the required headings, no open audit issues and a green ci.yml run', SKIP, () => {
  const r = gate(fixture());
  assert.equal(r.code, 0, r.out);
});

// #542: a version that is not x.y.z(-suffix) must not reach a path or a command.
test('#542 a bad version exits 2 before any repo file is read', SKIP, () => {
  const dir = fixture();
  for (const version of ['../x', '1.4', '1.4.0;rm']) {
    const r = runGate(dir, [version]);
    assert.equal(r.code, 2, `${version}: ${r.out}`);
    assert.match(r.out, /::error::invalid version/);
  }
});

// #542: the audit must be read from the repo root, even when the gate is started from a subfolder.
test('#542 a run from a subfolder reads docs/audit-<version>.md at the repo root', SKIP, () => {
  const dir = fixture();
  const sub = path.join(dir, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  // Started by path from the subfolder, as a user would: over stdin `$0` is the shell, which on Windows is a full path outside the repo.
  const r = runGate(dir, ['9.9.9', headSha(dir)], sub);
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /audit-9\.9\.9\.md is missing/);
});

// #542: mirror release.yml, which refuses a tag whose SHA is not on main.
test('#542 fails when the gated SHA is not an ancestor of origin/main', SKIP, () => {
  const dir = fixture();
  const base = headSha(dir);
  git(dir, 'update-ref', 'refs/remotes/origin/main', base);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'not on main');
  const r = gate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`::error::${headSha(dir)} is not on main`));
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
  const dir = fixture({ runs: [{ conclusion: 'failure' }] });
  const r = gate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`no successful ci\\.yml run for ${headSha(dir)}`));
});

// #587: a checkout behind the gated SHA would gate its own stale pins, so it fails before any gh call.
test('#587 fails fast when HEAD is not the gated SHA, before gh is called', SKIP, () => {
  const dir = fixture();
  const gated = headSha(dir);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'newer');
  const r = gate(dir, gated);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`::error::checkout HEAD ${headSha(dir)} is not the gated SHA ${gated}; run git pull`));
  assert.doesNotMatch(r.out, /unexpected gh/);
});

test('#587 a short SHA resolves to HEAD and passes the check', SKIP, () => {
  const dir = fixture();
  const r = gate(dir, headSha(dir).slice(0, 7));
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /not the gated SHA/);
});

// A git repo with one commit (or none) in a fresh temp dir: the "caller's cwd" for the tests below.
function otherRepo({ committed = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-other-'));
  git(dir, 'init', '-q');
  if (committed) {
    fs.writeFileSync(path.join(dir, 'README.md'), 'other\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'other');
  }
  return dir;
}

// The gate's own checkout with no commit yet: script copied in, nothing committed.
function unbornFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-unborn-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT, scriptIn(dir));
  git(dir, 'init', '-q');
  return dir;
}

// #587 review (HIGH): the gate reads pins and audit from its own checkout, so git must read that checkout too.
test('#587 a SHA from another repo does not resolve in the gate checkout and fails', SKIP, () => {
  const dir = fixture();
  const other = otherRepo();
  const r = runGate(dir, ['9.9.9', headSha(other)], other);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, new RegExp(`::error::${headSha(other)} does not resolve to a commit here; git fetch first`));
});

test('#587 an unborn gate checkout fails with a clear message, also when run from another repo', SKIP, () => {
  const r = runGate(unbornFixture(), ['9.9.9'], otherRepo());
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::HEAD does not resolve to a commit in this checkout; commit first/);
  assert.doesNotMatch(r.out, /gating HEAD/);
});

test('#587 a SHA that does not resolve says git fetch first, not the raw string', SKIP, () => {
  const dir = fixture();
  const r = gate(dir, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::deadbeefdeadbeefdeadbeefdeadbeefdeadbeef does not resolve to a commit here; git fetch first/);
});

// #587 review (MEDIUM): the audit and changes/ fragments are gated too, so uncommitted edits there fail as well.
test('#587 fails when docs/audit has uncommitted or untracked changes, and lists them', SKIP, () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'docs', 'audit-9.9.9.md'), `${PASSING_AUDIT}\nedited\n`);
  fs.mkdirSync(path.join(dir, 'changes'));
  fs.writeFileSync(path.join(dir, 'changes', '9.md'), '### Fixed\n- x (#9)\n');
  const r = gate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::core[\\/], scripts[\\/], docs[\\/] or changes[\\/] has uncommitted or untracked files/);
  assert.match(r.out, /M docs[\\/]audit-9\.9\.9\.md/);
  assert.match(r.out, /\?\? changes[\\/]/);
});

test('#587 without a SHA argument the gate prints a notice with the HEAD it gates', SKIP, () => {
  const dir = fixture();
  const r = runGate(dir, ['9.9.9']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`::notice::gating HEAD ${headSha(dir)}`));
});

test('#587 fails when core/pins.json has uncommitted changes', SKIP, () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'core', 'pins.json'), JSON.stringify({ pins: { 'lean-update': { version: 'v9.9.9' } }, edited: true }));
  const r = gate(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::core[\\/], scripts[\\/], docs[\\/] or changes[\\/] has uncommitted or untracked files/);
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

// #590: a pin that moves below the previous release tag fails the gate.
import { pinDowngrades } from '../scripts/lib/pin-downgrades.mjs';

const pin = (version, extra = {}) => ({ kind: 'download', version, ...extra });

test('pinDowngrades: orca-app 1.4.264 -> 1.4.258 (the 1.3.0 change) is an error', () => {
  const r = pinDowngrades({ 'orca-app': pin('1.4.264') }, { 'orca-app': pin('1.4.258') });
  assert.deepEqual(r.errors, ['::error::pin downgrade: orca-app 1.4.264 -> 1.4.258']);
  assert.deepEqual(r.notices, []);
});

test('pinDowngrades: a downgrade with a note passes with a notice', () => {
  const r = pinDowngrades({ 'orca-app': pin('1.4.264') }, { 'orca-app': pin('1.4.258', { downgrade: 'upstream pulled 1.4.264' }) });
  assert.deepEqual(r.errors, []);
  assert.match(r.notices[0], /^::notice::pin downgrade: orca-app 1\.4\.264 -> 1\.4\.258 .*upstream pulled/);
});

test('pinDowngrades: upgrades, equal versions and new pins pass quietly', () => {
  const r = pinDowngrades({ a: pin('1.0.0'), b: pin('2.0.0') }, { a: pin('1.0.1'), b: pin('2.0.0'), c: pin('0.0.1') });
  assert.deepEqual(r, { errors: [], notices: [] });
});

// Real git repo with a v9.9.8 tag holding the old pins, then the gate on the new ones.
function gitGate(oldOrca, newOrca, extra) {
  const dir = fixture();
  const lib = path.join(dir, 'scripts', 'lib');
  fs.mkdirSync(lib, { recursive: true });
  for (const f of ['pin-downgrades.mjs', 'update-plan.mjs', 'node-runtime.mjs', 'pins.mjs']) {
    fs.copyFileSync(path.resolve(import.meta.dirname, '..', 'scripts', 'lib', f), path.join(lib, f));
  }
  const write = (orca, more) => fs.writeFileSync(path.join(dir, 'core', 'pins.json'), JSON.stringify({ pins: { 'lean-update': { version: 'v9.9.9' }, 'orca-app': { version: orca, ...more } } }));
  write(oldOrca);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'old');
  git(dir, 'tag', 'v9.9.8');
  write(newOrca, extra);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'new');
  return gate(dir);
}

test('gate fails on a pin downgrade against the previous tag', SKIP, () => {
  const r = gitGate('1.4.264', '1.4.258');
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /::error::pin downgrade: orca-app 1\.4\.264 -> 1\.4\.258/);
});

test('gate passes a downgrade that carries a note, and prints a notice', SKIP, () => {
  const r = gitGate('1.4.264', '1.4.258', { downgrade: 'upstream pulled 1.4.264' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /::notice::pin downgrade: orca-app/);
});

test('gate passes an upgrade against the previous tag', SKIP, () => {
  assert.equal(gitGate('1.4.258', '1.4.280').code, 0);
});
