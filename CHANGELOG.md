# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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

### Changed

- Node.js 20.12 or newer is required (`@clack/prompts` needs `util.styleText`).

### Fixed

- `models-refresh` no longer reports a model the same profile already uses, or one with different outputs such as an image model (issue #6). Profiles unchanged; reasons in `profiles/README.md`.
- After the last prompt on `/dev/tty`, as in `curl | bash`, the installer exits instead of hanging.
- Without a TTY and without `--yes`, the installer stops with a clear message instead of a crash, and `--dry-run` with every choice passed as a flag exits 0.
- The OpenCode undo no longer leaves `~/.agents/skills` when another agent is detected.
- Real-binary test scripts run agent CLIs only after HOME is a throwaway.
- With `--home`, `XDG_CACHE_HOME`, `XDG_DATA_HOME` and `XDG_STATE_HOME` outside it are dropped.

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
