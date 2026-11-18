// The lean-migrate and lean-update skills may only name flags that `lean.mjs --help` lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPrompt } from '../scripts/lib/verify-prompt.mjs';
import { preset } from '../scripts/lib/network.mjs';

// Flags of the `gh` CLI that lean-update shows next to lean-agents flags.
const GH_FLAGS = new Set(['--repo', '--search', '--title', '--body-file', '--state']);
const root = fileURLToPath(new URL('..', import.meta.url));

for (const name of ['lean-migrate', 'lean-update']) test(`every --flag in skills/${name}/SKILL.md appears in --help`, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-skillflags-'));
  const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home };
  const help = spawnSync(process.execPath, [path.join(root, 'scripts', 'lean.mjs'), '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  const skill = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8');
  const flags = new Set(skill.match(/--[a-z][a-z0-9-]*/g));
  assert.ok(flags.size >= 6, 'the skill should name its flags');
  for (const f of flags) if (!GH_FLAGS.has(f)) assert.match(help.stdout, new RegExp(`${f}(?![a-z0-9-])`), `${f} is not in --help`);
});

test('lean-update skill is PowerShell-safe: no bash-only syntax', () => {
  const skill = fs.readFileSync(path.join(root, 'skills', 'lean-update', 'SKILL.md'), 'utf8');
  for (const bad of ['rm -rf', '$(date', '${TMPDIR', '/dev/null']) assert.ok(!skill.includes(bad), `bash-only: ${bad}`);
});

// The verify prompt names lean-agents flags too (#284). `--summary` / `--filed-issue` land with #181 PR3: skip until --help lists them.
for (const lang of ['en', 'es']) test(`every --flag in the ${lang} verify prompt appears in --help`, (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-promptflags-'));
  const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home };
  const help = spawnSync(process.execPath, [path.join(root, 'scripts', 'lean.mjs'), '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  if (!/--filed-issue(?![a-z0-9-])/.test(help.stdout)) return t.skip('--filed-issue is not in --help yet (#181 PR3 not merged)');
  const flags = new Set(verifyPrompt({ lang, network: preset('on') }).match(/--[a-z][a-z0-9-]*/g));
  assert.ok(flags.size >= 6, 'the prompt should name its flags');
  for (const f of flags) if (!GH_FLAGS.has(f)) assert.match(help.stdout, new RegExp(`${f}(?![a-z0-9-])`), `${f} is not in --help`);
});
