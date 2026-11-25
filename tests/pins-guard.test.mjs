// pins-latest.mjs rewrites core/pins.json, so it refuses to run outside CI without --force. Real child process, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PINS = path.join(ROOT, 'core', 'pins.json');

test('pins-latest.mjs exits 1 and leaves core/pins.json alone outside CI', () => {
  const before = fs.readFileSync(PINS);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'pins-latest.mjs')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pins-latest\.mjs only runs in CI/);
  assert.deepEqual(fs.readFileSync(PINS), before);
});