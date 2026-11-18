# Audit 1.0.0

Release audit of lean-agents for 1.0.0 (branch `release-1.0.0`, main `3aee4a7` after PR #285, 2026-11-18). Format follows [audit-0.8.0](audit-0.8.0.md). Nothing in this audit was re-tested against real tools: every row below comes from `git log`, `gh issue` and `gh pr` output or from the repo files named in it. Where a claim could not be checked it says so.

## Summary

- **Since v0.8.0:** 246 commits on main, 79 pull requests merged after the v0.8.0 tag (#152 to #286, counted from merge commits), 46 issues closed since 0.8.0 (table below).
- **The 0.8.0 audit:** all 15 issues it filed ([#155](https://github.com/estebanmr99/lean-agents/issues/155) to [#169](https://github.com/estebanmr99/lean-agents/issues/169)) are closed except [#160](https://github.com/estebanmr99/lean-agents/issues/160) (npm OIDC proof, an owner gate). [#169](https://github.com/estebanmr99/lean-agents/issues/169) is closed: the issue records that the owner deprecated `0.0.0-stage` on npm.
- **Independent reviews:** nine so far (1 to 9) plus a final whole-repo review; reviews 1, 4, 5, 7, 8 and 9 are closed, 2, 3 and 6 are partly open, the final review ([#287](https://github.com/estebanmr99/lean-agents/issues/287)) is open (see below).
- **Open issues:** 20 (list below, each with a recommendation; the owner decides which ones gate the tag). [#287](https://github.com/estebanmr99/lean-agents/issues/287) holds two medium findings about undo data safety and is the one most likely to gate.
- **VERIFY:** 168 mentions in `docs/compatibility.md`, grouped below. None was closed in this release prep.
- **Owner-only gates:** npm OIDC proof ([#160](https://github.com/estebanmr99/lean-agents/issues/160)), the work-PC trial on [#145](https://github.com/estebanmr99/lean-agents/issues/145), and fresh Mac and PC runs of `--everything`.

## Method

- Closed issues: `gh issue list --state closed --search 'closed:>=2026-11-13'`, then `closedByPullRequestsReferences` per issue. Issues [#106](https://github.com/estebanmr99/lean-agents/issues/106), [#123](https://github.com/estebanmr99/lean-agents/issues/123) and [#132](https://github.com/estebanmr99/lean-agents/issues/132) were closed on 2026-11-13 by PRs that are already inside v0.8.0 (#137, #140), so they shipped in 0.8.0.
- Open issues: `gh issue list --state open`; the "why it does not gate" column is a recommendation from the issue text, not an owner decision.
- VERIFY items: counted per section of `docs/compatibility.md` with a line scan.
- Reviews: issue titles, bodies and the fix PRs or commits named in each issue.
- **Not checked:** CI status of every job at the tag, branch protection and npmjs.com settings (need admin access), the real tools on any machine.

## Findings and issues

### Closed since 0.8.0

| Issue | Title | Fixed by |
| --- | --- | --- |
| [#106](https://github.com/estebanmr99/lean-agents/issues/106) | Adopt a hand-built machine: inventory, back up, reinstall every tool on one Node, keep OpenCode 1.x sessions | [#140](https://github.com/estebanmr99/lean-agents/pull/140) |
| [#123](https://github.com/estebanmr99/lean-agents/issues/123) | Provider-based usage: show remaining Copilot premium-request allowance (OpenCode first) without spending a request | [#137](https://github.com/estebanmr99/lean-agents/pull/137) |
| [#132](https://github.com/estebanmr99/lean-agents/issues/132) | Doctor and adopt: duplicate skills across ~/.agents/skills and ~/.claude/skills on hand-built machines | [#140](https://github.com/estebanmr99/lean-agents/pull/140) |
| [#148](https://github.com/estebanmr99/lean-agents/issues/148) | Antigravity --uninstall removes same-named user skills | [#220](https://github.com/estebanmr99/lean-agents/pull/220) |
| [#155](https://github.com/estebanmr99/lean-agents/issues/155) | docs: SECURITY-REVIEW.md says Serena and plugins are unpinned; pins.json pins them by SHA | [#185](https://github.com/estebanmr99/lean-agents/pull/185) |
| [#156](https://github.com/estebanmr99/lean-agents/issues/156) | Bootstrap: undo-safe removal of the source clone (unpushed commits, LEAN_AGENTS_SRC) | [#191](https://github.com/estebanmr99/lean-agents/pull/191) |
| [#157](https://github.com/estebanmr99/lean-agents/issues/157) | Undo removes whole directories it did not fully create (~/.bun, OpenCode 2 vendor dir) | [#188](https://github.com/estebanmr99/lean-agents/pull/188) |
| [#158](https://github.com/estebanmr99/lean-agents/issues/158) | Engine: state.json written only after apply and commands; a mid-run failure leaves untracked files | [#187](https://github.com/estebanmr99/lean-agents/pull/187) |
| [#159](https://github.com/estebanmr99/lean-agents/issues/159) | Pin-bump PRs fail: agent-lifecycle test hardcodes the claude-code version (blocks #153) | [#183](https://github.com/estebanmr99/lean-agents/pull/183) |
| [#161](https://github.com/estebanmr99/lean-agents/issues/161) | README, ROADMAP and SPEC section 0 still describe 0.6.0/0.7.0 as current | [#185](https://github.com/estebanmr99/lean-agents/pull/185) |
| [#162](https://github.com/estebanmr99/lean-agents/issues/162) | Bootstrap checksum comes from the same release as the tarball: document the limit or add attestation | [#217](https://github.com/estebanmr99/lean-agents/pull/217) |
| [#163](https://github.com/estebanmr99/lean-agents/issues/163) | Child env allowlist passes GIT_*, NODE_OPTIONS and NPM_CONFIG_* values that can carry secrets | [#222](https://github.com/estebanmr99/lean-agents/pull/222) |
| [#164](https://github.com/estebanmr99/lean-agents/issues/164) | Tests: OpenCode 2 has no install-then-uninstall round trip test | [#225](https://github.com/estebanmr99/lean-agents/pull/225) |
| [#165](https://github.com/estebanmr99/lean-agents/issues/165) | ci-latest: record the "Actions may create pull requests" setting it depends on | [#217](https://github.com/estebanmr99/lean-agents/pull/217) |
| [#166](https://github.com/estebanmr99/lean-agents/issues/166) | Flaky CI: real-winget hits the GitHub API rate limit; macOS runners cancelled unacquired | [#230](https://github.com/estebanmr99/lean-agents/pull/230) |
| [#167](https://github.com/estebanmr99/lean-agents/issues/167) | README EN/ES: --home and ten other --help flags are undocumented | [#185](https://github.com/estebanmr99/lean-agents/pull/185) |
| [#168](https://github.com/estebanmr99/lean-agents/issues/168) | compatibility.md: lean-update v0.7.0 tag VERIFY is stale | [#185](https://github.com/estebanmr99/lean-agents/pull/185) |
| [#169](https://github.com/estebanmr99/lean-agents/issues/169) | npm: deprecate the 0.0.0-stage placeholder version | No PR: the owner deprecated `0.0.0-stage` on npm (`npm view` checked in the issue, 2026-11-18) |
| [#172](https://github.com/estebanmr99/lean-agents/issues/172) | --doctor prints proxy host, NO_PROXY and CA bundle path in the network env rows | [#186](https://github.com/estebanmr99/lean-agents/pull/186) |
| [#173](https://github.com/estebanmr99/lean-agents/issues/173) | --upgrade-agent opencode: wrong user-manual reasons and ambiguous names for 1.x plugins | [#195](https://github.com/estebanmr99/lean-agents/pull/195) |
| [#174](https://github.com/estebanmr99/lean-agents/issues/174) | --adopt: context-mode drift labels and duplicate rows mislead | [#196](https://github.com/estebanmr99/lean-agents/pull/196) |
| [#175](https://github.com/estebanmr99/lean-agents/issues/175) | --adopt misses Cursor hooks (~/.cursor/hooks.json) | [#198](https://github.com/estebanmr99/lean-agents/pull/198) |
| [#176](https://github.com/estebanmr99/lean-agents/issues/176) | --adopt: flag skills OpenCode loads twice (~/.claude/skills and ~/.agents/skills) | [#197](https://github.com/estebanmr99/lean-agents/pull/197) |
| [#178](https://github.com/estebanmr99/lean-agents/issues/178) | README EN/ES: make npx the primary install, scripts the fallback | [#185](https://github.com/estebanmr99/lean-agents/pull/185) |
| [#181](https://github.com/estebanmr99/lean-agents/issues/181) | Finish step: local HTML summary, login checklist and an agent verify prompt that files feedback issues | [#286](https://github.com/estebanmr99/lean-agents/pull/286) |
| [#184](https://github.com/estebanmr99/lean-agents/issues/184) | Pin test still hardcodes opencode-v2 and copilot-cli versions (pin-bump PRs will fail) | [#192](https://github.com/estebanmr99/lean-agents/pull/192) |
| [#189](https://github.com/estebanmr99/lean-agents/issues/189) | OpenCode 2: Copilot usage meter never refreshes after startup | [#232](https://github.com/estebanmr99/lean-agents/pull/232) |
| [#193](https://github.com/estebanmr99/lean-agents/issues/193) | real-cursor fails: cursor.com/install changed upstream (sha256 mismatch) | [#194](https://github.com/estebanmr99/lean-agents/pull/194) |
| [#199](https://github.com/estebanmr99/lean-agents/issues/199) | --adopt: Cursor RTK/GSD hooks labeled user, Claude's same hooks managed | [#200](https://github.com/estebanmr99/lean-agents/pull/200) |
| [#201](https://github.com/estebanmr99/lean-agents/issues/201) | --adopt / --upgrade-agent: OpenCode session count lost when the engine runs on Node < 22.13 (node:sqlite) | [#207](https://github.com/estebanmr99/lean-agents/pull/207) |
| [#202](https://github.com/estebanmr99/lean-agents/issues/202) | --adopt: Cursor GSD hook names garbled (`sessionStart:$(for n in `) | [#209](https://github.com/estebanmr99/lean-agents/pull/209) |
| [#203](https://github.com/estebanmr99/lean-agents/issues/203) | --upgrade-agent opencode: text rows lack the source file (opencode-dcp shows twice) | [#209](https://github.com/estebanmr99/lean-agents/pull/209) |
| [#204](https://github.com/estebanmr99/lean-agents/issues/204) | --adopt: npm pin compare treats pre-release versions as equal | [#215](https://github.com/estebanmr99/lean-agents/pull/215) |
| [#205](https://github.com/estebanmr99/lean-agents/issues/205) | CI flake: engine.test.mjs:712 proxy test fails when a temp path or timestamp contains 3128 | [#214](https://github.com/estebanmr99/lean-agents/pull/214) |
| [#206](https://github.com/estebanmr99/lean-agents/issues/206) | Cursor installer downloads its tarball without a checksum | [#217](https://github.com/estebanmr99/lean-agents/pull/217) |
| [#208](https://github.com/estebanmr99/lean-agents/issues/208) | lean.mjs run directly from a clone skips the Node 22.20 floor check | [#224](https://github.com/estebanmr99/lean-agents/pull/224) |
| [#211](https://github.com/estebanmr99/lean-agents/issues/211) | Windows: existing Antigravity CLI outside PATH is reported as missing | [#220](https://github.com/estebanmr99/lean-agents/pull/220) |
| [#213](https://github.com/estebanmr99/lean-agents/issues/213) | Independent review of #195-#209: hook-name, path and test-coverage follow-ups | [#221](https://github.com/estebanmr99/lean-agents/pull/221) |
| [#216](https://github.com/estebanmr99/lean-agents/issues/216) | Antigravity IDE and VS Code extension: detect, proxy env, refresh VERIFY rows (team pilot) | [#233](https://github.com/estebanmr99/lean-agents/pull/233) |
| [#218](https://github.com/estebanmr99/lean-agents/issues/218) | CI: Cursor installer sha256 changed again (real-cursor fails at download) | [#244](https://github.com/estebanmr99/lean-agents/pull/244) |
| [#235](https://github.com/estebanmr99/lean-agents/issues/235) | Independent review 4 follow-ups: hook ownership over-match, dcp test assertions, meter refresh guard, env-drop warning | [#237](https://github.com/estebanmr99/lean-agents/pull/237) |
| [#238](https://github.com/estebanmr99/lean-agents/issues/238) | Independent review 5 follow-ups: prereqs bun step dead code, spike job on every PR, probe robustness | [#240](https://github.com/estebanmr99/lean-agents/pull/240) |
| [#268](https://github.com/estebanmr99/lean-agents/issues/268) | Review 7 findings: opencode1 vs 2.x config, --uninstall after apply, nvm undo, --update --no-exec | [#272](https://github.com/estebanmr99/lean-agents/pull/272) |
| [#278](https://github.com/estebanmr99/lean-agents/issues/278) | Review 8 findings: update undo not wired and ordered wrongly, --json leaks outside-home paths, installer leftover | [#281](https://github.com/estebanmr99/lean-agents/pull/281) |
| [#282](https://github.com/estebanmr99/lean-agents/issues/282) | Review of #281 follow-ups: stale reinstall records, undo tests, --json with --undo | [#283](https://github.com/estebanmr99/lean-agents/pull/283) |
| [#284](https://github.com/estebanmr99/lean-agents/issues/284) | Review 9 findings: verify prompt consent/flags, vacuous N-1 proof, --auto-update on ignored, undo filter | [#285](https://github.com/estebanmr99/lean-agents/pull/285) |

Other work merged since 0.8.0 without a closing issue: PR [#171](https://github.com/estebanmr99/lean-agents/pull/171) (release audit gate), [#227](https://github.com/estebanmr99/lean-agents/pull/227) and [#228](https://github.com/estebanmr99/lean-agents/pull/228) (isolation proof, `real-dcp-v2`), the #80 part 2 steps [#243](https://github.com/estebanmr99/lean-agents/pull/243), [#247](https://github.com/estebanmr99/lean-agents/pull/247), [#254](https://github.com/estebanmr99/lean-agents/pull/254), [#258](https://github.com/estebanmr99/lean-agents/pull/258), [#265](https://github.com/estebanmr99/lean-agents/pull/265), the #179 steps [#236](https://github.com/estebanmr99/lean-agents/pull/236), [#241](https://github.com/estebanmr99/lean-agents/pull/241), [#246](https://github.com/estebanmr99/lean-agents/pull/246), [#250](https://github.com/estebanmr99/lean-agents/pull/250), [#259](https://github.com/estebanmr99/lean-agents/pull/259), [#260](https://github.com/estebanmr99/lean-agents/pull/260), [#269](https://github.com/estebanmr99/lean-agents/pull/269), the #180 steps [#249](https://github.com/estebanmr99/lean-agents/pull/249), [#264](https://github.com/estebanmr99/lean-agents/pull/264), [#266](https://github.com/estebanmr99/lean-agents/pull/266), [#273](https://github.com/estebanmr99/lean-agents/pull/273), [#279](https://github.com/estebanmr99/lean-agents/pull/279), the #182 steps [#239](https://github.com/estebanmr99/lean-agents/pull/239), [#256](https://github.com/estebanmr99/lean-agents/pull/256), [#263](https://github.com/estebanmr99/lean-agents/pull/263), [#274](https://github.com/estebanmr99/lean-agents/pull/274), [#277](https://github.com/estebanmr99/lean-agents/pull/277), [#280](https://github.com/estebanmr99/lean-agents/pull/280), the #181 steps [#275](https://github.com/estebanmr99/lean-agents/pull/275), [#276](https://github.com/estebanmr99/lean-agents/pull/276), [#286](https://github.com/estebanmr99/lean-agents/pull/286), and the CI changes [#242](https://github.com/estebanmr99/lean-agents/pull/242), [#257](https://github.com/estebanmr99/lean-agents/pull/257), [#261](https://github.com/estebanmr99/lean-agents/pull/261), [#267](https://github.com/estebanmr99/lean-agents/pull/267).

### Open issues left

| Issue | Title | Why it does not gate 1.0 (recommendation) |
| --- | --- | --- |
| [#287](https://github.com/estebanmr99/lean-agents/issues/287) | Final review findings: nvm undo scope, `--uninstall` after a failed undo, flag drift, parallel clean path | **May gate; owner decides.** Two medium findings on undo data safety (nvm undo can delete a Node with a user's global CLIs; `--uninstall` continues after a failed undo). Not fixed in this PR. |
| [#270](https://github.com/estebanmr99/lean-agents/issues/270) | Dry runs refuse while OpenCode runs and give no size (work-PC report) | Dry-run text only; the real apply path has its own checks. Fix in 1.0.x. |
| [#253](https://github.com/estebanmr99/lean-agents/issues/253) | Review 6 findings: `--everything` and installers, backup race | Item 1 and 4 fixed in [#255](https://github.com/estebanmr99/lean-agents/pull/255); the rest are low (issue labels it p2). The nvm undo part overlaps #287. |
| [#245](https://github.com/estebanmr99/lean-agents/issues/245) | Cursor installer pin has no auto-bump | CI maintenance; a Cursor release can break `real-cursor` until re-pinned, users keep the pinned installer. |
| [#229](https://github.com/estebanmr99/lean-agents/issues/229) | Review 3 follow-ups | Most items fixed in [#231](https://github.com/estebanmr99/lean-agents/pull/231); item 3 (Antigravity undo scope) needs the real skills CLI layout and is marked VERIFY. |
| [#226](https://github.com/estebanmr99/lean-agents/issues/226) | QA audit follow-ups: link-only skill plan, adopt child timeout, dry run starts opencode | Issue states no user-visible regression on main. |
| [#223](https://github.com/estebanmr99/lean-agents/issues/223) | Uninstall leaves empty directories behind | Cosmetic: no file is left behind. |
| [#219](https://github.com/estebanmr99/lean-agents/issues/219) | Review 2 follow-ups: stale pin text, build metadata in version compare, proxy test | Docs and test hygiene (p2); the proxy test part has its own fix in [#214](https://github.com/estebanmr99/lean-agents/pull/214). |
| [#212](https://github.com/estebanmr99/lean-agents/issues/212) | DCP runtime health | Health check ships ([#234](https://github.com/estebanmr99/lean-agents/pull/234), [#271](https://github.com/estebanmr99/lean-agents/pull/271)); the issue also asks for reconcile of existing pins, which is not done. |
| [#190](https://github.com/estebanmr99/lean-agents/issues/190) | Standalone OpenCode plugin for the Copilot usage meter | Feature in its own repo, optional. |
| [#182](https://github.com/estebanmr99/lean-agents/issues/182), [#180](https://github.com/estebanmr99/lean-agents/issues/180), [#179](https://github.com/estebanmr99/lean-agents/issues/179), [#80](https://github.com/estebanmr99/lean-agents/issues/80) | Release train, VS Code agent install, fresh machine, agent lifecycle | Code and docs are merged (PRs in the list above). They stay open for proof that CI cannot give: a logged-in VS Code agent run, fresh Mac and PC runs, the work-PC upgrade. Those are the owner gates below. |
| [#177](https://github.com/estebanmr99/lean-agents/issues/177) | `--doctor`: active Node vs project `engines.node`, npx path per app | Diagnostic row; no data at risk. |
| [#160](https://github.com/estebanmr99/lean-agents/issues/160) | npm release: OIDC trusted publishing unproven | **Owner gate.** `release.yml` is trusted-publishing only; the tag run is the proof. |
| [#147](https://github.com/estebanmr99/lean-agents/issues/147) | Antigravity install on macOS uses an unpinned brew cask | Homebrew cannot pin the cask; the installer prints the limit and asks first (recorded in the issue). |
| [#145](https://github.com/estebanmr99/lean-agents/issues/145) | Work PC: read-only `--adopt` inventory | **Owner gate** (work-PC trial). |
| [#103](https://github.com/estebanmr99/lean-agents/issues/103) | Research: harness benchmark | Research, needs an inference budget (issue comment). |
| [#78](https://github.com/estebanmr99/lean-agents/issues/78) | Orca: OpenCode 1.19 shows no status icons (work PC with Warp) | Not reproduced in CI; waits for the work PC. |

## VERIFY items still open

`docs/compatibility.md` carries 168 lines with **VERIFY** (counted from the file at this commit, per section; a line can hold several). Each item is a fact that no CI job proves yet. None blocks 1.0.0; the ones that need a logged-in app are listed in `docs/ROADMAP.md`.

| Section of `docs/compatibility.md` | VERIFY lines | First to last line |
| --- | --- | --- |
| Not yet verified | 46 | 472-531 |
| Verification log | 27 | 164-271 |
| Migration sources | 10 | 397-427 |
| Orca | 9 | 88-107 |
| Agent install and uninstall (`--install-agent`, `--uninstall-agent`) | 8 | 275-285 |
| Child environment allowlist | 7 | 356-367 |
| Pins and checksums | 6 | 298-308 |
| Windows | 5 | 41-47 |
| Staying on OpenCode 1.x | 5 | 113-122 |
| Permanent backup and frozen copy of the 1.x sessions (#80 part 2, P3, 2026-11-18) | 5 | 565-572 |
| Install with VS Code Copilot chat (#180, 2026-11-18) | 5 | 638-643 |
| npm package and release bootstrap | 4 | 447-458 |
| `opencode1` side by side (#80 part 2, P4, 2026-11-18) | 4 | 579-582 |
| Upgrade apply and `--undo` (#80 part 2, P6, 2026-11-18) | 4 | 591-598 |
| Warp | 3 | 72-76 |
| Plugin health (#212, 2026-11-18) | 3 | 626-629 |
| Login checks (#181 PR1, 2026-11-18) | 3 | 693-695 |
| What lean-agents does | 2 | 62-64 |
| Proxy and corporate CA | 2 | 345-346 |
| Isolation proof for `opencode1` (#80 part 2, P1) | 2 | 546-551 |
| OpenCode 1.x to 2.x: where things live | 2 | 613-614 |
| Gemini CLI (not supported) | 1 | 323-323 |
| Cursor: what CI proves today | 1 | 328-328 |
| Update plan (#182 PR2, 2026-11-18) | 1 | 657-657 |
| Fresh-machine workflow (#179 PR6, 2026-11-18) | 1 | 671-671 |
| Agent CLI upgrades within a major (#182 PR3, 2026-11-18) | 1 | 679-679 |
| Summary page (#181 PR3, 2026-11-18) | 1 | 683-683 |

The biggest groups are "Not yet verified" and "Verification log". Items that need a real login (Antigravity rule and skill loading, Copilot `model` format, VS Code reading Copilot CLI hooks, the VS Code agent run in `docs/vscode-agent-checklist.md`) cannot be closed in CI.

## Independent reviews

| Review | Issue | Findings | Fixed in |
| --- | --- | --- | --- |
| 1 | [#213](https://github.com/estebanmr99/lean-agents/issues/213) | Hook-name, path and test-coverage follow-ups for #195-#209 | [#221](https://github.com/estebanmr99/lean-agents/pull/221) |
| 2 | [#219](https://github.com/estebanmr99/lean-agents/issues/219) | Stale pin text, build metadata in version compare, proxy test partial leaks | Open; proxy test in [#214](https://github.com/estebanmr99/lean-agents/pull/214), build metadata in [#221](https://github.com/estebanmr99/lean-agents/pull/221) (commit `4cf7e85`) |
| 3 | [#229](https://github.com/estebanmr99/lean-agents/issues/229) | Vacuous round-trip skill coverage, floor-check bypass, Antigravity undo scope | [#231](https://github.com/estebanmr99/lean-agents/pull/231); item 3 stays open (VERIFY) |
| 4 | [#235](https://github.com/estebanmr99/lean-agents/issues/235) | Hook ownership over-match, DCP test assertions, meter refresh guard, env-drop | [#237](https://github.com/estebanmr99/lean-agents/pull/237) |
| 5 | [#238](https://github.com/estebanmr99/lean-agents/issues/238) | Prereqs Bun step dead code, spike job on every PR, probe robustness | [#240](https://github.com/estebanmr99/lean-agents/pull/240) |
| 6 | [#253](https://github.com/estebanmr99/lean-agents/issues/253) | `--everything` with `--migrate`, nvm undo, backup race and others | Items 1 and 4 in [#255](https://github.com/estebanmr99/lean-agents/pull/255); stray file in [#252](https://github.com/estebanmr99/lean-agents/pull/252); rest open |
| 7 | [#268](https://github.com/estebanmr99/lean-agents/issues/268) | opencode1 vs 2.x config, `--uninstall` after apply, nvm undo, `--update --no-exec` | [#267](https://github.com/estebanmr99/lean-agents/pull/267), [#272](https://github.com/estebanmr99/lean-agents/pull/272) |
| 8 | [#278](https://github.com/estebanmr99/lean-agents/issues/278) | Update undo not wired and ordered wrongly, `--json` leaks outside-home paths, installer leftovers | [#281](https://github.com/estebanmr99/lean-agents/pull/281); follow-ups [#282](https://github.com/estebanmr99/lean-agents/issues/282) in [#283](https://github.com/estebanmr99/lean-agents/pull/283) |
| 9 | [#284](https://github.com/estebanmr99/lean-agents/issues/284) | Verify prompt consent and flags, vacuous N-1 proof, `--auto-update` on ignored, undo filter | [#285](https://github.com/estebanmr99/lean-agents/pull/285) |
| Final (whole repo) | [#287](https://github.com/estebanmr99/lean-agents/issues/287) | No high finding; two medium (nvm undo scope, `--uninstall` after a failed undo) and low rows | Open |
| Data-safety (backup and upgrade, #80) | none (commit messages only, `Refs #80`) | Backup: node_modules in config check, count-copy space, pins path filter. Upgrade apply: journal every `opencode1` write, safe saves in rollback and undo, verify the frozen copy by content | `731c086` (in [#247](https://github.com/estebanmr99/lean-agents/pull/247)), `843fb00` and `284ffc1` (in [#258](https://github.com/estebanmr99/lean-agents/pull/258)); the finding text beyond the commit titles was not available to this audit |

## Owner-only gates

1. **npm OIDC proof ([#160](https://github.com/estebanmr99/lean-agents/issues/160)):** confirm the trusted publisher (repo, `release.yml`, environment `npm`) on npmjs.com; the tag run is the proof. Then delete the `NPM_TOKEN` secret if it still exists.
2. **Deprecate the placeholder ([#169](https://github.com/estebanmr99/lean-agents/issues/169)):** done. The issue records `0.0.0-stage` as deprecated; re-check with `npm view lean-agents@0.0.0-stage deprecated`.
3. **Work-PC trial ([#145](https://github.com/estebanmr99/lean-agents/issues/145)):** read-only `--adopt` and `--upgrade-agent opencode --dry-run` on the work PC with OpenCode 1.19.0 (never upgrade without the plan).
4. **Fresh-machine runs:** `--everything` on a clean Mac and a clean Windows PC ([#179](https://github.com/estebanmr99/lean-agents/issues/179)); `docs/fresh-machine.md` has the steps.
5. **Release gate inputs:** the audit gate needs no issue labeled `audit` open; the new gate needs the tagged commit on main with a green `ci.yml` run.

## Bot PRs

Open at this commit: [#149](https://github.com/estebanmr99/lean-agents/pull/149) and [#150](https://github.com/estebanmr99/lean-agents/pull/150) (artifact actions) and [#151](https://github.com/estebanmr99/lean-agents/pull/151) (`@clack/prompts` 1.9.0, a dependency change that needs the owner's yes). None was merged or reviewed here; the 0.8.0 audit's recommendation stands unchanged and was not re-checked.
