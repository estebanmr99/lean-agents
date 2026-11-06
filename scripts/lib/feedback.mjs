// Opt-in feedback after a failed install: a redacted issue draft the agent shows before anything is filed.
import os from 'node:os';
import { redactText } from './doctor.mjs';

// Filing an issue is an outbound call, so only the `outbound` category decides (strict turns it off).
export const feedbackAllowed = (network) => network?.outbound === 'on';

// Returns null when the preset forbids it. Everything free-form goes through redactText.
export function draftIssue({ network, home, env = process.env, versions = {}, command, error, platform = `${os.platform()} ${os.arch()}` }) {
  if (!feedbackAllowed(network)) return null;
  const clean = (t) => redactText(t, { home, env });
  const versionLines = Object.entries(versions).map(([k, v]) => `- ${k}: ${clean(v)}`);
  return {
    title: clean(`Install failed: ${command}`).slice(0, 100),
    body: [
      '## What failed',
      `- OS: ${platform}`,
      ...versionLines,
      `- Command: \`${clean(command)}\``,
      '',
      '## Error',
      '```',
      clean(error).trim(),
      '```',
      '',
      '_Drafted by an agent, redacted by lean-agents, filed only after the user said yes._',
    ].join('\n'),
  };
}
