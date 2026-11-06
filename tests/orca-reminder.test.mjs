// Orca telemetry reminder: shown on real-home Windows unless an opt-out env var is persisted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orcaEnvSet, terminalPrivacyNotes } from '../scripts/lib/terminals.mjs';

const none = () => null;
const scoped = (values) => (scope, name) => values[`${scope}:${name}`] ?? null;

test('Windows real home with no opt-out var set: the reminder shows', () => {
  assert.equal(orcaEnvSet({ platform: 'win32', system: true, readEnv: none }), false);
  const notes = terminalPrivacyNotes(['orca'], { orcaEnvSet: orcaEnvSet({ platform: 'win32', system: true, readEnv: none }) });
  assert.ok(notes.some((n) => /Orca telemetry/.test(n)));
});

test('Windows real home with DO_NOT_TRACK in the User env: hidden', () => {
  const readEnv = scoped({ 'User:DO_NOT_TRACK': '1' });
  assert.equal(orcaEnvSet({ platform: 'win32', system: true, readEnv }), true);
  assert.deepEqual(terminalPrivacyNotes(['orca'], { orcaEnvSet: true }), []);
});

test('Windows real home with ORCA_TELEMETRY_DISABLED in the Machine env: hidden', () => {
  const readEnv = scoped({ 'Machine:ORCA_TELEMETRY_DISABLED': '1' });
  assert.equal(orcaEnvSet({ platform: 'win32', system: true, readEnv }), true);
});

test('Windows --home run (not the real home): never reads the env, reminder shows', () => {
  const readEnv = scoped({ 'User:DO_NOT_TRACK': '1' });
  assert.equal(orcaEnvSet({ platform: 'win32', system: false, readEnv }), false);
});

test('macOS and Linux: unchanged, the env is never consulted', () => {
  const readEnv = scoped({ 'User:DO_NOT_TRACK': '1' });
  assert.equal(orcaEnvSet({ platform: 'darwin', system: true, readEnv }), false);
  assert.equal(orcaEnvSet({ platform: 'linux', system: true, readEnv }), false);
});
