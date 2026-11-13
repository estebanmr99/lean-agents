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

## 0.7.0: trust what runs, then ship to npm

Scope and order from the architecture checkpoint [`docs/checkpoints/0.7.0.md`](checkpoints/0.7.0.md), accepted by the owner on 2026-11-06.

| Session | Issues | What changes |
| --- | --- | --- |
| 45 — Agent-first updates (done) | [#45](https://github.com/estebanmr99/lean-agents/issues/45) | `lean-update` skill, `--update` prints old -> new, daily pin-bump PR |
| 58 — 1-minute README (done) | [#58](https://github.com/estebanmr99/lean-agents/issues/58) | Short README EN and ES with a support matrix, enforced in CI |
| 59 — Architecture checkpoint | [#59](https://github.com/estebanmr99/lean-agents/issues/59) | One keep / change / spike per question; this scope |
| 69 — CI trust | [#69](https://github.com/estebanmr99/lean-agents/issues/69), [#70](https://github.com/estebanmr99/lean-agents/issues/70), [#56](https://github.com/estebanmr99/lean-agents/issues/56) | Actions pinned by SHA, least-privilege tokens, macOS jobs fixed or trimmed, one update channel, `ci-latest` green |
| 68 — File safety and redaction | [#68](https://github.com/estebanmr99/lean-agents/issues/68), [#67](https://github.com/estebanmr99/lean-agents/issues/67), [#74](https://github.com/estebanmr99/lean-agents/issues/74), [#72](https://github.com/estebanmr99/lean-agents/issues/72) | No symlink or out-of-home writes, more token formats redacted, child env allowlist, doctor obeys the network preset |
| 71 — Contributor and governance docs | [#71](https://github.com/estebanmr99/lean-agents/issues/71), [#73](https://github.com/estebanmr99/lean-agents/issues/73) | Dev setup, adapter path, `SECURITY.md`, PR template, `CODEOWNERS` |
| 79 — OpenCode 1.x safety and Orca | [#79](https://github.com/estebanmr99/lean-agents/issues/79), [#78](https://github.com/estebanmr99/lean-agents/issues/78) | Never cross OpenCode 1.x to 2.x, warn about session loss; Orca status icons on OpenCode 1.19 |
| 107 — Context Mode MCP starts with server | [#107](https://github.com/estebanmr99/lean-agents/issues/107) | `core/mcp.json` registers Context Mode with the server subcommand |
| 108 — One update channel (done) | [#108](https://github.com/estebanmr99/lean-agents/issues/108) | The pin-bump PR from `ci-latest` is the only update channel; `version-watch` workflow removed |
| 93 — migrate owned-file check | [#93](https://github.com/estebanmr99/lean-agents/issues/93) | Owned-file check matches the mark only where it belongs |
| 64 — Pin and verify downloaded code | [#64](https://github.com/estebanmr99/lean-agents/issues/64), [#66](https://github.com/estebanmr99/lean-agents/issues/66), [#75](https://github.com/estebanmr99/lean-agents/issues/75) | Serena, Context Mode, ponytail, Warp and the Bun installer pinned and checked |
| 50 — Pin bumps | [#50](https://github.com/estebanmr99/lean-agents/issues/50), [#51](https://github.com/estebanmr99/lean-agents/issues/51), [#52](https://github.com/estebanmr99/lean-agents/issues/52) | orca-cli, gsd-core, playwright-mcp |
| 44 — Context Mode on Node < 24.15 | [#44](https://github.com/estebanmr99/lean-agents/issues/44), [#104](https://github.com/estebanmr99/lean-agents/issues/104) (points 1 to 3) | Install Node 24 via nvm, or skip Context Mode; engines check, `node` field per pin, nvm Node with absolute registration |
| 65 — How you get it | [#65](https://github.com/estebanmr99/lean-agents/issues/65), [#46](https://github.com/estebanmr99/lean-agents/issues/46) | Bootstraps default to the release tag; `npx lean-agents` from npm |
| Archive done sessions | — | Finished session blocks move out of `docs/SPEC.md` |

## 0.8.0 (done)

- [#80](https://github.com/estebanmr99/lean-agents/issues/80) part 1: optional agent install and uninstall, `--migrate` to and from Antigravity, `--upgrade-agent opencode` dry run and the `lean-migrate` skill.
- [#60](https://github.com/estebanmr99/lean-agents/issues/60): the multi-agent coordinator workflow as an opt-in playbook.
- [#104](https://github.com/estebanmr99/lean-agents/issues/104) points 4 and 5: Node runtime per tool in `--doctor`.
- [#106](https://github.com/estebanmr99/lean-agents/issues/106), [#132](https://github.com/estebanmr99/lean-agents/issues/132): adopt a hand-built machine (inventory, back up, one Node, undo, keep OpenCode 1.x sessions).
- [#124](https://github.com/estebanmr99/lean-agents/issues/124), [#123](https://github.com/estebanmr99/lean-agents/issues/123), [#130](https://github.com/estebanmr99/lean-agents/issues/130), [#78](https://github.com/estebanmr99/lean-agents/issues/78) (Windows shim).

## 0.9.0

- [#80](https://github.com/estebanmr99/lean-agents/issues/80) part 2: guided OpenCode 1.x to 2.x upgrade with `opencode1` side by side, permanent session backup and undo. Needs a new plan: 2.x migrates the shared 1.x db in place (`docs/compatibility.md`).
- [#103](https://github.com/estebanmr99/lean-agents/issues/103).

## On hold

| Session | Issues | What changes |
| --- | --- | --- |
| 9 — Showcase | — | Logo, one short GIF per use case (dry run, uninstall, all-off preset, team mode), "who it is for" in the README |

## Later: 1.0.0

- [#103](https://github.com/estebanmr99/lean-agents/issues/103): harness benchmark and personal vs enterprise recommendation (later).
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
