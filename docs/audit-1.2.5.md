# Audit 1.2.5

Release audit of lean-agents for 1.2.5 (2026-11-27). Range: v1.2.4..f8fb8e5 (main). One read-only security review of the shipped code and workflows (`scripts/changelog.mjs`, `scripts/release-gate.sh`, `scripts/lib/retry.mjs`, `scripts/lib/fsops.mjs`, `scripts/lib/adopt.mjs`, `scripts/lib/upgrade.mjs`, `install.sh`, `install.ps1`, `.github/workflows/release.yml`, the CI script diffs, `core/AGENTS.md`).

## Summary

- **Range:** v1.2.4..f8fb8e5 (6 commits, 42 files).
- **Dependencies:** no change. The only runtime dependencies are still `jsonc-parser` and `@clack/prompts`.
- **Reviews:**
  - One read-only security review on 2026-11-27, covering main at f8fb8e5.
  - Each feature PR (#533, #535, #536, #537, #538) had code, security and PO reviews with a date and SHA header before merge, posted as PR comments, plus a findings ledger.
- **Shipped changes:**
  - `--adopt` and `--upgrade-agent` shorten a Windows home path to `~` whatever its letter case, and `tilde()` no longer matches a home inside a longer path (#506, #535).
  - `core/AGENTS.md` trimmed from 3,016 to 1,599 bytes. Every safety rule from 1.2.4 is kept (#532, #537).
  - Changelog fragments in `changes/<issue>.md`, folded by `node scripts/changelog.mjs <version>` (#516, #533).
  - `scripts/release-gate.sh` runs the release gate locally and in `release.yml`; `docs/audit-template.md` lists the required headings (#515, #536).
  - CI: real-binary downloads retry a 5xx (and refused connections) three times, never a 4xx (#505, #538).
- **Findings:** no HIGH, no MEDIUM. Four LOW findings, all accepted, with follow-ups in #540, #541 and #542.
- **Owner-only gates:**
  - Tag v1.2.5 (waits for the owner's approval)
  - Release run green on the tagged SHA
  - OIDC publish proof

## Findings and issues

- **LOW, accepted (#541):** `tilde()` in `scripts/lib/fsops.mjs` now skips a home that comes right after `\`, `/`, a word character, `.` or `-`. A home behind the Windows long-path prefix `\\?\` is no longer shortened, so the user name can show in printed output. Output only; nothing is written to a wrong path.
- **LOW, accepted (#542):** `scripts/release-gate.sh` does not validate the version and reads the audit file relative to the current folder. A local run from outside the repo root can read the wrong file, and a local run does not check that the SHA is on main (`release.yml` still does). Every value is quoted, so there is no injection.
- **LOW, accepted (#540):** retry rules differ: `scripts/lib/retry.mjs` retries network errors, `install.ps1` fails at once on them. Both stop at once on a 4xx. All callers send GET requests and every pinned download is still checksum-verified.
- **LOW, accepted (no issue):** `scripts/changelog.mjs --changes <dir>` accepts any folder. Deletion stays scoped: top-level `*.md` only, `README.md` kept, symlinks refused, every fragment read before anything is written or deleted. No workflow calls it.
