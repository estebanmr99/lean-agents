# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

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
