import test from 'node:test';
import assert from 'node:assert/strict';
import { exitCrashAfterDone, run } from '../scripts/lib/system.mjs';

test('exitCrashAfterDone: true for skills CLI crash on exit after Done!', () => {
  const argv = ['npx', '-y', 'skills@1.7.4', 'remove', 'caveman', '-g', '-y'];
  const status = 3221226505;
  const out = 'Successfully removed 1 skill(s)\nDone!\nAssertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76';
  assert.equal(exitCrashAfterDone(argv, status, out), true);
});

test('exitCrashAfterDone: false when status is 0', () => {
  const argv = ['npx', '-y', 'skills@1.7.4', 'remove', 'caveman', '-g', '-y'];
  const out = 'Successfully removed 1 skill(s)\nDone!\nAssertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76';
  assert.equal(exitCrashAfterDone(argv, 0, out), false);
});

test('exitCrashAfterDone: false without Done!', () => {
  const argv = ['npx', '-y', 'skills@1.7.4', 'remove', 'caveman', '-g', '-y'];
  const status = 3221226505;
  const out = 'Successfully removed 1 skill(s)\nAssertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76';
  assert.equal(exitCrashAfterDone(argv, status, out), false);
});

test('exitCrashAfterDone: false without the assertion', () => {
  const argv = ['npx', '-y', 'skills@1.7.4', 'remove', 'caveman', '-g', '-y'];
  const status = 3221226505;
  const out = 'Successfully removed 1 skill(s)\nDone!\nSome other error';
  assert.equal(exitCrashAfterDone(argv, status, out), false);
});

test('exitCrashAfterDone: false for a non-skills argv', () => {
  const argv = ['npx', '-y', 'other@1', 'remove'];
  const status = 3221226505;
  const out = 'Successfully removed 1 skill(s)\nDone!\nAssertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\win\\async.c, line 76';
  assert.equal(exitCrashAfterDone(argv, status, out), false);
});

test('run(): counts skills crash on exit after Done! as done', () => {
  const logs = [];
  const codes = [];
  const script = 'console.log("Successfully removed 1 skill(s)\\nDone!"); console.error("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\\\\win\\\\async.c, line 76"); process.exit(1);';
  const ok = run([process.execPath, '-e', script, 'skills@1.7.4'], {
    dryRun: false,
    log: (msg) => logs.push(msg),
    codes,
  });
  assert.equal(ok, true);
  assert.deepEqual(codes, [1]);
  assert.ok(logs.some((l) => l.includes('the skills CLI finished, then Node crashed on exit')));
});
