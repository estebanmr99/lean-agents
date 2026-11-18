// Antigravity: agy found outside PATH (#211) and user skills kept on undo (#148). Temp HOME, no real agy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agyCandidates, findAgy, version, BREW_AGY_LIMIT } from '../scripts/lib/system.mjs';
import { agentLifecycle } from '../scripts/lib/agent-lifecycle.mjs';
import { antigravityAdapter } from '../scripts/lib/adapters/antigravity.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-agy-'));
const quietly = async (fn) => { const log = console.log; const out = []; console.log = (...a) => out.push(a.join(' ')); try { await fn(); } finally { console.log = log; } return out.join('\n'); };

test('agy candidates: install.sh folder on POSIX, install.ps1 and #211 folders on Windows', () => {
  assert.deepEqual(agyCandidates('/h', 'linux', {}), ['/h/.local/bin/agy']);
  assert.deepEqual(agyCandidates('C:\\u', 'win32', { LOCALAPPDATA: 'C:\\u\\AppData\\Local' }), ['C:\\u\\AppData\\Local\\agy\\bin\\agy.exe', 'C:\\u\\.gemini\\bin\\agy.exe']);
  assert.deepEqual(agyCandidates('C:\\u', 'win32', {}), ['C:\\u\\.gemini\\bin\\agy.exe']);
});

// A shell script cannot be the fake on Windows; the pure test above covers the paths there.
test('a fake agy outside PATH is found and its version read; absent is missing', { skip: process.platform === 'win32' && 'POSIX shell script fake' }, () => {
  const home = tmp();
  const oldPath = process.env.PATH;
  process.env.PATH = tmp();
  try {
    assert.equal(findAgy(home, 'linux', {}), null);
    const agy = agyCandidates(home, 'linux', {})[0];
    fs.mkdirSync(path.dirname(agy), { recursive: true });
    fs.writeFileSync(agy, '#!/bin/sh\necho "agy 1.5.9"\n', { mode: 0o755 });
    assert.equal(findAgy(home, 'linux', {}), agy);
    assert.equal(version(agy), '1.5.9');
  } finally { process.env.PATH = oldPath; }
});

test('--install-agent leaves an agy found outside PATH alone', async () => {
  const home = tmp();
  const agy = agyCandidates(home, process.platform).at(-1);
  fs.mkdirSync(path.dirname(agy), { recursive: true });
  fs.writeFileSync(agy, 'fake');
  const table = { antigravity: { method: 'script', run: [['false']], bins: [], dirs: [], cmd: 'agy' } };
  const out = await quietly(() => agentLifecycle({ mode: 'install', agents: ['antigravity'], home, realHome: '/nowhere', stateDir: path.join(home, 'state'), dryRun: false, exec: true, yes: true, ask: async (_q, d) => d, yesNo: (a) => /^y/i.test(a), table }));
  assert.match(out, /antigravity: already installed, not by lean-agents; left alone/);
});

const adapt = (home, prior = []) => antigravityAdapter({ home, core: { agents: [] }, profile: null, opts: { tools: ['caveman', 'i-have-adhd'], prior }, rules: '', adhdCommand: { tool: 'adhd', desc: 'adhd', run: [], undo: [] } });
const skillDir = (home, n) => { const d = path.join(home, '.gemini', 'config', 'skills', n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), 'mine'); };

test('an unmarked user skill with a managed name is neither installed over nor removed on undo', async () => {
  const home = tmp();
  skillDir(home, 'i-have-adhd');
  let commands;
  const out = await quietly(() => { commands = adapt(home).commands; });
  assert.match(out, /Kept your existing Antigravity skill "i-have-adhd"/);
  assert.ok(!commands.some((c) => c.desc.startsWith('i-have-adhd skill') || c.desc === 'adhd'), 'user skill planned or rewritten');
  const caveman = commands.find((c) => c.desc.startsWith('Caveman'));
  assert.ok(caveman.undo[0].includes('caveman-stats'), 'managed skills still undone');
});

test('a skill recorded in state.json from an earlier run stays managed', async () => {
  const home = tmp();
  skillDir(home, 'caveman');
  const prior = [{ desc: 'Caveman skills for Antigravity', undo: [['npx', 'remove', 'caveman', 'caveman-compress']] }];
  const caveman = adapt(home, prior).commands.find((c) => c.desc.startsWith('Caveman'));
  assert.ok(caveman.undo[0].includes('caveman'));
});

test('--install-agent on a brew cask prints the unpinned limit and names it in the question', async () => {
  const home = tmp();
  const asked = [];
  const table = { antigravity: { method: 'brew', run: [['true']], uninstall: [], bins: [], dirs: [], cmd: 'agy', unpinned: BREW_AGY_LIMIT } };
  const out = await quietly(() => agentLifecycle({ mode: 'install', agents: ['antigravity'], home, realHome: '/nowhere', stateDir: path.join(home, 'state'), dryRun: false, exec: true, yes: false, ask: async (q, d) => { asked.push(q); return d; }, yesNo: (a) => /^y/i.test(a), table }));
  assert.match(out, /cannot pin or verify this cask/);
  assert.match(asked[0], /not pinned/);
});
