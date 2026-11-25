// Every relative Markdown link in a tracked *.md file points to a file that exists (#437). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Relative link targets in a Markdown text; code fences (``` and ~~~) and inline code skipped.
function relativeLinks(md) {
  const text = md.replace(/(```|~~~)[\s\S]*?\1/g, '').replace(/`[^`\n]*`/g, '');
  const out = [];
  // Target: <with spaces> or a run without spaces that may hold one (paren) group; optional "title" or 'title'.
  for (const m of text.matchAll(/\]\(\s*(?:<([^>\n]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g)) {
    const target = m[1] || m[2];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    const path = target.split('#')[0].split('?')[0];
    try { out.push(decodeURIComponent(path)); } catch { out.push(path); }
  }
  return out;
}

test('relativeLinks skips URLs, mailto, anchors and code', () => {
  const md = '[a](docs/x.md) [b](https://e.com) [c](mailto:a@b) [d](#top) [e](y.md#sec) `[f](no.md)`\n```\n[g](no2.md)\n```\n~~~\n[h](no3.md)\n~~~';
  assert.deepEqual(relativeLinks(md), ['docs/x.md', 'y.md']);
  const edge = "[a](foo(bar).md) [b](<my file.md>) [c](t.md 'T') [d](100%.md) [e](//host/x) ![i](img.png \"alt\")";
  assert.deepEqual(relativeLinks(edge), ['foo(bar).md', 'my file.md', 't.md', '100%.md', 'img.png']);
});

test('every relative link in tracked Markdown resolves', () => {
  const files = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const broken = [];
  for (const f of files) {
    for (const target of relativeLinks(readFileSync(join(ROOT, f), 'utf8'))) {
      const path = target.startsWith('/') ? join(ROOT, target) : join(ROOT, dirname(f), target);
      if (!existsSync(path)) broken.push(`${f}: ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});
