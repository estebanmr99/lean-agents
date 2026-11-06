// Session 20 in CI (ubuntu, windows): the agent-install flow in a throwaway HOME, no login, no real GitHub API.
// gh is hidden from PATH to prove the default; `gh` for the feedback flow is a stub that records its arguments.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lean agents '));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
process.env.LEAN_AGENTS_NODE ??= '24.22.2';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });
const lean = (args, opts) => run(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], opts);
const json = (r) => { assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };

// PATH without any folder that holds gh, so the engine sees it as missing.
const hasGh = (d) => ['gh', 'gh.exe', 'gh.cmd'].some((n) => fs.existsSync(path.join(d, n)));
const noGhPath = process.env.PATH.split(path.delimiter).filter((d) => d && !hasGh(d)).join(path.delimiter);
const env = { ...process.env, PATH: noGhPath, ...(win && { Path: noGhPath }) };
const base = ['--no-exec', '--yes', '--dry-run', '--json', '--agents', 'claude'];

// 1. gh is on by default when missing, and --no-gh skips it. Without --no-exec the plan lists the prerequisite step.
const withGh = json(lean(base, { env }));
assert.equal(withGh.gh, true, 'gh not preselected');
const execBase = base.filter((a) => a !== '--no-exec');
const mentionsGh = (p) => p.commands.some((c) => /\bgh\b/.test(c.desc));
assert.ok(mentionsGh(json(lean(execBase, { env }))), 'plan has no gh step');
assert.equal(json(lean([...base, '--no-gh'], { env })).gh, false, '--no-gh ignored');
assert.ok(!mentionsGh(json(lean([...execBase, '--no-gh'], { env }))), '--no-gh still plans gh');
console.log('ok gh default and --no-gh');

// 2. -NoGh through install.ps1 reaches the engine.
if (win) {
  const r = run('pwsh', ['-NoProfile', '-File', path.join(ROOT, 'install.ps1'), '-DryRun', '-Yes', '-NoGh', '-Agents', 'claude', '--no-exec', '--json', '--home', home], { env });
  assert.equal(json(r).gh, false, '-NoGh ignored');
  console.log('ok -NoGh');
}

// 3. --dry-run --json and --doctor --json parse; the plan has no absolute home path.
assert.ok(withGh.files.length && withGh.files.every((f) => !f.path.includes(home)), 'plan leaks the home path');
lean(['--no-exec', '--yes', '--agents', 'claude']); // state for the doctor
const doc = json(lean(['--no-exec', '--doctor', '--json']));
assert.ok(doc.rows.some((r) => r.item === 'lean-agents' && r.status === 'ok'), JSON.stringify(doc.rows[0]));
console.log('ok --json');

// 4. Feedback: a stub gh records its arguments; the strict preset gets no offer.
const bin = path.join(tmp, 'bin');
const log = path.join(tmp, 'gh.log');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'gh.mjs'), `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
fs.writeFileSync(path.join(bin, win ? 'gh.cmd' : 'gh'), win ? `@"${process.execPath}" "%~dp0gh.mjs" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/gh.mjs" "$@"\n`, { mode: 0o755 });
const ghEnv = { ...env, PATH: `${bin}${path.delimiter}${noGhPath}`, HTTPS_PROXY: 'http://proxy.corp.example:3128' };

const draft = json(lean(['--feedback-draft', '--failed-command', 'winget install gh', '--network', 'on'], { env: ghEnv, input: `failed in ${home}\\x via ${ghEnv.HTTPS_PROXY} as ${os.userInfo().username}` }));
for (const leak of [home, 'proxy.corp.example', os.userInfo().username]) assert.ok(!draft.body.includes(leak), `draft leaks ${leak}`);
assert.deepEqual(json(lean(['--feedback-draft', '--failed-command', 'x', '--privacy', 'strict'], { env: ghEnv, input: 'x' })), { offer: false });

const body = path.join(tmp, 'draft.md');
fs.writeFileSync(body, draft.body);
// gh.cmd needs a shell on Windows, which splits arguments on spaces: quote them.
const gh = (args) => run('gh', win ? args.map((a) => `"${a}"`) : args, { env: ghEnv, shell: win });
assert.equal(gh(['issue', 'list', '--repo', 'estebanmr99/lean-agents', '--search', draft.title]).status, 0);
assert.equal(gh(['issue', 'create', '--repo', 'estebanmr99/lean-agents', '--title', draft.title, '--body-file', body]).status, 0);
const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['issue', 'list'], ['issue', 'create']]);
console.log('ok feedback draft and stub gh');
fs.rmSync(tmp, { recursive: true, force: true });
