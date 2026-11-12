# Install with an agent

Hand lean-agents to Claude Code, OpenCode, Copilot CLI or Antigravity CLI. The agent reads machine output (`--json`) instead of scraping text, asks you before it changes anything, and installs with exact flags.

## Prompt to paste

```text
Install lean-agents for me from https://github.com/estebanmr99/lean-agents.
Follow docs/install-with-an-agent.md in that repo. Ask before every change.
Never read, print or store my API keys or tokens, and never run gh auth login for me.
```

## Steps the agent follows

1. **Get the engine.** Use the latest release, not a clone of `main`. Run the release bootstrap with the read-only flags of step 2; it checks the download against the release's `SHA256SUMS` and unpacks it to `~/.config/lean-agents/src` (Windows: `%USERPROFILE%\.config\lean-agents\src`). Node.js 22.20 or newer.
   - macOS, Linux, Git Bash: `curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash -s -- --doctor --json`
   - Windows PowerShell: `& ([scriptblock]::Create((irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1))) -Doctor --json`
   - Once the npm package is published, `npx lean-agents --doctor --json` does the same.

   Later steps run `node scripts/lean.mjs` from that folder.
2. **Detect the setup.** The step 1 command printed this; run `node scripts/lean.mjs --doctor --json` to repeat it. It prints `{"ok": bool, "rows": [{"item", "status", "detail"}]}`; `status` is `ok`, `changed`, `note`, `error` or `missing`. `missing` on `lean-agents` means a fresh install.
3. **Ask the user**, one question each, with the answer's flag:
   - Which agents? `--agents claude,opencode-v2,copilot-cli,antigravity,vscode-copilot,cursor`
   - Which tools? `--tools <list>` or `--all-tools`; `--no-core` leaves out RTK and Context Mode.
   - Move an existing setup over? `--migrate auto` (see the README, "Migrate from another tool").
   - Which network preset? `--network on` or `--network off` (strict). `--telemetry`, `--auto-update` and `--outbound` override one category.
   - Which terminal integration? Orca and Warp are detected and preselected: `--terminal orca|warp|both|none` (`none` opts out). The terminal apps are never installed.
   - Install GitHub CLI? It is on by default when missing; `--no-gh` skips it. The user runs `gh auth login` themselves.
4. **Show the plan.** Run `node scripts/lean.mjs --yes --dry-run --json <flags>`. stdout is one JSON object (`agents`, `tools`, `network`, `files`, `commands`); messages go to stderr. Summarize files and commands for the user and wait for a yes. A line starting with `! git not found` on stderr means git is missing: show its install hint.
5. **Install.** Run the same command without `--dry-run` and `--json`.
6. **Verify.** Run `node scripts/lean.mjs --doctor --json` again. Report every row that is not `ok`.

Undo everything with `--uninstall`.

## Update with an agent

The `lean-update` skill (installed by lean-agents for every agent) runs these steps; without it, the agent follows them from this page. The script is the only thing that changes files. Doing it by hand from [manual-install.md](manual-install.md) is the fallback for a machine that cannot run Node.

1. **Latest release.** `gh release view --repo estebanmr99/lean-agents --json tagName -q .tagName`. Read `core/pins.json` from `https://raw.githubusercontent.com/estebanmr99/lean-agents/<tag>/`, and the release notes and `CHANGELOG.md` sections between the installed version and the latest. Breaking changes and upgrade steps come first; a release without clear upgrade notes is called out as such.
2. **Detect.** With `state.json`: `node scripts/lean.mjs --doctor --json`; `behind` lists `{tool, installed, pinned}`. Without it (hand install): the read-only commands in [manual-install.md section 6](manual-install.md#6-detect-what-is-installed-read-only), then pass what they found as `--agents` and `--tools`; the script writes the state from then on and never overwrites your files.
3. **Dry run.** `node scripts/lean.mjs --update --dry-run --yes --json` (hand install: the same flags as a fresh install). The agent shows `tool | installed | pinned | impact | upgrade notes | what it would run` and asks.
4. **Back up, update.** One folder under the OS temp dir with only the files that change ([section 7](manual-install.md#7-back-up-before-changing-delete-after)), then the same command without `--dry-run`. `--update` prints `tool: old -> new` and installs only pinned versions.
5. **Read back.** `--doctor --json`. When `ok` is true and `behind` is empty, the backup folder is deleted and the agent says so. `--uninstall` still undoes everything.
6. **Share findings (optional).** Same rules as the next section, with `--feedback-kind update`: never under strict or off, a redacted draft, a duplicate check, `gh issue create` only after a yes.

## Opt-in feedback after a failure

Only if a step failed, and only if the network preset allows outbound calls (`--network on`, or the saved preset). With `--privacy strict`, `--network off` or `--outbound off` the agent never offers.

1. Ask: "Install failed. Draft a redacted issue for lean-agents?" Stop on no.
2. Pipe the error text through the engine, which removes home paths, user names, proxy and CA values, emails and tokens:
   `node scripts/lean.mjs --feedback-draft --failed-command "<the command>" --network on < error.txt`
   The output is `{"title", "body"}`, or `{"offer": false}` (then stop). Pass `--network` as the user chose it when nothing is installed yet.
3. Check duplicates: `gh issue list --repo estebanmr99/lean-agents --search "<title words>"`. If one matches, show it and stop.
4. Show the full draft. Only after the user says yes, run `gh issue create --repo estebanmr99/lean-agents --title "<title>" --body-file <draft>`.

The draft holds OS, versions, the failing command and the error. Employer names cannot be detected, so the user reads the draft before anything is sent.
