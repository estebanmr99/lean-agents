// --doctor passes the network preset to every child command and skips `mcp list` when outbound is off. Stubbed runner, no real commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import { doctor } from '../scripts/lib/doctor.mjs';
import { preset } from '../scripts/lib/network.mjs';

function runDoctor(network, agents = ['claude', 'copilot-cli', 'antigravity']) {
  const calls = [];
  const run = (argv, _t, env) => { calls.push({ argv, env }); return { ok: true, out: 'serena playwright' }; };
  const state = { version: '0', commands: [], files: [], options: { agents, tools: ['serena', 'playwright', 'codeburn', 'autoskills'], privacy: 'standard', network } };
  let out = '';
  const write = process.stdout.write;
  process.stdout.write = (s) => { out += s; return true; };
  try { doctor({ home: '/nonexistent-lean-home', state, exec: true, json: true, run }); } finally { process.stdout.write = write; }
  return { calls, rows: JSON.parse(out).rows };
}
const isMcp = (c) => c.argv.includes('mcp');

test('strict: children get DO_NOT_TRACK and no mcp list runs', () => {
  const { calls, rows } = runDoctor(preset('off'));
  assert.ok(calls.some((c) => c.argv[0] === 'npx'));
  for (const c of calls) assert.equal(c.env.DO_NOT_TRACK, '1', c.argv.join(' '));
  assert.equal(calls.filter(isMcp).length, 0);
  assert.equal(rows.filter((r) => r.item === 'mcp servers' && r.status === 'skipped').length, 1);
});

test('on: no extra env, mcp list runs, no skipped row', () => {
  const { calls, rows } = runDoctor(preset('on'));
  assert.ok(calls.filter(isMcp).length >= 3);
  for (const c of calls) assert.deepEqual(c.env, {});
  assert.equal(rows.some((r) => r.status === 'skipped'), false);
});

test('strict: no skipped row when no selected agent runs mcp list', () => {
  const { rows } = runDoctor(preset('off'), ['opencode-v2']);
  assert.equal(rows.some((r) => r.status === 'skipped'), false);
});
