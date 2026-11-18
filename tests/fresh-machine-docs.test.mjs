// The fresh-machine docs: every --flag they name exists in lean.mjs --help, and they hold no real home path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const section = (md, heading) => md.slice(md.indexOf(heading)).split(/\n###? /)[0];
const docs = {
  'README.md': section(read('README.md'), '### Fresh Mac or Windows PC'),
  'README.es.md': section(read('README.es.md'), '### Mac o PC con Windows nuevos'),
  'docs/fresh-machine.md': read('docs/fresh-machine.md'),
};

// Only `--word` forms are checked: the install.ps1 switches use one dash, and `gh ...` spans are GitHub CLI commands.
const flagsOf = (text) => new Set(text.replace(/`gh [^`]*`/g, '').match(/(?<![\w-])--[a-z][a-z-]*/g));

test('every --flag in the fresh-machine docs exists in lean.mjs --help', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-docs-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/lean.mjs'), '--home', home, '--help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  const known = flagsOf(r.stdout);
  for (const [file, text] of Object.entries(docs)) {
    assert.ok(text.length > 200, `${file}: section not found`);
    assert.deepEqual([...flagsOf(text)].filter((f) => !known.has(f)), [], file);
  }
});

test('the fresh-machine docs hold no real home path', () => {
  for (const [file, text] of Object.entries(docs)) assert.doesNotMatch(text, /C:\\Users\\|\/Users\/[^<\s]|\/home\/[^<\s]/i, file);
});
