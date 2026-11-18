// The lean-migrate skill may only name flags that `lean.mjs --help` lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

test('every --flag in skills/lean-migrate/SKILL.md appears in --help', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-skillflags-'));
  const env = { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home };
  const help = spawnSync(process.execPath, [path.join(root, 'scripts', 'lean.mjs'), '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  const skill = fs.readFileSync(path.join(root, 'skills', 'lean-migrate', 'SKILL.md'), 'utf8');
  const flags = new Set(skill.match(/--[a-z][a-z0-9-]*/g));
  assert.ok(flags.size >= 6, 'the skill should name its flags');
  for (const f of flags) assert.match(help.stdout, new RegExp(`${f}(?![a-z0-9-])`), `${f} is not in --help`);
});
