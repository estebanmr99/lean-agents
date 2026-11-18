// The verified-backup stamp that gates --upgrade-agent opencode apply (#80 part 2).
// `--backup` (opencode-backup.mjs) writes STAMP.json into the finished backup folder as its very last step, after the sha256, count and frozen-copy checks passed:
// a folder without it (a half-made or older backup) never opens the gate. `apply` re-verifies the files before it trusts the stamp.
import fs from 'node:fs';
import path from 'node:path';
import { backupLayout, STAMP_FILE } from './opencode-backup.mjs';

const j = path.join;
const NAME = STAMP_FILE;

// Newest complete stamp for `home`, or null. { verified: true, ts, sessions, dir, frozen }.
export function readBackupStamp(home, fsx = fs) {
  const L = backupLayout(home, 'x');
  const root = path.dirname(L.backup);
  let names = [];
  try { names = fsx.readdirSync(root).filter((n) => /^opencode1-sessions-\d{8}T\d{6}Z$/.test(n)).sort(); } catch { return null; }
  for (const n of names.reverse()) {
    const dir = j(root, n);
    let s;
    try { s = JSON.parse(fsx.readFileSync(j(dir, NAME), 'utf8')); } catch { continue; }
    if (s?.verified !== true || !fsx.existsSync(j(dir, 'MANIFEST.sha256')) || !fsx.existsSync(j(L.frozen, 'opencode', 'opencode.db'))) continue;
    return { ...s, dir, frozen: L.frozen };
  }
  return null;
}
