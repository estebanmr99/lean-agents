// --update plan model: rows, held/major/own guards and the CHANGELOG slice, on synthetic pins and state (no binaries, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planUpdate, changelogNotes, formatUpdatePlan } from '../scripts/lib/update-plan.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pins = {
  caveman: { kind: 'skill', version: 'v2.0.0' },
  'claude-code': { kind: 'npm', version: '2.1.316', ciOnly: true },
  'opencode-v1': { kind: 'npm', version: '1.19.0', hold: true, ciOnly: true },
  'opencode-v2': { kind: 'npm', version: '2.2.5', ciOnly: true },
  'copilot-cli': { kind: 'npm', version: '1.0.105', ciOnly: true },
  bun: { kind: 'download', version: '1.4.4' },
};
const saved = { version: '0.7.0', pins: { caveman: 'v1.0.0', bun: '1.0.0', codeburn: '0.0.1' }, options: { tools: ['caveman'] } };
const rowOf = (rows, tool) => rows.find((r) => r.tool === tool);

test('tools in use that are behind the pin get an update row; download pins and unused tools do not', () => {
  const rows = planUpdate({ saved, pins });
  assert.deepEqual(rows, [{ tool: 'caveman', installed: 'v1.0.0', pinned: 'v2.0.0', action: 'update', reason: null }]);
});

test('OpenCode 1.x is held, whoever installed it', () => {
  for (const owned of [[], ['opencode-v2']]) {
    const r = rowOf(planUpdate({ saved, pins, owned, installed: { opencode: '1.19.0' } }), 'opencode-v1');
    assert.equal(r.action, 'held');
    assert.equal(rowOf(planUpdate({ saved, pins, owned, installed: { opencode: '1.19.0' } }), 'opencode-v2'), undefined);
  }
});

test('agent CLI: updated within its major, held across it, left alone when the user installed it', () => {
  const owned = ['claude', 'copilot-cli'];
  const rows = planUpdate({ saved, pins, owned, installed: { claude: '2.1.0', copilot: '0.9.9', opencode: '2.0.0' } });
  assert.equal(rowOf(rows, 'claude-code').action, 'update');
  assert.equal(rowOf(rows, 'copilot-cli').action, 'major');
  assert.equal(rowOf(rows, 'opencode-v2').action, 'own');
});

test('agent CLI at or above the pin, missing, or unreadable gets no row', () => {
  const rows = planUpdate({ saved, pins, owned: ['claude'], installed: { claude: '2.1.316', opencode: '9.0.0', copilot: 'unknown' } });
  assert.equal(rows.filter((r) => r.tool !== 'caveman').length, 0);
});

const log = '# Changelog\n\n## [Unreleased]\n\n- next\n\n## [0.9.0] - 2026-12-01\n\n### Added\n- nine\n\n## [0.8.0] - 2026-11-12\n- eight\n\n## [0.7.0] - 2026-11-01\n- seven\n';

test('notes: sections after the installed version up to the current one, never Unreleased', () => {
  assert.deepEqual(changelogNotes(log, '0.7.0', '0.9.0').map((n) => n.version), ['0.9.0', '0.8.0']);
  assert.deepEqual(changelogNotes(log, '0.7.0', '0.8.0').map((n) => n.version), ['0.8.0']);
  assert.equal(changelogNotes(log, '0.9.0', '0.9.0').length, 0);
  assert.equal(changelogNotes(undefined, '0.1.0', '0.9.0').length, 0);
  assert.equal(changelogNotes(log, '0.8.0', '0.9.0')[0].body, '### Added\n- nine');
});

test('format: moves, then what is not updated, then notes', () => {
  const text = formatUpdatePlan(planUpdate({ saved, pins, installed: { opencode: '1.19.0' } }), changelogNotes(log, '0.8.0', '0.9.0'));
  assert.match(text, /^Pins that will change \(old -> new\):\ncaveman: v1\.0\.0 -> v2\.0\.0\nNot updated:\nopencode-v1: 1\.19\.0 \(OpenCode 1\.x/);
  assert.match(text, /Release notes since your version \(0\.9\.0\):\n## 0\.9\.0\n### Added/);
  assert.equal(formatUpdatePlan([], []), '');
});

test('--update --dry-run --json carries update.rows and update.notes (temp HOME, PATH only)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  // PATH holds only node: no real claude/opencode/copilot may be probed.
  const env = { PATH: path.dirname(process.execPath), HOME: home, ...(process.env.NVM_DIR && { NVM_DIR: process.env.NVM_DIR }) };
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', '--yes', ...args], { encoding: 'utf8', env });
  assert.equal(run(['--agents', 'claude', '--tools', 'caveman', '--lang', 'en', '--profile', 'none']).status, 0);
  const file = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  state.version = '0.0.1';
  state.pins.caveman = 'v0.0.1';
  fs.writeFileSync(file, JSON.stringify(state));
  const r = run(['--update', '--dry-run', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const { update } = JSON.parse(r.stdout);
  assert.equal(rowOf(update.rows, 'caveman').action, 'update');
  assert.ok(update.notes.length > 0 && update.notes.every((n) => /^\d+\.\d+\.\d+$/.test(n.version)));
});

test('--update --dry-run on a hand-built machine without state.json says run --adopt --yes first', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{"enabledPlugins": {"context-mode@latest": true}}');
  // NVM_DIR inside the temp HOME: a real one would make --adopt find the runner's Node
  const env = { PATH: path.dirname(process.execPath), HOME: home, NVM_DIR: path.join(home, '.nvm') };
  const run = (args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--no-exec', '--yes', ...args], { encoding: 'utf8', env });

  const r = run(['--update', '--dry-run']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /lean-agents is not installed; run --adopt --yes first/);

  // also check that with nothing to adopt, it just says not installed
  fs.rmSync(path.join(home, '.claude'), { recursive: true, force: true });
  const r2 = run(['--update', '--dry-run']);
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /nothing to update: lean-agents is not installed$/m);

  fs.rmSync(home, { recursive: true, force: true });
});
