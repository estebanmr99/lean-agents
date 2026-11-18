// Children get an env allowlist, not the whole environment (S6). Real child process, no external tools.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quiet, run } from '../scripts/lib/system.mjs';
import { allowedEnv, childEnv, preset, resetDropWarnings } from '../scripts/lib/network.mjs';

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
  // Windows spells it Path.
  assert.ok(Object.keys(seen).some((k) => k.toUpperCase() === 'PATH'));
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

test('allowedEnv: one key per name, whatever the case', () => {
  const out = allowedEnv({ PATH: 'a', Path: 'b', path: 'c', Home: 'h', HOME: 'g' }, 'linux');
  assert.deepEqual(Object.keys(out).map((k) => k.toUpperCase()).sort(), ['HOME', 'PATH']);
});

// #163: name -> kept / dropped (by name or by value). Values are synthetic.
const TOKEN = 'ghp_' + 'a'.repeat(20);
const cases = [
  ['NODE_OPTIONS', '--require /x.js', false],
  ['NODE_OPTIONS', '-r /x.js', false],
  ['NODE_OPTIONS', '--import /x.mjs', false],
  ['NODE_OPTIONS', '--use-system-ca --eval x', false],
  ['NODE_OPTIONS', '--max-old-space-size=abc', false],
  ['NODE_OPTIONS', '--use-system-ca', true],
  ['NODE_OPTIONS', '--use-openssl-ca --max-old-space-size=4096', true],
  ['NODE_OPTIONS', '--use-bundled-ca --dns-result-order=ipv4first', true],
  ['NODE_OPTIONS', '--max-old-space-size 4096', true],
  ['NODE_OPTIONS', '--max-old-space-size=4096', true],
  ['NODE_OPTIONS', '--dns-result-order ipv4first', true],
  ['NODE_OPTIONS', '--use-env-proxy', true],
  ['NODE_OPTIONS', '--use-env-proxy --use-system-ca', true],
  ['NODE_OPTIONS', '--use-env-proxy --require /x.js', false],
  ['NODE_OPTIONS', '--max-old-space-size --require', false],
  ['NODE_OPTIONS', '--max-old-space-size', false],
  ['NODE_OPTIONS', '-r /x.js --use-env-proxy', false],
  ['NODE_PATH', '/x', false],
  ['GIT_CONFIG_COUNT', '1', false],
  ['GIT_CONFIG_VALUE_0', 'Authorization: bearer abc', false],
  ['GIT_ASKPASS', '/x/askpass', false],
  ['GIT_SSH_COMMAND', 'ssh -i /k', false],
  ['GIT_PROXY_COMMAND', '/x', false],
  ['npm_config_//registry.example/:_authToken', 'q', false],
  ['NPM_CONFIG__AUTH', 'q', false],
  ['NPM_CONFIG_REGISTRY', 'https://user:pw@example.com/', false],
  ['NPM_CONFIG_USERCONFIG', TOKEN, false],
  ['NPM_CONFIG_FOO', 'npm_' + 'b'.repeat(24), false],
  ['git_config_value_0', 'x', false],
  ['node_options', '--require /x.js', false],
  ['GIT_EXEC_PATH', '/x', false],
  ['GIT_EDITOR', '/x', false],
  ['NPM_CONFIG_SCRIPT_SHELL', '/x', false],
  ['UV_INDEX_URL', 'https://abc123def456@example.com/', false],
  ['UV_INDEX_URL', 'https://:abc123def456@example.com/', false],
  ['PATH', '/home/u/.npm_' + 'c'.repeat(24) + '/bin', true],
  ['GIT_TERMINAL_PROMPT', '0', true],
  ['GIT_SSL_CAINFO', '/ca.pem', true],
  ['NODE_EXTRA_CA_CERTS', '/ca.pem', true],
  ['NODE_USE_SYSTEM_CA', '1', true],
  ['NPM_CONFIG_PREFIX', '/p', true],
  ['NPM_CONFIG_CACHE', '/c', true],
  ['NPM_CONFIG_REGISTRY', 'https://registry.example/', true],
  ['NVM_DIR', '/n', true],
  ['XDG_CONFIG_HOME', '/x', true],
  ['HTTPS_PROXY', 'http://user:pw@example.com:3128', true],
  ['https_proxy', 'http://proxy.example:3128', true],
  ['HTTPS_PROXY', 'http://u:' + TOKEN + '@example.com', true],
];
for (const [name, value, kept] of cases) {
  test(`allowedEnv #163: ${name} is ${kept ? 'kept' : 'dropped'}`, () => {
    assert.equal(name in allowedEnv({ [name]: value }, 'linux'), kept);
  });
}

test('allowedEnv: dropped variables are reported by name, never by value (#235)', () => {
  const env = { PATH: '/bin', NODE_OPTIONS: '--require ./evil-secret.js', GIT_CONFIG_COUNT: '1', GIT_AUTHOR_NAME: 'a', GH_TOKEN: 'x'.repeat(12), RANDOM_VAR: '1' };
  let names;
  const out = allowedEnv(env, 'linux', (n) => { names = n; });
  assert.deepEqual(Object.keys(out).sort(), ['GIT_AUTHOR_NAME', 'PATH']);
  // GH_TOKEN and RANDOM_VAR were never on the pass list, so they are not news.
  assert.deepEqual([...names].sort(), ['GIT_CONFIG_COUNT', 'NODE_OPTIONS']);
  assert.ok(!names.join(' ').includes('evil-secret'));
  let called = false;
  allowedEnv({ PATH: '/bin' }, 'linux', () => { called = true; });
  assert.equal(called, false);
});

test('allowedEnv warns once per name on stderr, and resetDropWarnings starts over', () => {
  const lines = [];
  const orig = console.error;
  console.error = (m) => lines.push(m);
  try {
    resetDropWarnings();
    allowedEnv({ GIT_CONFIG_COUNT: '1' }, 'linux');
    allowedEnv({ GIT_CONFIG_COUNT: '1' }, 'linux');
    allowedEnv({ GIT_CONFIG_COUNT: '1', GIT_ASKPASS: 'x' }, 'linux');
    assert.equal(lines.length, 2);
    assert.match(lines[1], /GIT_ASKPASS$/);
    resetDropWarnings();
    allowedEnv({ GIT_CONFIG_COUNT: '1' }, 'linux');
    assert.equal(lines.length, 3);
  } finally { console.error = orig; }
});
