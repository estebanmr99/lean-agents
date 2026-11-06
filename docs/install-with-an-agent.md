# Install with an agent

Hand lean-agents to Claude Code, OpenCode, Copilot CLI or Antigravity CLI. The agent reads machine output (`--json`) instead of scraping text, asks you before it changes anything, and installs with exact flags.

## Prompt to paste

```text
Install lean-agents for me from https://github.com/estebanmr99/lean-agents.
Follow docs/install-with-an-agent.md in that repo. Ask before every change.
Never read, print or store my API keys or tokens, and never run gh auth login for me.
```

## Steps the agent follows

1. **Get the engine.** Clone the repo to `~/.config/lean-agents/src` (Windows: `%USERPROFILE%\.config\lean-agents\src`). Use `node scripts/lean.mjs` below; Node.js 20.12 or newer.
2. **Detect the setup.** Run `node scripts/lean.mjs --doctor --json`. It prints `{"ok": bool, "rows": [{"item", "status", "detail"}]}`; `status` is `ok`, `changed`, `note`, `error` or `missing`. `missing` on `lean-agents` means a fresh install.
3. **Ask the user**, one question each, with the answer's flag:
   - Which agents? `--agents claude,opencode-v2,copilot-cli,antigravity,vscode-copilot,cursor`
   - Which tools? `--tools <list>` or `--all-tools`; `--no-core` leaves out RTK and Context Mode.
   - Move an existing setup over? `--migrate auto` (see the README, "Migrate from another tool").
   - Which network preset? `--network on` or `--network off` (strict). `--telemetry`, `--auto-update` and `--outbound` override one category.
   - Install GitHub CLI? It is on by default when missing; `--no-gh` skips it. The user runs `gh auth login` themselves.
4. **Show the plan.** Run `node scripts/lean.mjs --yes --dry-run --json <flags>`. stdout is one JSON object (`agents`, `tools`, `network`, `files`, `commands`); messages go to stderr. Summarize files and commands for the user and wait for a yes. A line starting with `! git not found` on stderr means git is missing: show its install hint.
5. **Install.** Run the same command without `--dry-run` and `--json`.
6. **Verify.** Run `node scripts/lean.mjs --doctor --json` again. Report every row that is not `ok`.

Undo everything with `--uninstall`.

## Opt-in feedback after a failure

Only if a step failed, and only if the network preset allows outbound calls (`--network on`, or the saved preset). With `--privacy strict`, `--network off` or `--outbound off` the agent never offers.

1. Ask: "Install failed. Draft a redacted issue for lean-agents?" Stop on no.
2. Pipe the error text through the engine, which removes home paths, user names, proxy and CA values, emails and tokens:
   `node scripts/lean.mjs --feedback-draft --failed-command "<the command>" --network on < error.txt`
   The output is `{"title", "body"}`, or `{"offer": false}` (then stop). Pass `--network` as the user chose it when nothing is installed yet.
3. Check duplicates: `gh issue list --repo estebanmr99/lean-agents --search "<title words>"`. If one matches, show it and stop.
4. Show the full draft. Only after the user says yes, run `gh issue create --repo estebanmr99/lean-agents --title "<title>" --body-file <draft>`.

The draft holds OS, versions, the failing command and the error. Employer names cannot be detected, so the user reads the draft before anything is sent.
