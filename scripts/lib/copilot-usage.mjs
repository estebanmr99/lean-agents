// One-line Copilot premium-request allowance from `gh api copilot_internal/user` (undocumented endpoint,
// the one VS Code's meter uses). Any failure is "unavailable", never zero. Dollars: 1 credit = $0.01, an estimate.
import { quiet } from './system.mjs';
import { OWNED_MARK } from './fsops.mjs';

const money = (credits) => `$${(credits / 100).toFixed(2)}`;
const n = (v) => String(Math.round(v));

export function formatUsage(user) {
  const p = user?.quota_snapshots?.premium_interactions;
  if (!p) return 'unavailable';
  if (p.unlimited) return 'Unlimited premium requests';
  if (![p.entitlement, p.remaining, p.percent_remaining].every(Number.isFinite)) return 'unavailable';
  return `${n(p.remaining)} of ${n(p.entitlement)} credits left (${Math.floor(p.percent_remaining)}%), about ${money(p.remaining)} of ${money(p.entitlement)}, resets ${user.quota_reset_date}`;
}

// Claude Code status line: a standalone Node script built from the formatter above (same source, so it cannot drift).
// gh runs at most once per 5 minutes (cache in the temp dir); a failure prints `unavailable`, never zero.
export const statuslineScript = () => `// ${OWNED_MARK}
// Claude Code status line: Copilot credits left. One gh call (cached 5 minutes), never a model request.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const money = ${money};
const n = ${n};
${formatUsage}

const cache = path.join(os.tmpdir(), 'lean-copilot-usage-statusline.txt');
try {
  if (Date.now() - fs.statSync(cache).mtimeMs < 300000) { process.stdout.write(fs.readFileSync(cache, 'utf8')); process.exit(0); }
} catch {}
let line;
try {
  const out = execFileSync('gh', ['api', 'copilot_internal/user'], { timeout: 15000, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
  line = 'Copilot: ' + formatUsage(JSON.parse(out)) + '\\n';
} catch { line = 'Copilot: ' + formatUsage(null) + '\\n'; }
// Shared /tmp: never follow a planted symlink; 'wx' (O_EXCL) refuses any existing path.
try { fs.rmSync(cache, { force: true }); fs.writeFileSync(cache, line, { flag: 'wx' }); } catch {}
process.stdout.write(line);
`;

// No leading slash: Git Bash rewrites it into a Windows path.
export function copilotUsage(run = quiet) {
  const r = run(['gh', 'api', 'copilot_internal/user'], 15000);
  if (!r.ok) return formatUsage(null);
  try { return formatUsage(JSON.parse(r.out)); } catch { return formatUsage(null); }
}
