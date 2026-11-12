// One-line Copilot premium-request allowance from `gh api copilot_internal/user` (undocumented endpoint,
// the one VS Code's meter uses). Any failure is "unavailable", never zero. Dollars: 1 credit = $0.01, an estimate.
import { quiet } from './system.mjs';

const money = (credits) => `$${(credits / 100).toFixed(2)}`;
const n = (v) => String(Math.round(v));

export function formatUsage(user) {
  const p = user?.quota_snapshots?.premium_interactions;
  if (!p) return 'unavailable';
  if (p.unlimited) return 'Unlimited premium requests';
  if (![p.entitlement, p.remaining, p.percent_remaining].every(Number.isFinite)) return 'unavailable';
  return `${n(p.remaining)} of ${n(p.entitlement)} credits left (${Math.floor(p.percent_remaining)}%), about ${money(p.remaining)} of ${money(p.entitlement)}, resets ${user.quota_reset_date}`;
}

// No leading slash: Git Bash rewrites it into a Windows path.
export function copilotUsage(run = quiet) {
  const r = run(['gh', 'api', 'copilot_internal/user'], 15000);
  if (!r.ok) return formatUsage(null);
  try { return formatUsage(JSON.parse(r.out)); } catch { return formatUsage(null); }
}
