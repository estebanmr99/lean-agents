# Audit 1.2.4

Release audit of lean-agents for 1.2.4 (2026-11-27). Range: v1.2.3..d3fbf3c (main). One read-only security review of the shipped code and workflows (`scripts/lean.mjs`, `scripts/lib/adopt.mjs`, `scripts/lib/inventory.mjs`, `scripts/lib/fsops.mjs`, `core/pins.json`, `tests/bench-multiagent.mjs`, `.github/workflows/bench-multiagent.yml`, the `ci.yml` diff).

## Summary

- **Range:** v1.2.3..d3fbf3c (7 commits, 26 files).
- **Dependencies:** no change. The only runtime dependencies are still `jsonc-parser` and `@clack/prompts`.
- **Reviews:**
  - One read-only security review on 2026-11-27, covering main at d3fbf3c.
  - Each feature PR (#514, #519, #520, #521, #522, #524) had code, security and PO reviews by review agents before merge. They were reported in the coordinator session, not as GitHub review objects.
- **Shipped changes:**
  - `--adopt` (and `--json`) lists every global npm package under every Node that nvm knows, with an engines check, not only the packages lean-agents pins (#521, part of #465).
  - `--doctor` no longer reports `~/.claude/settings.json` as edited after `--update` when the only difference is plugin keys that lean-agents' own commands wrote (#492, #522).
  - The `context-mode` Claude plugin pin moved from v2.1.4 to v2.1.7, the same version as the npm CLI, with a test that catches drift (#490, #519).
  - Multi-agent benchmark harness and a manual workflow, capped at USD 5 per run (#404, #524). The first run on main passed in every mode for about USD 0.05.
  - CI:
    - pinned rtk in the macOS real-opencode job (#486, #514)
    - no unexpanded name on the skipped `real-vscode-others` job (#460, #520)
- **Findings:** no HIGH, no MEDIUM. Six LOW findings, all accepted, with follow-ups in #525, #526 and #527.
- **Owner-only gates:**
  - Tag v1.2.4 (needs the owner's approval)
  - Release run green on the tagged SHA
  - OIDC publish proof

## Findings and issues

- **LOW, accepted (#525):** `scripts/lib/adopt.mjs:290` builds the printed `npm uninstall -g` line from the global's own `package.json` `name`, not from its folder name. The `--prefix` path is also unquoted. If a manifest name does not match its folder, the copied command removes a different package. This needs write access to the user's nvm tree. The line is only printed, never run.
- **LOW, accepted (#525):** `clean()` in `scripts/lib/adopt.mjs` strips C0/C1 control characters (ESC included), but not bidi overrides or zero-width characters. A crafted name can reorder the printed list visually. It cannot inject terminal escapes.
- **LOW, accepted (#526):** in `userHash` (`scripts/lib/fsops.mjs`), an ignore entry of the `repo` kind drops the whole `extraKnownMarketplaces.<name>` object from the hash. A user edit inside that entry is not shown by `--doctor`. The edit itself is kept.
- **LOW, accepted (#526):** in `refreshUserHashes` (`scripts/lean.mjs`), the first guard is always false right after the write. The `managedUserHash` check does the real protection. User values that `keepIfChanged` keeps in managed keys fold into the new hash.
- **LOW, accepted (#527):** `.github/workflows/bench-multiagent.yml` installs `@opencode/cli@2.2.5` from npm with no SHA256 check. The rest of CI uses `scripts/ci-install-opencode-v2.sh` at the pinned 2.2.7. The workflow is manual, main only, with `contents: read`.
- **LOW, accepted (#527):** the benchmark's budget is enforced by polling key spend every 30 s, so the cap is soft. The model's shell has the API key, and artifacts remove only an exact match of it. The fix is a dedicated key with a provider-side limit (owner step).

## Checked, no defect

- **`bench-multiagent.yml`:**
  - Every `inputs.*` value passes through `env:` and is quoted in `run:`, so there is no expression injection.
  - The job runs on `refs/heads/main` only, with `persist-credentials: false` and `npm ci --ignore-scripts`.
  - Every `uses:` is pinned to a 40-character SHA.
  - The secret is set on the run step only.
- **`tests/bench-multiagent.mjs`:**
  - `max_usd` is capped at 5 and fails closed on bad input.
  - `--model` cannot start with `-`. Modes, variant and counts are validated.
  - A failed usage poll kills every session.
  - Sessions get only PATH, HOME, NVM_DIR and the key.
- **`npmGlobals`:**
  - It reads directories with `withFileTypes` and does not follow symlinks.
  - JSON parse errors are caught, and non-string fields are coerced.
  - `meetsEngines` returns null on unknown clauses.
- **`--doctor` hashes:**
  - `usableIgnore` validates ignore entries from `state.json`. A parse failure reads as changed (fail-safe).
  - A file is refreshed only when it equals the managed keys plus the recorded plugin keys. Any other user key keeps the row flagged.
- **Pins and CI:**
  - context-mode v2.1.7 is pinned with a commit SHA.
  - The rtk download is SHA256-checked through `scripts/ci-download.sh` and `tests/ci-downloads.json`.
- **Privacy:** `bash scripts/check-private.sh` passes.
- **Not checked:**
  - nvm-windows on a real install (VERIFY in the code)
  - lockfile integrity hashes against the registry
  - whether the benchmark's setup variant writes anything secret into its output folder (only `raw/*.jsonl`, `results.json` and `results.md` were read)

## Open issues left (do not gate 1.2.4)

- **v1.2.5:** [#505](https://github.com/estebanmr99/lean-agents/issues/505), [#506](https://github.com/estebanmr99/lean-agents/issues/506), [#507](https://github.com/estebanmr99/lean-agents/issues/507), [#508](https://github.com/estebanmr99/lean-agents/issues/508), [#515](https://github.com/estebanmr99/lean-agents/issues/515).
- **v1.2.6:** [#516](https://github.com/estebanmr99/lean-agents/issues/516), [#517](https://github.com/estebanmr99/lean-agents/issues/517), [#518](https://github.com/estebanmr99/lean-agents/issues/518), [#465](https://github.com/estebanmr99/lean-agents/issues/465) (MCP/hook and PATH-node flags).
- **Audit follow-ups, no milestone yet:** [#525](https://github.com/estebanmr99/lean-agents/issues/525), [#526](https://github.com/estebanmr99/lean-agents/issues/526), [#523](https://github.com/estebanmr99/lean-agents/issues/523) (marketplace plugin SHA never checked).
- **v1.3.0 and Research:** [#527](https://github.com/estebanmr99/lean-agents/issues/527), [#430](https://github.com/estebanmr99/lean-agents/issues/430); otherwise unchanged, see `docs/ROADMAP.md`.

## Owner-only gates

1. **Tag v1.2.4:** needs the owner's approval.
2. **Release run green:** `release.yml` on the tagged SHA.
3. **OIDC publish proof:** npm shows 1.2.4 as `latest`, with SLSA provenance.
