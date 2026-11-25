import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareCounts, countTests } from '../scripts/test-count.mjs';

test('countTests counts correctly', () => {
  const code = `
    test('one', () => {});
    it('two', () => {});
    t.test('three', () => {});
    // test('ignored', () => {});
      // it('also ignored', () => {});
    other();
    test('four', () => {
      it('nested', () => {});
    });
  `;
  assert.equal(countTests(code), 5);
});

test('compareCounts flags drops', () => {
  const base = { 't1.test.mjs': 5, 't2.test.mjs': 3 };
  const head = { 't1.test.mjs': 4, 't2.test.mjs': 3 };
  const { errors } = compareCounts(base, head);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('t1.test.mjs'));
});

test('compareCounts flags deletions', () => {
  const base = { 't1.test.mjs': 5 };
  const head = {};
  const { errors } = compareCounts(base, head);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('t1.test.mjs'));
});

test('compareCounts allows increases', () => {
  const base = { 't1.test.mjs': 5 };
  const head = { 't1.test.mjs': 6, 't2.test.mjs': 1 };
  const { errors } = compareCounts(base, head);
  assert.equal(errors.length, 0);
});

test('compareCounts PR_BODY escape works', () => {
  const base = { 't1.test.mjs': 5 };
  const head = { 't1.test.mjs': 4 };
  const prBody = 'tests-removed: refactored some redundant tests';
  const { errors } = compareCounts(base, head, prBody);
  assert.equal(errors.length, 0);
});

test('compareCounts PR_BODY escape requires reason', () => {
  const base = { 't1.test.mjs': 5 };
  const head = { 't1.test.mjs': 4 };
  const prBody = 'tests-removed: '; // Empty reason
  const { errors } = compareCounts(base, head, prBody);
  assert.equal(errors.length, 1);
});
