---
name: lean-update
description: Update a lean-agents install through its script. Use when the user asks to update lean-agents or its tools, check what is outdated, or bring a hand-made install under the script. Detects, asks in plain words, shows a table, runs the script only on yes.
---

# lean-update

The script (`lean-agents`, `scripts/lean.mjs`) is the only thing that changes files: deterministic, tested, undone by `--uninstall`. You are the middleware: detect, ask, run it, read it back. Change nothing before the user says yes.

Run the script with `npx -y lean-agents@<version> <flags>` (the latest release version, below). Without npm access, use the bootstrap, which downloads that release and checks its SHA256: `curl -fsSL https://github.com/estebanmr99/lean-agents/releases/download/<tag>/install.sh | bash -s -- <flags>`. In a clone, `node scripts/lean.mjs ...` works too. Use the latest release tag: `gh release view --repo estebanmr99/lean-agents --json tagName -q .tagName`.

1. **Read the release.** Fetch `core/pins.json` at that tag from `https://raw.githubusercontent.com/estebanmr99/lean-agents/<tag>/`. Then read every release between the installed lean-agents version (`version` in `state.json`; for a hand install, ask or say it is unknown and read from the oldest release you can match) and the latest: `gh release view <tag> --repo estebanmr99/lean-agents --json body -q .body`, and the matching `CHANGELOG.md` sections. A pin's `note` adds to the impact.
   - Start your answer with the **breaking changes and upgrade steps** from those notes, before any table.
   - The notes mention OpenCode 2: say that upgrading OpenCode is the user's own step (lean-agents never upgrades it), and that before it they should back up the OpenCode data folder (`opencode.db`) and config; see "Staying on OpenCode 1.x" in `docs/compatibility.md`. This skill never runs the OpenCode upgrade.
   - A release with no clear "Upgrade" or "Breaking" notes: say so in plain words, and put "none in the release notes" in the table.
2. **Detect.**
   - `~/.config/lean-agents/state.json` exists (or `--doctor --json` works): run `--doctor --json`. Its `behind` list is what is older than the pins.
   - No `state.json` (installed by hand): run the read-only commands in "Detect what is installed" in `docs/manual-install.md` to learn which agents and tools are there. Say that this install has no state yet and that the script will take it over without overwriting user files.
3. **Dry run as JSON, with the script.**
   - With state: `--update --dry-run --yes --json`.
   - Without state: `--dry-run --yes --json --agents <detected> --tools <detected>`.
   The JSON lists files, commands (exact `npx`/`brew` lines, all pinned) and, on update, `behind`.
4. **Show one table** in plain words: `tool | installed | pinned | impact | upgrade notes | what it would run`. Installed comes from `behind` or the detection; impact from step 1 ("not in the changelog" when it is not); upgrade notes from the releases in step 1 ("none in the release notes" when there are none); what it would run from the JSON `commands`. Then ask: "Update these N tools?" Stop on no.
5. **Back up only what changes, then run.** One folder `"${TMPDIR:-/tmp}/lean-agents-backup-$(date +%Y%m%d-%H%M%S)"` (snippet in `docs/manual-install.md` section 7) holding the files the JSON says will change (paths start with `~`: expand it to the home directory) and that the engine does not already restore. Then run the same flags without `--dry-run`: `--update --yes`, or `--yes --agents ... --tools ...`. Stop at the first failure and report it.
6. **Read it back.** Run `--doctor --json`. When `ok` is true and `behind` is empty, `rm -rf` the backup folder and tell the user it is gone and that `--uninstall` still undoes everything. When it is not, keep the backup, say where it is, and offer to restore.
7. **Share findings (optional).** Only if you found a problem or an improvement (a failed command, a tool the detection cannot see, a missing changelog note):
   - Never offer under `--privacy strict`, `--network off` or `--outbound off`. Read the saved preset from `state.json`; with no state, ask once whether outbound calls are allowed.
   - Ask: "Draft a redacted issue for lean-agents?" Stop on no.
   - `lean-agents --feedback-draft --feedback-kind update --failed-command "<tool>" --network on < details.txt`. `{"offer": false}` means stop.
   - Duplicates: `gh issue list --repo estebanmr99/lean-agents --search "<title words>"`. If one matches, show it and stop.
   - Show the full draft. Only after a yes: `gh issue create --repo estebanmr99/lean-agents --title "<title>" --body-file <draft>`.
8. **Report**: old -> new per tool, what you verified (`--doctor --json`), what is left for the user.

## Fallback: the script cannot run

Only when Node is missing or the machine blocks the script. Use the table of commands and the install lines in `docs/manual-install.md` (sections 4, 6, 7) by hand, with the same table, the same ask, the same backup and the same read-back. Say that this is the fallback: nothing here is recorded in `state.json`, so `--uninstall` will not know about it.
