---
name: release-train
description: Use when cutting a lean-agents release: one release per session, start to finish, with the same gated steps.
---

Run one release per session. Read the private details (models, budget, workspace
paths) from the agent's memory at run time; this skill holds only the generic steps.

## Steps

1. Start: read pending-status, the latest retro, who-builds and SPEC 0/2; run `date -u`. Check: each milestone has ≤5 open issues and the UTC date is noted.
2. Preflight: provider smoke test + parsed 30-day spend logged. Check: the smoke file says OK and a total is printed, otherwise stop.
3. Spec per issue: task first, rules last (local gate incl. Node 22, `[\\/]` in path regexes, a test per finding, no main checkout); the worker done gate runs `npm test` on Node 22 in a hermetic env (only PATH, HOME, NVM_DIR), expected paths in tests use path.join/path.sep, never a literal '~/' or '~\', and any new external CLI flag cites its minimum version from docs/compatibility.md in the PR body. Check: one spec file per issue.
4. Launch: one worktree + terminal per issue from `origin/main`. Check: each worktree HEAD equals the main SHA.
5. Watch: one batch monitor (PR opened, worker exit/error prefix, CI done). Check: no stray watchers; a dead worker is cleaned up within 1 h.
6. Verify PR: HEAD equals PR head, read the diff, `npm ci && npm test` on default Node and Node 22, `check-private.sh`. Check: counts posted in a PR comment; never paste private memory details (models, budgets, paths) into PR comments or issues.
7. Review: code, security (cwd/PATH), PO vs "Done when"; the header carries `date -u` + SHA; a different model for data-sensitive PRs. Check: 3 verdicts recorded; the security reviewer rejects a PR that adds an external CLI flag without its minimum-version line.
8. Fix round: all findings in one worker message; each MEDIUM+ finding gets a test that fails on the pre-fix SHA; same-agent re-review. Check: re-review approves and names the tests; before writing a fix spec for a CI-only failure the coordinator reproduces it on `origin/main` in a clean temp HOME on Node 22 and quotes the failing line.
9. Coordinator edits only conflicts, release/docs and assertion-keeping harness fixes; each one is re-reviewed; no spec branches on the Node version and "never narrow an assertion" also covers the specs the coordinator writes. Check: a PR comment lists the coordinator commits + the reviewer's OK.
10. Merge gate: required checks green on the head SHA (a known flake is rerun once, with an issue filed), findings ledger complete, REST squash merge. Check: merge API message + ledger comment.
11. Cleanup + carry-over: close the terminal, remove the worktree, move leftovers with a comment, update pending-status. Check: `git worktree list` is clean and milestones are ≤5.
12. Release PR in a worktree: security audit of the range, audit doc, version bumps, PO review. Check: `scripts/release-gate.sh <ver>` exits 0 and no pin in core/pins.json is older than the previous release, including the lean-update skill pin (see #547).
13. Publish: main `ci.yml` green on the SHA, owner approves the tag, `release.yml`, owner approves the npm env. Check: `npm view lean-agents version` shows the new version as latest with provenance; the record PR updating `docs/SPEC.md` and `docs/ROADMAP.md` is open.
14. Clean up: remove every merged worktree, every local and remote branch whose PR is merged or closed, worker logs and temp HOMEs; archive specs and retro notes outside the repo tree. Check: `git worktree list` shows only main, `git branch` shows only main, and no remote branch has a merged PR.
15. Site and listing: update the project site and the public listings with the new version and highlights (after the site issue lands). Check: the live site shows the new version.
16. Retro: condense the transcript; 2 reviewers on different models write independently, then debate. Check: `retro-<date>.md` with apply-now / repo issues / rejected / keep.
17. Next-session prompt: top-risk repo issues first, saved in pending-status and given to the owner; end the session. Check: the prompt names the issues, the first step and the budget read from the agent's memory at run time.

## Scripts

- `scripts/release-gate.sh` before tagging; `scripts/changelog.mjs <version>` folds `changes/<issue>.md` fragments.
- `scripts/prove-on-main.sh` (after #517) for reproducing a CI-only failure on `origin/main`.

## Shell traps

- Launch workers with `bash -c`; zsh does not word-split an unquoted `$spec`.
- Start watchers only as background tasks of the agent harness; `nohup` or `& disown` never notify.
- `git add` new docs before running the link test; it reads tracked files only.
- A flaky test gets one rerun plus an issue.
- `timeout` is not on macOS by default.
