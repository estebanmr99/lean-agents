import test from 'node:test';
import assert from 'node:assert/strict';
import { npxFailDetail } from '../scripts/lib/doctor.mjs';

test('npxFailDetail: ECOMPROMISED or EINTEGRITY appends fix', () => {
  const out = 'npm error code ECOMPROMISED\nnpm error Content-addressable store is compromised';
  const res = npxFailDetail(out, { home: '/tmp' });
  assert.match(res, /Fix: run npm cache verify, then --doctor again/);
  
  const out2 = 'npm error code EINTEGRITY\nnpm error sha1-deadbeef integrity checksum failed';
  const res2 = npxFailDetail(out2, { home: '/tmp' });
  assert.match(res2, /Fix: run npm cache verify, then --doctor again/);
});

test('npxFailDetail: other errors stay as is', () => {
  const out = 'npm error code ENOENT\nnpm error no such file or directory';
  const res = npxFailDetail(out, { home: '/tmp' });
  assert.doesNotMatch(res, /Fix: run npm cache verify/);
});
