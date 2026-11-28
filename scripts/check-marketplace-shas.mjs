// Fails when a marketplace tag no longer points at the sha recorded in core/pins.json, so a moved tag is caught
// before users install different code than the one verified (#523). Network read-only: git ls-remote.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PINS } from './lib/pins.mjs';
import { marketplaceDrift, parseLsRemote } from './lib/marketplace-sha.mjs';

// argv, never a shell string: repo and tag were already checked against their regexes.
export function resolveTag(repo, tag) {
  const out = execFileSync('git', ['ls-remote', `https://github.com/${repo}`, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const sha = parseLsRemote(out, tag);
  if (!sha) throw new Error(`no tag ${tag}`);
  return sha;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let drift;
  try {
    drift = marketplaceDrift(PINS, resolveTag);
  } catch (e) {
    console.log(`::error::marketplace pin unresolved: ${e.message}`);
    process.exit(2);
  }
  for (const d of drift) console.log(`::error::marketplace pin drift: ${d.key} ${d.tag} pinned ${d.pinned} now ${d.actual}`);
  if (!drift.length) console.log('marketplace pins match');
  process.exit(drift.length ? 1 : 0);
}