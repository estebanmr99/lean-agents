// #476: the feedback draft keeps package specs, cuts the title on a word, and does not claim a failure it was not told about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { draftIssue } from '../scripts/lib/feedback.mjs';

const on = { outbound: 'on' };
const draft = (command, error = 'x') => draftIssue({ network: on, home: '/h/u', env: {}, command, error, platform: 'linux x64' });

test('#476: package specs stay, emails are still redacted', () => {
  const d = draft('npx -y lean-agents@1.2.1 --yes', 'skills@1.7.4 and @scope/pkg@2.0.0 by a.b@example.com');
  assert.match(d.title, /lean-agents@1\.2\.1/);
  assert.match(d.body, /skills@1\.7\.4/);
  assert.match(d.body, /@scope\/pkg@2\.0\.0/);
  assert.match(d.body, /<email>/);
  assert.doesNotMatch(d.body, /a\.b@example\.com/);
});

test('#476: a long title ends on a word boundary with an ellipsis, within 100 characters', () => {
  const d = draft(`npx -y lean-agents@1.2.1 --yes --agents claude,antigravity,vscode-copilot,cursor --terminal both --tools rtk,context-mode`);
  assert.ok(d.title.length <= 100, d.title);
  assert.match(d.title, /\S…$/);
  assert.doesNotMatch(d.title, /--te…$|--tool…$/);
  assert.ok(`npx -y lean-agents@1.2.1 --yes --agents claude,antigravity,vscode-copilot,cursor --terminal both --tools rtk,context-mode`.includes(d.title.split(': ')[1].replace(/…$/, '')));
});

test('#476: the install title says "Problem running", not "Install failed"', () => {
  const d = draft('brew install gh');
  assert.equal(d.title, 'Problem running: brew install gh');
  assert.doesNotMatch(d.body, /What failed/);
});
