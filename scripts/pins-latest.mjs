#!/usr/bin/env node
// Rewrites core/pins.json in the current checkout to the newest upstream versions, so the daily CI run tests `latest`.
// Only the runner's copy changes; nothing is committed. Pins never move backwards. Deliberately no 14-day quarantine: the point is to see a brand-new release break before anyone bumps to it.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isNewer, latestVersion, tagSha } from './version-watch.mjs';

const FILE = fileURLToPath(new URL('../core/pins.json', import.meta.url));

// Returns the pins that moved as [{ key, from, to }] and edits `pins` in place.
export async function bump(pins, get) {
  const moved = [];
  for (const [key, p] of Object.entries(pins)) {
    let next = null;
    if (p.kind === 'download') continue; // Bun: the sha256 map is copied by hand from SHASUMS256.txt
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
  const { GITHUB_TOKEN } = process.env;
  const get = async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json', ...(url.includes('api.github.com') && GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}) } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };
  const file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const moved = await bump(file.pins, get);
  fs.writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`);
  const lines = moved.length ? moved.map((m) => `- ${m.key}: ${m.from} -> ${m.to}`) : ['- no pin has a newer version'];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Latest versions under test\n${lines.join('\n')}\n`);
}
