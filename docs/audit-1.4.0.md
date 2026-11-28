# Audit 1.4.0

Release audit of lean-agents for 1.4.0 (2026-11-28). Range: v1.3.0..35e115e (main, 26 commits). One read-only security review of the shipped code and workflows, on 2026-11-28, covering main at 35e115e:

- `scripts/lib/system.mjs` (`whereAll`, `dropCwd`, `spawnArgs`, `spawnFor`, `sys32`), `opencode-backup.mjs`, `adapters/opencode1.mjs`
- `--remove-tools` in `scripts/lean.mjs` and `scripts/lib/fsops.mjs`
- `scripts/lib/doctor.mjs` (repo ignore, `refreshUserHashes`, launcher-only stubs, the service guard)
- the `/lean-update` command file, the in-session OpenCode deferral
- `.github/workflows/*` changes, `tests/no-literal-tilde.test.mjs`

## Summary

- **Range:** v1.3.0..35e115e.
- **Dependencies:** no change. The only runtime dependencies are still `jsonc-parser` and `@clack/prompts`.
- **Theme:** one command controls everything: `--remove-tools` removes one tool (GSD proved in the `real-tools` CI job, #633), `/lean-update` is a slash command in OpenCode 1.x and 2.x, `--update` inside an OpenCode session applies what it can and defers the rest (#575), plus security fixes.
- **Reviews:**
  - Each PR had code, security and PO reviews with a date and SHA header before merge, posted as PR comments, plus a findings ledger. Feature PRs: #580, #620, #624; fixes, tests and CI, including: #598, #600, #601, #602, #604, #610, #612, #614, #615, #616, #621, #627, #628, #631, #632, #633, #635, #637, #638, #639, #603, #625, #626.
  - One read-only security review of the release on 2026-11-28 (see above). Verdict: OK to tag, every MEDIUM tracked.
- **Shipped changes:** see the `[1.4.0]` section of `CHANGELOG.md`. Security-relevant: marketplace tags are checked against the pinned sha (#523); `--adopt` cleanup output is quoted and stripped of bidi characters (#525); on Windows a command is never run from the current folder, by `which()` (#630) or by a bare-name spawn (#636); Windows tools run from System32.
- **Findings:** no HIGH. Two MEDIUM, both tracked (#640, #617/#579). LOW findings accepted or tracked below.
- **Owner-only gates:**
  - Tag v1.4.0 (owner pre-approved tagging on 2026-11-27). Tagged on 661982e after `ci.yml` run 46123884361 passed on it and `release-gate.sh 1.4.0` exited 0.
  - Release run green: `release.yml` run 46124631710 passed on the tag (2026-11-28); the owner approved the npm environment.
  - OIDC publish proof: npm shows 1.4.0 as `latest`, with SLSA provenance (`https://slsa.dev/provenance/v1`, checked 2026-11-28).
  - Proof: `e2e-update` run 46123891719 (from 1.3.0) passed on 661982e.

## Findings and issues

- **MEDIUM, tracked (#640):** a few Windows spawns still pass a bare program name (`scripts/lib/inventory.mjs` `probeInitialize`; `git` and `orca` in `scripts/lib/parallel.mjs`), so a same-named file in the current folder could run. The main paths are fixed (#630, #636) and Windows tools run from System32.
- **MEDIUM, tracked (#617, #579):** in `e2e-update.yml` the spend watcher and the OpenCode service hold the OpenRouter key while the agent runs, so a same-user process can read it. The agent steps no longer carry the key (#616). The job is manual dispatch only with `contents: read` and a spend cap.
- **LOW, tracked (#629):** `--remove-tools` maps untagged 1.3.0 records to a tool by folder hint; `playwright` and `playwright-extension` share one, so removing one can revert the other's untagged files. Only files lean-agents recorded (managed mark, backup or our own JSON keys) are touched.
- **LOW, tracked (#634):** `--doctor` does not report a user edit to `source.ref` of our marketplace entry.
- **LOW, accepted:** the `--doctor` service guard compares OpenCode service PIDs before and after its probe; a service the user starts during that probe would be stopped. It never stops a service that was already running, and does nothing if the process list fails.
- **LOW, tracked (#641):** the `e2e-update` proof fails when `from_version` equals the checkout version (npx resolves the local package). The 1.4.0 proof is dispatched after the version bump.
