// #548: --update leaves no OpenCode 2 background service behind when its own commands started it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceStopRow, runningBlocker, OPENCODE_RUNNING } from '../scripts/lib/opencode-backup.mjs';

const stop = ['opencode', 'service', 'stop'];

test('no pid before and a new one after: one opencode service stop row', () => {
  const row = serviceStopRow({ before: new Set(), agents: ['opencode-v2'], pids: () => [42] });
  assert.deepEqual(row.run, [stop]);
  assert.match(row.desc, /stop the OpenCode 2 background service/);
});

test('the same pid before and after: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set([7]), agents: ['opencode-v2'], pids: () => [7] }), null);
});

test('a pid before and a new one after: nothing is stopped (not ours)', () => {
  assert.equal(serviceStopRow({ before: new Set([7]), agents: ['opencode-v2'], pids: () => [7, 42] }), null);
});

test('no pid before and none after: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set(), agents: ['opencode-v2'], pids: () => [] }), null);
});

test('OpenCode 2 not configured: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set(), agents: ['claude'], pids: () => [42] }), null);
});

test('cannot list the processes: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: new Set(), agents: ['opencode-v2'], pids: () => { throw new Error('ps failed'); } }), null);
});

test('the before list could not be read: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: null, agents: ['opencode-v2'], pids: () => [42] }), null);
});

test('the refusal names the safe service stop command', () => {
  const r = runningBlocker([{ desc: 'RTK plugin for OpenCode', run: [['rtk', 'init', '-g', '--opencode']] }], () => ['opencode']);
  assert.equal(r, OPENCODE_RUNNING);
  assert.match(r, /run 'opencode service stop' \(safe: it stops only the background service\) and close OpenCode windows, then run this again/);
});