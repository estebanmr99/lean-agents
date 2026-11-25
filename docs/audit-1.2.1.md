# Audit 1.2.1

Release audit of lean-agents for 1.2.1 (2026-11-25). Range: v1.2.0..v1.2.1. One read-only security review of the shipped code (`scripts/lib/adapters/vscode-copilot.mjs`, `doctor.mjs`, `inventory.mjs`, `system.mjs`), the new spike workflows and scripts, and the benchmark harness (`tests/bench-savings.mjs`).

## Summary

- **Range:** v1.2.0..v1.2.1 (37 commits, 23 files).
- **Reviews:**
  - One read-only security review on 2026-11-25.
  - Before merge, each PR in the range (#453 to #459) had a separate code review.
- **Shipped change:** VS Code Insiders support.
  - lean-agents writes `Code - Insiders/User` only when that folder already exists.
  - `--uninstall` undoes every write, proven by `tests/engine.test.mjs` and spike run 45643523161.
  - Root dependencies are unchanged.
- **Findings:** one MEDIUM, fixed in this PR. Six LOW: one fixed here, five accepted (below).
- **Open issues:** none gate 1.2.1. No open `audit` issues.
- **Owner-only gates:**
  - Tag v1.2.1.
  - Release run green.
  - OIDC publish proof.

## Findings and issues

- **MEDIUM, fixed here:** `spike-vscode-insiders.yml` downloads the current Insiders build unpinned and ran on PRs.
  - The download has no checksum, because Insiders builds change daily.
  - The workflow is now `workflow_dispatch` only, so the unpinned download never runs on PRs.
- **LOW, fixed here:** the Insiders spike checked only the server list after `--uninstall`. It now also fails if the strict `settings.json` keys are left behind.
- **LOW, accepted:** the benchmark raw log is redacted for the exact key string only (`tests/bench-savings.mjs`).
  - A model echoing a transformed key would not be caught.
  - The benchmark is paused, the artifact is kept 3 days, and the job is manual.
  - Recheck when #404 v2 resumes.
- **LOW, accepted:** the benchmark quota stop also triggers on `provider.auth`, 401 and 403. This is intended: a bad or capped key should stop spending runs.
- **LOW, accepted:** on an Insiders-only machine, lean-agents still creates stable `Code/User`. This behavior predates 1.2.1 (stable has always been written) and is documented in `docs/compatibility.md`.
- **LOW, accepted:** Windows `%APPDATA%\Code - Insiders\User` is unproven and marked **VERIFY** in the code and docs.
- **Checked, no defect:**
  - Action pins:
    - Every new `uses:` is pinned to a SHA.
    - The checkout SHA was checked against tag v7.0.1 and the setup-node SHA against v7.1.0, both via the GitHub API on 2026-11-25.
  - Workflow safety:
    - No `pull_request_target`.
    - `contents: read` and `persist-credentials: false`.
    - No `github.event.*` or `inputs.*` in `run:`.
  - The spikes use a `mktemp -d` HOME with `trap` cleanup.
  - `bench-savings.mjs` passes only PATH, HOME and NODE_OPTIONS to test subprocesses.
  - `scripts/check-private.sh` passes.

### Open issues left (do not gate 1.2.1)

- [#460](https://github.com/estebanmr99/lean-agents/issues/460): skipped `real-vscode-others` job shows an unexpanded name template (cosmetic, worker).
- [#407](https://github.com/estebanmr99/lean-agents/issues/407), [#404](https://github.com/estebanmr99/lean-agents/issues/404), [#428](https://github.com/estebanmr99/lean-agents/issues/428), [#436](https://github.com/estebanmr99/lean-agents/issues/436): 1.3.0 work, unchanged since the 1.2.0 audit.

## Owner-only gates

1. **Tag v1.2.1:** The owner approved the tag on 2026-11-25.
2. **Release run green:** `release.yml` must pass on the tag.
3. **OIDC publish proof:** Verify that npm shows 1.2.1 as `latest`, with provenance.
