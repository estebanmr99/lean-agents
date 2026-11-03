#!/usr/bin/env bash
# Installs Caveman with the real Skills CLI into a throwaway HOME, then uninstalls.
# ~/.gemini/antigravity-cli stays in place on purpose: `skills remove -a opencode` then keeps
# ~/.agents/skills, because it thinks another agent still uses it. Used by CI; safe locally.
# Usage: tests/real-skills-undo.sh <agents>, for example claude,opencode-v2.
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

agents="${1:?usage: real-skills-undo.sh <agents>}"

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
skills="$HOME/.agents/skills"

mkdir -p "$HOME/.gemini/antigravity-cli"
node "$repo/scripts/lean.mjs" --home "$HOME" --yes --agents "$agents" --tools caveman \
  --privacy standard --lang en --ponytail-mode off </dev/null 2>&1 | tee "$HOME/install.txt"
refute grep -qE '^ *! ' "$HOME/install.txt"

case ",$agents," in *,claude,*) test -f "$HOME/.claude/skills/caveman/SKILL.md" ;; esac
case ",$agents," in *,opencode-v*) test -f "$skills/caveman/SKILL.md" ;; esac

node "$repo/scripts/lean.mjs" --home "$HOME" --uninstall --yes </dev/null 2>&1 | tee "$HOME/uninstall.txt"
refute grep -qE '^ *! ' "$HOME/uninstall.txt"

for name in caveman caveman-compress caveman-stats; do
  refute test -e "$skills/$name"
  refute test -e "$HOME/.claude/skills/$name"
done
test -z "$(ls -A "$skills" 2>/dev/null)"
refute grep -qs caveman "$HOME/.agents/.skill-lock.json"
echo "real-skills-undo: $agents OK"
