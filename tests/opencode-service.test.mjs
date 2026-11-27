// #548: --update leaves no OpenCode 2 background service behind when its own commands started it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceStopRow, runningBlocker, OPENCODE_RUNNING } from '../scripts/lib/opencode-backup.mjs';

const stop = ['opencode', 'service', 'stop'];

test('none before and one after: one opencode service stop row', () => {
  const row = serviceStopRow({ before: false, agents: ['opencode-v2'], list: () => ['node', 'opencode'] });
  assert.deepEqual(row.run, [stop]);
  assert.match(row.desc, /stop the OpenCode 2 background service/);
});

test('one before: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: true, agents: ['opencode-v2'], list: () => ['opencode'] }), null);
});

test('none before and none after: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: false, agents: ['opencode-v2'], list: () => ['node'] }), null);
});

test('OpenCode 2 not configured: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: false, agents: ['claude'], list: () => ['opencode'] }), null);
});

test('cannot list the processes: nothing is stopped', () => {
  assert.equal(serviceStopRow({ before: false, agents: ['opencode-v2'], list: () => { throw new Error('ps failed'); } }), null);
});

test('the refusal names the safe service stop command', () => {
  const r = runningBlocker([{ desc: 'RTK plugin for OpenCode', run: [['rtk', 'init', '-g', '--opencode']] }], () => ['opencode']);
  assert.equal(r, OPENCODE_RUNNING);
  assert.match(r, /run 'opencode service stop' \(safe: it stops only the background service\) and close OpenCode windows, then run this again/);
});