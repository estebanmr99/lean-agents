# Audit 0.8.0

Read-only audit of lean-agents at v0.8.0 (main `012fb11`, 2026-11-13). Nothing was fixed in this audit: every medium or higher row is a labeled issue for **0.9.0**, linked below. Format and severity scale follow [audit-2026-11](audit-2026-11.md).

## Summary

- **Findings:** 1 high, 20 medium, 39 low, filed as 15 issues (related rows share one issue).
- **The high row:** `docs/SECURITY-REVIEW.md` understates pinning: Serena and the Claude plugins are pinned by commit SHA in `core/pins.json`, but the review says they are not (S1, *verified*).
- **Data-loss risks (medium):** bootstrap removal of a clean clone (S3), undo removing whole directories (S4, S5), `state.json` written only after a full run (C1).
- **Release:** the v0.8.0 CI publish failed with `EOTP`; OIDC trusted publishing is not proven yet (P3, P4).
- **Docs:** README, ROADMAP and SPEC section 0 still describe 0.6.0/0.7.0 as current (D4-D6).
- **Tests:** `npm test` passes: 294 pass, 2 skipped, 27 s on macOS.

## Method

- Five read-only workers, one per area, in parallel: security (W1), pipelines (W2), README and docs (W3), code and tests (W4), repo health (W5). Each wrote a report; none edited tracked files.
- Workers ran `npm test`, `node scripts/lint-workflows.mjs`, `node scripts/check-readme.mjs`, `bash scripts/check-private.sh`, `node scripts/lean.mjs --help`, and read `gh run`, `gh pr`, `gh issue` and `npm view` output. Engine runs used a temp `--home` with `--no-exec`.
- Rows marked *spot-checked* were re-read by the worker. Every high row was re-checked by the orchestrator against the cited lines and marked *verified*.
- **Severity:** high = wrong claim to users or code run without a pin or consent; medium = real gap with a clear fix; low = polish.

## Findings and issues

