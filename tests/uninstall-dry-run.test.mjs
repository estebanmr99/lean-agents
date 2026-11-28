// Tests for --uninstall --dry-run listing command undos (#369).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bunPathCommand } from '../scripts/lib/system.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-uninstall-dry-run-')));

test('--uninstall --dry-run lists undo for bun-path and jq and leaves state.json unchanged', () => {
  const home = tmp();
  const configDir = path.join(home, '.config', 'lean-agents');
  fs.mkdirSync(configDir, { recursive: true });
  const stateFile = path.join(configDir, 'state.json');

  const b = bunPathCommand(home);
  const bunRec = { desc: b.desc, ok: true, undo: b.undo };
  const jqRec = { desc: 'prerequisite: jq', ok: true, undo: [['winget', 'uninstall', '--id', 'jqlang.jq', '-e']] };

  const fixture = {
    version: '0.1.0',
    installedAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    pins: {},
    options: { agents: ['claude'], tools: [], terminals: ['warp'] },
    files: [],
    commands: [bunRec, jqRec],
  };

  const fixtureContent = `${JSON.stringify(fixture, null, 2)}\n`;
  fs.writeFileSync(stateFile, fixtureContent);

  const res = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--uninstall', '--dry-run', '--no-exec'],
    { encoding: 'utf8', env: { ...process.env, HOME: home } }
  );

  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /This restores 0 files and undoes 2 commands\./);
  assert.match(res.stdout, /  - undo: prerequisite: jq/);
  assert.match(res.stdout, /  - undo: put ~\\\.bun\\bin on your user PATH \(open a new terminal\)/); // literal-tilde: hardcoded Windows description text
  assert.match(res.stdout, /Nothing changed\./);

  const afterContent = fs.readFileSync(stateFile, 'utf8');
  assert.equal(afterContent, fixtureContent, 'state.json must be byte-identical');
});
