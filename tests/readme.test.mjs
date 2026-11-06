// README checks: links, anchors, EN/ES parity and every installer command as a dry run in a temp HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, READMES, HERO_BUDGET, brokenLinks, heroProblems, imageProblems, shape, installerArgs, dryRun, slug } from '../scripts/check-readme.mjs';

test('slug follows GitHub rules', () => {
  assert.equal(slug('Team mode (`--project`)'), 'team-mode---project');
  assert.equal(slug('Demo: OpenCode with GitHub Copilot models'), 'demo-opencode-with-github-copilot-models');
});

for (const f of READMES) {
  const md = fs.readFileSync(path.join(ROOT, f), 'utf8');
  test(`${f}: links and anchors resolve`, () => assert.deepEqual(brokenLinks(f), []));
  test(`${f}: fits the 1-minute budget before Details`, () => assert.deepEqual(heroProblems(md, f), []));
  test(`${f}: images have alt text and stay under 5 MB`, () => assert.deepEqual(imageProblems(md, f), []));
  test(`${f}: shows installer commands and each exits 0 as a dry run`, () => {
    const all = installerArgs(f);
    assert.ok(all.length >= 5, 'expected installer commands in the README');
    for (const args of all) assert.equal(dryRun(args).status, 0, args.join(' '));
  });
}

test('EN and ES share headings, tables, code blocks and details', () => assert.deepEqual(shape('README.md'), shape('README.es.md')));

const fixture = (hero) => `${hero}\n<!-- details -->\n## Details\n`;

test('a README with 100 more lines above Details fails the budget', () => {
  assert.deepEqual(heroProblems(fixture('# T\n'), 'fixture'), []);
  const long = fixture(`# T\n${'line\n'.repeat(100)}`);
  assert.match(heroProblems(long, 'fixture')[0], new RegExp(`budget is ${HERO_BUDGET}`));
});

test('a README without the Details divider fails', () => assert.match(heroProblems('# T\n', 'fixture')[0], /no <!-- details -->/));

test('an image without alt text fails', () => {
  assert.match(imageProblems('<img src="a.png">', 'fixture')[0], /without alt text/);
  assert.match(imageProblems('![](a.png)', 'fixture')[0], /without alt text/);
  assert.match(imageProblems('<img src="a.png" alt="">', 'fixture')[0], /without alt text/);
  assert.deepEqual(imageProblems('<img src="a.png" alt="ok"> ![ok](https://x.test/b.svg)', 'fixture'), []);
});

test('an image over 5 MB fails', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-readme-img-'));
  try {
    fs.writeFileSync(path.join(dir, 'big.gif'), '');
    fs.truncateSync(path.join(dir, 'big.gif'), 6 * 1024 * 1024);
    assert.match(imageProblems('<img src="big.gif" alt="big">', 'fixture', dir)[0], /over 5 MB/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
