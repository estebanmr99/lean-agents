// Nothing lean-agents installs or configures may come from a moving ref (#64, #66). Runs the engine for every
// agent with --all-tools in a temp HOME and checks every planned command and written config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PINS, gitSpec, marketplaceSource, skillSource } from '../scripts/lib/pins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.LEAN_AGENTS_NODE ??= '24.22.2';
const AGENTS = ['claude', 'opencode-v1', 'opencode-v2', 'copilot-cli', 'cursor', 'antigravity', 'vscode-copilot'];
// Unpinned on purpose, each with its reason in docs/compatibility.md: warpdotdev/claude-code-warp has no tags or releases (VERIFY).
const UNPINNED_OK = ['warpdotdev/claude-code-warp'];

function lean(home, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--yes', '--no-exec', '--all-tools', '--terminal', 'both', '--lang', 'en', '--profile', 'none', ...args], { encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile())
    .map((e) => fs.readFileSync(path.join(e.parentPath, e.name), 'utf8')).join('\n');
}
// Plan text (every command) plus every file the install wrote.
function everything() {
  return AGENTS.map((a) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
    const plan = lean(home, ['--dry-run', '--agents', a]);
    lean(home, ['--agents', a]);
    // state.json records each edit's `legacy` list: the old unversioned values we replace, not something we install.
    return plan + files(home).replace(/"legacy":\s*\[[^\]]*\]/g, '');
  }).join('\n');
}

test('every pin carries what verifies it: npm integrity, git/skill/marketplace commit SHA', () => {
  for (const [key, p] of Object.entries(PINS)) {
    if (p.kind === 'npm') assert.match(p.integrity, /^sha512-[A-Za-z0-9+/]+=*$/, `${key} integrity`);
    else if (p.kind === 'download') for (const h of Object.values(p.sha256)) assert.match(h, /^[0-9a-f]{64}$/, `${key} sha256`);
    // lean-update has no sha until its release tag exists (set at release).
    else if (key !== 'lean-update') assert.match(p.sha, /^[0-9a-f]{40}$/, `${key} sha`);
  }
});

test('no generated command or config uses a moving ref', () => {
  const out = everything();
  assert.ok(!/@latest\b/.test(out), '@latest');
  assert.ok(out.includes(gitSpec('serena')), 'serena pinned by commit');
  for (const m of out.matchAll(/git\+https:\/\/[^\s\"',]+/g)) assert.match(m[0], /@[0-9a-f]{40}$/, m[0]);
  for (const m of out.matchAll(/marketplace add (\S+)/g)) {
    if (UNPINNED_OK.includes(m[1])) continue;
    assert.match(m[1], /#v?\d+\.\d+\.\d+$/, `marketplace source ${m[1]} needs a tag`);
  }
  for (const m of out.matchAll(/skills@\S+ add (\S+)/g)) assert.match(m[1], /#([0-9a-f]{40}|v\d+\.\d+\.\d+)$/, m[1]);
  for (const key of ['ponytail-plugin', 'context-mode-plugin', 'i-have-adhd']) assert.ok(out.includes(marketplaceSource(key)), key);
  for (const key of ['caveman', 'i-have-adhd', 'orca-cli']) assert.ok(out.includes(skillSource(key)), key);
  // npm packages named in plugin lists must carry a version.
  for (const pkg of ['@dietrichgebert/ponytail', '@warp-dot-dev/opencode-warp']) {
    for (const m of out.matchAll(new RegExp(`${pkg}(?!@\\d)`, 'g'))) assert.fail(`${pkg} without a version near: ${out.slice(m.index - 40, m.index + 60)}`);
  }
});
