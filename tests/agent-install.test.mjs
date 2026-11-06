// Session 20: --json output, gh by default, git hint and the redacted feedback draft. Temp HOME, no external commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitHint } from '../scripts/lib/system.mjs';
import { redactText } from '../scripts/lib/doctor.mjs';
import { draftIssue } from '../scripts/lib/feedback.mjs';
import { preset } from '../scripts/lib/network.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Built from parts so the privacy check does not flag these fake paths.
const unixUser = ['', 'Users', 'jdoe', 'work', 'x'].join('/');
const winUser = ['c:', 'users', 'JDoe', 'z'].join('\\');
const posix = { skip: process.platform === 'win32' && 'PATH stubs are POSIX; real-agent-install covers Windows' };
process.env.LEAN_AGENTS_NODE ??= '24.22.2';

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
function engine(args, { env = process.env, input } = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), ...args], { encoding: 'utf8', env, input });
}
// A PATH that has git (a stub) but no gh, and optionally no git either.
function pathWith(...bins) {
  const dir = tmp('lean-bin-');
  for (const b of bins) {
    fs.writeFileSync(path.join(dir, b), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  return { ...process.env, PATH: dir };
}
const plan = (home, extra, env) => JSON.parse(engine(['--home', home, '--no-exec', '--yes', '--dry-run', '--json', '--agents', 'claude', ...extra], { env }).stdout);

test('--dry-run --json prints one parseable plan', () => {
  const j = plan(tmp('lean-home-'), []);
  assert.deepEqual(j.agents, ['claude']);
  assert.ok(j.files.length > 0 && j.files.every((f) => !path.isAbsolute(f.path) || !f.path.startsWith(os.tmpdir())));
  assert.ok(Array.isArray(j.commands) && j.network.outbound === 'on');
});

test('--json without --dry-run is refused', () => {
  const r = engine(['--home', tmp('lean-home-'), '--no-exec', '--yes', '--agents', 'claude', '--json']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--json needs --dry-run/);
});

test('--doctor --json prints ok and rows', () => {
  const r = engine(['--home', tmp('lean-home-'), '--no-exec', '--doctor', '--json']);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, false);
  assert.equal(j.rows[0].status, 'missing');
});

test('gh is installed by default when missing, --no-gh opts out', posix, () => {
  const env = pathWith('git');
  assert.equal(plan(tmp('lean-home-'), [], env).gh, true);
  assert.equal(plan(tmp('lean-home-'), ['--no-gh'], env).gh, false);
  assert.equal(plan(tmp('lean-home-'), [], pathWith('git', 'gh')).gh, false);
});

test('missing git prints the install hint on stderr, stdout stays JSON', posix, () => {
  const r = engine(['--home', tmp('lean-home-'), '--no-exec', '--yes', '--dry-run', '--json', '--agents', 'claude'], { env: pathWith() });
  assert.match(r.stderr, /git not found/);
  JSON.parse(r.stdout);
});

test('gitHint: silent when present, brew command or link when not', () => {
  assert.equal(gitHint('brew', '/usr/bin/git'), null);
  assert.match(gitHint('brew', null), /brew install git/);
  assert.match(gitHint(null, null), /git-scm\.com/);
});

test('redactText drops home, user, proxy, email and token values', () => {
  const env = { HTTPS_PROXY: ['http://corp-user:s3cret', 'proxy.corp.example:3128'].join('@'), NODE_EXTRA_CA_CERTS: '/etc/corp/ca.pem' };
  const raw = `ENOENT ${unixUser} /tmp/h/a failed via ${env.HTTPS_PROXY} ca ${env.NODE_EXTRA_CA_CERTS} ${['jdoe', 'corp.example'].join('@')} ghp_abcdefghijkl1234 ${winUser}`;
  const out = redactText(raw, { home: '/tmp/h', env, user: 'jdoe' });
  for (const leak of ['jdoe', '/tmp/h', 'proxy.corp', 's3cret', '/etc/corp', 'ghp_']) assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
});

test('draftIssue: redacted when allowed, null on strict or unknown preset', () => {
  const base = { home: '/tmp/h', env: { USER: 'jdoe', HTTP_PROXY: 'http://10.1.2.3:8080' }, versions: { node: '24.0.0' }, command: 'brew install gh', error: 'boom in /tmp/h/x as jdoe via http://10.1.2.3:8080' };
  const d = draftIssue({ ...base, network: preset('on') });
  assert.match(d.body, /brew install gh/);
  for (const leak of ['jdoe', '/tmp/h', '10.1.2.3']) assert.ok(!d.body.includes(leak), leak);
  assert.equal(draftIssue({ ...base, network: preset('off') }), null);
  assert.equal(draftIssue({ ...base, network: {} }), null);
});

test('--feedback-draft: strict preset makes no offer; redacts stdin', () => {
  const home = tmp('lean-home-');
  const env = { ...process.env, HTTPS_PROXY: 'http://proxy.corp.example:3128' };
  const on = JSON.parse(engine(['--home', home, '--feedback-draft', '--failed-command', 'brew install gh', '--network', 'on'], { env, input: `fail ${home}/x via ${env.HTTPS_PROXY}` }).stdout);
  assert.ok(!on.body.includes(home) && !on.body.includes('proxy.corp'));
  const strict = JSON.parse(engine(['--home', home, '--feedback-draft', '--failed-command', 'c', '--privacy', 'strict'], { input: 'x' }).stdout);
  assert.deepEqual(strict, { offer: false });
});

test('--json without --yes is refused before any question is written', () => {
  const r = engine(['--home', tmp('lean-home-'), '--no-exec', '--dry-run', '--json', '--agents', 'claude']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--json needs --yes/);
});

test('redactText: any listed home, mixed-case Windows paths, npm and AWS keys', () => {
  const out = redactText(`a /real/me/x b /tmp/h/y c ${winUser} npm_abcdefghijkl ${'AKIA' + 'ABCDEFGHIJKLMNOP'}`, { home: ['/tmp/h', '/real/me'], env: {}, user: '' });
  for (const leak of ['/real/me', '/tmp/h', 'JDoe', 'npm_abc', 'AKIA']) assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
});

test('--feedback-draft --feedback-kind update: update wording, same redaction, same strict gate', () => {
  const home = tmp('lean-home-');
  const on = JSON.parse(engine(['--home', home, '--feedback-draft', '--feedback-kind', 'update', '--failed-command', 'rtk', '--network', 'on'], { input: `rtk 1.0 at ${home}/bin` }).stdout);
  assert.match(on.title, /^Update finding: rtk/);
  assert.match(on.body, /## What the update found/);
  assert.ok(!on.body.includes(home));
  const strict = JSON.parse(engine(['--home', home, '--feedback-draft', '--feedback-kind', 'update', '--failed-command', 'rtk', '--privacy', 'strict'], { input: 'x' }).stdout);
  assert.deepEqual(strict, { offer: false });
});