- S1: [docs: SECURITY-REVIEW.md says Serena and plugins are unpinned; pins.json pins them by SHA](https://github.com/estebanmr99/lean-agents/issues/155)
- S3: [Bootstrap: undo-safe removal of the source clone (unpushed commits, LEAN_AGENTS_SRC)](https://github.com/estebanmr99/lean-agents/issues/156)
- S4, S5: [Undo removes whole directories it did not fully create (~/.bun, OpenCode 2 vendor dir)](https://github.com/estebanmr99/lean-agents/issues/157)
- C1: [Engine: state.json written only after apply and commands; a mid-run failure leaves untracked files](https://github.com/estebanmr99/lean-agents/issues/158)
- P1: [Pin-bump PRs fail: agent-lifecycle test hardcodes the claude-code version (blocks #153)](https://github.com/estebanmr99/lean-agents/issues/159)
- P3, P4: [npm release: EOTP on v0.8.0 run, OIDC trusted publishing unproven](https://github.com/estebanmr99/lean-agents/issues/160)
- D4, D5, D6: [README, ROADMAP and SPEC section 0 still describe 0.6.0/0.7.0 as current](https://github.com/estebanmr99/lean-agents/issues/161)
- S2: [Bootstrap checksum comes from the same release as the tarball: document the limit or add attestation](https://github.com/estebanmr99/lean-agents/issues/162)
- S6: [Child env allowlist passes GIT_*, NODE_OPTIONS and NPM_CONFIG_* values that can carry secrets](https://github.com/estebanmr99/lean-agents/issues/163)
- C6: [Tests: OpenCode 2 has no install-then-uninstall round trip test](https://github.com/estebanmr99/lean-agents/issues/164)
- P2: [ci-latest: record the "Actions may create pull requests" setting it depends on](https://github.com/estebanmr99/lean-agents/issues/165)
- P6, P7: [Flaky CI: real-winget hits the GitHub API rate limit; macOS runners cancelled unacquired](https://github.com/estebanmr99/lean-agents/issues/166)
- D1, D2: [README EN/ES: --home and ten other --help flags are undocumented](https://github.com/estebanmr99/lean-agents/issues/167)
- D8: [compatibility.md: lean-update v0.7.0 tag VERIFY is stale](https://github.com/estebanmr99/lean-agents/issues/168)
- R1: [npm: deprecate the 0.0.0-stage placeholder version](https://github.com/estebanmr99/lean-agents/issues/169)

## Security and installers (W1)

| ID | Sev | Area | Evidence | Fix | Issue |
| --- | --- | --- | --- | --- | --- |
| S1 | high (*verified*) | docs claim | `docs/SECURITY-REVIEW.md:75-80` table says Serena is "Not pinned / default branch", the Ponytail plugin and marketplaces are "latest from their source", and skill sources are `owner/repo#<tag>`. `core/pins.json:19-22` pins Serena to a commit SHA, `ponytail-plugin` and `context-mode-plugin` by tag+sha; skills pin to a SHA (`scripts/lib/pins.mjs:15-19`). The file is the prompt a company reviewer feeds to its agent, so it misreports the supply chain (*spot-checked*) | Regenerate the pinned/not-pinned table from `core/pins.json`; add a test like `pins-coverage` that fails when a pin key is missing from the doc | #155 |
| S2 | medium | bootstrap | `install.sh:100-116`, `install.ps1:121-125`: `SHA256SUMS` and the tarball come from the same release URL, so the checksum guards corruption, not a tampered release or a compromised account. No signature or attestation is checked (release.yml `npm publish --provenance` covers npm only). Docs should not call it "verified" in a supply-chain sense (*spot-checked*) | State the limit in README/`manual-install.md`; publish a GitHub artifact attestation and check it, or print the expected hash for `LEAN_AGENTS_VERSION` pinning (W6 in the earlier audit is the same gap) | #162 |
| S3 | medium | bootstrap | `install.sh:84-92`, `install.ps1:94-101`: a clean git clone at `$SRC` is `rm -rf`'d. `git status --porcelain` clean does not mean no unpushed commits, branches or stashes, and `LEAN_AGENTS_SRC` can point at the owner's own dev clone (it has `scripts/lean.mjs`) (*spot-checked*) | Also refuse when `git -C $SRC log @{u}..` is non-empty or no upstream exists, or just refuse any `.git` and tell the user to move it | #156 |
| S4 | medium | engine undo | `scripts/lib/system.mjs:144,163-165`: Linux/Windows Bun undo runs `rmSync(~/.bun, {recursive})`. Install runs when `bun` binary is absent (`bunPresent` checks only `.bun/bin/bun`), but `~/.bun` may hold the user's install cache or global packages; uninstall deletes all of it (*spot-checked*) | Undo removes only `~/.bun/bin/bun` (and the dir if empty), as `agent-lifecycle` does with recorded files | #157 |
| S5 | medium | engine undo | `scripts/lib/adapters/opencode-v2.mjs:117`: undo `rmSync(vendor, {recursive, force})` of a derived path with no `unsafe()`/inside-home check at undo time; relies on the path computed at install. A hand-edited `state.json` is trusted | Re-derive and assert the path is under the home before removing, or go through `fsops.unsafe` | #157 |
| S6 | medium | env | `scripts/lib/network.mjs:40-42`: allowlist passes whole prefixes `GIT_`, `NODE_`, `NPM_CONFIG_`, `UV_`, plus `NODE_OPTIONS`. `GIT_CONFIG_VALUE_*` (extraheader with a token), `GIT_ASKPASS`, `GIT_SSH_COMMAND` and `NODE_OPTIONS=--require` are not caught by `SECRET_NAME` (line 31) when the secret is in the value. `docs/privacy.md:52` says "API keys and cloud credentials never reach" children (*spot-checked*) | Drop `GIT_CONFIG_*`, `GIT_ASKPASS`, `NODE_OPTIONS` or scrub values that look like tokens; soften the sentence | #163 |
| S7 | low | engine | `scripts/lib/parallel.mjs:166-167` (still open, was S16): orca output written to `log` with default mode and no redaction; `parallel.mjs:104-105,121-131` state, prompt and status files also default mode (*spot-checked*) | Use `writePrivate`/`privateDir` from fsops and `redactText` on the log | - |
| S8 | low | engine | `scripts/lib/system.mjs:18,168,173` (still open, was S18): `shell: true` on Windows for `.cmd` shims joins args unescaped; paths with `&` or `%` from `--home` break or inject (*spot-checked*) | Quote args for cmd or call `node <cli.js>` directly like `adopt.mjs` does for npm | - |
| S9 | low | engine | `scripts/lib/agent-lifecycle.mjs:75,89-98`: `inside()` is lexical. A recorded file under a symlinked parent dir inside home passes `inside` and `lstat` on the leaf only, so `unlinkSync` can delete through a parent link (needs a user-made link plus a hash match, so low) | Use `fsops.unsafe(f.path, [home])` before the unlink | - |
| S10 | low | engine | `scripts/lib/adopt.mjs:52-58`: copies the user's OpenCode DBs (sessions, may hold secrets) into `os.tmpdir()/lean-adopt-*` (mkdtemp is 0700, ok) but the copy is not wiped on a crash before `finally`; also whole DB read into a copy of unbounded size (`dbBytes` is measured, not capped) | Cap size or open read-only in place with `?immutable=1`; document | - |
| S11 | low | bootstrap | `install.sh:62`/`install.ps1:87`: `npm ci` for a local checkout still runs without `--ignore-scripts` (was S4, still low, not marked Fixed). Deps are two pinned packages with no install scripts | Add `--ignore-scripts` (cheap) | - |
| S12 | low | bootstrap | `install.sh:103-111`: `LEAN_AGENTS_DIST` accepts any https URL and only warns; the checksum then comes from the same attacker-chosen host. CI and mirrors need it, but nothing makes the user confirm on a TTY | Require an extra `--allow-dist` or an interactive confirm when stdin is a TTY | - |
| S13 | low | workflows | `.github/workflows/ci-latest.yml:64-94`: `bump-pins` runs `scripts/bump-pins.mjs` (repo code) with `contents: write`, `pull-requests: write`, `actions: write` and the token in env, then pushes with it in the remote URL. Code runs from `main` only (schedule/dispatch), so risk is a merged malicious change, not a PR | Split: run bump-pins.mjs in a read-only job, upload `core/pins.json`, push in a second job; use `git -c http.extraheader` or `gh` credential helper instead of a token in the URL | - |
| S14 | low | workflows | `.github/workflows/release.yml:4-5,36-49`: any `v*` tag push by someone with write access builds and creates a GitHub release; `publish` has no `environment:` gate (only the npm job has). No check that the tag commit is on `main` (`release.mjs:33` only compares version to package.json) | Add a step that `git merge-base --is-ancestor $GITHUB_SHA origin/main` and put the release job behind an environment with a reviewer | - |
| S15 | low | workflows | `release.yml:70-74`: npm publish job passes `NODE_AUTH_TOKEN: secrets.NPM_TOKEN` alongside `id-token: write`; comment says the secret is emptied after the first publish. Not enforced | Remove the secret reference once the trusted publisher is configured; confirm on npmjs.com (not checked) | - |
| S16 | low | pins | `scripts/verify-pins.mjs:14-23` checks npm `dist.integrity` and tag SHAs, but not `kind: download` pins (Bun, agent installers: sha256 in `pins.json`/`tests/ci-downloads.json`) against upstream, and tests/ci-downloads.json duplicates bun hashes by hand | Add a test that `ci-downloads.json` bun entries equal `pins.json` (note says "must match"; confirm it is tested) | - |
| S17 | low | docs | `docs/SECURITY-REVIEW.md:112`, `docs/privacy.md:28-32` assume Windows OpenCode 2 tarball is unchecked; still open and honestly stated, listed so it is tracked next to issues #147 and #148 (not re-filed) | none beyond #147/#148 | - |

## Pipelines (W2)

| ID | Sev | Area | Evidence | Fix | Issue |
| --- | --- | --- | --- | --- | --- |
| P1 | medium | pin-bump PRs | PR #153 (runs 43449143965, 43449138337): `test (ubuntu/macos)` fail, `tests/agent-lifecycle.test.mjs:27` ("dry run prints the pinned plan") asserts `/claude-installer\.sh 2\.1\.312/`, hardcoded; the bump moves claude-code to 2.1.314. Every claude-code bump PR will fail the same way (*spot-checked*) | Build the regex from `core/pins.json` instead of a literal | #159 |
| P2 | medium | ci-latest | 9 of 13 runs failed. Runs 42377684313, 42487146323, 42659373208, 42842428289 (11-07..11-10): `bump-pins` "GitHub Actions is not permitted to create or approve pull requests"; 11-06 runs 42263726117, 42264723834 and 42927547124: forced-failure test and real-winget. Last run 43447496789 (11-13) succeeded and opened #153, so the setting was fixed, but nothing records it (*spot-checked*) | Note the repo setting (Settings > Actions > allow PR creation) in `docs/compatibility.md` or branch-protection doc; keep failure-issue reporting | #165 |
| P3 | medium | release npm | Run 43360753847 (v0.8.0): `npm` job failed `EOTP` after "Signed provenance statement... published to transparency log" (logIndex 3845258591), so a provenance entry exists for a publish that did not complete. docs/compatibility.md:435 says CI failed twice, owner published locally; only one failed release run exists, so the second attempt is not in `release.yml` history (*spot-checked*) | Record the sigstore entry in compatibility.md; after the trusted publisher is set, republish proof via a patch release | #160 |
| P4 | medium | release npm | OIDC trusted publishing unproven: `release.yml` npm job still passes `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`, and compatibility.md:441-442 lists OIDC as VERIFY. The package was published locally, so the 0.8.0 tarball on npm has no CI provenance | Set the trusted publisher, delete `NPM_TOKEN`, run 0.9.0 and mark VERIFY done only with that run id | #160 |
| P5 | low | release npm | npm job needs `vars.NPM_PUBLISH == 'true'` and a reviewer; no workflow warns when it was skipped, so a release can finish green with nothing on npm | Add a step summary line when skipped | - |
| P6 | medium | ci flaky | `real-winget` failed twice on GitHub API rate limit (run 43348445140 on main: "API rate limit exceeded"; also 42264723834). Job fetches winget without a token | Pass `GITHUB_TOKEN` to the winget install step, or retry once | #166 |
| P7 | medium | ci flaky | macOS arm64 capacity: run 43249931041 (ci-latest 11-12), jobs `real-copilot`, `real-vscode`, `package` (macos-latest) cancelled after 16 min, annotation "job was not acquired by Runner of type hosted". The next ci-latest (43447496789) passed, so no rerun done | Accept as infra; add `timeout-minutes` on queue wait is not possible, so consider `continue-on-error` or an auto-retry for the daily run only | #166 |
| P8 | low | ci cancels | 5 of 30 ci runs cancelled by `cancel-in-progress` after a newer push (43351766981, 43351768220, 43352217951 on PRs; 43354467938, 43354537236 on main push). Cancelling main pushes hides a failed main check | Set `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` | - |
| P9 | low | ci lint | session-80b0 branch runs 43350726437, 43351795238, 43352937372: `lint / shellcheck` failed SC2016, then test 44 (the ci.yml rules test) failed. Fixed on that branch; caught pre-merge, so CI works as intended | None | - |
| P10 | low | ci | `real-claude` run 43352217951: exit code 127 on the branch (command not found); not reproduced on main, one-off | None | - |
| P11 | low | jobs not on PRs | `spike-opencode-side` (ci.yml:470) runs only on `workflow_dispatch`; `bench-code-nav.yml` is dispatch only (2 runs, both OK); `ci-latest` and `models-refresh` are schedule only. Every other ci.yml job runs on PRs when `changes.code == 'true'`; docs-only PRs skip all real-* jobs by design | None; a spike job on dispatch only is documented in its comment | - |
| P12 | low | models-refresh | One run ever (41321649999, 11-01), monthly cron `0 9 1 * *`. Next run 2026-12-01; the 2026-11 run was 12 days ago and succeeded in 0.2 min. Issue-opening path untested in production (*spot-checked*) | None | - |
| P13 | low | stale audit row | docs/audit-2026-11.md W1 ("all `uses:` are tags, zero SHA pins") and W2/W6 no longer hold: every `uses:` in `.github/workflows` is a 40-char SHA except local ones; release.yml has `permissions: contents: read` plus a separate write job and `SHA256SUMS`. Not edited here (*spot-checked*) | Mark W1, W2, W6 "Fixed in #<pr>" in the audit doc | - |
| P14 | low | ci-latest.test | `tests/ci-latest.test.mjs` covers bump, held pins, `ciOnly` pins, report issue dedupe, ci.yml timeouts, docs-only check, latest-pins use in real-*/bench-* jobs, and branch-protection job names. No rule for the dispatched pin-bump CI run, the `pull request create` permission, or that `release.yml` actions stay SHA-pinned | Add a test that every `uses:` is a SHA except `./`; add the PR-permission note | - |
| P15 | low | release | `release` job order: `publish` (GitHub release) runs without waiting for `npm`, so a failed `npm` job (43360753847) leaves a release marked failed while the GitHub release exists | Intended; mention in release checklist | - |

## README and docs (W3)

| ID | Sev | Area | Evidence | Fix | Issue |
| --- | --- | --- | --- | --- | --- |
| D1 | medium | readme-flags | `--home` has zero hits in `README.md` and `README.es.md`. It is the safety flag: `node scripts/lean.mjs --help` says "Always pass --home to try it" (help line 42). Nothing in the user docs mentions it (*spot-checked*) | Add `--home` to the "Useful flags" line, `README.md:163` and `README.es.md:163` | #167 |
| D2 | medium | readme-flags | Help flags absent from both READMEs (0 hits each): `--gh`/`--no-gh` (help line 20), `--bun`/`--no-bun` (27), `--no-tools` (9), `--ponytail-mode` (34), `--adhd-always` (33), `--feedback-draft`/`--feedback-kind`/`--failed-command` (21-23). Check made with `node scripts/lean.mjs --help` plus grep (*spot-checked*) | Document them, or add a short "All flags: `--help`" table to both READMEs | #167 |
| D3 | low | readme-profiles | README names 3 of 8 profiles (`vertex-gemini`, `github-copilot`, `antigravity`). `anthropic-api`, `claude-subscription`, `openai-api` and `opencode-go` exist in `profiles/` and appear in no README (only in `docs/compatibility.md`, `docs/parallel-sessions.md`, `docs/SPEC.md`) | List all profiles or link `profiles/README.md`, in both languages | - |
| D4 | medium | readme-roadmap | `README.md:441` says the last release is `v0.6.0`, and `README.md:442` lists "installable CLI on npm" as on hold. Yet `README.md:155` already tells users `npx lean-agents@latest`, and `npm view lean-agents version` returns `0.8.0`. Mirror in `README.es.md:441-442` | Add the 0.7.0 and 0.8.0 entries; tick the npm item | #161 |
| D5 | medium | docs-roadmap | `docs/ROADMAP.md:5` says `v0.6.0` "is done and waits for the owner's tag". `git tag` lists `v0.6.0`, `v0.7.0` and `v0.8.0`, and `CHANGELOG.md:7` has `[0.8.0] - 2026-11-12` (*spot-checked*) | Rewrite the "Released" line to name 0.8.0 as the latest tag | #161 |
| D6 | medium | docs-spec | `docs/SPEC.md:36-37` (section 0, under "Current state") says 0.7.0 "is built ... the owner tags it" and "Next is 0.8.0". The tags exist, `CHANGELOG.md:7` is 0.8.0, `package.json:3` is 0.8.0, and `docs/ROADMAP.md:47` says "0.8.0 (done)" (*spot-checked*) | Rewrite section 0 to: 0.8.0 released 2026-11-12; next step is the first open item in section 14 | #161 |
| D7 | low | docs-version | `README.md:153`, `README.es.md:153`: `LEAN_AGENTS_VERSION=0.7.0` as the pin example. Same in `install.sh:9` and `install.ps1:8` comment headers. Current is 0.8.0. The example still works (the tag exists), so this is stale rather than wrong (*spot-checked*) | Change the example to `0.8.0` in all four places (the scripts are outside W3; flag only) | - |
| D8 | medium | docs-compat | `docs/compatibility.md:287` says the `lean-update` pin `v0.7.0` "does not exist before the release"; `:505` says "the tag must exist before a real install works" and asks to **VERIFY** after the tag. `git tag` shows `v0.7.0` exists; `core/pins.json:13` pins it (*spot-checked*) | Record that the tag exists, and run the tagged-form check (`skills add ...#v0.7.0 --skill lean-update`) so the VERIFY can close | #168 |
| D9 | low | docs-links | `CONTRIBUTING.md:45`: anchor `#7-third-party-tools-tools-tool` does not match the heading slug of `docs/SPEC.md:356` (`## 7. Third-party tools (`tools/<tool>/`)`, GitHub slug `7-third-party-tools-toolstool`). The link lands at the top of SPEC. `SECURITY.md:25` uses the correct slug (*spot-checked*) | Change to `#7-third-party-tools-toolstool` | - |
| D10 | low | docs-verify-age | `docs/compatibility.md` has about 70 VERIFY lines with no date of their own, for example `:483-488` ("session 11") and the "Not yet verified" section at `:451`. `git blame` dates `:483-486` and `:488` to 2026-11-03 (10 days) and `:487` to 2026-11-05. No dated VERIFY row is older than 30 days. The 30-day rule cannot be checked per row | Add a date to each VERIFY row, or to each section header | - |
| D11 | low | readme-flags | `scripts/lean.mjs:108` `--no-exec` is used by AGENTS.md and the tests but is missing from `--help`. `scripts/lean.mjs:122` silently accepts `--skip-agents` and `--no-admin` as no-ops | List `--no-exec` in help; document or drop the no-op flags | - |

## Code and tests (W4)

| ID | Sev | Area | Evidence | Fix | Issue |
| --- | --- | --- | --- | --- | --- |
| C1 | medium | engine, data loss | `scripts/lean.mjs:535` `apply()` writes files in a loop (`fsops.mjs:236-255`) and returns entries only at the end; `state.json` is written later at `lean.mjs:576`, after commands run. An error mid-loop (EACCES, disk full) or Ctrl-C during `commands` leaves written files with no state, so `--uninstall` cannot undo them (*spot-checked*) | Write state incrementally (or in a `finally`) with the entries applied so far | #158 |
| C2 | low | engine, undo | `fsops.mjs:279-281`: `block` entry for a file lean-agents created, edited by the user, leaves an empty file after `removeBlock` instead of removing it (the `json` branch does remove, `:272-276`) | Remove the file when `created` and the result is empty | - |
| C3 | low | engine, undo | `fsops.mjs:257-289`: `undo()` has no try/catch per entry; one failing write aborts the rest and later entries stay installed (state.json is kept, so a rerun works) | Catch per entry, report `failed`, continue | - |
| C4 | low | dead code | Exports with no caller in `scripts/` or `tests/`: `adopt.mjs` `adoptPlan`, `adoptApply`, `adoptUndo`, `opencodeInfo` (the test says apply/undo are "not in this release yet"); `agent-lifecycle.mjs` `diffSnapshots`, `removeRecorded`; `parallel.mjs` (lib) `TIERS`, `orcaAvailable`, `pickAgent`, `display`, `repoInfo`, `loadWorkers`, `statusOf`; `terminals.mjs` `TERMINALS`, `orcaHooksFound`; `upgrade.mjs` `installVia`; `adhd.mjs` `setInvocable`; `copilot-usage.mjs` `formatUsage`; `doctor.mjs` `resolvedOpenCodeConfig`; `feedback.mjs` `feedbackAllowed`; `gsd.mjs` `gsdProfileName`; `migrate.mjs` `hasContent`; `network.mjs` `scrubValue`; `node-runtime.mjs` `nodeAt`; `pins.mjs` `pinInUse`; `unverified.mjs` `notesDir`, `redactNotes`; `opencode-v1.mjs` `LeanOrcaStatusShim` (grep by name, may be used in-module; only the `export` keyword may be dead) | Drop `export` or delete per item; keep `adopt*` if the planned release uses them | - |
| C5 | low | duplicated helpers | Two sha256 helpers: `fsops.mjs:19` `sha(text)` and `verify-sha256.mjs:7` `sha256(file)`, plus `agent-lifecycle.mjs:69,92` using the file one; different inputs, so a thin duplicate of `crypto.createHash` only | Optional: have `verify-sha256` reuse `fsops.sha` | - |
| C6 | medium | tests, adapters | No per-adapter test file; coverage is spread over `tests/engine.test.mjs` (1300+ lines). Install + uninstall round trips exist for Claude (`engine.test.mjs:93`), OpenCode 1.x (`:135`), Copilot CLI and Antigravity (`:226`), VS Code Copilot (`:781`), Cursor (`:857`). OpenCode v2 has no dedicated "install then uninstall leaves HOME identical" test in the list I found (only mixed tests, e.g. `:1328`) | Add one table-driven test: each adapter, all tools, install then `--uninstall` and assert the temp HOME tree equals the pre-install snapshot (ignoring `.lean-agents` backups) | #164 |
| C7 | low | tests, undo | `fsops` action kinds `file`, `json`, `block` each have undo tests (`engine.test.mjs:93,179,1101`, `tests/fsops-arrayadd.test.mjs`, `tests/file-safety.test.mjs`); I did not find a test for C2 (user-edited created block file) or for C3 | Add after fixing | - |
| C8 | low | speed | `npm test`: 296 tests, 294 pass, 0 fail, 2 skipped, 27.3 s wall (duration_ms 27032). Slowest: README.md dry-run commands 6.2 s, "no generated command or config uses a moving ref" 4.9 s, parallel start/status/merge 4.6 s, detection commands in temp HOME 4.0 s, README.es.md 3.4 s, tui.js 2.3 s | Fine; README EN/ES checks could share one run if CI time matters | - |
| C9 | low | bash 3.2 | `install.sh:26` uses `[[ =~ ]]` (valid in 3.2, regex unquoted OK). No `declare -A`, `mapfile`, `${x,,}`, `&>>`, `|&` found by grep in `install.sh`, `scripts/*.sh`, `tests/*.sh` (grep only, not run on 3.2) | None | - |
| C10 | low | powershell 5.1 | `install.ps1`: no `??`, `?.`, `-Parallel`, `-AsHashtable`, `utf8NoBOM` found by grep; `Set-Content -Encoding ascii` at `:89,:145`; relies on `tar` (Windows 10 1803+) at `:136,:142`, undocumented minimum Windows version (not verified in README) | Mention the Windows 10 1803+ requirement if absent | - |

## Repo health (W5)

| ID | Sev | Area | Evidence | Fix | Issue |
| --- | --- | --- | --- | --- | --- |
| R1 | medium | npm | `npm view lean-agents time`: `0.0.0-stage` published 2026-11-13T14:49Z, description "Temporary package placeholder for staged publishing", no `deprecated` field; `0.8.0` published 14:51Z (*spot-checked*) | Owner runs `npm deprecate lean-agents@0.0.0-stage "placeholder, use lean-agents@latest"`. Not run by this audit. | #169 |
| R2 | low | ci | Open branch `pin-bump/2026-11-13-1505`: run 43449143965 failed `test (ubuntu-latest, 22)` and `test (macos-latest, 22)`. Main run 43452184439 was still queued at check time | Reproduce in a temp HOME and fix on that branch before merge. Not a main regression. | - |
| R3 | low | repo | Live protection on `main` (`gh api repos/.../branches/main/protection`, read-only): 8 required checks match `docs/branch-protection.md` exactly; `enforce_admins` false; `required_pull_request_reviews` null; CODEOWNERS errors = 0 (*spot-checked*) | No new fix. CODEOWNERS is still unenforced; the owner decides (already H7 in `docs/audit-2026-11.md`). | - |
| R4 | low | branches | `git fetch --prune` then `git branch -r --merged origin/main`: 6 merged remote branches (names in Not checked) | Owner deletes them. This audit did not. | - |
| R5 | low | changelog | `CHANGELOG.md:5` has `## [Unreleased]`, but it is empty. Main commits 59bcc57 and e0c68a7 (npm/README docs) have no entry (*spot-checked*) | Add one Unreleased line if the README/npm pointer counts as user-facing. | - |
| R6 | low | changelog | `CHANGELOG.md:7` dates 0.8.0 as 2026-11-12; npm `0.8.0` publish time is 2026-11-13T14:51Z | Confirm the release date. Probably fine: the publish happened after the tag. | - |
| R7 | low | issues | 6 open issues, all with `type:`, `priority:`, `area:` labels; no milestones; oldest update 2026-11-10, so none stale (>30 days). #80 and #145 overlap in topic (adopt/migrate), not duplicates | No change needed. Optionally link #145 to #80 as related. | - |

## Bot PRs (recommendation only, none merged)

| PR | Recommendation | Reason |
| --- | --- | --- |
| #149 download-artifact 4.3.0 to 8.0.2 | merge (with #150, after owner's SHA check) | CI green (18 pass); v8 only makes a digest mismatch an error and is ESM, transparent to `release.yml` and `ci.yml`; merge together with #150 so upload and download stay on compatible majors |
| #150 upload-artifact 4.6.2 to 7.0.2 | merge (with #149) | CI green (19 pass); default still zips and `name`/`path`/`if-no-files-found` inputs used by `release.yml` are unchanged; first release after merge (0.9.0) is the real test, since PR CI does not run release.yml |
| #151 @clack/prompts 1.8.1 to 1.9.0 | hold | Pinned dependency (AGENTS.md: owner OK needed to change deps); CI green, mergeable, minor bump, so approve if the owner says yes |
| #153 pin bump (claude-code 2.1.312 to 2.1.314, ponytail 5.3.2 to 5.3.3) | hold | Engine tests fail on ubuntu and macOS (hardcoded 2.1.312 in `tests/agent-lifecycle.test.mjs:27`, see P1); fix the test first, then re-run the checks |

## Not checked

**Security and installers:**
- Real behavior of `lean.mjs` beyond lines 575-633 and 445-462; most of `scripts/lib/adapters/` (only `opencode-v2.mjs:117` read).
- `migrate.mjs` write paths (grep showed no direct fs writes; it delegates to fsops, not read in full).
- `terminals.mjs` Windows user-env writes, `upgrade.mjs`, `lean-update.mjs`.
- GitHub-side settings: branch protection, required reviewers on the `npm` environment, trusted-publisher config on npmjs.com, secret scanning, whether `PRIVATE_DENYLIST` is set. No `pull_request_target` in any workflow (grep: 0).
- Running the engine (`--home <tmp> --no-exec`) and the test suite: not done, so none of the above was dynamically confirmed.
- `.github/actions/*`, `bench-code-nav.yml`, `ci.yml` bodies beyond grep of `uses:` pins (all full SHAs) and lines 69-73.
- Latest CI run state (CI run 43452184439 was still in progress when sampled; 43451863409 succeeded).

**Pipelines:**
- npm-side facts (trusted publisher setting, 2FA mode, the staged publish) need npmjs.com access.
- Windows-specific jobs only through run conclusions, no log reading beyond failures.
- No rerun was done: the only infra failures (P6, P7) were already followed by later successes or were old.
- Job-by-job flake rates across 30 runs: only failures and cancels were opened, not slow jobs.
- Branch protection and the GitHub Actions PR-creation setting need repo admin access.
- Actual diff of #151 (changelog not read in detail).

**README and docs:**
- Semantic EN/ES drift: I compared headings, tables, flags, links and version strings, not the wording of each paragraph. A translation that says something different would pass.
- Claims in the compatibility tables against upstream tools (per-row **VERIFY** status was not re-tested; only the age of the undated rows).
- The `docs/compatibility.md:449` note "newer version in `--doctor` planned for 0.8.0": I did not check whether it shipped.
- `docs/SPEC.md` section 14 open items and `docs/ROADMAP.md` sections other than "Released" and 0.8.0.
- Flag behavior itself (only that each flag is printed and where it is documented). I did not run the engine.
- Adapter content beyond the agent names and CI job names.

**Code and tests:**
- `shellcheck` is not installed here (`command not found`): `shellcheck install.sh scripts/check-private.sh tests/*.sh` was not run.
- PSScriptAnalyzer and `pwsh` are not installed: `install.ps1` and `tests/*.ps1` were only grepped for 7+ only syntax, not parsed.
- Bash 3.2 was not executed; only grepped.
- Real-binary tests (`tests/real-*.sh`) not run.
- Dead-code list is a name-grep, not a call graph; dynamic imports not traced.
- Adapter files beyond the cited lines, and `lean.mjs` beyond the cited ranges, not read.

**Repo health:**
- Names of the 6 merged remote branches (for owner cleanup): `session-106c-adopt-apply`, `session-78-orca-opencode-v1`, `session-80a-upgrade-inventory`, `session-80b0-side-spike`, `session-80c-agent-install`, `session-80d-migrate-antigravity`.
- Full remote branch count, and whether the unmerged ones are live work.
- Job-name match between `ci.yml` and the protection list beyond the protection JSON; `tests/ci-latest.test.mjs` is assumed to guard it.
- Secret-scan run logs (only the run status was read). Gitleaks action pinning is W1's area.
- Whether the `0.0.0-stage` placeholder is needed for staged publishing (the EOTP flow in `docs/`).
- Closed-issue history and whether closed issues were duplicates.
- The npm package contents and `npm view` of other fields (only versions, dist-tags, time and deprecated checked).
- Issue bodies, comments and linked PRs (only titles and labels read).
