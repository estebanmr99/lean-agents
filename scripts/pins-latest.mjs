#!/usr/bin/env node
// Rewrites core/pins.json in the current checkout to the newest upstream versions, so the daily CI run tests `latest`.
// Only the runner's copy changes; nothing is committed. Pins never move backwards. Deliberately no 14-day quarantine: the point is to see a brand-new release break before anyone bumps to it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isNewer, latestVersion, tagSha } from './version-watch.mjs';

const FILE = fileURLToPath(new URL('../core/pins.json', import.meta.url));

export async function hashUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
}

// An installer script at a fixed URL changes without a version number: its sha256 is the version (#245).
// Returns { key, from, to } when the hash moved and edits `p` in place; null when it did not.
export async function rehash(key, p, hash) {
  const s = await hash(p.url);
  if (s === p.sha256) return null;
  const m = { key, from: `sha256 ${p.sha256.slice(0, 12)}`, to: `sha256 ${s.slice(0, 12)}` };
  p.sha256 = s;
  return m;
}

// Returns the pins that moved as [{ key, from, to }] and edits `pins` in place. `hash` (url -> sha256) re-hashes
// the `version: "script"` installer pins; without it they are skipped like the other download pins.
export async function bump(pins, get, hash) {
  const moved = [];
  for (const [key, p] of Object.entries(pins)) {
    let next = null;
    if (p.version === 'script' && hash) {
      try { const m = await rehash(key, p, hash); if (m) moved.push(m); } catch (e) { console.log(`! ${key}: ${e.message}`); }
      continue;
    }
    if (p.kind === 'download' || p.sha256) continue; // a sha256 map (Bun, RTK's Linux tarball) only fits its own version (tool and cask pins move in the runner copy too, so the nightly shows the newest rtk/uv/gh/Antigravity)
    // Bun: the sha256 map is copied by hand from SHASUMS256.txt
    try {
      next = await latestVersion(p, get);
      if (next && isNewer(p.version, next)) {
        const sha = p.sha ? await tagSha(p.source, next, get) : null;
        const integrity = p.integrity ? (await get(`https://registry.npmjs.org/${p.source.replace('/', '%2F')}/${next}`)).dist.integrity : null;
        moved.push({ key, from: p.version, to: next }); p.version = next;
        if (sha) p.sha = sha;
        if (integrity) p.integrity = integrity;
      }
    } catch (e) { console.log(`! ${key}: ${e.message}`); }
  }
  return moved;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.CI && !process.argv.includes('--force')) {
    console.error('pins-latest.mjs only runs in CI (it rewrites core/pins.json). Set CI=true or pass --force to run it on purpose.');
    process.exit(1);
  }
  const { GITHUB_TOKEN } = process.env;
  const get = async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json', ...(url.includes('api.github.com') && GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}) } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };
  const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const moved = await bump(file.pins, get, hashUrl);
  fs.writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  const lines = moved.length ? moved.map((m) => `- ${m.key}: ${m.from} -> ${m.to}`) : ['- no pin has a newer version'];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Latest versions under test\n${lines.join('\n')}\n`);
}
