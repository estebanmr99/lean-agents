# Audit 1.1.0

Release audit of lean-agents for 1.1.0 (2026-11-23): range v1.0.0..main (66 commits), two read-only reviews (security inspector over `scripts/`, `install.sh`, `install.ps1`, `core/pins.json`, `.github/workflows/`; product-owner release check).

## Summary

- **Range:** v1.0.0..main (66 commits).
- **Reviews:** Two read-only reviews 2026-11-23.
- **Findings:** No HIGH findings. Two MEDIUM, both in `bench-savings.yml`, filed as #389 and fixed in this PR.
- **Open issues:** 7 open issues remain (list below), none gating 1.1.0.
- **Owner-only gates:** tag v1.1.0, release run green, OIDC publish proof.

## Findings and issues

- **#389 MEDIUM+LOW bench-savings.yml:** top-level permissions, job-level if-check, pinned opencode-v2, and model input env variable — fixed here.
- **LOW, accepted:** the pinned Cursor Windows script downloads a zip lean-agents does not hash itself, and deletes an existing %LOCALAPPDATA%\cursor-agent folder first (lean-agents only runs it when `agent` is missing). Trust is the cursor.com script pinned by sha256.
- **LOW, accepted:** winget/brew app installs (Antigravity, Cursor) are unpinned; only a clear "not installed" answer installs, any other answer is a note; undo uninstalls the app even if the user reinstalled it in between.
- **LOW, follow-up:** `psQ` (Bun PowerShell in scripts/lib/system.mjs) should double typographic quotes like `q()` in agent-lifecycle.mjs.
- **Checked, no defect:** fsops arrayAdd restore, agent undo removes only recorded files that still match and dirs that are empty, release audit gate (--limit 1000, release-proof exemption is by design), no secrets or private data in the diff.

### Open issues left (do not gate 1.1.0)

- [#304](https://github.com/estebanmr99/lean-agents/issues/304): Investigate: Claude Code experimental Code Mode, and the equivalents for the other agents
- [#190](https://github.com/estebanmr99/lean-agents/issues/190): Standalone OpenCode plugin for the Copilot usage meter (own repo, optional install)
- [#180](https://github.com/estebanmr99/lean-agents/issues/180): Install with an agent: VS Code Copilot chat (agent mode) as the installing agent for peers
- [#179](https://github.com/estebanmr99/lean-agents/issues/179): Fresh machine: one command from a clean Mac or Windows PC to the full setup, proven in CI
- [#145](https://github.com/estebanmr99/lean-agents/issues/145): Work PC: read-only --adopt inventory before the 0.9.0 OpenCode upgrade
- [#103](https://github.com/estebanmr99/lean-agents/issues/103): research: harness benchmark and personal vs enterprise recommendation (OpenCode 1.19 / 2.x vs Pi, Kimi Code, Hermes)
- [#78](https://github.com/estebanmr99/lean-agents/issues/78): Orca: OpenCode 1.19 shows no agent status icons (work PC with Warp), and Ctrl+P clashes with OpenCode (deferred consciously, needs the work PC).

## Owner-only gates

1. **Tag v1.1.0:** The owner tags the release.
2. **Release run green:** The `release.yml` workflow passes on the tag.
3. **OIDC publish proof:** Verify the npm publish via OIDC trusted publishing.
