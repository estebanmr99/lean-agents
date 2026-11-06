// Children get an env allowlist, not the whole environment (S6). Real child process, no external tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quiet, run } from '../scripts/lib/system.mjs';
import { allowedEnv, childEnv, preset } from '../scripts/lib/network.mjs';

// Probes live in files: `node -e` loses its quotes in the Windows shell.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-env-'));
const probe = (name, code) => { const f = path.join(dir, name); fs.writeFileSync(f, code); return [process.execPath, f]; };
const dump = probe('dump.mjs', 'console.log(JSON.stringify(process.env));\n');
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test('quiet: secrets stay behind, proxy, CA and strict-privacy vars get through', () => {
  const seen = withEnv({ GH_TOKEN: 'x'.repeat(12), ANTHROPIC_API_KEY: 'y'.repeat(12), NPM_TOKEN: 'z', HTTPS_PROXY: 'http://proxy.example:3128', npm_config_cafile: '/ca.pem', npm_config__authToken: 'q', HOMEBREW_GITHUB_API_TOKEN: 'w' },
    () => JSON.parse(quiet(dump, 30000, childEnv(preset('off'))).out));
  for (const gone of ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'NPM_TOKEN', 'npm_config__authToken', 'HOMEBREW_GITHUB_API_TOKEN']) assert.equal(seen[gone], undefined, gone);
  assert.equal(seen.DO_NOT_TRACK, '1');
  assert.equal(seen.HTTPS_PROXY, 'http://proxy.example:3128');
  assert.equal(seen.npm_config_cafile, '/ca.pem');
  assert.ok(seen.PATH);
});

test('run: the allowlist applies even without a per-command env', () => {
  withEnv({ GH_TOKEN: 'x'.repeat(12) }, () => {
    const ok = run(probe('gone.mjs', 'process.exit(process.env.GH_TOKEN === undefined ? 0 : 1);\n'), { dryRun: false, log() {} });
    assert.equal(ok, true);
  });
});

test('allowedEnv: names match case-insensitively; Windows names only on win32', () => {
  const env = { Path: 'p', XDG_DATA_HOME: '/d', lc_all: 'C', SystemRoot: 'C:\\Windows', RANDOM_VAR: '1', UV_INDEX_X_PASSWORD: 'pw' };
  assert.deepEqual(Object.keys(allowedEnv(env, 'linux')).sort(), ['Path', 'XDG_DATA_HOME', 'lc_all']);
  assert.deepEqual(Object.keys(allowedEnv(env, 'win32')).sort(), ['Path', 'SystemRoot', 'XDG_DATA_HOME', 'lc_all']);
});

test('allowedEnv keeps git identity and curl/pip CA vars', () => {
  const kept = Object.keys(allowedEnv({ GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'e', CURL_CA_BUNDLE: '/c', PIP_CERT: '/p', GIT_ASKPASS_TOKEN: 'x' }, 'linux')).sort();
  assert.deepEqual(kept, ['CURL_CA_BUNDLE', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_NAME', 'PIP_CERT']);
});
