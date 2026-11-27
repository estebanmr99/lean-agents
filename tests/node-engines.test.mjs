// #465: meetsEngines reads npm `engines.node` ranges; anything it cannot parse fully is null (never flagged).
import test from 'node:test';
import assert from 'node:assert/strict';
import { meetsEngines } from '../scripts/lib/node-runtime.mjs';

test('meetsEngines reads the common engines ranges', () => {
  const cases = [
    ['>=22.20.0', [['22.19.9', false], ['22.20.0', true], ['23.0.0', true], ['24.15.0', true]]],
    ['^20.0.0', [['19.9.9', false], ['20.0.0', true], ['20.99.0', true], ['21.0.0', false]]],
    ['~20.1.0', [['20.0.9', false], ['20.1.0', true], ['20.1.9', true], ['20.2.0', false]]],
    ['<=20', [['19.0.0', true], ['20.0.0', true], ['20.99.99', true], ['21.0.0', false]]],
    ['<=20.x', [['19.0.0', true], ['20.0.0', true], ['20.99.99', true], ['21.0.0', false]]],
    ['<=20.1', [['20.0.0', true], ['20.1.0', true], ['20.1.99', true], ['20.2.0', false]]],
    ['>=18 || >=20', [['17.9.9', false], ['18.0.0', true], ['20.0.0', true], ['24.0.0', true]]],
  ];
  for (const [range, versions] of cases) {
    for (const [version, expected] of versions) assert.equal(meetsEngines(version, range), expected, `${version} vs ${range}`);
  }
});

test('meetsEngines returns null for a clause it cannot parse fully', () => {
  for (const version of ['14.0.0', '18.0.0', '20.1.0', '24.0.0']) {
    assert.equal(meetsEngines(version, '14.0.0 - 20.x'), null, `hyphen range vs ${version}`);
  }
  assert.equal(meetsEngines('20.0.0', 'garbage'), null);
  assert.equal(meetsEngines('20.0.0', '>22 garbage'), null); // unknown part after a failing one is still unknown
  assert.equal(meetsEngines('20.0.0', 'garbage >22'), null);
  assert.equal(meetsEngines('20.0.0', 'node'), null);
  assert.equal(meetsEngines('20.0.0', 'lts/*'), null);
  assert.equal(meetsEngines('20.0.0', ''), null);
  assert.equal(meetsEngines('20.0.0', null), null);
});