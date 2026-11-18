// #181 PR2: the verify prompt and the feedback records. Pure functions, no engine run, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPrompt } from '../scripts/lib/verify-prompt.mjs';
import { draftFromRow, addFiledIssue } from '../scripts/lib/feedback.mjs';
import { preset } from '../scripts/lib/network.mjs';

const on = preset('on');
const off = preset('off');
const FILING = /gh issue|issue create|--body-file|duplicad?o|duplicate|--filed-issue/i;

test('strict, off or unknown preset: no filing text, copy-only', () => {
  for (const network of [off, { ...on, outbound: 'off' }, {}, undefined]) {
    for (const lang of ['en', 'es']) {
      const p = verifyPrompt({ lang, network });
      assert.ok(!FILING.test(p), `${lang}: ${p}`);
      assert.match(p, /--doctor --json/);
      assert.match(p, lang === 'en' ? /copy myself/ : /yo mismo pueda copiar/);
    }
  }
});

test('outbound on: per-issue consent wording, search, draft, file, write-back', () => {
  const en = verifyPrompt({ network: on });
  assert.match(en, /File this issue\? yes\/no" for each draft separately\. File nothing without my yes\. One yes covers one issue only/);
  assert.match(en, /gh issue list --repo .* --state open --search/);
  assert.match(en, /--feedback-draft --feedback-kind verify/);
  assert.match(en, /Only after my yes, run `gh issue create/);
  assert.match(en, /--filed-issue/);
  assert.match(en, /--summary/);
  assert.ok(en.indexOf('gh issue list') < en.indexOf('File this issue?') && en.indexOf('File this issue?') < en.indexOf('gh issue create'));
  const es = verifyPrompt({ lang: 'es', network: on });
  assert.match(es, /No crees nada sin mi sí\. Un sí cubre un solo issue/);
  assert.match(es, /Solo después de mi sí, ejecuta `gh issue create/);
});

test('EN and ES have the same steps and the same commands', () => {
  for (const network of [on, off]) {
    const en = verifyPrompt({ network }).split('\n');
    const es = verifyPrompt({ lang: 'es', network }).split('\n');
    assert.equal(en.length, es.length);
    const cmds = (lines) => lines.flatMap((l) => l.match(/`[^`]+`/g) ?? []).map((c) => c.replace(/<[^>]*>/g, '<>').replace(/ --title "<>"/, '')).sort();
    assert.deepEqual(cmds(en), cmds(es));
  }
  assert.equal(verifyPrompt({ lang: 'fr', network: on }), verifyPrompt({ network: on }));
});

test('draftFromRow: redacted, copyable under strict, canFile follows the preset', () => {
  const home = '/opt/h';
  const row = { item: 'mcp serena', status: 'error', detail: `spawn failed in ${home}/bin as jdoe via http://10.1.2.3:8080 ghp_abcdefghijkl1234` };
  const base = { row, home, env: { USER: 'jdoe', HTTP_PROXY: 'http://10.1.2.3:8080' }, versions: { node: '24.0.0' } };
  for (const [network, canFile] of [[on, true], [off, false]]) {
    const d = draftFromRow({ ...base, network });
    assert.equal(d.canFile, canFile);
    assert.match(d.title, /^Verify finding: mcp serena/);
    assert.match(d.body, /What the check found/);
    for (const leak of ['jdoe', '/opt/h', '10.1.2.3', 'ghp_']) assert.ok(!d.body.includes(leak), leak);
  }
});

test('addFiledIssue: redacted record, deduped by url, only GitHub issue URLs', () => {
  const rec = { item: 'mcp serena', title: 'Verify finding: x in /opt/h/a', url: 'https://github.com/estebanmr99/lean-agents/issues/300', filedAt: '2026-11-18T00:00:00.000Z' };
  const list = addFiledIssue([], rec, { home: '/opt/h' });
  assert.deepEqual(Object.keys(list[0]), ['item', 'title', 'url', 'filedAt']);
  assert.ok(!list[0].title.includes('/opt/h'));
  assert.equal(addFiledIssue(list, rec, { home: '/opt/h' }).length, 1);
  for (const url of ['http://github.com/a/b/issues/1', 'https://evil.example/a/b/issues/1', 'https://github.com/a/b/pull/1']) {
    assert.throws(() => addFiledIssue([], { ...rec, url }), /not a GitHub issue URL/);
  }
});
