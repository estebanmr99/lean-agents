// --adopt lists ~/.cursor/hooks.json: names, owner, keep, and no encoded payload in any output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory } from '../scripts/lib/adopt.mjs';

const j = path.join;
const LEAN = path.resolve(import.meta.dirname, '..', 'scripts', 'lean.mjs');
const skip = process.platform === 'win32' && 'the real-tool-node job covers Windows paths';
// Synthetic: a dummy PowerShell payload, decoded only to name the Orca path it contains.
const PAYLOAD = Buffer.from('node $HOME/.orca/agent-hooks/cursor-status.js', 'utf16le').toString('base64');

// `hooks` is a string, null (no file) or a function of the home path.
function seeded(hooks) {
  const home = fs.realpathSync(fs.mkdtempSync(j(os.tmpdir(), 'adopt-cursor-')));
  fs.mkdirSync(j(home, 'synthetic'), { recursive: true });
  fs.mkdirSync(j(home, '.cursor'), { recursive: true });
  fs.mkdirSync(j(home, '.nvm'), { recursive: true });
  fs.writeFileSync(j(home, 'synthetic', 'gsd-cursor-demo.js'), '// synthetic GSD hook\n');
  fs.writeFileSync(j(home, 'synthetic', 'lean-cursor-demo.js'), '// managed by lean-agents\n');
  fs.mkdirSync(j(home, 'My Hooks'));
  fs.writeFileSync(j(home, 'My Hooks', 'quoted-cursor-demo.js'), '// managed by lean-agents\n');
  if (hooks !== null) fs.writeFileSync(j(home, '.cursor', 'hooks.json'), typeof hooks === 'function' ? hooks(home) : hooks);
  const env = { PATH: process.env.PATH, NVM_DIR: j(home, '.nvm'), HOME: home };
  return { home, env };
}
const run = ({ home, env }) => inventory({ home, env, platform: process.platform, realHome: '/nowhere' });
const cursor = (r) => r.items.filter((i) => i.client === 'cursor');

const goodHooks = (home) => JSON.stringify({
  version: 1,
  hooks: {
    sessionStart: [{ command: j(home, 'synthetic', 'gsd-cursor-demo.js') }],
    stop: [{ command: `${j(home, 'synthetic', 'gsd-cursor-demo.js')} --encoding utf8 --event stop` }], // `--encoding` is not `-enc`
    preToolUse: [{ command: 'rtk hook cursor' }],
    beforeShellExecution: [{ command: 'TOKEN=sekrit rtk hook cursor' }],
    sessionEnd: [{ command: `powershell.exe -NoProfile -EncodedCommand ${PAYLOAD}` }],
    afterFileEdit: [{ command: j(home, 'synthetic', 'lean-cursor-demo.js') }],
    beforeSubmitPrompt: [{ command: `"${j(home, 'My Hooks', 'quoted-cursor-demo.js')}"` }],
    beforeMCPExecution: [{ command: `powershell -enc ${PAYLOAD}` }],
    beforeReadFile: [{ type: 'prompt', prompt: 'ignored' }],
    beforeTabFileRead: [{ command: j(home, 'synthetic', 'user-cursor-demo.js') }],
  },
});

test('lists each Cursor hook by event and basename, keep, no payload', { skip }, async () => {
  const s = seeded(goodHooks);
  const r = await run(s);
  const hooks = cursor(r);
  assert.deepEqual(hooks.map((i) => i.name).sort(), [
    'afterFileEdit:lean-cursor-demo.js', 'beforeMCPExecution:powershell', 'beforeShellExecution:rtk', 'beforeSubmitPrompt:quoted-cursor-demo.js',
    'beforeTabFileRead:user-cursor-demo.js', 'preToolUse:rtk', 'sessionEnd:powershell', 'sessionStart:gsd-cursor-demo.js', 'stop:gsd-cursor-demo.js',
  ]);
  for (const i of hooks) assert.equal(i.action, 'keep');
  const owner = (name) => hooks.find((i) => i.name === name).owner;
  assert.equal(owner('sessionStart:gsd-cursor-demo.js'), 'managed'); // GSD name match, no mark (#199)
  assert.equal(owner('stop:gsd-cursor-demo.js'), 'managed');
  assert.equal(owner('preToolUse:rtk'), 'managed'); // RTK name match, no mark (#199)
  assert.equal(owner('beforeShellExecution:rtk'), 'managed'); // inline VAR=value prefix
  assert.equal(owner('beforeTabFileRead:user-cursor-demo.js'), 'user');
  assert.equal(owner('sessionEnd:powershell'), 'user'); // encoded Orca hook stays user
  assert.equal(owner('beforeMCPExecution:powershell'), 'user');
  assert.equal(owner('afterFileEdit:lean-cursor-demo.js'), 'managed');
  assert.equal(owner('beforeSubmitPrompt:quoted-cursor-demo.js'), 'managed'); // quoted path with a space
  assert.equal(hooks.find((i) => i.name === 'beforeMCPExecution:powershell').note, 'Orca agent status hook'); // -enc alias
  const hook = hooks.find((i) => i.name === 'sessionStart:gsd-cursor-demo.js');
  assert.equal(hook.kind, 'hook'); assert.deepEqual(hook.keyPath, ['hooks', 'sessionStart']); assert.equal(hook.file, '~/.cursor/hooks.json');
  assert.equal(hooks.find((i) => i.name === 'sessionEnd:powershell').note, 'Orca agent status hook');
  assert.ok(!hooks.some((i) => i.name.includes('sekrit')));
});

