#!/usr/bin/env node
// Daily "latest versions" CI run failed: open one `version-watch` issue, or comment on the open one once per run.
// Needs GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_URL, RUN_ID and FAILED_JOBS (newline-separated names).
import { pathToFileURL } from 'node:url';
import { githubApi } from './version-watch.mjs';

export const TITLE = 'Latest versions break CI';
const mark = (runId) => `<!-- ci-latest:${runId} -->`;

// issues: [{ number, title, state, body, comments: [string] }]. Returns the one action to take, or null.
export function plan(issues, { failed, runUrl, runId }) {
  const open = issues.find((i) => i.title === TITLE && i.state === 'open');
  if (open && [open.body, ...open.comments].some((t) => t?.includes(mark(runId)))) return null;
  const body = [
    `The daily run with the newest upstream versions failed: ${runUrl}`,
    `Failed jobs:\n${failed.map((j) => `- ${j}`).join('\n')}`,
    'The run summary lists which pins moved. PRs are not affected: they use `core/pins.json`. Open `Update available` issues name the tool; run its `ci` job to confirm before bumping.',
    mark(runId),
  ].join('\n\n');
  return open ? { type: 'comment', number: open.number, body } : { type: 'create', title: TITLE, body };
}

export async function run({ api, ...ctx }, log = console.log) {
  const issues = await api.list();
  for (const i of issues) i.comments = await api.comments(i.number);
  const action = plan(issues, ctx);
  if (!action) log('already reported for this run');
  else if (action.type === 'create') await api.create(action.title, action.body);
  else await api.comment(action.number, action.body);
  if (action) log(action.type);
  return action;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_URL, RUN_ID, FAILED_JOBS = '' } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !RUN_ID) { console.error('needs GITHUB_TOKEN, GITHUB_REPOSITORY and RUN_ID'); process.exit(1); }
  await run({ api: githubApi(GITHUB_REPOSITORY, GITHUB_TOKEN), failed: FAILED_JOBS.split('\n').filter(Boolean), runUrl: RUN_URL, runId: RUN_ID });
}
