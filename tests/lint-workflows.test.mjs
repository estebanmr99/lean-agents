import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findPipes } from '../scripts/lint-workflows.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lint = (...files) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lint-workflows.mjs'), ...files], { cwd: ROOT, encoding: 'utf8' });

test('lint-workflows: the fixture with curl | bash, curl | sh and irm | iex fails', () => {
  assert.equal(findPipes(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'curl-pipe.yml'), 'utf8')).length, 3);
  const r = lint('tests/fixtures/curl-pipe.yml');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /3 piped download/);
});

test('lint-workflows: the real workflows and actions pass', () => {
  const r = lint();
  assert.equal(r.status, 0, r.stdout);
});

test('ci-downloads.json bun entries match core/pins.json', () => {
  const dl = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'ci-downloads.json'), 'utf8'));
  const { version, sha256 } = JSON.parse(fs.readFileSync(path.join(ROOT, 'core', 'pins.json'), 'utf8')).pins.bun;
  for (const [k, plat] of [['bun-linux-x64', 'linux-x64'], ['bun-windows-x64', 'windows-x64']]) {
    assert.equal(dl[k].sha256, sha256[plat], k);
    assert.ok(dl[k].url.includes(`bun-v${version}/`), k);
  }
});
