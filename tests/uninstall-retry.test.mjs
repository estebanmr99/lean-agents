// --uninstall after a failed undo (#287): the failed command stays in state.json for a retry, nothing is archived until it passes,
// and --uninstall-agent vscode-copilot resolves the <lean-node> placeholder. Throwaway HOME; stubs are node itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { UNDO_NODE } from '../scripts/lib/prereqs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-uninstall-')));
const lean = (home, args, exec = false) => {
  const env = { PATH: process.env.PATH, HOME: home };
  if (process.env.NVM_DIR) env.NVM_DIR = process.env.NVM_DIR;
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...(exec ? [] : ['--no-exec']), '--yes', ...args], { encoding: 'utf8', env });
};
const stateFile = (home) => path.join(home, '.config', 'lean-agents', 'state.json');
const archived = (home) => fs.readdirSync(path.dirname(stateFile(home))).filter((f) => f.startsWith('state.uninstalled-'));

function installed(commands) {
  const home = tmp();
  assert.equal(lean(home, ['--agents', 'vscode-copilot', '--no-tools']).status, 0);
  const state = JSON.parse(fs.readFileSync(stateFile(home), 'utf8'));
  fs.writeFileSync(stateFile(home), JSON.stringify({ ...state, commands }));
  return home;
}

test('a failed undo command stays recorded, nothing is archived, and a second --uninstall retries it', () => {
  const flag = path.join(tmp(), 'ok');
  const gate = [process.execPath, '-e', 'process.exit(require("fs").existsSync(process.argv[1]) ? 0 : 3)', flag];
  const fine = [process.execPath, '-e', 'process.exit(0)'];
  const home = installed([{ agent: 'x', undo: [gate, fine] }]);
  const first = lean(home, ['--uninstall'], true);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.match(first.stdout, /Not finished: 1 undo command/);
  assert.deepEqual(archived(home), []);
  const kept = JSON.parse(fs.readFileSync(stateFile(home), 'utf8'));
  assert.deepEqual(kept.commands.map((c) => c.undo), [[gate]], 'only the failed argv is kept');
  assert.deepEqual(kept.files, []);
  fs.writeFileSync(flag, '');
  const second = lean(home, ['--uninstall'], true);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(archived(home).length, 1);
  assert.equal(fs.existsSync(stateFile(home)), false);
});

test('a state with one ok:false command whose undo fails: --uninstall --yes finishes ("Uninstalled")', () => {
  const gate = [process.execPath, '-e', 'process.exit(1)'];
  const home = installed([{ agent: 'x', ok: false, undo: [gate] }]);
  const first = lean(home, ['--uninstall'], true);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.match(first.stdout, /Uninstalled/);
  assert.match(first.stdout, /\(it did not finish, so there may be nothing to remove\)/);
  assert.equal(archived(home).length, 1);
  assert.equal(fs.existsSync(stateFile(home)), false);
});

test('--uninstall-agent vscode-copilot runs an undo that starts with the <lean-node> placeholder', () => {
  const home = installed([{ agent: 'vscode-copilot', undo: [[UNDO_NODE, '-e', 'process.exit(0)']] }]);
  const r = lean(home, ['--uninstall-agent', 'vscode-copilot'], true);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /failed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(stateFile(home), 'utf8')).commands, []);
});
