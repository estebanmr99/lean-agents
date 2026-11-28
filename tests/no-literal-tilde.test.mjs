// Fails when a test compares against a literal home-relative string instead of an OS path (#544).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = import.meta.dirname;
// A string literal that starts with `~/` or `~\`, e.g. '~/x', "~\\x" or `~/x`.
const LITERAL = /(['"`])~[\\/]/;
// A line ends with the escape hatch: // literal-tilde: <reason>
const ALLOWED = /\/\/ literal-tilde: .+$/;

test('test assertions build home-relative paths with tildePath, not a literal tilde', () => {
  const hits = [];
  for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.test.mjs')).sort()) {
    const lines = fs.readFileSync(path.join(DIR, name), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.includes('assert') || !LITERAL.test(line) || ALLOWED.test(line)) return;
      hits.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, [], `literal tilde in an assertion; use tildePath(...) or end the line with // literal-tilde: <reason>:\n${hits.join('\n')}`);
});