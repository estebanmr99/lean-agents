// Flag drift (#287): every `case '--x'` in lean.mjs is in --help and in README EN and ES (the two deprecated no-ops excepted).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lean = fs.readFileSync(path.join(ROOT, 'scripts', 'lean.mjs'), 'utf8');
const flags = [...new Set([...lean.matchAll(/case '(--[a-z0-9-]+)'/g)].map((m) => m[1]))];
const DEPRECATED = ['--skip-agents', '--no-admin']; // accepted with a warning for one more release
const mentions = (text, flag) => new RegExp(`(?<![\\w-])${flag}(?![\\w-])`).test(text);
const help = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH } }).stdout;

test('every flag the engine parses is in --help', () => {
  assert.deepEqual(flags.filter((f) => !DEPRECATED.includes(f) && f !== '--help' && !mentions(help, f)), []);
});

for (const readme of ['README.md', 'README.es.md']) {
  test(`every flag the engine parses is in ${readme}`, () => {
    const md = fs.readFileSync(path.join(ROOT, readme), 'utf8');
    assert.deepEqual(flags.filter((f) => !DEPRECATED.includes(f) && f !== '--help' && !mentions(md, f)), []);
  });
}

test('the deprecated no-op flags warn instead of passing silently', () => {
  for (const f of DEPRECATED) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), f, '--version'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.match(r.stderr, new RegExp(`${f} does nothing`));
  }
});
