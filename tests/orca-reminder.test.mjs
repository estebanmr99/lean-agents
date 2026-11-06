// Orca telemetry reminder: shown on real-home Windows unless an opt-out env var is set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orcaEnvSet, terminalPrivacyNotes } from '../scripts/lib/terminals.mjs';

test('Windows real home with no opt-out var set: the reminder shows', () => {
  assert.equal(orcaEnvSet({ platform: 'win32', system: true, env: {} }), false);
  const notes = terminalPrivacyNotes(['orca'], { orcaEnvSet: orcaEnvSet({ platform: 'win32', system: true, env: {} }) });
  assert.ok(notes.some((n) => /Orca telemetry/.test(n)));
});

test('Windows real home with DO_NOT_TRACK set: hidden', () => {
  const env = { DO_NOT_TRACK: '1' };
  assert.equal(orcaEnvSet({ platform: 'win32', system: true, env }), true);
  assert.deepEqual(terminalPrivacyNotes(['orca'], { orcaEnvSet: true }), []);
});

test('Windows real home with ORCA_TELEMETRY_DISABLED set: hidden', () => {
  assert.equal(orcaEnvSet({ platform: 'win32', system: true, env: { ORCA_TELEMETRY_DISABLED: '1' } }), true);
});

test('Windows --home run (not the real home): the env is ignored, reminder shows', () => {
  assert.equal(orcaEnvSet({ platform: 'win32', system: false, env: { DO_NOT_TRACK: '1' } }), false);
});

test('macOS and Linux: unchanged, the env is ignored', () => {
  const env = { DO_NOT_TRACK: '1' };
  assert.equal(orcaEnvSet({ platform: 'darwin', system: true, env }), false);
  assert.equal(orcaEnvSet({ platform: 'linux', system: true, env }), false);
});
