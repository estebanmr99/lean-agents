// Opt-in feedback after a failed install: a redacted issue draft the agent shows before anything is filed.
import os from 'node:os';
import { redactText } from './redact.mjs';

// Filing an issue is an outbound call, so only the `outbound` category decides (strict turns it off).
export const feedbackAllowed = (network) => network?.outbound === 'on';

// Returns null when the preset forbids it. Everything free-form goes through redactText.
export function draftIssue({ network, home, env = process.env, versions = {}, command, error, kind = 'install', platform = `${os.platform()} ${os.arch()}` }) {
  if (!feedbackAllowed(network)) return null;
  const clean = (t) => redactText(t, { home, env });
  const update = kind === 'update';
  const verify = kind === 'verify';
  const versionLines = Object.entries(versions).map(([k, v]) => `- ${k}: ${clean(v)}`);
  return {
    title: clean(`${update ? 'Update finding' : verify ? 'Verify finding' : 'Install failed'}: ${command}`).slice(0, 100),
    body: [
      update ? '## What the update found' : verify ? '## What the check found' : '## What failed',
      `- OS: ${platform}`,
      ...versionLines,
      `- ${update || verify ? 'Tool' : 'Command'}: \`${clean(command)}\``,
      '',
      update || verify ? '## Details' : '## Error',
      '```',
      clean(error).trim(),
      '```',
      '',
      '_Drafted by an agent, redacted by lean-agents, filed only after the user said yes._',
    ].join('\n'),
  };
}

// A doctor row `{ item, status, detail }` as an issue draft. Unlike draftIssue it always returns the redacted text, so a
// strict or offline user can copy it; `canFile` says whether the agent may offer to file it (feedbackAllowed).
export function draftFromRow({ network, row, ...rest }) {
  const draft = draftIssue({ ...rest, network: { outbound: 'on' }, command: row.item, error: `${row.status}: ${row.detail ?? ''}`, kind: 'verify' });
  return { ...draft, canFile: feedbackAllowed(network) };
}

const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;

// state.json `filedIssues`: [{ item, title, url, filedAt }], one entry per issue the user said yes to. Pure: returns the new list.
export function addFiledIssue(list = [], { item, title, url, filedAt = new Date().toISOString() }, { home, env = process.env } = {}) {
  if (!ISSUE_URL.test(url)) throw new Error(`not a GitHub issue URL: ${url}`);
  if (list.some((f) => f.url === url)) return list;
  const clean = (t) => redactText(t, { home, env });
  return [...list, { item: clean(item), title: clean(title), url, filedAt }];
}