test('no base64 payload or secret in JSON or text output, and nothing is written', { skip }, async () => {
  const s = seeded(goodHooks);
  const before = fs.readFileSync(j(s.home, '.cursor', 'hooks.json'), 'utf8');
  const r = await run(s);
  assert.ok(!JSON.stringify(r).includes(PAYLOAD));
  assert.ok(!JSON.stringify(r).includes('sekrit'));
  const cli = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt', '--json'], { encoding: 'utf8', env: s.env });
  assert.equal(cli.status, 0, cli.stderr);
  const text = spawnSync(process.execPath, [LEAN, '--home', s.home, '--no-exec', '--adopt'], { encoding: 'utf8', env: s.env });
  assert.equal(text.status, 0, text.stderr);
  for (const out of [cli.stdout, text.stdout, cli.stderr, text.stderr]) {
    assert.ok(!out.includes(PAYLOAD));
    assert.ok(!out.includes('sekrit'));
  }
  assert.equal(JSON.parse(cli.stdout).items.filter((i) => i.client === 'cursor').length, 9);
  assert.match(text.stdout, /keep +managed +cursor hook sessionStart:gsd-cursor-demo\.js/);
  assert.match(text.stdout, /cursor hook sessionEnd:powershell .*Orca agent status hook/);
  assert.equal(fs.readFileSync(j(s.home, '.cursor', 'hooks.json'), 'utf8'), before);
});

test('a hook path that is a directory is user-owned; an unknown bare command never reads the cwd',{ skip }, async () => {
  const s = seeded((home) => JSON.stringify({ version: 1, hooks: { stop: [{ command: j(home, 'synthetic') }], preToolUse: [{ command: 'mytool hook cursor' }] } }));
  fs.writeFileSync(j(s.home, 'mytool'), '// managed by lean-agents\n'); // a cwd file that must not count
  const cwd = process.cwd();
  process.chdir(s.home);
  try {
    const r = await run(s);
    assert.equal(cursor(r).find((i) => i.name === 'stop:synthetic').owner, 'user');
    assert.equal(cursor(r).find((i) => i.name === 'preToolUse:mytool').owner, 'user');
  } finally { process.chdir(cwd); }
});

test('missing or invalid hooks.json gives no cursor items and no crash', { skip }, async () => {
  for (const hooks of [null, '{not json', '[]', '{"version":1,"hooks":"nope"}']) {
    const s = seeded(hooks);
    const r = await run(s);
    assert.deepEqual(cursor(r), []);
  }
});

test('a shell-loop GSD hook is named after its script; a duplicate gets #2 (#202)', { skip }, async () => {
  const GSD_LOOP = '$(for n in C:/nodejs/node.exe node; do [ -x "$n" ] && echo "$n" && break; done) ~/.cursor/hooks/gsd-cursor-demo.js';
  const s = seeded((home) => JSON.stringify({ version: 1, hooks: {
    sessionStart: [{ command: GSD_LOOP }, { command: j(home, 'synthetic', 'gsd-cursor-demo.js') }],
    stop: [{ command: 'sh -c "exit 0"' }],
  } }));
  const r = await run(s);
  const hooks = cursor(r);
  assert.deepEqual(hooks.map((i) => i.name), ['sessionStart:gsd-cursor-demo.js', 'sessionStart:gsd-cursor-demo.js#2', 'stop:shell']);
  assert.equal(hooks[0].owner, 'managed');
});

test('each shell head names its script or falls back to shell; a third duplicate gets #3 (#202)', { skip }, async () => {
  const cases = [
    ['(cd /x && node ~/.cursor/hooks/a-demo.mjs)', 'a-demo.mjs'],
    ['{ node ~/.cursor/hooks/b-demo.cjs; }', 'b-demo.cjs'],
    ['if true; then bash ~/.cursor/hooks/c-demo.sh; fi', 'c-demo.sh'],
    ['while false; do :; done', 'shell'],
    ['bash -c "echo hi"', 'shell'],
    ['$(node -e 1) ~/.cursor/hooks/d-demo.ps1', 'd-demo.ps1'],
  ];
  for (const [command, label] of cases) {
    const s = seeded(JSON.stringify({ version: 1, hooks: { stop: [{ command }] } }));
    assert.equal(cursor(await run(s))[0].name, `stop:${label}`, command);
  }
  const s = seeded((home) => JSON.stringify({ version: 1, hooks: { stop: [0, 1, 2].map(() => ({ command: j(home, 'synthetic', 'gsd-cursor-demo.js') })) } }));
  assert.deepEqual(cursor(await run(s)).map((i) => i.name), ['stop:gsd-cursor-demo.js', 'stop:gsd-cursor-demo.js#2', 'stop:gsd-cursor-demo.js#3']);
});
