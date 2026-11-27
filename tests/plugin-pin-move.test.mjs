// A moved Claude plugin pin must move lean-agents' own extraKnownMarketplaces ref in ~/.claude/settings.json, back the
// file up, and leave a user entry with another repo alone (#546). External commands never run: --no-exec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { PINS } from '../scripts/lib/pins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = 'context-mode-plugin';
const NAME = 'context-mode';
const REPO = PINS[PLUGIN].source;
const NEW_REF = PINS[PLUGIN].version;
const OLD_REF = NEW_REF === 'v2.1.4' ? 'v2.1.3' : 'v2.1.4';

function seed(entryRepo = REPO) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-plugin-move-'));
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, `${JSON.stringify({
    extraKnownMarketplaces: { [NAME]: { source: { source: 'github', repo: entryRepo, ref: OLD_REF } } },
  }, null, 2)}\n`);
  // The state an install with the previous pin leaves behind.
  const dir = path.join(home, '.config', 'lean-agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify({
    version: '1.2.5',
    installedAt: new Date().toISOString(),
    pins: { [PLUGIN]: OLD_REF },
    options: { agents: ['claude'], tools: [NAME], privacy: 'standard', network: {}, keepUpdater: false, gh: false, terminals: [], installTerminals: [], unverified: {}, lang: 'en', profile: null, adhdAlways: false, ponytailMode: 'lite', bun: false, shell: 'default' },
    files: [],
    commands: [{ tool: NAME, desc: 'Context Mode plugin', ok: true, run: [['claude', 'plugin', 'marketplace', 'add', `${REPO}#${OLD_REF}`], ['claude', 'plugin', 'install', `${NAME}@${NAME}`]], undo: [['claude', 'plugin', 'uninstall', `${NAME}@${NAME}`]] }],
  }, null, 2)}\n`);
  return { home, settings };
}

function lean(home, ...args) {
  const env = { PATH: process.env.PATH, NVM_DIR: path.join(home, '.nvm'), HOME: home, LEAN_AGENTS_NODE: '24.22.2' };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}

const entry = (settings) => parse(fs.readFileSync(settings, 'utf8')).extraKnownMarketplaces[NAME].source;

test('--update moves our marketplace ref before the add, backs settings.json up, and --uninstall restores it', () => {
  const { home, settings } = seed();
  const dry = lean(home, '--update', '--yes', '--no-exec', '--dry-run');
  assert.match(dry, new RegExp(`${NAME} marketplace ref ${OLD_REF} -> ${NEW_REF} \\(settings\\.json entry moved, plugin data kept\\)`));
  assert.match(dry, new RegExp(`claude plugin marketplace add ${REPO}#${NEW_REF}`));
  assert.match(dry, new RegExp(`claude plugin marketplace update ${NAME}`));
  assert.match(dry, new RegExp(`claude plugin update ${NAME}@${NAME}`));
  assert.doesNotMatch(dry, /marketplace remove/);
  assert.equal(entry(settings).ref, OLD_REF, 'a dry run changes nothing');

  const out = lean(home, '--update', '--yes', '--no-exec');
  assert.match(out, new RegExp(`${NAME} marketplace ref ${OLD_REF} -> ${NEW_REF}`));
  assert.equal(entry(settings).ref, NEW_REF);

  const backups = path.join(home, '.config', 'lean-agents', 'backups');
  const saved = fs.readdirSync(backups).map((n) => path.join(backups, n, '.claude', 'settings.json')).filter((f) => fs.existsSync(f));
  assert.equal(saved.length, 1);
  assert.equal(parse(fs.readFileSync(saved[0], 'utf8')).extraKnownMarketplaces[NAME].source.ref, OLD_REF);

  const row = lean(home, '--doctor', '--no-exec').split('\n').find((l) => /^(ok|changed|error)\s+\S*\.claude[\\/]settings\.json/.test(l));
  assert.doesNotMatch(row, /edited since install/, 'the moved ref with the current pin stays ours (#492)');

  // --no-exec ran no `claude` command, so there is no command to undo.
  const stateFile = path.join(home, '.config', 'lean-agents', 'state.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.commands = [];
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  lean(home, '--uninstall', '--yes', '--no-exec');
  assert.equal(entry(settings).ref, OLD_REF);
});

test('a marketplace entry with another repo is the user\'s: left alone with a warning naming it', () => {
  const { home, settings } = seed('someone/else');
  const out = lean(home, '--update', '--yes', '--no-exec');
  assert.match(out, /! context-mode marketplace entry in .*settings\.json points at someone\/else, not mksglu\/context-mode: left as it is/);
  assert.doesNotMatch(out, /marketplace ref .* -> /);
  assert.equal(entry(settings).repo, 'someone/else');
  assert.equal(entry(settings).ref, OLD_REF);
});

test('--update --undo restores settings.json from the newest run backup and says so', () => {
  const { home, settings } = seed();
  lean(home, '--update', '--yes', '--no-exec');
  assert.equal(entry(settings).ref, NEW_REF);

  const dry = lean(home, '--update', '--undo', '--dry-run');
  assert.match(dry, /settings\.json: marketplace ref v[\d.]+ -> v[\d.]+ \(from .*backups/);
  assert.equal(entry(settings).ref, NEW_REF, 'a dry run changes nothing');

  lean(home, '--update', '--undo', '--yes');
  assert.equal(entry(settings).ref, OLD_REF);
});