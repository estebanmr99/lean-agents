# Fresh machine: one command (`--everything`)

From a Mac or Windows PC with no Node.js, git or Homebrew to Claude Code and OpenCode 2 with the optional tools. The flow is detect, plan, apply, verify. Short version: [README](../README.md#fresh-mac-or-windows-pc---everything). Flags: the "All flags" table in the README.

Nothing here has been run on a bare machine by the owner yet. What CI proves, and what stays **VERIFY**, is at the end and in [compatibility.md](compatibility.md).

## Before you start

1. **Work PC or proxy?** Read [SECURITY-REVIEW.md](SECURITY-REVIEW.md) and set `HTTPS_PROXY`, `NO_PROXY` and `NODE_EXTRA_CA_CERTS` in your own terminal first (they are read, never written to disk). Add `--network off` to switch telemetry, auto-updates and outbound calls off.
2. **Already on OpenCode 1.x?** Do not use `--everything`. It installs OpenCode 2. Use `--adopt` and `--upgrade-agent opencode` ([README](../README.md#quick-start)).
3. **Your own Node.js stays the default.** The tools that need Node 24 get it under nvm; a Node you have, even an old one, is never replaced.

## macOS

1. **See the plan.** Nothing changes:

   ```bash
   curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash -s -- --dry-run --everything
   ```

   With no Node.js, `install.sh` stops after printing what it would do. With Node.js 22.20+ it hands over to the engine and prints the full plan.

2. **Run it.**

   ```bash
   curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash -s -- --everything
   ```

3. **Answer the prompts, in this order.**
   - *Bootstrap, only when Node.js 22.20+ is missing:* how to get it. With Homebrew: `brew install node`. Without Homebrew: the official Homebrew installer (asks for your macOS password and installs the Xcode Command Line Tools; a system dialog may appear), or a Node.js download from nodejs.org checked against `SHASUMS256.txt` into `~/.config/lean-agents/node` (no admin). `--yes` accepts only that last one.
   - *Engine plan, then one question:* `Apply these changes?` (default yes). Nothing is changed before you answer.

4. **Read the plan** the engine prints. Summarised:
   - `Prerequisites`: one line per step, each `will install` or `skipped (reason)`: Xcode Command Line Tools, Homebrew, nvm, Node 24 (under nvm), uv, RTK, Bun.
   - `lean-agents plan for claude, opencode-v2`: the tools, privacy level, language and network choices.
   - `Files`: every file it creates or edits (`create`, and the other kinds the plan prints).
   - `Commands`: every command it runs, such as `claude plugin install ...`.
   - A line `after nvm: run lean-agents --update to add ...` when a tool needs Node 24 that nvm only gets during this run.

5. **Finish.** Open a new terminal (the PATH changed), then:

   ```bash
   npx lean-agents@latest --doctor
   ```

   Log in to each agent yourself (`claude`, `opencode`, `gh auth login`). lean-agents never reads or stores credentials.

## Windows

1. **See the plan.** PowerShell 5.1 or 7, no admin:

   ```powershell
   & ([scriptblock]::Create((irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1))) -DryRun --everything
   ```

   With no Node.js, the dry run uses a temporary copy and keeps your profile clean.

2. **Run it.**

   ```powershell
   & ([scriptblock]::Create((irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1))) --everything
   ```

   `--everything` goes through the bootstrap as it is; the PascalCase switch `-Everything` does not exist yet.

3. **Answer the prompts.**
   - *Bootstrap, only when Node.js is missing:* it asks first (`-Yes` accepts). It tries `winget` (user scope); without `winget` it downloads the Node.js 24 zip from nodejs.org (SHA-256 checked) into `%USERPROFILE%\tools\node`. git is not needed.
   - *Engine plan, then* `Apply these changes?`.

4. **The plan** has the same parts as on macOS, with nvm-windows instead of nvm and Homebrew and the Command Line Tools left out. The team preset adds the Copilot CLI, VS Code Copilot and Antigravity that are already on the PC; the ones it does not find appear in the plan as `not found, skipped`.

5. **Finish.** Open a new terminal, then `npx lean-agents@latest --doctor`.

## If it stops

- **Rerun the same command.** Finished prerequisites are skipped (`finished in an earlier run`).
- **An agent will read the result for you:** add `--dry-run --json` to print the plan, or see [install-with-an-agent.md](install-with-an-agent.md).
- **Failed step:** `--feedback-draft` turns the error into a redacted issue draft (needs `--failed-command`).

## Undo

```bash
npx lean-agents@latest --uninstall
```

It undoes what lean-agents changed. Kept on purpose: a prerequisite you already had; Homebrew itself (its uninstaller is interactive, so there is no automatic undo); `~/.nvm` unless every Node under it is v24. Agent CLIs lean-agents installed are removed by `--uninstall-agent` (plan first, `--yes` runs it).

## What is proven, what is not

| Claim | Status |
| --- | --- |
| The plan (`--everything --dry-run --json`) lists prerequisites then agents, and a rerun resumes | Offline tests (`tests/everything.test.mjs`, `tests/prereqs.test.mjs`) |
| `install.sh` and `install.ps1` reach the engine with Homebrew, Node.js, git, gh and nvm hidden from PATH | Nightly `fresh-machine` workflow (macOS, Windows, `ubuntu:24.04`); not a bare image |
| Homebrew installer unattended, Xcode Command Line Tools headless | **VERIFY**: no CI runner lacks Homebrew |
| nvm-windows and the Node MSI without admin; `winget` on corporate images | **VERIFY** |
| Behind a TLS-inspecting corporate proxy | **VERIFY**: only a real work PC can show it |
| Run once on a truly fresh Mac and PC | **VERIFY**: the owner reports it on [#179](https://github.com/estebanmr99/lean-agents/issues/179) |
