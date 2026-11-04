// README checks: links, anchors, EN/ES parity and every installer command as a dry run in a temp HOME.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { READMES, brokenLinks, shape, installerArgs, dryRun, slug } from '../scripts/check-readme.mjs';

test('slug follows GitHub rules', () => {
  assert.equal(slug('Team mode (`--project`)'), 'team-mode---project');
  assert.equal(slug('Demo: OpenCode with GitHub Copilot models'), 'demo-opencode-with-github-copilot-models');
});

for (const f of READMES) {
  test(`${f}: links, anchors and image alt text resolve`, () => assert.deepEqual(brokenLinks(f), []));
  test(`${f}: shows installer commands and each exits 0 as a dry run`, () => {
    const all = installerArgs(f);
    assert.ok(all.length >= 5, 'expected installer commands in the README');
    for (const args of all) assert.equal(dryRun(args).status, 0, args.join(' '));
  });
}

test('EN and ES share headings, tables, code blocks and details', () => assert.deepEqual(shape('README.md'), shape('README.es.md')));
