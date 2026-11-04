// Tests for the parallel sessions helper in throwaway git repos. No agent binary and no real HOME are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTask, tierOf, tierModel, buildWorkerCommand, start, status, merge, clean, leftovers } from '../scripts/lib/parallel.mjs';

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-par-')));
const sh = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const noWin = { skip: process.platform === 'win32' && 'stub agent is a shebang script' };

function repo() {
  const dir = path.join(tmp(), 'proj');
  fs.mkdirSync(dir);
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.name', 'Test');
  sh(dir, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  sh(dir, 'add', '.');
  sh(dir, 'commit', '-qm', 'init');
  return dir;
}

// Stub agent: reads the prompt file it is given, commits <task>.txt and reports done.
function stub(root) {
  const file = path.join(root, 'stub.mjs');
  fs.writeFileSync(file, `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const prompt = fs.readFileSync(process.argv[2], 'utf8');
const statusFile = prompt.match(/writing one line to (\\S+):/)[1];
const name = path.basename(path.dirname(process.argv[2]));
fs.writeFileSync(name + '.txt', name + '\\n');
for (const a of [['add', '.'], ['-c', 'user.name=Stub', '-c', 'user.email=stub@example.com', 'commit', '-qm', name]]) spawnSync('git', a);
fs.writeFileSync(statusFile, 'done\\n');
`);
  fs.chmodSync(file, 0o755);
  return file;
}

function tasks(dir, check) {
  return ['one', 'two'].map((n) => {
    const f = path.join(path.dirname(dir), `${n}.md`);
    fs.writeFileSync(f, `---\nrole: ${n === 'one' ? 'explore' : 'build'}\n${check ? `check: ${check}\n` : ''}---\nDo ${n}.\n`);
    return f;
  });
}

const waitDone = async (dir, n) => {
  for (let i = 0; i < 100 && status(dir).filter((w) => w.status === 'done').length < n; i++) await new Promise((r) => setTimeout(r, 100));
};

test('default tiers by role, override, and profile mapping', () => {
  assert.equal(tierOf({ name: 'a', role: 'plan' }), 'strong');
  assert.equal(tierOf({ name: 'a', role: 'build' }), 'balanced');
  assert.equal(tierOf({ name: 'a', role: 'research' }), 'cheap');
  assert.equal(tierOf({ name: 'a', role: 'build', tier: 'cheap' }), 'cheap');
  assert.equal(tierOf({ name: 'a', role: 'build' }, 'strong'), 'strong');
  assert.throws(() => tierOf({ name: 'a', role: 'build', tier: 'huge' }), /unknown tier/);
  assert.deepEqual(['cheap', 'balanced', 'strong'].map((t) => tierModel('claude', t)), ['haiku', 'sonnet', 'opus']);
  assert.equal(tierModel('opencode', 'cheap', 'opencode-go'), 'opencode-go/glm-5.3-flash');
});

test('worker commands are argv arrays with the model flag per agent', () => {
  const a = { name: 't', model: 'haiku', promptFile: '/p/task.md', base: 'main' };
  const claude = buildWorkerCommand({ ...a, agent: 'claude' });
  assert.deepEqual(claude.slice(0, 6), ['claude', '--bg', '-n', 't', '--permission-mode', 'plan']);
  assert.ok(claude.join(' ').includes('--model haiku'));
  assert.equal(claude.at(-1), 'Read /p/task.md and follow it.');
  const oc = buildWorkerCommand({ ...a, agent: 'opencode', model: 'p/m' });
  assert.ok(oc.join(' ').includes('-m p/m') && oc.join(' ').includes('-f /p/task.md'));
  const orca = buildWorkerCommand({ ...a, agent: 'orca' });
  assert.ok(orca.join(' ').includes('--model haiku') && orca.includes('--base-branch') && orca.includes('--json'));
});

test('task file parsing rejects unsafe names', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'Bad Name.md'), 'x');
  assert.throws(() => parseTask(path.join(d, 'Bad Name.md')), /lowercase/);
});

test('start, status, ordered merge with rebase, clean', noWin, async () => {
  const dir = repo();
  const agent = stub(path.dirname(dir));
  const [one, two] = tasks(dir, 'git status');
  const workers = start(dir, [one, two], { agent: 'custom', cmd: agent, profile: 'claude-subscription' });
  assert.deepEqual(workers.map((w) => [w.name, w.tier, w.model]), [['one', 'cheap', 'haiku'], ['two', 'balanced', 'sonnet']]);
  assert.ok(workers.every((w) => fs.existsSync(w.dir)));
  await waitDone(dir, 2);
  assert.deepEqual(status(dir).map((w) => w.status), ['done', 'done']);
  assert.deepEqual(leftovers(dir), ['one', 'two']);

  assert.throws(() => merge(dir, 'two'), /merge "one" first/);
  assert.deepEqual(merge(dir, 'one'), ['two']);
  assert.deepEqual(merge(dir, 'two'), []);
  assert.ok(fs.existsSync(path.join(dir, 'one.txt')) && fs.existsSync(path.join(dir, 'two.txt')));
  // the second worker was rebased onto the first merge before it was merged
  assert.equal(sh(dir, 'rev-list', '--count', '--merges', 'main'), '2');

  assert.deepEqual(clean(dir).removed, ['one', 'two']);
  assert.equal(sh(dir, 'branch', '--list', 'lean/*'), '');
  assert.equal(sh(dir, 'worktree', 'list').split('\n').length, 1);
  assert.deepEqual(leftovers(dir), []);
});

test('merge refuses unfinished workers; clean keeps unmerged ones', noWin, () => {
  const dir = repo();
  const [one] = tasks(dir);
  start(dir, [one], { agent: 'print' });
  assert.throws(() => merge(dir, 'one'), /not done/);
  assert.deepEqual(clean(dir), { removed: [], kept: ['one'] });
  assert.ok(fs.existsSync(`${dir}.lean/one`));
});
