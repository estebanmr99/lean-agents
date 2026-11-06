# Roadmap

What comes next, in order. Each step is one build session in `docs/SPEC.md` section 14 and one PR. A step is done when its CI job with real binaries is green and its issues are closed.

Released: [`v0.5.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v0.5.0) (2026-11-04). [`v0.6.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v0.6.0) (2026-11-06) is done and waits for the owner's tag; it folds in the planned 0.5.1 and raises the minimum Node to 22.20.

## Done in 0.6.0: fixes from real installs (planned as 0.5.1)

Found while installing on two Windows 11 work PCs behind a corporate proxy.

| Session | Issues | What changes |
| --- | --- | --- |
| 16 — Fixes and docs | [#20](https://github.com/estebanmr99/lean-agents/issues/20), [#27](https://github.com/estebanmr99/lean-agents/issues/27), [#31](https://github.com/estebanmr99/lean-agents/issues/31), [#32](https://github.com/estebanmr99/lean-agents/issues/32), [#39](https://github.com/estebanmr99/lean-agents/issues/39) | GSD no longer crashes with Cursor or VS Code Copilot; the test suite passes on Windows hosts with a proxy; privacy table, `tests/README.md` and compatibility rows fixed; OpenCode 2 on Windows found from PowerShell; Context Mode v2 install for Copilot CLI and Antigravity |
| 17 — Windows: Cursor CLI and Orca | [#21](https://github.com/estebanmr99/lean-agents/issues/21), [#22](https://github.com/estebanmr99/lean-agents/issues/22), [#23](https://github.com/estebanmr99/lean-agents/issues/23), [#25](https://github.com/estebanmr99/lean-agents/issues/25), [#26](https://github.com/estebanmr99/lean-agents/issues/26), [#28](https://github.com/estebanmr99/lean-agents/issues/28), [#29](https://github.com/estebanmr99/lean-agents/issues/29) | `orca-cli` skill for Cursor and VS Code Copilot; Cursor CLI works from Git Bash and behind a proxy; Orca status hooks work behind a proxy; `--doctor` reports Orca's own hooks; a "Still needed from you" list after install |

## Done in 0.6.0: install less, pin what runs, bring your setup

| Session | Issues | What changes |
| --- | --- | --- |
| 18 — Pick only what you need, pin versions | [#30](https://github.com/estebanmr99/lean-agents/issues/30), [#33](https://github.com/estebanmr99/lean-agents/issues/33), [#40](https://github.com/estebanmr99/lean-agents/issues/40) | `--no-core` skips RTK and Context Mode; MCP servers and skills use pinned versions, bumped by a skill with your approval; `--doctor` reports drift; a daily check opens one issue per tool when a new version ships |
| 21 — Lean CI | [#42](https://github.com/estebanmr99/lean-agents/issues/42) | PRs use pinned versions and skip real-binary jobs on docs-only changes; every job has a timeout; a trimmed matrix; a daily run with the latest versions opens one issue when it breaks; the required checks and the `gh api` command are documented |
| 19 — Migrate from another harness | [#34](https://github.com/estebanmr99/lean-agents/issues/34) | `--migrate <from|auto>` copies rules, agents, skills, MCP servers and prompts from VS Code Copilot, Claude Code, Cursor, OpenCode or Copilot CLI to the agents you pick; never overwrites, never copies secret values, reports hooks instead of converting them |
| 20 — Install with an agent | [#35](https://github.com/estebanmr99/lean-agents/issues/35), [#36](https://github.com/estebanmr99/lean-agents/issues/36), [#37](https://github.com/estebanmr99/lean-agents/issues/37) | A guide and copy-paste prompt so your agent installs only what you ask; `--json` for `--dry-run` and `--doctor`; opt-in, redacted issue drafts after a failure; `gh` preselected with `--no-gh` |

## Next release (on hold)

| Session | Issues | What changes |
| --- | --- | --- |
| 9 — Showcase | — | Logo, one short GIF per use case (dry run, uninstall, all-off preset, team mode), "who it is for" in the README |

Other open items: [#44](https://github.com/estebanmr99/lean-agents/issues/44) (`nvm install 24` helper), #56.

### Unscheduled

- [#45](https://github.com/estebanmr99/lean-agents/issues/45): update from verified pins (after session 18).
- [#46](https://github.com/estebanmr99/lean-agents/issues/46): installable CLI on npm, any OS.

## Later: 1.0.0

- Close the **VERIFY** items in `docs/compatibility.md` that need a logged-in app (Antigravity rule and skill loading, Copilot `model` format, VS Code reading Copilot CLI hooks).
- Codex CLI and Gemini CLI adapters.
- Tag `v1.0.0` and run the full launch in `docs/launch.md`.

## Promotion

Order matters: fix what a new visitor would hit first, then show it, then post.

1. **After 0.6.0:** Windows behind a proxy works end to end. Most first-time users will try exactly that path.
2. **After session 9:** the README shows each use case in a GIF, so a visitor sees it working in 10 seconds.
3. **Directories and lists (low effort, lasting):** open PRs to curated lists for Claude Code, OpenCode and MCP; keep the GitHub topics current.
4. **One write-up from real experience:** "Setting up coding agents on a corporate Windows PC behind a proxy". Issues #22, #25 and #28 are the material. Post it on dev.to or a blog and link the repo.
5. **Posts from `docs/launch.md`:** r/ClaudeAI, r/opencodecli, LinkedIn, X; Show HN at `v1.0.0`. Read each subreddit's self-promotion rules first.
6. **Measure:** check stars and `gh api repos/estebanmr99/lean-agents/traffic/views` a week after each step, and keep what worked.
