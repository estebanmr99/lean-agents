// #181 PR3: the summary page is self-contained, fits the 1-minute budget (EN and ES), redacts, and is an owned file. Temp HOME, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderSummary, canOffer, openArgv } from '../scripts/lib/summary-html.mjs';
import { buildSummary } from '../scripts/lib/summary-data.mjs';
import { preset } from '../scripts/lib/network.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lean-sum-'));
// Only PATH, NVM_DIR and HOME reach the engine, never the runner's env.
const engine = (home, args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lean.mjs'), '--home', home, ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH, NVM_DIR: process.env.NVM_DIR ?? '', HOME: home },
});
// Built from parts so the privacy check does not flag the fake path.
const unixUser = ['', 'Users', 'jdoe', 'work'].join('/');

const logins = [
  { tool: 'gh', login: 'gh auth login', state: 'needed' },
  { tool: 'claude', login: 'claude auth login', state: 'unknown' },
  { tool: 'opencode', login: 'opencode, then /connect', state: 'unknown' },
];
const rows = [
  { item: 'skills', status: 'changed', detail: 'edited by you' },
  { item: 'rtk', status: 'skipped', detail: '' },
  { item: 'context-mode', status: 'error', detail: 'not found' },
];
const model = (lang, extra = {}) => buildSummary({
  state: { version: '1.0.0' }, lang, logins, rows, updated: ['claude-code'],
  applied: { ok: true, files: ['a', 'b'], commands: [{ desc: 'rtk', ok: true }], errors: [] }, ...extra,
});
const page = (lang, extra = {}) => renderSummary({ model: model(lang), network: preset('on'), env: {}, ...extra });
// What a reader sees: no script, style, tags or the prompt (a copy payload, not text to read).
const words = (html) => html.replace(/<(script|style|pre)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

test('no network and no external reference', () => {
  for (const lang of ['en', 'es']) {
    const html = page(lang);
    assert.doesNotMatch(html, /https?:|\/\/[\w-]+\./i);
    assert.doesNotMatch(html, /\bsrc\s*=|<link|@import|url\(|fetch\(|XMLHttpRequest|WebSocket|<iframe|<img/i);
  }
});

test('word budget: 1 minute of reading in EN and ES', () => {
  for (const lang of ['en', 'es']) assert.ok(words(page(lang)) <= 200, `${lang}: ${words(page(lang))} words`);
});

test('sections in order, red action first, copy button, light/dark', () => {
  const html = page('en');
  const at = ['h-action', 'h-summary', 'h-next', 'h-how', 'h-updates'].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])));
  assert.match(html, /<section class="action"/);
  assert.match(html, /id="copy"/);
  assert.match(html, /prefers-color-scheme:dark/);
  assert.match(html, /<html lang="en">/);
  assert.match(page('es'), /<html lang="es">/);
});

test('every text is redacted', () => {
  const secret = ['ghp_', 'abcdefgh12345678'].join(''); // gitleaks:allow
  const m = model('en');
  m.summary.doctor.problems = [{ item: `${unixUser}/x`, status: 'error', detail: `token ${secret} for jdoe@example.com` }];
  m.summary.skipped = [`${unixUser}/y`];
  const html = renderSummary({ model: m, network: preset('on'), env: {} });
  for (const bad of [unixUser, secret, 'jdoe@example.com', '/Users/jdoe']) assert.ok(!html.includes(bad), bad);
});

test('strict privacy: the page and prompt offer no filing', () => {
  const html = page('en', { network: preset('off') });
  assert.doesNotMatch(html, /gh issue create/);
  assert.match(html, /Nothing is filed/);
  assert.match(page('en'), /gh issue create/);
});

test('filed issues link only to GitHub issue URLs', () => {
  const html = page('en', { filed: [{ item: 'rtk', url: 'https://github.com/o/r/issues/7' }, { item: 'bad', url: 'javascript:alert(1)' }] });
  assert.match(html, /<a href="https:\/\/github\.com\/o\/r\/issues\/7">rtk<\/a>/);
  assert.doesNotMatch(html, /javascript:/);
});

test('opening needs a terminal and no CI, --no-open, --yes or --json', () => {
  const base = { tty: true, env: {} };
  assert.equal(canOffer(base), true);
  for (const off of [{ noOpen: true }, { yes: true }, { json: true }, { env: { CI: 'true' } }, { tty: false }]) assert.equal(canOffer({ ...base, ...off }), false);
  assert.deepEqual(openArgv('darwin', 'f.html'), ['open', 'f.html']);
  assert.deepEqual(openArgv('win32', 'f.html'), ['cmd', '/c', 'start', '', 'f.html']);
  assert.deepEqual(openArgv('linux', 'f.html'), ['xdg-open', 'f.html']);
});

test('install writes the owned page, --summary rebuilds it, --uninstall removes it', () => {
  const home = tmp();
  const file = path.join(home, '.config', 'lean-agents', 'summary.html');
  const r = engine(home, ['--no-exec', '--yes', '--no-open', '--agents', 'claude,opencode-v2', '--lang', 'es']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`Summary page: ${file}`));
  assert.doesNotMatch(r.stdout, /Open it in your browser/);
  const html = fs.readFileSync(file, 'utf8');
  assert.ok(html.split('\n', 10).join('\n').includes('managed by lean-agents'));
  assert.match(html, /<html lang="es">/);
  assert.ok(!html.includes(home));
  const again = engine(home, ['--no-exec', '--summary', '--no-open', '--lang', 'en', '--filed-issue', 'rtk=https://github.com/o/r/issues/7']);
  assert.equal(again.status, 0, again.stderr);
  assert.match(fs.readFileSync(file, 'utf8'), /<html lang="en">[\s\S]*issues\/7/);
  const files = JSON.parse(fs.readFileSync(path.join(home, '.config', 'lean-agents', 'state.json'), 'utf8')).files;
  assert.equal(files.filter((f) => f.path === file).length, 1);
  assert.equal(engine(home, ['--no-exec', '--yes', '--uninstall']).status, 0);
  assert.ok(!fs.existsSync(file));
});

test('--summary without an install says so; a bad --filed-issue is refused', () => {
  const home = tmp();
  const none = engine(home, ['--summary', '--no-open']);
  assert.equal(none.status, 1);
  assert.match(none.stdout, /not installed/);
  engine(home, ['--no-exec', '--yes', '--no-open', '--agents', 'claude']);
  assert.notEqual(engine(home, ['--summary', '--no-open', '--filed-issue', 'x=http://evil.test/1']).status, 0);
});
