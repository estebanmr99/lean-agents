// Session 20: --json output, gh by default, git hint and the redacted feedback draft. Temp HOME, no external commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitHint } from '../scripts/lib/system.mjs';
import { redactText } from '../scripts/lib/redact.mjs';
import { draftIssue } from '../scripts/lib/feedback.mjs';
import { preset, proxyReport } from '../scripts/lib/network.mjs';

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

// One row per audit item (S11-S14). Fake secrets are built from parts so scanners do not flag the test file.
const join = (...p) => p.join('_');
const PW = ['hunter', '2'.repeat(8)].join('-');
const VAL = ['sekrit', 'value', '1234'].join('-');
const VAL2 = ['zzz', 'key', '98765432'].join('-');
const REDACT_ROWS = [
  ['S11 AIza', 'key ' + 'AIza' + 'SyA1234567890abcdefghijk', 'AIza'],
  ['S11 hf_', 'hf' + '_abcdefghijklmnop', 'hf_abc'],
  ['S11 sk_live_', 'sk' + '_live_abcdefgh12345678', 'sk_live_abc'],
  ['S11 sk_test_', 'sk' + '_test_abcdefgh12345678', 'sk_test_abc'],
  ['S11 rk_live_', 'rk' + '_live_abcdefgh12345678', 'rk_live_abc'],
  ['S11 ya29', 'ya' + '29.a0AbCdEfGhIjKl', 'ya29.a0'],
  ['S11 JWT', 'ey' + 'Jhbgcioij9.ey' + 'Jzdwiioij9.abc_def-123', 'eyJ'],
  ['S11 AWS secret', 'aws_secret_access_key = ' + 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalr'],
  ['S12 api_key=', `${join('api', 'key')}=${PW}`, PW],
  ['S12 password:', `${['pass', 'word'].join('')}: ${PW}`, PW],
  ['S12 x-api-key', `${['x', 'api', 'key'].join('-')}: ${PW}`, PW],
  ['S12 Authorization Basic', 'Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  ['S12 Authorization Bearer', 'Authorization: Bearer abc', 'Bearer abc'],
  ['S13 env value', `failed with ${VAL}`, VAL, { [join('MY_SERVICE', 'TOKEN')]: VAL }],
  ['S13 env value (API key)', `using ${VAL2}`, VAL2, { [join('ANTHROPIC', 'API', 'KEY')]: VAL2 }],
  ['S14 /root', 'cd /root/work', '/root/'],
  ['S14 /var/folders', 'at /var/folders/ab/cdef0123/T/x.log', 'cdef0123'],
  ['S14 /private/var', 'at /private/var/db/x', '/private/var/db'],
  ['S14 C:/Users', ['at C:', 'Users', 'jdoe2', 'x'].join('/'), 'jdoe2'],
  ['S14 hostname', 'on build-box-7 failed', 'build-box-7', {}, { host: 'build-box-7' }],
];

test('redactText: every audit item is scrubbed', () => {
  for (const [name, raw, leak, env = {}, extra = {}] of REDACT_ROWS) {
    const out = redactText(raw, { home: '/nohome', env, user: '', host: 'unused-host', ...extra });
    assert.ok(!out.includes(leak), `${name} leaked: ${out}`);
  }
});

test('redactText: ordinary words stay unchanged', () => {
  for (const raw of ['tokenizer', 'the author wrote', 'password reset docs', 'sk- alone', 'tokens: ok', 'rootless install at /project/root/x', 'secret sauce']) {
    assert.equal(redactText(raw, { home: '/nohome', env: {}, user: '', host: 'unused-host' }), raw);
  }
});

test('proxyReport keeps the host but drops userinfo, query strings and the home path', () => {
  const lines = proxyReport({ HTTPS_PROXY: ['http://u:p', 'proxy.example:3128/?token=abc'].join('@'), NODE_EXTRA_CA_CERTS: '/home/me/ca.pem?x=1' }, '/home/me');
  assert.deepEqual(lines, ['HTTPS_PROXY=http://***@proxy.example:3128/?<redacted>', 'NODE_EXTRA_CA_CERTS=~/ca.pem?<redacted>']);
});

test('redaction review cases: scheme-less proxy creds, env-style names, home prefix collision', () => {
  assert.equal(proxyReport({ HTTPS_PROXY: ['ci:pw', 'proxy.corp:3128'].join('@') }, '/nohome')[0], 'HTTPS_PROXY=***@proxy.corp:3128');
  const o = { home: '/nohome', env: {}, user: '', host: 'unused-host' };
  assert.equal(redactText('npm_config_prefix npm_package_version hf_hub', o), 'npm_config_prefix npm_package_version hf_hub');
  assert.ok(!redactText(`npm_${'a'.repeat(36)}`, o).includes('npm_a'));
  assert.equal(redactText('read /tmp/ali/proj/x', { ...o, home: '/tmp/al' }), 'read /tmp/ali/proj/x');
});
