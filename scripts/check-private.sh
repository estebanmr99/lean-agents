#!/usr/bin/env bash
# Fails if any tracked file contains private data.
# Generic patterns live here; personal ones come from a gitignored
# .private-denylist file or the PRIVATE_DENYLIST env var (one regex per line).
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

patterns=(
  '/Users/[A-Za-z0-9._-]+/'                  # macOS home paths
  'C:\\\\Users\\\\[A-Za-z0-9._-]+\\\\'       # Windows home paths
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' # email addresses
  'AKIA[0-9A-Z]{16}'                         # AWS access key
  'ghp_[A-Za-z0-9]{36}'                      # GitHub token
  'github_pat_[A-Za-z0-9_]{20,}'             # GitHub fine-grained token
  'sk-[A-Za-z0-9_-]{20,}'                    # OpenAI/Anthropic style keys
  'AIza[0-9A-Za-z_-]{35}'                    # Google API key
  'xox[baprs]-[A-Za-z0-9-]+'                 # Slack token
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)

# Allowed placeholders and public addresses.
allow='(<username>|noreply@|users\.noreply\.github\.com|@example\.com|@anthropic\.com|git@github\.com)'

if [[ -f .private-denylist ]]; then
  while IFS= read -r line; do
    [[ -n "$line" && "$line" != \#* ]] && patterns+=("$line")
  done < .private-denylist
fi
if [[ -n "${PRIVATE_DENYLIST:-}" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && patterns+=("$line")
  done <<< "$PRIVATE_DENYLIST"
fi

status=0
for p in "${patterns[@]}"; do
  hits=$(git ls-files -z -- ':!scripts/check-private.sh' \
    | xargs -0 grep -nIiE -e "$p" 2>/dev/null | grep -viE "$allow" || true)
  if [[ -n "$hits" ]]; then
    # Never echo the matched private pattern itself; show file:line only.
    echo "Private data found (pattern #$(( $(printf '%s\n' "${patterns[@]}" | grep -nxF -- "$p" | head -1 | cut -d: -f1) ))):"
    echo "$hits" | cut -d: -f1,2 | sed 's/^/  /'
    status=1
  fi
done

if [[ $status -eq 0 ]]; then
  echo "check-private: OK (${#patterns[@]} patterns)"
fi
exit $status
