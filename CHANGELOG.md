# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- `CONTRIBUTING.md` has a "Development" section (Node 22.20+, `npm ci`, `npm test`, shellcheck, privacy check, safe dry run), the adapter path (`scripts/lib/adapters/*.mjs`, not `agents/`), and a "Proposing a tool" section linked from `tools/README.md` (#71).
- `--doctor` honors the network preset (#72, N7, N8): child commands get `DO_NOT_TRACK` and friends under telemetry off, and `mcp list` (which starts Serena and Playwright) is skipped with one `skipped` row when outbound is off. `tests/doctor-network.test.mjs`.
- Every third-party GitHub Action is pinned to a full commit SHA with a `# vX.Y.Z` comment (#69). Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm and actions. A `lint` step fails on any new tag-only `uses:` line.
- README is a 1-minute read (#58): positioning line, one install command, demo GIF, a support matrix (agent × macOS/Linux/Windows × rules, subagents, MCP tools × CI job; cells without a real-binary job say VERIFY), an at-a-glance list and a diagram, all above a Details divider. Everything else moved below it; README.es.md mirrors it.
- `scripts/check-readme.mjs` also fails on a hero over 80 lines, an image without alt text or over 5 MB, and EN/ES image-count drift. It runs in the `lint` job and in the release workflow.
- Privacy presets match `docs/privacy.md` (#63): new "What each preset does NOT block" section (install downloads, chosen tools); `--network off` or `--outbound off` drops the research agent's web tools in Claude Code, Copilot CLI and VS Code Copilot; the Orca row mentions the Windows user env var.

### Added

- OpenCode 1.x guard (#79): `--doctor` (text and `--json`) says "OpenCode 1.x: supported; lean-agents will not upgrade it"; `tests/opencode-guard.test.mjs` fails if an install, `--update`, `--migrate` or `lean-update` plan installs or upgrades OpenCode; the `lean-update` skill leaves an OpenCode 2 upgrade to the user and tells them to back up `opencode.db` and config first; "Staying on OpenCode 1.x" in `docs/compatibility.md` (data folder, backup; Windows path still **VERIFY**).
- `docs/checkpoints/0.7.0.md`: first architecture checkpoint (#59). It recommends keep, change or spike on the installer's form, the script-plus-agent split, what to stop, the numbers, and the 0.7.0 scope.
- Issue forms for bug, feature, update finding and agent support; blank issues are off and vulnerabilities point to `SECURITY.md`. The bug and update-finding forms list the fields the opt-in feedback flow fills (os, version, agents, command, error).
- `scripts/labels.sh`: idempotent label set (`type:`, `priority:`, `area:`); it renames GitHub's default `bug`, `documentation` and `enhancement` so existing issues keep them.
- `docs/audit-2026-11.md`: repo audit (README, security, network and privacy, repo health), and a "Before each release" checklist in `docs/SPEC.md`.
- `lean-update` skill, installed for every agent through the Skills CLI at the release tag (`lean-update` pin). It reads the latest release's `core/pins.json` and CHANGELOG, detects what is installed (also for hand installs without `state.json`), runs `--update --dry-run --json`, shows a table, asks, backs up only what changes in one temp folder, runs the script, reads `--doctor --json` back and deletes the backup (#45).
- `docs/manual-install.md` sections 6 (read-only detection command per tool) and 7 (backup snippet); a test runs every detection command with no writes.
- `--update` prints `tool: old -> new` and installs again the tools whose pin moved (Context Mode, MCP servers, the i-have-adhd checkout), recording each command once; `--doctor --json` and `--update --dry-run --json` list `behind` (#45).
- `--feedback-draft --feedback-kind update` drafts an "Update finding" issue with the same redaction and strict/off gate.
- The daily green `ci-latest` run opens one `pin-bump/<date>` PR (newest stable versions at least 14 days old) and dispatches `ci.yml` on its branch; a human merges (#45). `ci.yml` gained `workflow_dispatch`.
- CI job `real-update`: old pins in a throwaway HOME, `--update`, new versions, nothing behind, `--uninstall` leaves nothing.

### Changed

- The daily version watch also labels its issues `type: update`.

## [0.6.0] - 2026-11-06

0.5.1 was folded into this release: its fixes are listed below.

### Fixed

- GSD Core no longer crashes when Cursor is selected: Cursor installs with `--cursor`, and agents without a GSD installer (`vscode-copilot`) are skipped with a note (#20).
- The test "--yes keeps every tool default for undocumented settings" no longer depends on a host proxy (#31).
- `install.ps1` finds OpenCode 2 in `%USERPROFILE%\.opencode\bin` when it is not on PATH and says how to fix the PATH (#32).
- Context Mode 2 on Copilot CLI: pinned `context-mode@2.1.4`, registered with `copilot mcp add` (the old plugin path no longer exists and `setup` is a no-op for Copilot); hooks and skills are left to `context-mode setup --print copilot-cli`. Antigravity is skipped with a note because `setup --list` has no Antigravity agent. `--uninstall` runs `copilot mcp remove context-mode` (#39).
- Context Mode is skipped for every agent, with one line, when Node is older than 24.15 (its `engines`); `--doctor` reports it as a `note` and `--update` installs it after a Node upgrade (#39; an `nvm` helper is issue #44).
- `--uninstall` no longer leaves `~/.copilot/mcp-config.json` without `mcpServers`, which Copilot rejects: a file lean-agents created is removed, a file you own keeps `mcpServers: {}` (#39).

### Changed

- **Breaking:** the minimum Node.js is now 22.20 (was 20.12), because Node 20 is end of life and `skills` 1.5.19 and later need 22.20. `package.json` `engines`, `install.sh`, `install.ps1`, the README and the docs say so; CI drops the Node 20 job.
- `skills-cli` pinned at 1.7.4 (was 1.5.18), the newest 1.7.x at least 14 days old (#49).
- CI (#42): pull requests use the pinned versions, now including the Claude Code, OpenCode 1.x and Copilot CLI npm packages (`ciOnly` pins in `core/pins.json`, not installed for users; Claude Code is installed from npm in CI instead of `claude.ai/install.sh`; OpenCode 2, Cursor and `agy` stay on their installers); docs-only PRs run only `lint`, `test` and the Secret scan; every job has `timeout-minutes`; macOS dropped where it added nothing; shellcheck and PSScriptAnalyzer cover every tracked script.
- `gh` (GitHub CLI) is installed by default when missing; it used to default to no (#37).
- MCP servers, npx tools and skills no longer fetch `@latest` or the default branch: exact versions and tags come from `core/pins.json`. Skills install with `owner/repo#<tag>` (a trailing `@<tag>` is ignored and installs HEAD). `docs/SECURITY-REVIEW.md` and the README "On a work PC" list run-time fetches as their own category (#33).
- Docs: `docs/privacy.md` table renders again and covers Cursor, VS Code Copilot, Warp and Orca; `tests/README.md` describes `npm test` and the `real-*` scripts; the Cursor CLI install row in `docs/compatibility.md` is correct for Windows (#27).
- Docs: the demo step 1 has a verified Windows PowerShell block for OpenCode 2 (EN, ES); `docs/SECURITY-REVIEW.md` notes the upstream script checks no tarball checksum (#32).

### Added

- Install with an agent (#35): `docs/install-with-an-agent.md`, a copy-paste prompt in both READMEs, and `--json` for `--dry-run` and `--doctor` (stdout is one JSON object; messages go to stderr).
- Opt-in feedback (#36): `--feedback-draft --failed-command <text>` prints a redacted issue draft (no home paths, user names, proxy values, emails or tokens), and never offers one under the strict preset or `--outbound off`. The agent files it with `gh issue create` only after a yes.
- `--no-gh` (`-NoGh`) and a `git` check (#37). The `gh` field in `--dry-run --json` means "to install"; without brew or winget (Linux) the plan only prints the download link, and a failed or manual `gh` step never fails the run.
- `--migrate <from|auto>` (`-Migrate` on Windows): copies rules, subagents, skills, prompts and MCP servers from Claude Code, VS Code Copilot, Cursor, Copilot CLI or OpenCode 1/2 to the agents in `--agents`, at user scope or inside a repository with `--project`. Never moves or overwrites; MCP env and header values are not copied, only their names; hooks are listed, not migrated; `--dry-run` prints an item / source / target / status table. CI job `real-migrate` runs it with the real OpenCode 2 and Claude Code (#34).
- `ci-latest.yml`: a daily run of the real-binary jobs with the newest upstream versions; a failure opens or comments on one `version-watch` issue instead of blocking PRs (#42). `docs/branch-protection.md` has the command that makes the key checks required.
- Orca on Windows: `ORCA_SKILL_AGENT` covers Cursor and VS Code Copilot (#21); with the all-off preset it sets `DO_NOT_TRACK=1` and `ORCA_TELEMETRY_DISABLED=1` in the user env when absent, and behind a proxy it appends the missing `localhost`, `127.0.0.1`, `::1` to the user `NO_PROXY` (#22, #28). Undo removes only what it set.
- Git Bash: a marked `~/.bashrc` block with the Cursor `agent` / `cursor-agent` aliases (`MSYSTEM= SHELL=`) and the loopback `NO_PROXY` entries (#23, #28).
- Cursor behind a proxy: `network.useHttp1ForAgent: true` merged into `~/.cursor/cli-config.json`; proxy values are never written (#25).
- "Still needed from you" list after install and in `--doctor` (Cursor login, User Rules, Orca first launch and Install CLI & Skills); `--doctor` finds Orca's hook entries, also PowerShell-encoded ones (#22, #26, #29).
- CI jobs `real-cursor-windows` (real Cursor CLI, `agent.cmd`, Git Bash alias block) and `real-terminals-windows` (Orca user-env writes and their undo, runner env restored).
- `core/pins.json`: the one list of known-good versions fetched at run time (Playwright MCP, Context Mode, Codeburn, AutoSkills, GSD Core, DCP, the Skills CLI, the Caveman, i-have-adhd and orca-cli skills), each with the day verified and the CI job that proves it. `state.json` records them and `--doctor` shows `changed` when they differ (#33).
- `version-watch` workflow (daily and on demand): opens one `Update available: <item>` issue per pin with a newer upstream version, comments on the open one for each newer version, never twice for the same version, and never changes a pin (#40).
- `update-models` skill: "Tool versions" section to list newer versions and bump pins after approval (#33).
- `--no-core` (`-NoCore`): leaves out RTK and Context Mode so a managed PC gets only the `--tools` you list; `--update` keeps the choice (#30).
- `docs/ROADMAP.md`: the order of the next releases, the issues each session closes, and the promotion plan.

## [0.5.0] - 2026-11-04

### Added

- `docs/launch.md`, a README banner, and an `assets` workflow that renders the demo GIF and social preview in CI.
- `release.yml`: a tag `v*` publishes the CHANGELOG notes and source archives. `scripts/release.mjs` builds them.
- CI job `real-skills-undo`: real Skills CLI, throwaway HOME, Claude Code and OpenCode 1.x and 2.x.
- Network presets: one question (all off, all on, per category) and `--network on|off`, `--telemetry`, `--auto-update`, `--outbound` for `--yes` runs. Saved in `state.json`; `--privacy strict|standard` map to the presets. Telemetry off also sets `DO_NOT_TRACK=1` for Claude Code and for install commands.
- Proxy support: `HTTP(S)_PROXY`, `ALL_PROXY` and `NO_PROXY` are passed to every command in both letter cases, and shown redacted in `--dry-run` and `--doctor` with any CA variables. Never written to disk.
- `--gh`: installs GitHub CLI with brew or winget at user scope; `gh auth login` stays manual.
- Interactive menus, a progress list and a summary on a real terminal, with `@clack/prompts` (the one new dependency). `--yes`, pipes and no-TTY runs keep the plain questions.
- Settings upstream does not document (Antigravity telemetry and auto-update, Serena config, winget persistent proxy, download hosts, DCP, GSD and AutoSkills telemetry): the installer asks to paste docs or IT notes, saved to `~/.config/lean-agents/notes/` for an agent to apply after review, or keep the tool's default. Never guessed and never applied automatically; skipped when another agent already set the tool up.
- `docs/SECURITY-REVIEW.md`: a prompt any agent runs on this repo before install.
- CI: `real-proxy` (install through squid with direct traffic blocked, all-off preset, gh and agy behind the proxy), a pty test for the menus, no-TTY checks in PowerShell 5.1 and Git Bash, `gh` through winget.
- `docs/compatibility.md` "Terminals": Warp and Orca install routes, the hooks Orca adds, its permission modes and how to keep approvals on. Research only; the installer does not offer either app yet.
- Plan for session 10 (parallel agent sessions) in `docs/SPEC.md`, with the research in `docs/compatibility.md`.
- `--agents vscode-copilot`: rules, subagents, user MCP servers, skills and strict privacy settings for VS Code Copilot. Shared `~/.copilot` files are written once when Copilot CLI is also selected.
- `--agents cursor`: subagents, MCP servers, RTK hook and skills for Cursor and its `agent` CLI.
- `--project <dir>` (`-Project` in PowerShell): writes the team setup into one repository (`AGENTS.md`, `.github/`, `.vscode/mcp.json`, `.cursor/`). State stays in the user's home.
- `docs/claude-with-copilot.md`: the official route to Claude through GitHub Copilot (partner agent); token proxies are documented as not supported.
- CI jobs `real-cursor` and `real-vscode`: real Cursor CLI and VS Code CLI in a throwaway HOME, Linux and macOS.
- Plan and research for full Antigravity support (app and CLI on macOS, Windows and Linux): `docs/SPEC.md` session 11, `docs/compatibility.md`, both READMEs.
- Opt-in `--tools playwright-extension`: Playwright MCP in extension mode (`--extension`) for OpenCode, Copilot CLI, VS Code Copilot and Cursor, so agents use your own signed-in Chrome on pages behind single sign-on. The installer prints the Chrome Web Store link; `docs/browser-extension.md` covers the optional auto-approve token, which lean-agents never asks for, stores or prints.
- CI job `bench-context-mode`: Context Mode `ctx_execute` with Node only and with Bun on Ubuntu, macOS and Windows, numbers in the job summary.
- Bun for Context Mode, on by default when `context-mode` is selected (`--no-bun`, `-NoBun` to opt out): faster `ctx_execute` and TypeScript. User scope on every OS (Linux upstream script into `~/.bun` with no profile edit, macOS `brew install oven-sh/bun/bun`, Windows upstream `install.ps1`); an existing Bun is reused and never removed; a failed install falls back to Node with one line. With telemetry off, a marked `telemetry = false` block at the top of `~/.bunfig.toml`, removed by `--uninstall`.
- CI job `real-bun` (Ubuntu, macOS, Windows): Bun found by Context Mode through the MCP client, reuse, `--no-bun`, fallback and uninstall; `real-proxy` also checks Bun through the proxy.
- `scripts/parallel.mjs` (`start`, `status`, `merge`, `clean`) and the `parallel-sessions` skill: one worker per task in its own git worktree (Orca when installed, plain `git worktree` otherwise), prompt and status files, one-at-a-time merges with a rebase of the rest. Each worker gets a model tier (`cheap`, `balanced`, `strong`; default by role: plan strong, build balanced, explore and research cheap) mapped through the model profiles. `--doctor` lists workers left in the repo.
- CI job `real-parallel`: real git worktrees and a stub agent on Ubuntu and macOS; flags checked against real Claude Code and OpenCode.
- Antigravity CLI on Windows: CI job `real-antigravity-windows` runs real `agy` with `install.ps1` in a throwaway `USERPROFILE`.
- With Antigravity selected, the CLI and the app are installed through Homebrew (macOS) or winget (app only, Windows); other cases print the vendor link. `--no-app` (`-NoApp`) skips the app. App-side loading, its MCP path and settings stay VERIFY.
- `--terminal warp|orca|both|none`: agent integrations for a terminal you already have. Warp: Claude Code plugin `warp@claude-code-warp` and the OpenCode plugin `@warp-dot-dev/opencode-warp`. Orca: the `orca-cli` skill. The apps are detected (never installed) and preselected; nothing found means no question. The all-off network preset prints the Warp and Orca telemetry switches. CI job `real-terminals` (real Claude Code, OpenCode 1.x and 2.x, throwaway HOME).
- README (EN and ES): a hero with one badge row and the OpenCode + GitHub Copilot demo as the first call to action, a table of contents, collapsible long sections, bullets instead of long paragraphs, and `scripts/check-readme.mjs` (run by `npm test`), which checks links, anchors, EN/ES structure and that every installer command shown exits 0 as a dry run.

### Changed

- Node.js 20.12 or newer is required (`@clack/prompts` needs `util.styleText`).
- Owner decision (2026-11-04): Warp plugins are no longer refused outright (`AGENTS.md`, `docs/SPEC.md` section 2, `docs/faq.md`).
- `--agents ... --tools ...` runs without `--yes` now also need `--terminal` when a terminal is found, like the other questions.

### Fixed

- `models-refresh` no longer reports a model the same profile already uses, or one with different outputs such as an image model (issue #6). Profiles unchanged; reasons in `profiles/README.md`.
- After the last prompt on `/dev/tty`, as in `curl | bash`, the installer exits instead of hanging.
- Without a TTY and without `--yes`, the installer stops with a clear message instead of a crash, and `--dry-run` with every choice passed as a flag exits 0.
- The OpenCode undo no longer leaves `~/.agents/skills` when another agent is detected.
- Real-binary test scripts run agent CLIs only after HOME is a throwaway.
- With `--home`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` outside it are dropped.
- A Claude-only install with `--tools playwright-extension` no longer gets the Playwright and `ToolSearch` rule lines.

## [0.4.0] - 2026-10-31

### Added

- GitHub Copilot CLI adapter: rules, subagents, MCP servers, RTK, Context Mode plugin, Caveman, i-have-adhd.
- Antigravity CLI adapter: same set, except that rules and skills loading is not proven (see `docs/compatibility.md`).
- Tools: Codeburn. GSD Core and AutoSkills are opt-in and stay out of `--all-tools`. AutoSkills is CC BY-NC 4.0, non-commercial use only.
- Profiles `github-copilot`, `opencode-go`, `openai-api`, and per-agent GSD models in `profiles/<name>/gsd-defaults.json`.
- Skills `setup-doctor`, `token-audit`, `update-models`.
- `scripts/models-refresh.mjs` and a monthly workflow that opens an issue when profile models change.
- CI jobs with real Copilot CLI (Linux, macOS, Windows), real Antigravity CLI, real winget, and a non-default `XDG_CONFIG_HOME`.

### Changed

- i-have-adhd: lean-agents sets `disable-model-invocation: false` in installed copies so a prompt can load the skill. The doctor reports when an update resets it.
- The installer exits 1 when an install step fails.

### Fixed

- `XDG_CONFIG_HOME` is honored for the OpenCode and Ponytail config paths. With `--home`, it counts only inside that directory.
- winget no longer stops at an agreement prompt without a TTY.
- CI negative checks written as `! cmd` never failed a job; they now do.

## [0.3.0] - 2026-10-30

### Added

- `install.ps1` for Windows on PowerShell 5.1 and 7, from a file or piped.
- OpenCode 1.x adapter (`>=1.18.29`, reference 1.19.0), and `docs/migrate-opencode-v1-to-v2.md`.
- Optional DCP tool for OpenCode 1.x.
- CI on Windows, plus jobs with real OpenCode 1.19, Claude Code and tool installs.
- `AGENTS.md`, `CLAUDE.md` and `.claude/settings.json` for agents working on this repo.
- Detailed steps for sessions 3 to 5 and a current-state summary in `docs/SPEC.md`.

### Changed

- Global rules now say when to use Context Mode, Playwright and the shell, and to load deferred tools first.

### Fixed

- RTK hook on Claude Code is now registered without a terminal, as in `curl | bash` installs.
- Caveman installs only its three skills, without a terminal, and uninstalls cleanly.
- Windows: only `.cmd` shims run through a shell, so paths with spaces work.
- Windows: Ponytail config stays inside `--home`.
- Windows: rule paths use forward slashes.

## [0.2.0] - 2026-10-31

### Added

- Node engine (`scripts/lean.mjs`): plan, `--dry-run`, apply with backups, `--update`, `--uninstall`, `--doctor`.
- JSON/JSONC merging that keeps your comments and your values; marked blocks for `CLAUDE.md`.
- Claude Code adapter: rules import, tiered subagents, settings, RTK, Context Mode, Ponytail, i-have-adhd, Serena, Playwright, Caveman.
- OpenCode 2.x adapter: rules, subagents, primary agent models, compaction, MCP servers, Ponytail, i-have-adhd, RTK, Caveman.
- Strict privacy mode for both agents.
- Model profiles: `claude-subscription`, `anthropic-api`, `vertex-gemini`.
- `install.sh` bootstrap, engine tests and CI on Ubuntu and macOS.
- Docs: compatibility and verification log, manual install, privacy, update.

## [0.1.0] - 2026-10-31

### Added

- Build specification (`docs/SPEC.md`).
- Global rules in English and Spanish (`core/AGENTS.md`, `core/AGENTS.es.md`).
- Neutral subagent definitions: explore, research, review, debug, planner.
- MCP server list and tier example.
- Privacy check script and secret-scan workflow.
