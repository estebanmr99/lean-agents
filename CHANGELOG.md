# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
