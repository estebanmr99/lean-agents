// The install-with-an-agent guide: every --flag it names exists in --help, it names VS Code, and it holds no real home path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const guide = fs.readFileSync(path.join(ROOT, 'docs/install-with-an-agent.md'), 'utf8');

// Flags of the install.ps1 bootstrap use one dash and are not lean.mjs flags; only `--word` forms are checked.
// `gh ...` spans are GitHub CLI commands with their own flags.
const flagsOf = (text) => new Set(text.replace(/`gh [^`]*`/g, '').match(/(?<![\w-])--[a-z][a-z-]*/g));

test('every --flag in the guide exists in lean.mjs --help', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guide-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/lean.mjs'), '--home', home, '--help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const known = flagsOf(r.stdout);
  const missing = [...flagsOf(guide)].filter((f) => !known.has(f));
  assert.deepEqual(missing, []);
});

test('the guide names VS Code Copilot chat, the proxy variables and the manual fallback', () => {
  for (const s of ['VS Code Copilot chat', '$env:HTTPS_PROXY', '$env:NO_PROXY', '$env:NODE_EXTRA_CA_CERTS', 'manual-install.md']) assert.ok(guide.includes(s), s);
});

test('the guide holds no real home path', () => {
  assert.doesNotMatch(guide, /C:\\Users\\|\/Users\/[^<\s]|\/home\/[^<\s]/i);
});
