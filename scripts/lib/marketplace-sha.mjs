// Marketplace plugins install by tag, so the sha recorded in core/pins.json is the only proof the tag did not move (#523).
// Pure: the caller supplies the resolver, so checks need no network.
const REPO = /^[\w.-]+\/[\w.-]+$/;
const TAG = /^[\w.+-]+$/;

function valid(re) { return (v) => typeof v === 'string' && re.test(v); }

// [{ key, tag, pinned, actual }] for every marketplace pin whose tag no longer resolves to its recorded sha.
// A resolver that cannot find the tag throws; the caller turns that into its own exit code.
export function marketplaceDrift(pins, resolve) {
  const drift = [];
  for (const [key, p] of Object.entries(pins)) {
    if (p.kind !== 'marketplace' || !p.sha) continue;
    if (!valid(REPO)(p.source) || !valid(TAG)(p.version)) throw new Error(`${key}: bad marketplace repo or tag`);
    const actual = resolve(p.source, p.version);
    if (actual !== p.sha) drift.push({ key, tag: p.version, pinned: p.sha, actual });
  }
  return drift;
}

// `git ls-remote <repo> refs/tags/<tag> refs/tags/<tag>^{}`: prefer the peeled sha of an annotated tag.
export function parseLsRemote(output, tag) {
  const refs = new Map(output.split('\n').filter(Boolean).map((line) => {
    const [sha, ref] = line.split('\t');
    return [ref, sha];
  }));
  return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
}