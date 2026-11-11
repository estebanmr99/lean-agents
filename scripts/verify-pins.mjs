// Checks core/pins.json against the real upstream: npm `dist.integrity` and the commit a tag points at.
// A mismatch means the registry or the tag changed after the pin was recorded (a republish or a moved tag).
//   node scripts/verify-pins.mjs        (GITHUB_TOKEN raises the GitHub API rate limit)
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tagSha } from './version-watch.mjs';

const FILE = fileURLToPath(new URL('../core/pins.json', import.meta.url));

// Returns one message per pin whose recorded integrity or sha differs from upstream.
export async function verify(pins, get) {
  const bad = [];
  for (const [key, p] of Object.entries(pins)) {
    try {
      if (p.integrity) {
        const meta = await get(`https://registry.npmjs.org/${p.source.replace('/', '%2F')}/${p.version}`);
        if (meta.dist.integrity !== p.integrity) bad.push(`${key}: integrity ${meta.dist.integrity} != pinned ${p.integrity}`);
        if (meta.engines?.node !== p.node) bad.push(`${key}: engines.node ${meta.engines?.node} != pinned ${p.node}`);
      }
      if (p.sha) {
        const got = await tagSha(p.source, p.version, get);
        if (got !== p.sha) bad.push(`${key}: ${p.version} is ${got}, pinned ${p.sha}`);
      }
    } catch (e) { bad.push(`${key}: ${e.message}`); }
  }
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const headers = { 'User-Agent': 'lean-agents', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const get = async (url) => { const r = await fetch(url, { headers }); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); };
  const bad = await verify(JSON.parse(fs.readFileSync(FILE, 'utf8')).pins, get);
  for (const m of bad) console.log(`! ${m}`);
  console.log(bad.length ? `${bad.length} pin(s) do not match upstream` : 'every pin matches upstream');
  process.exit(bad.length ? 1 : 0);
}
