// /lean-update as an OpenCode user command (#572): installed with the mark, undone, never over a user file, shown by --doctor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lean = (home, ...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], {
  encoding: 'utf8',
  env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR, HOME: home },
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-update-cmd-'));
const file = (home) => path.join(home, '.config', 'opencode', 'commands', 'lean-update.md');

for (const agent of ['opencode-v1', 'opencode-v2']) {
  test(`${agent}: install writes the marked command file, --uninstall removes it, doctor reports it`, () => {
    const home = tmp();
    const r = lean(home, '--no-exec', '--yes', '--agents', agent);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const text = fs.readFileSync(file(home), 'utf8');
    assert.match(text, /^---\ndescription: Update lean-agents and the tools it manages\n---\n/);
    assert.match(text, /managed by lean-agents/);
    assert.match(text, /`lean-update` skill/);
    assert.match(text, /\$ARGUMENTS/);

    const d = lean(home, '--doctor', '--json');
    const row = JSON.parse(d.stdout).rows.find((x) => x.item === `lean-update command (${agent})`);
    assert.equal(row?.detail, '/lean-update (command file)');

    const u = lean(home, '--uninstall', '--no-exec', '--yes');
    assert.equal(u.status, 0, u.stderr + u.stdout);
    assert.ok(!fs.existsSync(file(home)), 'command file left behind');
  });
}

test('a user lean-update.md without the mark is kept and doctor says missing', () => {
  const home = tmp();
  fs.mkdirSync(path.dirname(file(home)), { recursive: true });
  fs.writeFileSync(file(home), 'my own command\n');
  const r = lean(home, '--no-exec', '--yes', '--agents', 'opencode-v2');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(fs.readFileSync(file(home), 'utf8'), 'my own command\n');
  const row = JSON.parse(lean(home, '--doctor', '--json').stdout).rows.find((x) => x.item === 'lean-update command (opencode-v2)');
  assert.equal(row?.detail, 'missing');
  lean(home, '--uninstall', '--no-exec', '--yes');
  assert.equal(fs.readFileSync(file(home), 'utf8'), 'my own command\n');
});

test('doctor: a skill agent reads /lean-update (skill) once the skill install succeeded, else missing', async () => {
  const { doctor } = await import('../scripts/lib/doctor.mjs');
  const { leanUpdateCommands } = await import('../scripts/lib/lean-update.mjs');
  const { preset } = await import('../scripts/lib/network.mjs');
  const rowFor = (ok) => {
    const home = tmp();
    const cmd = leanUpdateCommands(['claude'])[0];
    const state = { version: '0', commands: [{ ...cmd, ok }], files: [], options: { agents: ['claude'], tools: [], privacy: 'standard', network: preset('on') } };
    let out = '';
    const write = process.stdout.write;
    process.stdout.write = (s) => { out += s; return true; };
    try { doctor({ home, state, exec: false, json: true, env: {}, platform: 'linux' }); } finally { process.stdout.write = write; }
    return JSON.parse(out).rows.find((x) => x.item === 'lean-update command (claude)');
  };
  assert.equal(rowFor(true).detail, '/lean-update (skill)');
  assert.equal(rowFor(false).detail, 'missing');
});
