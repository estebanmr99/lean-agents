#!/usr/bin/env node
// Daily check of core/pins.json against npm and GitHub tags. Opens one `version-watch` issue per item with a newer
// version, or comments on the open one. Read-only for the repo: it never changes a pin.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LABEL = 'version-watch';
const STABLE = /^v?\d+\.\d+\.\d+$/;
const mark = (v) => `<!-- version-watch:${v} -->`;
const parts = (v) => v.replace(/^v/, '').split('.').map(Number);

// True when `next` is a higher stable x.y.z than `current`.
export function isNewer(current, next) {
  if (!STABLE.test(next)) return false;
  const [a, b] = [parts(current), parts(next)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}

export function notesUrl(p, version) {
  return p.kind === 'npm' ? `https://www.npmjs.com/package/${p.source}/v/${version}` : `https://github.com/${p.source}/releases/tag/${version}`;
}

function render(key, p, version) {
  return [
    `Confirmed to work: \`${p.version}\` (verified ${p.verified}).`,
    `New upstream version: \`${version}\`.`,
    `Release notes: ${notesUrl(p, version)}`,
    'Do not bump to a version published in the last 14 days.',
    ...(p.note ? [`Note: ${p.note}`] : []),
    `Run before bumping: the \`${p.ci}\` job (or its \`tests/real-*.sh\` script in a sandbox HOME).`,
    'This watch never changes pins. To bump, follow "Tool versions" in `skills/update-models/SKILL.md` and edit `core/pins.json` after the owner approves.',
    mark(version),
  ].join('\n\n');
}

// pins: core/pins.json "pins"; latest: { key: version|null }; issues: every version-watch issue, open or closed:
// [{ number, title, state, body, comments: [string] }]. A closed issue still counts as "already reported".
export function plan(pins, latest, issues) {
  const actions = [];
  for (const [key, p] of Object.entries(pins)) {
    const version = latest[key];
    if (!version || !isNewer(p.version, version)) continue;
    const title = `Update available: ${key}`;
    const same = issues.filter((i) => i.title === title);
    if (same.some((i) => [i.body, ...i.comments].some((t) => t?.includes(mark(version))))) continue;
    const issue = same.find((i) => i.state === 'open');
    const body = render(key, p, version);
    if (!issue) actions.push({ type: 'create', key, title, body });
    else actions.push({ type: 'comment', key, number: issue.number, body });
  }
  return actions;
}

export async function latestVersion(p, get) {
  if (p.kind === 'npm') return (await get(`https://registry.npmjs.org/${p.source.replace('/', '%2F')}/latest`)).version;
  // shortcut: first 100 tags only, enough for repos that tag per release; page if a repo outgrows that.
  const tags = (await get(`https://api.github.com/repos/${p.source}/tags?per_page=100`)).map((t) => t.name).filter((n) => STABLE.test(n));
  return tags.reduce((best, n) => (!best || isNewer(best, n) ? n : best), null);
}

// api: { list(), comments(number), create(title, body), comment(number, body) }
export async function run({ pins, get, api, log = console.log }) {
  const latest = {};
  for (const [key, p] of Object.entries(pins)) {
    try { latest[key] = await latestVersion(p, get); } catch (e) { log(`! ${key}: ${e.message}`); }
  }
  const issues = await api.list();
  for (const i of issues) i.comments = await api.comments(i.number);
  const actions = plan(pins, latest, issues);
  for (const a of actions) {
    if (a.type === 'create') await api.create(a.title, a.body);
    else await api.comment(a.number, a.body);
    log(`${a.type}: ${a.key}`);
  }
  if (!actions.length) log('nothing new');
  return actions;
}

export function githubApi(repo, token) {
  const call = async (method, url, body) => {
    const r = await fetch(`https://api.github.com/repos/${repo}${url}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    if (!r.ok && !(method === 'POST' && url === '/labels' && r.status === 422)) throw new Error(`${method} ${url}: ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  return {
    async list() {
      await call('POST', '/labels', { name: LABEL, color: 'ededed' });
      return call('GET', `/issues?labels=${LABEL}&state=all&per_page=100`);
    },
    async comments(number) { return (await call('GET', `/issues/${number}/comments?per_page=100`)).map((c) => c.body); },
    create: (title, body) => call('POST', '/issues', { title, body, labels: [LABEL] }),
    comment: (number, body) => call('POST', `/issues/${number}/comments`, { body }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) { console.error('needs GITHUB_TOKEN and GITHUB_REPOSITORY'); process.exit(1); }
  const pins = JSON.parse(fs.readFileSync(`${ROOT}core/pins.json`, 'utf8')).pins;
  const get = async (url) => {
    const r = await fetch(url, { headers: { accept: 'application/json', authorization: url.includes('api.github.com') ? `Bearer ${GITHUB_TOKEN}` : '' } });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };
  await run({ pins, get, api: githubApi(GITHUB_REPOSITORY, GITHUB_TOKEN) });
}
