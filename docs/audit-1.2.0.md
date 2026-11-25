# Audit 1.2.0

Release audit of lean-agents for 1.2.0 (2026-11-24): range v1.1.0..main, two read-only reviews (security inspector over `scripts/`, `install.sh`, `install.ps1`, `core/pins.json`, `.github/workflows/`, `tools/code-mode-proxy/` and the package `files`; product-owner release check).

## Summary

- **Range:** v1.1.0..main (80+ commits), plus the release PR.
- **Reviews:** Two read-only reviews 2026-11-24. Every worker PR in the range also had a code review, a security review and a product-owner review before merge.
- **Findings:** No HIGH or MEDIUM findings. Four LOW, two fixed in the release PR, two accepted (below).
- **Code Mode proxy:** `tools/code-mode-proxy/` ships as source in the npm package but nothing installs, configures or runs it yet (no reference from `scripts/`, `install.sh`, `install.ps1`, `core/` or `profiles/`). Its own dependencies (`quickjs-emscripten-core`, `@jitl/quickjs-wasmfile-release-sync`, both 0.32.0) are exact pins with sha512 integrity. Root dependencies are unchanged (`jsonc-parser`, `@clack/prompts`).
- **Open issues:** none gate 1.2.0 (list below).
- **Owner-only gates:** tag v1.2.0, release run green, OIDC publish proof.

## Findings and issues

- **LOW, fixed here:** `spike-code-mode-proxy.yml` action comments said `# v4` for SHAs that are v7.0.1 / v7.1.0 / v4.6.2; comments corrected.
- **LOW, fixed here:** the Codex spike leak check (`spike-codex-cli.yml`) failed on the empty `@openai` scope folder npm leaves after uninstall (run 45549814258); it now compares `npm ls -g --parseable`.
- **LOW, accepted:** `spike-code-mode-proxy.yml` runs `npm rebuild isolated-vm` (a native build script) after `npm ci --ignore-scripts`. Manual dispatch only, `contents: read`, temp HOME, no secrets. Remove the workflow once the QuickJS choice is final (#407).
- **LOW, accepted:** `bench-savings.yml` uploads `raw/` (benchmark transcripts) with `OPENROUTER_API_KEY` in the job env; each raw log is written through `redactKey` (`tests/bench-savings.mjs:403`), and the artifact is kept 3 days. Recheck when #404 v2 changes the harness.
- **Checked, no defect:** every `uses:` pinned to a 40-character SHA; no `pull_request_target`; untrusted inputs (`inputs.*`, PR body, base ref) reach `run:` only through `env:`; the new test-count guard uses `execFileSync` with argument arrays and fails closed when the base ref is missing; the proxy spawns upstreams with `shell: false` and a filtered env, and `remove.mjs` refuses symlinks, paths outside the lean data dir and dirs without the marker; no private data in the diff (`scripts/check-private.sh` passes).
- **Dropped:** Gemini CLI spike (#433, PR #448 closed). Upstream made Gemini CLI enterprise-only on 2026-06-18; Antigravity CLI, already supported, covers individual accounts.

### Open issues left (do not gate 1.2.0)

- [#407](https://github.com/estebanmr99/lean-agents/issues/407): Code Mode proxy PRs 2 to 5 (measurement, installer wiring, real CLIs, comparison), 1.3.0.
- [#404](https://github.com/estebanmr99/lean-agents/issues/404), [#430](https://github.com/estebanmr99/lean-agents/issues/430), [#431](https://github.com/estebanmr99/lean-agents/issues/431), [#103](https://github.com/estebanmr99/lean-agents/issues/103): benchmark v2, 1.3.0.
- [#428](https://github.com/estebanmr99/lean-agents/issues/428), [#436](https://github.com/estebanmr99/lean-agents/issues/436): multi-CLI orchestration and coordinator tuning, 1.3.0.
- [#432](https://github.com/estebanmr99/lean-agents/issues/432): Codex CLI adapter after the spike's VERIFY rows, 1.3.0.
- [#190](https://github.com/estebanmr99/lean-agents/issues/190), [#420](https://github.com/estebanmr99/lean-agents/issues/420), [#422](https://github.com/estebanmr99/lean-agents/issues/422), [#434](https://github.com/estebanmr99/lean-agents/issues/434), [#435](https://github.com/estebanmr99/lean-agents/issues/435), [#437](https://github.com/estebanmr99/lean-agents/issues/437) to [#441](https://github.com/estebanmr99/lean-agents/issues/441): later work and good first issues.
- [#442](https://github.com/estebanmr99/lean-agents/issues/442) (social preview) and [#446](https://github.com/estebanmr99/lean-agents/issues/446) (private vulnerability reporting): owner repo settings, no code.

## Owner-only gates

1. **Tag v1.2.0:** The owner approves the tag.
2. **Release run green:** The `release.yml` workflow passes on the tag.
3. **OIDC publish proof:** Verify the npm publish via OIDC trusted publishing.
