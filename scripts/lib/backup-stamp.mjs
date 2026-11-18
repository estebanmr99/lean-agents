// Reader for the verified-backup stamp that gates --upgrade-agent opencode apply.
// Stub until the permanent backup lands (P3 of #80 part 2 replaces the body); until then there is never a stamp.
export function readBackupStamp(_home) {
  return null;
}
