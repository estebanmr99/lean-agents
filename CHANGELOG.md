# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Fixed

- `--upgrade-agent opencode`: the `api.command` reason is given only to plugin files that use `api.command` (others say the 2.x plugin API is not proven), `plugins/package.json` and `node_modules` are not listed as plugins, local `tui.json` plugins are named `<folder>/tui.js` instead of `file:tui.js`, and `permission` and `experimental` get a specific **VERIFY** reason (#173).
- The lifecycle test builds the opencode-v2 and copilot-cli version checks from `core/pins.json`, so a pin bump no longer fails CI (#184).
- `install.sh` and `install.ps1` no longer delete a git clone in the install folder that holds work not on its remote: they stop and tell you to move it when it has local changes, no upstream, unpushed commits, a stash or more than one local branch, or when `LEAN_AGENTS_SRC` points at a clone (#156).
- The engine saves `state.json` after writing files and before and after each command, so a write error or an interrupted or failing command no longer leaves files that `--uninstall` cannot undo (#158).
- `--uninstall` removes only what lean-agents created: the Linux and Windows Bun undo deletes `~/.bun/bin/bun` (`bun.exe`) and then its dirs only if empty, so your Bun cache and global packages stay; the OpenCode vendor undo re-derives the checkout path from your home at undo time and refuses a symlink, an edited `state.json` path or anything outside the home (#157).
- `--doctor` (text and `--json`) and the install preview print only `set` / `not set` for proxy and CA variables, so internal proxy hosts, ports and CA paths no longer reach stdout; `NO_PROXY` also reports whether the loopback entries are present (#172).

### Changed

- Release gate: `release.yml` stops before building anything when `docs/audit-<version>.md` is missing or an issue labeled `audit` is still open, so no release ships half audited. Audit findings of medium or higher get the new `audit` label.
- The Cursor CLI installer pin moves to `cursor.com/install` as of 2026-11-13 (reviewed: one download from `downloads.cursor.com`, no sudo or eval), which fixes the `real-cursor` sha256 mismatch (#193).

### Docs

- Versions: README (EN and ES), `docs/ROADMAP.md` and the spec name 0.8.0 as the latest release (#161). The npm item on the README roadmap is ticked; "Later: 1.0.0" lists #179 to #182.
- `docs/SECURITY-REVIEW.md` pin table names every key in `core/pins.json`; `tests/security-review-pins.test.mjs` fails when a key is missing (#155).
- `docs/compatibility.md`: the `lean-update` tag `v0.7.0` exists, and its tagged `skills add` form was checked in a throwaway HOME (#168).
- README (EN and ES): an "All flags" table covers every flag in `--help`, `--home` included (#167).
- Install docs (README, `docs/install-with-an-agent.md`, `skills/lean-update/SKILL.md`) use `npx lean-agents@latest` first and state Node.js 22.20+; Context Mode 2 and GSD Core need Node.js 24 via nvm. The bootstraps moved to a fallback section, and the `LEAN_AGENTS_VERSION` example is 0.8.0 (#178).

### Fixed

- Pin-bump PRs no longer fail the agent-lifecycle test: it builds the claude-code version check from `core/pins.json` instead of a hardcoded version (#159).

## [0.8.0] - 2026-11-12

### Added

- Orca status for OpenCode 1.x on Windows (#78): with Orca selected, the installer writes the owned file `~/.config/opencode/plugins/lean-orca-status-shim.js` so Orca's status plugin runs in OpenCode 1.19's TUI worker (`--uninstall` removes it). Not reproduced in CI (new `real-orca-opencode-v1` job), so it rests on the work-PC report; details in `docs/compatibility.md`.
- `--doctor` and the post-install checklist: restart Orca after changing `NO_PROXY` (Windows with a proxy), and the `~/.orca/keybindings.json` rebind that frees Ctrl+P for OpenCode (#78; never applied automatically).
- `--upgrade-agent opencode` dry run and `--json` (#80, PR A): classifies the OpenCode 1.x config (the `--adopt` inventory plus `agent`, `compaction`, `autoupdate`, `disabled_providers`, `keybinds`, agent/command folders) as managed, user-translatable (one row of the translation table, with source) or user-manual (with reason); changes nothing, prints key names only. Apply and `--undo` answer "not in this release yet". New opt-in `lean-migrate` skill (`--tools lean-migrate`).
- `--adopt --yes`, `--adopt --undo`, `--keep-backup`, `--confirm-removals` (#106, #132; session 106, PR C): applies the `--adopt` plan. Backs up each file it edits (and each folder it deletes) to `~/.config/lean-agents/adopt-<time>/` (owner-only), re-registers managed MCPs as `<tool Node> <entry>` (new `remove` mode in the `json` action for stale keys; `core/mcp.json` `legacy` gains the symlink and absolute `npx`/`node` shapes), installs the pin into the tool Node's prefix, then verifies (each MCP answers `initialize`, your own files and the OpenCode session count are unchanged, `--doctor` passes) and undoes itself on a failure. Old npm copies, a duplicate skill folder (the `~/.agents/skills` copy, only when Cursor and Copilot are absent) and hand-made stopgaps whose managed replacement is installed are removed only after a yes (menu or `--confirm-removals`), each backed up first. `--adopt --undo` restores bytes when the file still matches what we wrote, else reverts only our keys. New CI job `real-adopt` (ubuntu, windows). `probeInitialize` moved into `scripts/lib/inventory.mjs`.
- `--adopt` dry run and `--adopt --json` (#106, #132; session 106, PR B): inventories a hand-built machine (MCP servers of every client, Claude hooks and `enabledPlugins`, OpenCode `plugin`/`plugins`, `tui.json` plugins and the `plugins/` folder, skills, pinned npm copies under each nvm Node), classifies each item as managed, user, stale, duplicate, drift or wrong-node, and prints the planned action (keep, upgrade, remove, reinstall, ask) plus the Node the tools should use and the OpenCode session count (read from a copy of the database with `node:sqlite`, never the live file). Known hand-made stopgaps (the `copilot-usage` script and TUI plugin, the Orca status shim) are listed with the managed item that replaces them. Changes nothing; env and header values are never read. `--undo`, `--keep-backup` and `--confirm-removals` are parsed and rejected until the apply release. New `scripts/lib/adopt.mjs`, `tests/adopt.test.mjs`, `tests/fixtures/handbuilt.mjs`; `real-tool-node` seeds the fixture with real nvm on ubuntu and windows and checks the report and that the HOME tree hash is unchanged.
- `--migrate` to and from Antigravity (#80, PR D): `antigravity` is a source and a target at user scope (`~/.gemini/config/{rules,agents,skills,mcp_config.json}`); rules go to `rules/migrated-rules.md`, agents are rendered with the Antigravity adapter, MCP env and header values are never written. `--project` with Antigravity is refused (paths unverified). The `real-migrate` job now installs `agy` and reads migrated agents and MCP servers back with it, and migrates from Antigravity into Claude Code and OpenCode 2.
- `--install-agent a,b` / `--uninstall-agent a,b` (#80, PR C): opt-in install of Claude Code, OpenCode 2, Copilot CLI, Cursor CLI or the Antigravity CLI from the pinned installer (url + SHA256 now in `core/pins.json`, checked by `verify-sha256.mjs` before the script runs; `scripts/ci-download.sh` falls back to it) and an undo that deletes only the files recorded at install whose SHA256 still matches (`npm uninstall -g` for Copilot CLI), never `opencode uninstall`. Plan first, `--yes` or a question before anything runs; an agent not installed by lean-agents is left alone; OpenCode 1.x is never installed (#79). New `scripts/lib/agent-lifecycle.mjs`, `tests/agent-lifecycle.test.mjs`, `tests/real-agent-lifecycle.mjs`, run by the real-claude, real-opencode, real-copilot(-windows), real-cursor and real-antigravity jobs. Windows routes for Claude, OpenCode 2, Cursor and Antigravity are VERIFY (see `docs/compatibility.md`).
- `--doctor` shows the Node per tool and duplicate skills (#104 points 4-5, #132; session 106, PR A of `--adopt`): one `node for <client> mcp <name>` row for every registered MCP command that runs a pinned npm tool (absolute node, nvm link, bare `node`/`npx`, absolute `npx`), an `error` when that Node is below the tool's `engines.node`, and one `duplicate skill <name>` row for a skill found in two folders one agent reads (same or different content; no winner is claimed). `--doctor --json` adds `nodes` and `skills`. Read-only: nothing is changed or removed, and env and args are never printed. New `scripts/lib/inventory.mjs`; `real-tool-node` checks a symlink-launched MCP, an absolute one and a duplicate skill with real nvm on ubuntu and windows. `docs/manual-install.md` has the one-Node-per-tool and one-folder-per-skill rules.
- Code navigation evaluation (#130): `tests/bench-code-nav.mjs` and the manual-only `bench-code-nav` workflow compare codebase-memory-mcp with Serena over MCP stdio on ubuntu, macOS and Windows (result bytes as a token proxy, answer checks, index time and size, uninstall leftovers). Result in `docs/research/code-nav-2026-11.md`: keep Serena. Nothing installed for users changes.
- Multi-agent coordinator workflow (#60): `docs/agent-workflow.md` (roles, plan-first session prompts, model tiers, at most two workers, sandbox-first CI fixes, one-at-a-time merges, limit recovery) and an opt-in `coordinate` skill (`--tools coordinate`, never in `--all-tools`, removed by `--uninstall`) that ships a session-prompt template and `coord-watch.sh`, a bash watcher that exits with why a worker needs you (plan written, PR URL, question, limit, error, turn ended) from a transcript file or a terminal read command. New `real-coord-watch` CI job (ubuntu, macos).
- Git Bash as OpenCode's default shell on Windows (#124 follow-up): `--shell default|git-bash` (default `git-bash`). When Git Bash is found, OpenCode's `shell` key is set to its absolute `bash.exe` path through the usual `setIfAbsent` json edit, so a `shell` you already set is never overwritten; `--shell default` opts out; `--uninstall` removes it. Proven with a real OpenCode binary on `windows-latest` for both majors (1.19.0 and 2.2.5) in the new `real-opencode-shell` CI job: a local mock OpenAI-compatible LLM (`tests/fixtures/mock-llm.mjs`) drives one bash/shell tool call with no login and no paid model, and for the Git Bash case the job runs the real installer (not a hand-written config) and checks its own output. See `docs/compatibility.md` for the evidence (job IDs, date).
- Copilot credits, follow-up (#123): the OpenCode 2.x sidebar box and `/copilot-usage` toast are now proven on the real 2.x TUI (new `real-usage-v2` CI job, pseudo-terminal, fake `gh`). 2.x has a different TUI plugin API (`Plugin.define` with `setup(context)`, `context.ui.slot`, `context.keymap.layer`), so `plugins/lean-copilot-usage/tui.js` now exports both the 1.x and the 2.x entry points; on 2.x the plugin folder is discovered by itself, so no `tui.json` entry is written there (the 0.7.0 file and entry did not load on 2.x). New Claude Code status line: with `copilot-usage` selected, `~/.claude/lean-copilot-usage-statusline.mjs` (owned, built from the `--usage` formatter, `gh` called at most once per 5 minutes, nothing under `--outbound off`) is registered as `statusLine` only if you have none; `--uninstall` removes it only while the value is still ours. Cursor, Copilot CLI, VS Code and Antigravity: see `docs/compatibility.md` (Copilot CLI and Antigravity document a status line command, not wired yet).

### Fixed

- `--adopt` safety (pre-release audit): a Claude hook named after an inline `VAR=value` prefix no longer prints that value; `--adopt --undo` keeps the backup (and exits non-zero) when a removed folder exists again; apply and undo skip a folder or file reached through a symlink or outside HOME.
- README: Context Mode row for OpenCode 1.x/2.x and the "no admin rights" line now match what the installer does.

## [0.7.0] - 2026-11-12

### Added

- Windows shell notice (#124): the install summary and `--doctor` say whether Git Bash was found, and when it is missing, that RTK rewrites and bash-style commands fail or fall back, output is not compressed (more tokens) and the rules' POSIX examples do not apply, with `winget install Git.Git` as the fix. Nothing is shown off Windows. Setting OpenCode's `shell` to Git Bash is not done yet: upstream behaviour on Windows is unproven (`docs/compatibility.md`).

### Changed

- README (#126): the agent prompt comes first, then the release bootstrap, "What's new" and the update prompt, with a new banner and agent row; the feature overview moved below Details. EN and ES.
- Install from a verified release, and from npm (#65, #46; S1, S2, S3, N4): `install.sh` and `install.ps1` download the latest release's `lean-agents-<version>.tgz`, check its SHA256 against the release's `SHA256SUMS`, and only then extract it to `~/.config/lean-agents/src` (dependencies are bundled from `package-lock.json`, so there is no `npm ci` and a changed lockfile always reinstalls). The old git clone there is replaced; a folder that is not a lean-agents install is refused. A `scripts/lean.mjs` in the current directory never runs when the script is piped into bash. With an install in place, `--dry-run`, `--doctor` and `--uninstall` (without `--update`) use no network; a `--dry-run` without an install runs from a temp folder and leaves HOME untouched. The package is ready for `npx lean-agents@latest` (`files`, bundled dependencies, `repository`); `release.yml` builds the tarball and `SHA256SUMS` and, once the owner enables it, publishes to npm with provenance. `lean-agents --version` prints the version. New `package` CI job (ubuntu, macos, windows: `npx` from the packed tarball, dry run, install, `--doctor`, `--uninstall`) and `real-bootstrap.sh` / `.ps1`.
- **Breaking:** `LEAN_AGENTS_REPO` and `LEAN_AGENTS_REF` are removed. `LEAN_AGENTS_VERSION=<x.y.z>` pins a release; `LEAN_AGENTS_DIST=<folder or https url>` reads the release files from there (prints a warning). The bootstrap URLs are now `https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh` and `install.ps1` (they work after the first release); the `raw.githubusercontent.com/.../main/` URLs are no longer documented.
- Tools run on a matching Node (#44, #104 points 1 to 3): `core/pins.json` records `node` (the `engines.node` range) for each npm pin, `verify-pins` checks it and the pin-bump PR shows `Node from → to` with `raised` and `above lean floor` flags. When the active Node fails a range, Context Mode and GSD Core run on the lowest installed nvm Node that fits, or `nvm install <major>` (your default Node alias stays), and are registered with that Node's absolute path (`npm i -g --prefix`, `<node> .../context-mode/cli.mjs server`); a rerun, a user-edited entry and `--uninstall` behave as before, and a Node lean-agents installed is kept with a `nvm uninstall` hint. nvm commands run without `npm_config_prefix`, which nvm refuses. On Claude Code Context Mode becomes an MCP server on that Node (hooks and skills of the plugin are lost, one line says so). Without nvm the tool is skipped with `<tool> needs Node <range>, found <version>: skipped. Install nvm or Node <major.minor>+, then run --update.` nvm-windows reuses an installed Node and never installs one (VERIFY). New `real-tool-node` CI job (ubuntu, windows).
- Pin hold (#50, #51, #52, #97 to #102): a pin with `"hold": "<reason>"` in `core/pins.json` is skipped by the pin-bump PR and logged as `held: <key> <version> (<reason>)`. `opencode-v1` is held at 1.19.0 for the work PC.
- Downloaded code is pinned and verified (#64, #66, #75; N2, N3, N6, S5, S7, W4): Serena runs from a commit SHA, skill repos install from a commit SHA, the Claude plugins (Context Mode, Ponytail, i-have-adhd) from a tag (Claude rejects a SHA there), and the ponytail and Warp OpenCode plugins from a pinned npm version. `core/pins.json` carries `sha` and npm `integrity`; `scripts/verify-pins.mjs` (in `lint`) checks both against upstream. Bun on Linux and Windows is the pinned release zip, SHA256 checked before it is extracted. CI downloads installers to a file, checks SHA256 and only then runs them (`tests/ci-downloads.json`); OpenCode 2 is pinned (`opencode-v2`); a `lint` step fails on `curl | bash` and `irm | iex`. `warpdotdev/claude-code-warp` has no tags and stays unpinned. An OpenCode plugin entry lean-agents wrote earlier without a version (`context-mode`, `@dietrichgebert/ponytail`, `@warp-dot-dev/opencode-warp`) is replaced in place by the pinned one on the next run; a version you chose yourself is kept and no second entry is added (`arrayAdd` takes a `legacy` list).
- Pinned OpenCode plugins move to the new pin on rerun (#116): a pinned entry lean-agents wrote earlier (recorded in `state.json`) is replaced in place by the new pin; a version you typed stays.
- One update channel (#108): the pin-bump PR from a green `ci-latest` run is the only way upstream versions reach `core/pins.json`. The `version-watch` workflow is removed, so no per-tool update issues open; `scripts/version-watch.mjs` stays because other scripts import it.
- Workflow tokens are least-privilege (#70, W2, W3): every `actions/checkout` sets `persist-credentials: false` and a `lint` step fails when one does not. `release.yml` builds and tests with `contents: read` and uploads `dist/`; a separate `publish` job holds `contents: write`, runs no repo code, and only downloads the artifact and runs `gh release create`. The pin-bump job pushes with the token in that step's env only.
- macOS real-* legs (Copilot CLI, Antigravity, VS Code, Skills CLI undo) run on push to main, the daily `ci-latest` and manual runs, not on pull requests (#56): every PR run started five macOS jobs at once and some never got a runner. `test (macos-latest)` still runs on PRs.
- Governance files (#73, H5-H7): `SECURITY.md` lists supported versions (latest minor only) and a 7-day acknowledgement time; the PR template carries the CHANGELOG, README EN/ES, `docs/compatibility.md`, `npm test` and real-binary checks; `.github/CODEOWNERS` names the owner. Requiring Code Owner review is an owner setting, documented in `docs/branch-protection.md`.
- Secret scan covers main (#91): a push runs the gitleaks CLI (v8.30.1, SHA-256 checked) on the commits it brings in, and a weekly run scans the full history. The gitleaks action stays for pull requests; on main it scanned 0 commits because it skips merge commits.
- The engine never writes through symlinks or outside home and the project (#68, S8, S10, S17): `plan()` skips a symlinked target or a real parent outside the roots with a note, `apply()` throws if one slips through, `--uninstall` leaves such paths, and the `managed by lean-agents` mark counts only in a file's first 10 lines.
- Backups and `state.json` are owner-only, `0600` files in `0700` directories (#68, S9). `--uninstall` asks "Delete backups in <dir>?" (default no; `--yes` keeps them).
- `redactText` moved to `scripts/lib/redact.mjs` and scrubs more (#67, S11-S14): `AIza`, `hf_`, `sk_live_`/`sk_test_`/`rk_live_`, `ya29.`, JWT and AWS secret keys; `key=value` and `Authorization: Basic|Bearer|Token`; the value of every secret-named environment variable; `/root/`, `/var/folders/`, `/private/var/`, `C:/Users/<user>` and the host name. Proxy and CA lines in `--doctor` and the install plan drop userinfo and query strings and show the home as `~` (S15).
- Every command lean-agents runs gets an environment allowlist instead of your whole environment (#74, S6): `GH_TOKEN`, API keys and cloud credentials stay behind. The list is in `docs/privacy.md`; names that look like secrets are dropped even when allowed.
- `CONTRIBUTING.md` has a "Development" section (Node 22.20+, `npm ci`, `npm test`, shellcheck, privacy check, safe dry run), the adapter path (`scripts/lib/adapters/*.mjs`, not `agents/`), and a "Proposing a tool" section linked from `tools/README.md` (#71).
- `--doctor` honors the network preset (#72, N7, N8): child commands get `DO_NOT_TRACK` and friends under telemetry off, and `mcp list` (which starts Serena and Playwright) is skipped with one `skipped` row when outbound is off. `tests/doctor-network.test.mjs`.
- Every third-party GitHub Action is pinned to a full commit SHA with a `# vX.Y.Z` comment (#69). Dependabot (`.github/dependabot.yml`) opens weekly update PRs for npm and actions. A `lint` step fails on any new tag-only `uses:` line.
- README is a 1-minute read (#58): positioning line, one install command, demo GIF, a support matrix (agent × macOS/Linux/Windows × rules, subagents, MCP tools × CI job; cells without a real-binary job say VERIFY), an at-a-glance list and a diagram, all above a Details divider. Everything else moved below it; README.es.md mirrors it.
- `scripts/check-readme.mjs` also fails on a hero over 80 lines, an image without alt text or over 5 MB, and EN/ES image-count drift. It runs in the `lint` job and in the release workflow.
- Privacy presets match `docs/privacy.md` (#63): new "What each preset does NOT block" section (install downloads, chosen tools); `--network off` or `--outbound off` drops the research agent's web tools in Claude Code, Copilot CLI and VS Code Copilot; the Orca row mentions the Windows user env var.

### Added

- Copilot credits in OpenCode (#123): optional tool `copilot-usage` (in `--all-tools`, needs `gh`, skipped with a note under `--outbound off`). On OpenCode 1.x and 2.x it installs the owned file `plugins/lean-copilot-usage/tui.js` and a `tui.json` `plugin` entry: a sidebar box with credits spent and left, % left and the reset date, plus a `/copilot-usage` palette command and toast. It reads `gh api copilot_internal/user` and never makes a model request, so it costs no premium request. `--uninstall` removes both. New `--usage` flag prints `<left> of <total> credits left (P%), about $X of $Y, resets YYYY-MM-DD` (`Unlimited premium requests`, or `unavailable` with exit 0 when `gh` fails, never zero; under `--outbound off` it prints a skip note and makes no call). Dollars assume $0.01 per credit, an estimate. Sidebar on 2.x and the 2.x command registration are VERIFY.
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

### Fixed

- `--migrate` treats a rules file as lean-agents' own only when `managed by lean-agents` is in its first 10 lines, the same rule as the installer; a user file that mentions it further down is migrated (#93).
- The i-have-adhd step finds the skill where `skills` 1.8 installs it for Antigravity (`~/.gemini/config/skills/i-have-adhd`), which `ci-latest` with `skills@1.8` needs (it failed with "i-have-adhd skill not found"); the 1.7.4 paths work as before (#112).
- Context Mode MCP starts (#107): the command in `core/mcp.json` now ends with `server`, as 2.1.4 requires. A rerun replaces the old lean-agents entry (`npx -y context-mode@<version>`, any version) in OpenCode 2, Cursor and VS Code configs; an entry you edited stays as it is, and `--uninstall` removes the entry lean-agents wrote. `tests/real-opencode.sh` sends `initialize` to the registered command.
- Windows: the Orca telemetry reminder shows on a real-home run unless `DO_NOT_TRACK` or `ORCA_TELEMETRY_DISABLED` is already set in the user or machine env; it was always hidden (#76).

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
