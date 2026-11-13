// Real --install-agent / --uninstall-agent for one agent in a throwaway HOME (CI and local): install, `--version`,
// uninstall, binary gone, user files unchanged, a second uninstall does nothing. Usage: node tests/real-agent-lifecycle.mjs <agent>
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentTable } from '../scripts/lib/agent-lifecycle.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agent = process.argv[2];
const win = process.platform === 'win32';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-agent-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };
const lean = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--yes', ...args], { encoding: 'utf8' });

const user = path.join(home, '.local', 'bin', 'user-tool');
fs.mkdirSync(path.dirname(user), { recursive: true });
fs.writeFileSync(user, 'mine\n');
const bins = agentTable({ home, platform: process.platform, dir: path.join(home, '.config', 'lean-agents'), realHome: os.homedir() })[agent].bins;
assert.ok(bins.length, `${agent}: no binary path to check`);

const not = lean('--uninstall-agent', agent);
assert.match(not.stdout, /not installed by lean-agents/, not.stdout + not.stderr);

const IGNORE = /^(\.npm|\.cache|Library[\\/]Caches|\.config|AppData|npm-cache|\.claude|\.local[\\/]state|\.local[\\/]share[\\/]opencode)/;
const list = (d = home, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) list(p, out); else out.push(path.relative(home, p)); } return out; };
const inst = lean('--install-agent', agent);
assert.equal(inst.status, 0, inst.stdout + inst.stderr);
for (const b of bins) assert.ok(fs.existsSync(b), `${b} missing after install\n${inst.stdout}`);
const installed = new Set(list());
const v = spawnSync(bins[0], ['--version'], { encoding: 'utf8', env, shell: win && /\.cmd$/.test(bins[0]), timeout: 60000 });
assert.equal(v.status, 0, `--version failed: ${v.stdout}${v.stderr}`);
console.log(`ok ${agent} installed: ${v.stdout.trim().split('\n')[0]}`);

const rec = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'agents.json'), 'utf8')).agents[agent];
assert.ok(rec.uninstall || rec.files.length, 'nothing recorded');

const un = lean('--uninstall-agent', agent);
assert.equal(un.status, 0, un.stdout + un.stderr);
for (const b of bins) assert.ok(!fs.existsSync(b), `${b} still there after uninstall\n${un.stdout}`);
for (const f of rec.files) assert.ok(!fs.existsSync(f.path), `${f.path} left behind`);
assert.equal(fs.readFileSync(user, 'utf8'), 'mine\n', 'user file changed');
// Nothing the install itself put down may stay behind. Caches, config and state an agent makes when it runs are user data and stay.
const stray = list().filter((f) => installed.has(f) && f !== path.relative(home, user) && !IGNORE.test(f));
assert.deepEqual(stray, [], 'files left behind');
assert.match(lean('--uninstall-agent', agent).stdout, /not installed by lean-agents/);
console.log(`ok ${agent} uninstalled, user files unchanged`);
fs.rmSync(home, { recursive: true, force: true });
