// Every pin in core/pins.json must be named in docs/SECURITY-REVIEW.md, so a new pin cannot ship unreviewed (#155).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'core', 'pins.json'), 'utf8')).pins);
// Only the pin table counts: a key named in prose elsewhere does not review the pin.
const rows = fs.readFileSync(path.join(ROOT, 'docs', 'SECURITY-REVIEW.md'), 'utf8').split('\n').filter((l) => l.startsWith('|'));

test('every core/pins.json key is named in docs/SECURITY-REVIEW.md', () => {
  const missing = keys.filter((k) => !rows.some((r) => r.includes(`\`${k}\``)));
  assert.deepEqual(missing, [], `missing from docs/SECURITY-REVIEW.md: ${missing.join(', ')}`);
});
