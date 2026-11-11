// adhdSkillFiles finds the skill where skills 1.7 (~/.agents) and 1.8 (~/.gemini/config) install it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adhdSkillFiles } from '../scripts/lib/adhd.mjs';

const put = (home, ...rel) => {
  const f = path.join(home, ...rel, 'i-have-adhd', 'SKILL.md');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'disable-model-invocation: true\n');
  return f;
};
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-adhd-'));

test('adhdSkillFiles finds the skills 1.7 layout', () => {
  const home = temp();
  assert.deepEqual(adhdSkillFiles(home), []);
  const f = put(home, '.agents', 'skills');
  assert.deepEqual(adhdSkillFiles(home), [f]);
});

test('adhdSkillFiles finds the skills 1.8 Antigravity layout', () => {
  const home = temp();
  const f = put(home, '.gemini', 'config', 'skills');
  assert.deepEqual(adhdSkillFiles(home), [f]);
});

test('adhdSkillFiles returns every layout that exists', () => {
  const home = temp();
  const a = put(home, '.agents', 'skills');
  const g = put(home, '.gemini', 'config', 'skills');
  assert.deepEqual(adhdSkillFiles(home), [a, g]);
});
