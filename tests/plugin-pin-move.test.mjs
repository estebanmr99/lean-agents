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

function seed(entryRepo = REPO, { ref = OLD_REF, run, ok = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-plugin-move-'));
  const settings = path.join(home, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, `${JSON.stringify({
    extraKnownMarketplaces: { [NAME]: { source: { source: 'github', repo: entryRepo, ref } } },
  }, null, 2)}\n`);
  // The state an install with the previous pin leaves behind.
  const dir = path.join(home, '.config', 'lean-agents');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify({
    version: '1.2.5',
    installedAt: new Date().toISOString(),
    pins: { [PLUGIN]: ref },
    options: { agents: ['claude'], tools: [NAME], privacy: 'standard', network: {}, keepUpdater: false, gh: false, terminals: [], installTerminals: [], unverified: {}, lang: 'en', profile: null, adhdAlways: false, ponytailMode: 'lite', bun: false, shell: 'default' },
    files: [],
    commands: [{ tool: NAME, desc: 'Context Mode plugin', ok, run: run ?? [['claude', 'plugin', 'marketplace', 'add', `${REPO}#${ref}`], ['claude', 'plugin', 'install', `${NAME}@${NAME}`]], undo: [['claude', 'plugin', 'uninstall', `${NAME}@${NAME}`]] }],
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

test('--update --undo: no --yes and no terminal leaves the moved ref alone', () => {
  const { home, settings } = seed();
  lean(home, '--update', '--yes', '--no-exec');
  const env = { PATH: process.env.PATH, NVM_DIR: path.join(home, '.nvm'), HOME: home, LEAN_AGENTS_NODE: '24.22.2' };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, '--update', '--undo'], { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /Not done/);
  assert.equal(entry(settings).ref, NEW_REF);
});

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

test('--update --undo reverts only the ref and keeps a key the user added after --update', () => {
  const { home, settings } = seed();
  lean(home, '--update', '--yes', '--no-exec');
  assert.equal(entry(settings).ref, NEW_REF);
  const data = parse(fs.readFileSync(settings, 'utf8'));
  data.userSetting = 'keep me';
  fs.writeFileSync(settings, `${JSON.stringify(data, null, 2)}\n`);

  const dry = lean(home, '--update', '--undo', '--dry-run');
  assert.match(dry, new RegExp(`settings\\.json: marketplace ref ${NEW_REF} -> ${OLD_REF}`));
  assert.equal(entry(settings).ref, NEW_REF, 'a dry run changes nothing');

  lean(home, '--update', '--undo', '--yes');
  assert.equal(entry(settings).ref, OLD_REF);
  assert.equal(parse(fs.readFileSync(settings, 'utf8')).userSetting, 'keep me');
});

test('two --update runs, then --update --undo restores the original old ref', () => {
  const { home, settings } = seed();
  lean(home, '--update', '--yes', '--no-exec');
  lean(home, '--update', '--yes', '--no-exec');
  assert.equal(entry(settings).ref, NEW_REF);
  lean(home, '--update', '--undo', '--yes');
  assert.equal(entry(settings).ref, OLD_REF);
});

test('a fresh install records the marketplace entry and --uninstall removes it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-plugin-fresh-'));
  const settings = path.join(home, '.claude', 'settings.json');
  lean(home, '--yes', '--no-exec', '--agents', 'claude', '--tools', 'context-mode', '--privacy', 'standard', '--lang', 'en', '--profile', 'none', '--ponytail-mode', 'off', '--no-bun', '--no-gh', '--terminal', 'none');
  const created = parse(fs.readFileSync(settings, 'utf8')).extraKnownMarketplaces[NAME].source;
  assert.equal(created.repo, REPO);
  assert.equal(created.ref, NEW_REF);
  lean(home, '--uninstall', '--yes', '--no-exec');
  const left = fs.existsSync(settings) ? parse(fs.readFileSync(settings, 'utf8')).extraKnownMarketplaces : undefined;
  assert.equal(left, undefined);
});

test('a prior record with the update sequence is installed again through marketplace update + plugin update', () => {
  const run = [['claude', 'plugin', 'marketplace', 'add', `${REPO}#${OLD_REF}`], ['claude', 'plugin', 'marketplace', 'update', NAME], ['claude', 'plugin', 'update', `${NAME}@${NAME}`]];
  const { home } = seed(REPO, { run });
  const out = lean(home, '--update', '--yes', '--no-exec', '--dry-run');
  assert.match(out, new RegExp(`claude plugin marketplace update ${NAME}`));
  assert.match(out, new RegExp(`claude plugin update ${NAME}@${NAME}`));
  assert.doesNotMatch(out, new RegExp(`claude plugin install ${NAME}@${NAME}`));
});

test('a real state record (desc and undo, no run) still counts as installed', () => {
  const { home } = seed(REPO, { run: [] });
  const out = lean(home, '--update', '--yes', '--no-exec', '--dry-run');
  assert.match(out, new RegExp(`claude plugin marketplace update ${NAME}`));
  assert.match(out, new RegExp(`claude plugin update ${NAME}@${NAME}`));
  assert.doesNotMatch(out, new RegExp(`claude plugin install ${NAME}@${NAME}`));
});

test('a prior record with ok:false is not installed: a fresh plugin install runs', () => {
  const { home } = seed(REPO, { ok: false });
  const out = lean(home, '--update', '--yes', '--no-exec', '--dry-run');
  assert.match(out, new RegExp(`claude plugin install ${NAME}@${NAME}`));
  assert.doesNotMatch(out, /claude plugin marketplace update/);
  assert.doesNotMatch(out, new RegExp(`claude plugin update ${NAME}@${NAME}`));
});

test('no ref move keeps origin/main commands: marketplace add + plugin install, no update step', () => {
  const run = [['claude', 'plugin', 'marketplace', 'add', `${REPO}#${NEW_REF}`], ['claude', 'plugin', 'marketplace', 'update', NAME], ['claude', 'plugin', 'update', `${NAME}@${NAME}`]];
  const { home } = seed(REPO, { ref: NEW_REF, run });
  const out = lean(home, '--update', '--yes', '--no-exec', '--dry-run');
  assert.match(out, new RegExp(`claude plugin install ${NAME}@${NAME}`));
  assert.doesNotMatch(out, /claude plugin marketplace update/);
  assert.doesNotMatch(out, new RegExp(`claude plugin update ${NAME}@${NAME}`));
});
