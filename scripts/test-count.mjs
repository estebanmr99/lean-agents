#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Statically count test calls in a file's content.
 * Matches test(, it(, and t.test( on lines not starting with //.
 * heuristic: top-level and t.test calls at line start
 */
export function countTests(content) {
  // Strip // comments first
  const clean = content.replace(/\/\/.*$/gm, '');
  const matches = clean.match(/^\s*(?:await\s+)?(?:test|it|t\.test)\s*\(/gm);
  return matches ? matches.length : 0;
}

/**
 * Compare test counts between two sets of counts.
 * Returns results for the table and any errors found.
 */
export function compareCounts(baseCounts, headCounts, prBody = '') {
  const errors = [];
  const allFiles = new Set([...Object.keys(baseCounts), ...Object.keys(headCounts)]);
  const results = [];

  const skipMatch = prBody && prBody.match(/^tests-removed:\s*\S+/m);

  for (const file of [...allFiles].sort()) {
    const base = baseCounts[file] || 0;
    const head = headCounts[file] || 0;
    results.push({ file, base, head });

    if (head < base && !skipMatch) {
      errors.push(`${file}: ${base} -> ${head}`);
    }
  }

  return { results, errors };
}

function getCountsForRef(ref) {
  let files;
  try {
    files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref, 'tests/'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .split('\n')
      .filter(f => f.endsWith('.test.mjs'));
  } catch (e) {
    process.stderr.write(`test-count: base ref ${ref} not found (fetch-depth: 0?)\n`);
    process.exit(1);
  }

  const counts = {};
  for (const file of files) {
    if (!file) continue;
    try {
      const content = execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      counts[file] = countTests(content);
    } catch (e) {
      // A file missing at one ref is still fine: count 0.
      counts[file] = 0;
    }
  }
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: test-count.mjs <baseRef> <headRef>');
    process.exit(1);
  }

  const [baseRef, headRef] = args;
  const prBody = process.env.PR_BODY || '';

  const baseCounts = getCountsForRef(baseRef);
  const headCounts = getCountsForRef(headRef);

  const { results, errors } = compareCounts(baseCounts, headCounts, prBody);

  console.log('| File | Base | Head |');
  console.log('| --- | --- | --- |');
  for (const r of results) {
    console.log(`| ${r.file} | ${r.base} | ${r.head} |`);
  }

  if (errors.length > 0) {
    console.error('\nFAIL: Test count dropped without "tests-removed: <reason>" in PR body:');
    for (const e of errors) {
      console.error(`- ${e}`);
    }
    process.exit(1);
  }
}

// Run if called directly
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
