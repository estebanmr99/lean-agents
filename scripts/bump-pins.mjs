#!/usr/bin/env node
// After a green daily ci-latest run: bump core/pins.json to the newest stable version at least 14 days old and write the
// PR body. A human merges the PR. The workflow does the git work; this script only edits the file.
//   node scripts/bump-pins.mjs <body-file>      (needs GITHUB_TOKEN for GitHub API calls)
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isNewer, latestVersion, notesUrl, tagSha } from './version-watch.mjs';

const FILE = fileURLToPath(new URL('../core/pins.json', import.meta.url));
const STABLE = /^v?\d+\.\d+\.\d+$/;
const DAY = 86400000;
// The skill pin for this repo is bumped by the release, never by the daily run.
const SKIP = new Set(['lean-update']);

// { version, date } of the newest candidate at least `days` old, or null. npm: from the registry's publish times.
// Skill (GitHub tag): the newest tag's release date; null when it has no release or is too young.
export async function pickVersion(p, get, now, days = 14) {
  const old = (iso) => now - Date.parse(iso) >= days * DAY;
  if (p.kind === 'npm') {
    const times = (await get(`https://registry.npmjs.org/${p.source.replace('/', '%2F')}`)).time ?? {};
    const best = Object.keys(times).filter((v) => STABLE.test(v) && old(times[v])).reduce((b, v) => (!b || isNewer(b, v) ? v : b), null);
    return best && { version: best, date: times[best].slice(0, 10) };
  }
  const tag = await latestVersion(p, get);
  if (!tag) return null;
  const published = (await get(`https://api.github.com/repos/${p.source}/releases/tags/${tag}`)).published_at;
  return published && old(published) ? { version: tag, date: published.slice(0, 10) } : null;
}

// Edits only the version, verified, sha and integrity values on the pin's own line, so the file keeps its layout.
export function applyBump(text, key, version, verified, extra = {}) {
  return text.split('\n').map((l) => {
    if (!l.trimStart().startsWith(`"${key}":`)) return l;
    let out = l.replace(/"version": "[^"]*"/, `"version": "${version}"`).replace(/"verified": "[^"]*"/, `"verified": "${verified}"`);
    for (const [field, value] of Object.entries(extra)) out = out.replace(new RegExp(`"${field}": "[^"]*"`), `"${field}": "${value}"`);
    return out;
  }).join('\n');
}

// The commit SHA (git, skill) or npm integrity a bumped pin must carry; {} for pins that have neither.
async function checks(p, version, get) {
  const extra = {};
  if (p.sha) extra.sha = await tagSha(p.source, version, get);
  if (p.integrity) extra.integrity = (await get(`https://registry.npmjs.org/${p.source.replace('/', '%2F')}/${version}`)).dist.integrity;
  return extra;
}

export async function bump({ text, get, now = Date.now(), today = new Date(now).toISOString().slice(0, 10), log = console.log }) {
  const pins = JSON.parse(text).pins;
  const changes = [];
  for (const [key, p] of Object.entries(pins)) {
    if (SKIP.has(key) || p.kind === 'download') continue;
    if (p.hold) { log(`held: ${key} ${p.version} (${p.hold})`); continue; }
    try {
      const pick = await pickVersion(p, get, now);
      if (!pick || !isNewer(p.version, pick.version)) continue;
      text = applyBump(text, key, pick.version, today, await checks(p, pick.version, get));
      changes.push({ key, from: p.version, to: pick.version, ci: p.ci, notes: notesUrl(p, pick.version), published: pick.date });
    } catch (e) { log(`! ${key}: ${e.message}`); }
  }
  return { text, changes };
}

export const render = (changes) => [
  'Daily `ci-latest` was green. These pins move to the newest stable version published at least 14 days ago. The picked versions can differ from the ones `ci-latest` tested, so `ci.yml` is dispatched on this branch with the new pins. A human merges this PR.',
  '',
  '| Pin | From | To | Published | Notes | CI job |',
  '| --- | --- | --- | --- | --- | --- |',
  ...changes.map((c) => `| ${c.key} | ${c.from} | ${c.to} | ${c.published} | ${c.notes} | ${c.ci} |`),
  '',
  'Merge only when the `ci` job named for each pin is green for this head commit (VERIFY: the checks come from the workflow dispatch, not from a PR event).',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const body = process.argv[2];
  if (!body) { console.error('usage: bump-pins.mjs <body-file>'); process.exit(1); }
  const token = process.env.GITHUB_TOKEN;
  const get = async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json', ...(token && url.includes('api.github.com') ? { authorization: `Bearer ${token}` } : {}) } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };
  const { text, changes } = await bump({ text: fs.readFileSync(FILE, 'utf8'), get });
  if (!changes.length) { console.log('nothing to bump'); process.exit(0); }
  fs.writeFileSync(FILE, text);
  fs.writeFileSync(body, `${render(changes)}\n`);
  for (const c of changes) console.log(`${c.key}: ${c.from} -> ${c.to}`);
}
