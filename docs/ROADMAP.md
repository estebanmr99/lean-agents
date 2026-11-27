# Roadmap

What comes next, in order. Each step is one build session in `docs/SPEC.md` section 14 and one PR. A step is done when its CI job with real binaries is green and its issues are closed.

Latest release: [`v1.2.3`](https://github.com/estebanmr99/lean-agents/releases/tag/v1.2.3) (2026-11-26, `--preflight`, quiet output, safer `--update`, no shell-mode child processes; the owner approves the tag). Earlier: [`v1.2.2`](https://github.com/estebanmr99/lean-agents/releases/tag/v1.2.2) (2026-11-26), [`v1.2.1`](https://github.com/estebanmr99/lean-agents/releases/tag/v1.2.1) (2026-11-25), [`v1.2.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v1.2.0) (2026-11-24), [`v1.1.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v1.1.0) (2026-11-23), [`v1.0.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v1.0.0) (2026-11-20), [`v0.8.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v0.8.0) (2026-11-12), [`v0.7.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v0.7.0) and [`v0.6.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v0.6.0) (2026-11-06, which raised the minimum Node to 22.20), and [`v0.5.0`](https://github.com/estebanmr99/lean-agents/releases/tag/v0.5.0) (2026-11-04).

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

Scope and order from the architecture checkpoint [`docs/checkpoints/0.7.0.md`](archive/checkpoints/0.7.0.md), accepted by the owner on 2026-11-06.

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

## 0.9.0 (folded into 1.0.0)

No 0.9.0 release was cut: its scope (the guided OpenCode 1.x to 2.x upgrade, [#80](https://github.com/estebanmr99/lean-agents/issues/80) part 2, and the 0.8.0 audit fixes) shipped in 1.0.0.

## On hold

| Session | Issues | What changes |
| --- | --- | --- |
| 9 — Showcase | — | Logo, one short GIF per use case (dry run, uninstall, all-off preset, team mode), "who it is for" in the README |

## 1.0.0

Details in `CHANGELOG.md` and [`audit-1.0.0.md`](archive/audit-1.0.0.md). Closed: the 0.8.0 audit issues ([#155](https://github.com/estebanmr99/lean-agents/issues/155) to [#169](https://github.com/estebanmr99/lean-agents/issues/169) except [#160](https://github.com/estebanmr99/lean-agents/issues/160)), [#181](https://github.com/estebanmr99/lean-agents/issues/181) and the review follow-ups. Code and docs are merged for these; they stay open for proof only the owner can give (see the audit, "Owner-only gates"):

- [#80](https://github.com/estebanmr99/lean-agents/issues/80) part 2: guided OpenCode 1.x to 2.x upgrade with `opencode1` side by side, permanent session backup, undo and rollback. Open: the work-PC trial ([#145](https://github.com/estebanmr99/lean-agents/issues/145)).
- [#179](https://github.com/estebanmr99/lean-agents/issues/179): fresh machine, `--everything` from a clean Mac or Windows PC, nightly CI. Open: fresh Mac and PC runs by the owner.
- [#180](https://github.com/estebanmr99/lean-agents/issues/180): install with the VS Code Copilot chat agent. Open: a logged-in run (`docs/vscode-agent-checklist.md`).
- [#182](https://github.com/estebanmr99/lean-agents/issues/182): release train: update plan, agent CLI upgrades inside a major, `--update --undo`, self-updaters off.
- [#160](https://github.com/estebanmr99/lean-agents/issues/160): npm publish through trusted publishing only. Open until the tag run proves it.
- Launch: run `docs/launch.md` after the tag.

## 1.1.0 (released 2026-11-23)

Details in `CHANGELOG.md` and [`audit-1.1.0.md`](archive/audit-1.1.0.md).

## 1.2.0 (released 2026-11-24)

Details in `CHANGELOG.md` and [`audit-1.2.0.md`](audit-1.2.0.md).

- [#407](https://github.com/estebanmr99/lean-agents/issues/407): own Code Mode MCP proxy core, PR 1 of 5 (groundwork: the installer does not use it yet).
- Codex CLI spike ([#432](https://github.com/estebanmr99/lean-agents/issues/432)): verdict go; manual CI workflow.
- CI guard: a PR that lowers the test count fails unless its body says why ([#443](https://github.com/estebanmr99/lean-agents/issues/443)).
- Repo cleanup and archive: finished audits, checkpoints and sessions stay in `docs/archive/`.
- Community basics: [Code of Conduct](../CODE_OF_CONDUCT.md) ([#429](https://github.com/estebanmr99/lean-agents/issues/429)); the social preview image is an owner step ([#442](https://github.com/estebanmr99/lean-agents/issues/442)).

## How the backlog empties

Every open issue has a milestone; an issue without one is untriaged. Releases ship small and often:

1. **Patch milestones hold at most 5 open issues.** A patch ships when all but `owner-step` issues are closed, `docs/audit-<version>.md` is written and CI is green on the tagged SHA. The owner approves each tag.
2. **New bugs go to the next patch milestone.** Only a p1 joins the current one.
3. **Spikes end in one PR with a verdict.** The spike issue closes and its follow-ups open as `agent-ready` issues in a milestone.
4. **At most 3 feature or fix PRs open at a time.** Dependabot adds at most one grouped PR per ecosystem per week.
5. **`owner-step` issues never block a patch.** They are listed in the release notes as pending owner steps.

## 1.2.3 (done)

[Milestone](https://github.com/estebanmr99/lean-agents/milestone/3), all closed: [#495](https://github.com/estebanmr99/lean-agents/issues/495), [#488](https://github.com/estebanmr99/lean-agents/issues/488), [#475](https://github.com/estebanmr99/lean-agents/issues/475), [#493](https://github.com/estebanmr99/lean-agents/issues/493), [#476](https://github.com/estebanmr99/lean-agents/issues/476), [#477](https://github.com/estebanmr99/lean-agents/issues/477). Audit: [docs/audit-1.2.3.md](audit-1.2.3.md). Also ships what is already on main: `--preflight`, quiet output with a per-run log, and `--update` asking nothing mid-run.

## 1.2.4 (next patch)

[Milestone](https://github.com/estebanmr99/lean-agents/milestone/4): [#492](https://github.com/estebanmr99/lean-agents/issues/492), [#490](https://github.com/estebanmr99/lean-agents/issues/490), [#460](https://github.com/estebanmr99/lean-agents/issues/460), [#465](https://github.com/estebanmr99/lean-agents/issues/465), [#486](https://github.com/estebanmr99/lean-agents/issues/486).

## 1.2.5

[Milestone](https://github.com/estebanmr99/lean-agents/milestone/6): [#505](https://github.com/estebanmr99/lean-agents/issues/505), [#506](https://github.com/estebanmr99/lean-agents/issues/506), [#507](https://github.com/estebanmr99/lean-agents/issues/507), [#508](https://github.com/estebanmr99/lean-agents/issues/508) (follow-ups found while building 1.2.3).

## Research (no release date)

[Milestone](https://github.com/estebanmr99/lean-agents/milestone/5): [#494](https://github.com/estebanmr99/lean-agents/issues/494), [#422](https://github.com/estebanmr99/lean-agents/issues/422), [#420](https://github.com/estebanmr99/lean-agents/issues/420), [#190](https://github.com/estebanmr99/lean-agents/issues/190).

## 1.3.0

- Benchmark v2 and publish: [prove the savings](https://github.com/estebanmr99/lean-agents/issues/404), [publish the result](https://github.com/estebanmr99/lean-agents/issues/430), [multi-agent vs solo](https://github.com/estebanmr99/lean-agents/issues/431), [harness benchmark](https://github.com/estebanmr99/lean-agents/issues/103).
- Multi-CLI orchestration: [one main session with visible worker status](https://github.com/estebanmr99/lean-agents/issues/428), [less slop in the coordinator](https://github.com/estebanmr99/lean-agents/issues/436).
- Code Mode proxy PRs 2 to 5 ([#407](https://github.com/estebanmr99/lean-agents/issues/407)): measurement, `--tools code-mode-proxy` in the installer, real-CLI checks, comparison with the native Code Modes.
- Codex CLI adapter, after the spike's VERIFY rows are proven ([#432](https://github.com/estebanmr99/lean-agents/issues/432)). Gemini CLI: no-go ([#433](https://github.com/estebanmr99/lean-agents/issues/433)); upstream made it enterprise-only on 2026-06-18 and Antigravity CLI covers individual accounts.
- [Launch](https://github.com/estebanmr99/lean-agents/issues/434) and [demo GIFs](https://github.com/estebanmr99/lean-agents/issues/435).
- Copilot CLI and Antigravity CLI as headless workers ([#469](https://github.com/estebanmr99/lean-agents/issues/469)).

## After 1.0.0

- [#103](https://github.com/estebanmr99/lean-agents/issues/103): harness benchmark and personal vs enterprise recommendation (needs an inference budget).
- Close the **VERIFY** items in `docs/compatibility.md` that need a logged-in app (Antigravity rule and skill loading, Copilot `model` format, VS Code reading Copilot CLI hooks).
- Open issues and why they do not gate 1.0: `audit-1.0.0.md`.

## Promotion

Order matters: fix what a new visitor would hit first, then show it, then post.

1. **Windows behind a proxy:** works end to end (done in 0.6.0). Most first-time users will try exactly that path.
2. **After session 9:** the README shows each use case in a GIF, so a visitor sees it working in 10 seconds.
3. **Directories and lists (low effort, lasting):** open PRs to curated lists for Claude Code, OpenCode and MCP; keep the GitHub topics current.
4. **One write-up from real experience:** "Setting up coding agents on a corporate Windows PC behind a proxy". Issues #22, #25 and #28 are the material. Post it on dev.to or a blog and link the repo.
5. **Posts from `docs/launch.md`:** r/ClaudeAI, r/opencodecli, LinkedIn, X; Show HN at `v1.0.0`. Read each subreddit's self-promotion rules first.
6. **Measure:** check stars and `gh api repos/estebanmr99/lean-agents/traffic/views` a week after each step, and keep what worked.
