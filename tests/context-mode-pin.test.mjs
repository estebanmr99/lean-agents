// Claude Code's context-mode plugin must ship the same version as the npm context-mode CLI (#490). When upstream keeps
// them apart on purpose, the plugin pin records why in a `note`; this test then leaves it alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PINS } from '../scripts/lib/pins.mjs';

const strip = (v) => v.replace(/^v/, '');

test('context-mode-plugin matches context-mode unless the plugin pin has a note', () => {
  const cli = PINS['context-mode'];
  const plugin = PINS['context-mode-plugin'];
  assert.ok(cli && plugin, 'both pins exist');
  if (plugin.note) return;
  assert.equal(strip(plugin.version), strip(cli.version),
    `context-mode-plugin ${plugin.version} differs from context-mode ${cli.version}; bump the plugin pin or add a note`);
});