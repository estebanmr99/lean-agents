#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Statically count test calls in a file's content.
 * Matches test(, it(, and t.test( on lines not starting with //.
 */
export function countTests(content) {
  let count = 0;
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) continue;
    const matches = trimmed.match(/\b(test|it|t\.test)\s*\(/g);
    if (matches) {
      count += matches.length;
    }
  }
  return count;
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
    files = execSync(`git ls-tree -r --name-only ${ref} tests/`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      .split('\n')
      .filter(f => f.endsWith('.test.mjs'));
  } catch (e) {
    // Ref might not exist (e.g. fresh repo)
    return {};
  }

  const counts = {};
  for (const file of files) {
    if (!file) continue;
    try {
      const content = execSync(`git show ${ref}:${file}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      counts[file] = countTests(content);
    } catch (e) {
      // Ignore files that can't be shown
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
const isMain = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('test-count.mjs')
);

if (isMain) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
