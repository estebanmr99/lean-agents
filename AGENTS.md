# Working on lean-agents

Instructions for coding agents (Claude Code, OpenCode, Copilot CLI) that work **on this repository**. Not to be confused with `core/AGENTS.md`, which is the rule set lean-agents installs on users' machines.

## Read first

1. `docs/SPEC.md` section 0 (current state) and section 2 (non-negotiable rules).
2. The next unchecked session in `docs/SPEC.md` section 14. Work only on that session.

## Commands

| Task | Command |
| --- | --- |
| Install dev dependencies | `npm ci` |
| Engine tests (temp HOME, no external commands) | `npm test` |
| Shell lint | `shellcheck install.sh scripts/check-private.sh tests/real-opencode.sh` |
| Privacy check (run before every commit) | `bash scripts/check-private.sh` |
| Try the installer safely | `node scripts/lean.mjs --home "$(mktemp -d)" --no-exec --yes --dry-run --agents claude,opencode-v2 --all-tools` |
| Real OpenCode 2 check (needs `opencode` on PATH) | `bash tests/real-opencode.sh` |

## Hard rules

- **Never touch the real HOME.** Every engine run in development or tests uses `--home <temp dir>`; use `--no-exec` unless the task is to test real tool installs inside a throwaway HOME or CI. Never run `install.sh` or `scripts/lean.mjs` without `--home` on the owner's machine.
- **Public repo: no private data.** No usernames, home paths, employer names or internal tools, cloud project IDs, emails, keys or tokens. `scripts/check-private.sh` must pass; it also reads the gitignored `.private-denylist`.
- **Verify, don't guess.** Every install command, config key and CLI flag comes from the tool's current upstream docs or from a real binary in CI. Record source and date in `docs/compatibility.md`. Mark anything unverified as **VERIFY**.
- **Prove it in CI.** The owner does not test on their working machines. A feature is done when a CI job with real binaries and a throwaway HOME shows it works.
- **Never overwrite user files.** Use the engine's action kinds in `scripts/lib/fsops.mjs`: `file` (owned files with the `managed by lean-agents` mark), `json` (JSONC edits that keep comments and user values), `block` (marked block in text files). Every change must be undone by `--uninstall`.
- **Do not add tools the owner rejected:** Oh My OpenAgent, Graphify, Warp plugins (FAQ only).
- **Ask before pushing, opening PRs, or anything irreversible.**

## Code style

- Node 20+, ES modules, no dependencies beyond `jsonc-parser`. Small pure functions; adapters return `{ actions, commands }`.
- Bash 3.2 compatible (macOS default) and shellcheck clean. PowerShell 5.1 compatible and PSScriptAnalyzer clean.
- Match the comment density of the surrounding code: a short header per file, comments only where the why is not obvious.
- Tests in `tests/*.test.mjs` with `node:test`, always against a temp HOME.

## Git

- One branch per session: `session-<n>-<short-name>`. Conventional commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).
- Commit as the owner (their GitHub no-reply email is already in the clone's git config) and add a `Co-Authored-By:` trailer for the agent.
- Update `CHANGELOG.md` (Unreleased), the README compatibility tables (EN and ES) and `docs/compatibility.md` in the same PR as the feature.
- Mark the session `[x]` in `docs/SPEC.md` section 14 when its PR merges.

## Token efficiency while working here

- Search before reading; open only the relevant lines. Use Serena symbol tools if available.
- Delegate exploration and upstream research to cheap subagents (`explore`, `research`), review the diff with `review` before reporting done.
- Report: what changed, how it was verified (command + result), what is pending.
