# Audit 1.3.0

Release audit of lean-agents for 1.3.0 (2026-11-27), planned as 1.2.6 and renamed under SemVer because it adds features. Range: v1.2.5..0fb6e43 (main). One read-only security review of the shipped code and workflows, on 2026-11-27, covering main at 71d1655 plus PR #574 at bc28efc:

- `scripts/lib/*`: the marketplace ref move in `fsops.mjs`, the running-service check and `filesOnly` in `opencode-backup.mjs`, `opencode-upgrade.mjs`, the terminal update path, Context Mode `--agent`, the MCP OAuth key translation, the `cli.json` edits
- `scripts/lean.mjs`
- `.github/workflows/e2e-update.yml` and `tests/e2e-update.mjs`
- the bench scripts
- `skills/lean-update/SKILL.md`

## Summary

- **Range:** v1.2.5..0fb6e43.
- **Dependencies:** no change. The only runtime dependencies are still `jsonc-parser` and `@clack/prompts`.
- **Theme:** an agent or `/lean-update` updates an existing install end to end with no manual step. Proof: the manual `e2e-update` job (OpenCode 2.2.7 agent, DeepSeek v4.1 flash, install made by 1.2.4 with an old Context Mode plugin pin and the OpenCode service running) passed on main in run [46068437977](https://github.com/estebanmr99/lean-agents/actions/runs/46068437977).
- **Reviews:**
  - Each feature PR had code, security and PO reviews with a date and SHA header before merge, posted as PR comments, plus a findings ledger. PRs: #550, #551, #552, #553, #554, #559, #560, #563, #566, #567, #568, #570, #571, #574, #577, #578, #581, #582, #583.
  - One read-only security review of the release on 2026-11-27 (see above).
- **Shipped changes:**
  - `--update` moves a Claude plugin marketplace pin without losing plugin data, backs up `settings.json`, and `--update --undo` restores it (#546).
  - Inside an OpenCode session, a skill refresh and the RTK plugin refresh are files-only and no longer block, and the refusal never tells the agent to stop its own service (#546). A real OpenCode step still needs a terminal (follow-up #575).
  - `--update` checks for a terminal before the plan and stops the OpenCode service it started (#548). Preflight hints match the installer of each copy; the lean-update pin follows the release (#547).
  - `--update` updates managed Warp and Orca apps; an Orca update keeps the old app until the new copy is complete (#555).
  - OpenCode 2: MCP OAuth keys translated on upgrade (#556); `cli.json` edited instead of a stale `tui.json`, a duplicate DCP entry and dead 1.x TUI plugins reported or removed (#558).
  - Context Mode MCP entries pass `--agent` (#562).
  - CI and tooling: the `e2e-update` proof job and its evaluator (#561), bench cost per session and a splittable benchmark task (#527, #431), the release-train skill (#518).
- **Findings:** no HIGH. Two MEDIUM: one fixed before the tag (#555, Orca), one CI-only and tracked (#579). LOW findings accepted or tracked below.
- **Owner-only gates:**
  - Tag v1.3.0 (owner pre-approved tagging on 2026-11-27). Tagged on the release commit after `ci.yml` passed on it (SHA and run recorded after the tag).
  - Release run: `release.yml` on the tag (run recorded after publish).
  - OIDC publish proof: npm shows 1.3.0 as `latest`, with SLSA provenance (checked after publish).

## Findings and issues

- **MEDIUM, fixed (#577):** the Orca update ran `rm -rf` on the old app before `ditto` copied the new one, so a failed copy left no Orca. The new copy now goes to `Orca.app.new` first; a test runs the script with a failing copy.
- **MEDIUM, tracked (#579):** in `e2e-update.yml` the agent's shell has `OPENROUTER_API_KEY`; a prompt-injected tool output could send it out. The job is manual dispatch only, with `contents: read`, `persist-credentials: false`, a USD 1 spend cap and redacted uploads. Owner step: keep a low provider-side limit on that key and rotate it if a run looks wrong.
- **LOW, accepted:** the Orca swap is not atomic between `rm` and `mv`; a SIGKILL in that window leaves only `Orca.app.new`. Same-folder rename.
- **LOW, accepted:** the OAuth `clientSecret` move keeps the value in the undo record of `state.json`. The file is written with `writePrivate` (mode 0600) and the value is never printed.
- **LOW, tracked (#579):** `redact()` matches only the full key (plain, base64, base64url, hex) and does nothing when the key is empty; a generic `sk-or-` pattern and a fail-on-empty check are follow-ups. `e2e-update.yml` adds the Context Mode marketplace by tag in a throwaway HOME.
- **LOW, accepted:** the e2e consent check accepts `Update these <N> <words>?` with one optional parenthetical, so it may answer "yes" to a reworded question. It only gates one yes turn in a throwaway HOME. The checkout-run check accepts `cd "$DIR" || node …` too, and the after-update offer match accepts "summary page" without the path; both are tracked in #579.
- **LOW, resolved:** `OPENCODE` is set in OpenCode 2.2.7 tool shells (proof run 46052801952), so the inside-OpenCode text is shown (#576).
- **LOW, tracked (#575):** the running-service refusal is all-or-nothing: one OpenCode-touching step stops the whole run.
