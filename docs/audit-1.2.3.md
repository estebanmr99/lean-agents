# Audit 1.2.3

Release audit of lean-agents for 1.2.3 (2026-11-26). Range: v1.2.2..89f269e (main). One read-only security review of the shipped code (`scripts/lib/system.mjs`, `scripts/copilot-context-mode.mjs`, `scripts/lib/copilot-usage.mjs`, `scripts/lib/opencode-backup.mjs`, `scripts/lean.mjs`, `scripts/lib/feedback.mjs`, `scripts/lib/fsops.mjs`, `scripts/lib/doctor.mjs`, `scripts/lib/adopt.mjs`), the CI workflows, the Dependabot config and the dependency bumps.

## Summary

- **Range:** v1.2.2..89f269e (16 commits, 47 files).
- **Root dependency:** `@clack/prompts` 1.8.1 → 1.9.0 (with `@clack/core` 1.6.0). It is still the only runtime dependency besides `jsonc-parser`, and it loads only for the menus.
- **Reviews:**
  - One read-only security review on 2026-11-26. It covered main at 113af59 plus the pending #504 and #509 diffs. #510 is its fix and had its own review.
  - Each fix PR (#501, #502, #503, #504, #509) had code, security and PO reviews by review agents before merge. They were reported in the coordinator session, not as GitHub review objects. #510 had one combined review.
- **Shipped changes:**
  - `--preflight` (and `--json`): a read-only check for old or duplicate CLI copies, config shape, nvm copies, backup space and a running OpenCode (#471).
  - Quiet output: one line per step, with a log per run (#491).
  - `--update`:
    - asks nothing mid-run (#489)
    - stops, changing nothing, while an `opencode` process runs (#488)
  - Child processes run without `shell: true`. On Windows, `.cmd` shims run through `cmd.exe /d /s /c` with every argument escaped (#475, DEP0190).
  - `--doctor` fixes:
    - reads the OpenCode 2.2.7 plugin cache (#495)
    - shortens home paths on Windows whatever the drive-letter case (#493)
  - `--feedback-draft` keeps package specs and cuts titles at a word (#476).
  - `--adopt` no longer flags identical skill copies that lean-agents installed (#477).
  - CI: upload-artifact v7.0.2, download-artifact v8.0.2, and Dependabot grouped into one PR per ecosystem.
- **Findings:** no HIGH. One MEDIUM, fixed before release (#510). Five LOW, all accepted.
- **Owner-only gates:**
  - Tag v1.2.3 (needs the owner's approval)
  - Release run green on the tagged SHA
  - OIDC publish proof

## Findings

- **MEDIUM, fixed (#510):** in `scripts/copilot-context-mode.mjs`, if `npm root -g` failed, its empty output made the package candidate the relative `context-mode`. A `./context-mode/server.mjs` in the current folder could then be registered as Copilot's context-mode MCP server. #502 introduced this; before it, the script threw. Now only an absolute npm root is used, and a relative `which()` answer is ignored. `tests/copilot-context-mode.test.mjs` failed on main and passes now.
- **LOW, accepted:** in `scripts/lib/system.mjs` `spawnArgs`, the resolved `.cmd` path goes in plain quotes, not ^-escaped (escaping breaks the shim's `%~dp0`). A `%VAR%` in that path would expand. The path comes from `where` on the child's own PATH, so it is already trusted to run. Follow-up: #507, one shim policy with `cmdInvocation`, which refuses such paths.
- **LOW, accepted:** the `--update` running-process blocker (`scripts/lib/opencode-backup.mjs` `runningBlocker`) checks only steps whose text or argv names opencode, and it misses a 2.x service started as plain `node`. The code marks this as a `shortcut:`. A process list that cannot be read fails closed: exit 1, nothing changed.
- **LOW, accepted:** a crafted `state.json` can hide an `--adopt` duplicate row only when the copies are byte-identical and the name is a skill lean-agents recorded. That hides information only; no content is at risk, and nothing is deleted.
- **LOW, accepted:** `tilde()` in `scripts/lib/fsops.mjs` has no left path boundary, so it can shorten text inside a longer path. It is display only and leaks nothing. Follow-up: #506.
- **LOW, accepted:** `.github/workflows/ci.yml` puts `${{ matrix.* }}` in a few `run:` lines. The values are static matrix entries, so nothing is exploitable.

## Checked, no defect

- **POSIX `which`:** `/bin/sh -c 'command -v "$1"' sh <name>`. The name is an argument, never spliced into the script.
- **Windows argument escaping:** cross-spawn's quoting, with ^-escaping applied twice for batch files, because a shim re-parses `%*`. On Windows CI, an argument with a space, `&`, `"`, `%`, `|`, `\` or `^` reaches the child unchanged (`tests/spawn-args.test.mjs`).
- **`copilot-usage.mjs`:** fixed argv words, no user input.
- **`--update` blocker:** in `--json` mode its messages go to stderr, so stdout stays valid JSON.
- **`--feedback-draft`:** redaction runs before the 100-character cut, so no partial secret survives. The email pattern does not backtrack catastrophically.
- **Workflows:** no `pull_request_target`. Every `uses:` is pinned to a 40-character SHA, including upload-artifact `cf430e0` (v7.0.2) and download-artifact `9000827` (v8.0.2).
- **Tests:** they run against temp HOMEs. Fixtures use neutral paths.
- **Privacy:** `bash scripts/check-private.sh` passes.
- **Not checked:** the lockfile integrity hashes against the registry.

## Open issues left (do not gate 1.2.3)

- **v1.2.4:** [#492](https://github.com/estebanmr99/lean-agents/issues/492), [#490](https://github.com/estebanmr99/lean-agents/issues/490), [#460](https://github.com/estebanmr99/lean-agents/issues/460), [#465](https://github.com/estebanmr99/lean-agents/issues/465), [#486](https://github.com/estebanmr99/lean-agents/issues/486).
- **v1.2.5:** [#505](https://github.com/estebanmr99/lean-agents/issues/505), [#506](https://github.com/estebanmr99/lean-agents/issues/506), [#507](https://github.com/estebanmr99/lean-agents/issues/507), [#508](https://github.com/estebanmr99/lean-agents/issues/508), the follow-ups from this release.
- **v1.3.0 and Research:** unchanged; see `docs/ROADMAP.md`.

## Owner-only gates

1. **Tag v1.2.3:** pending the owner's approval.
2. **Release run green:** pending.
3. **OIDC publish proof:** pending.
