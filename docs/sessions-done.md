# Done build sessions

Archive of finished session blocks from [`SPEC.md`](SPEC.md) section 14, moved during the 0.7.0 release prep. Each session keeps one status line in SPEC. Open sessions stay in SPEC.

### Session 3 — Windows + OpenCode 1.x + wider CI

Branch: `session-3-windows-opencode-v1`.

1. **`install.ps1`** (PowerShell 5.1 and 7), parity with `install.sh`:
   - Same flags in PascalCase (`-DryRun`, `-Yes`, `-Agents`, `-Tools`, `-AllTools`, `-NoTools`, `-Privacy`, `-Profile`, `-Lang`, `-Update`, `-Uninstall`, `-Doctor`); translate them to the engine's `--kebab-case` flags and call `node scripts/lean.mjs`.
   - Ensure git and Node 22.20+ with `winget install --id Git.Git -e --scope user` / `winget install --id OpenJS.NodeJS.LTS -e --scope user` after asking; never require admin.
   - Clone or update `%USERPROFILE%\.config\lean-agents\src`, run `npm ci --omit=dev`, then hand over to the engine.
   - Works when piped: `& ([scriptblock]::Create((irm <raw url>))) -DryRun`.
   - Lint with PSScriptAnalyzer in CI.
2. **Engine on Windows** (`scripts/lib/*.mjs`):
   - `system.mjs`: `which` via `where.exe`; commands through `shell: true` only where needed (`npx`, `npm` are `.cmd` shims).
   - Ponytail config at `%APPDATA%\ponytail\config.json` (already handled), i-have-adhd loader paths with forward slashes inside the `.ts` file.
   - Skills: if a tool installs into `~/.agents/skills`, link into `~/.claude/skills` with a directory junction (`fs.symlinkSync(target, link, 'junction')`).
   - PATH: when RTK is installed from the release zip, add `%USERPROFILE%\tools\rtk` to the user PATH via `[Environment]::SetEnvironmentVariable('Path', …, 'User')` from `install.ps1`, and tell the user to open a new terminal.
   - Make `tests/engine.test.mjs` path-separator agnostic (normalize `path.relative` keys to `/`).
3. **OpenCode 1.x adapter** `scripts/lib/adapters/opencode-v1.mjs` (target `>=1.18.29`, reference 1.19.0):
   - Detection already maps `opencode --version` `1.*` to `opencode-v1`; register the adapter in `ADAPTERS` in `scripts/lean.mjs`.
   - Keys (from the docs, see `docs/compatibility.md`): `instructions`, `default_agent`, `agent.<name>.model` (singular `agent`), flat `mcp.<name>` with `enabled: true`, `plugin` (singular), `compaction.auto` + `compaction.reserved`, strict privacy `share: "disabled"`, `autoupdate: false`, `experimental.openTelemetry: false`, `disabled_providers: ["opencode"]` (unless the profile uses the `opencode` provider).
   - Context Mode as plugin (`"plugin": ["context-mode"]` + `npm install -g context-mode`), never also as MCP.
   - Ponytail: `"plugin": ["@dietrichgebert/ponytail"]`.
   - DCP: `"plugin": ["@tarquinen/opencode-dcp@latest"]` plus `~/.config/opencode/dcp.jsonc` with `compress.minContextLimit` 100000 and `maxContextLimit` 160000 (scale for non-200K windows), only on OpenCode 1.x.
   - Markdown subagents in `~/.config/opencode/agents/` (same renderer as v2 if the frontmatter matches; check `opencode debug agents` on 1.x).
   - `docs/migrate-opencode-v1-to-v2.md`: back up; `agent` → `agents`, `plugin` → `plugins`, `autoupdate: false` → `update: "disable"`, flat `mcp` → `mcp.servers`, `experimental.policies` / `disabled_providers` → `policies`, `tui.json` → `cli.json`; drop DCP (no V2 release) in favor of `compaction.buffer`; move Context Mode from plugin to MCP; verify with `opencode debug config`.
4. **Wider CI** (`.github/workflows/ci.yml`):
   - Add `windows-latest` to the `test` matrix (engine tests + `install.ps1 -DryRun` in a temp `USERPROFILE`).
   - `real-opencode-v1`: install OpenCode 1.19 (`curl -fsSL https://opencode.ai/install | bash`, pin the version if the installer supports it) and assert with `opencode debug config` like `tests/real-opencode.sh`.
   - `real-claude`: install Claude Code with the native installer (`curl -fsSL https://claude.ai/install.sh | bash`), run the engine with exec on for MCP only (`claude mcp add --scope user …`), assert with `claude mcp list` and that `~/.claude/settings.json` parses. Plugins may need network access to marketplaces; if `claude plugin` needs login, keep plugin steps out of CI and document it.
   - `real-tools` (Ubuntu + macOS): run the installer with exec on and `--all-tools` in a temp HOME, then `--doctor` with exec on; this proves RTK, Context Mode, uv/Serena and Caveman install for real.
5. Docs: update `README.md` and `README.es.md` compatibility table (OpenCode 1.x → ✅, Windows badge), `docs/compatibility.md` with dates, CHANGELOG `0.3.0`.

Done when: all CI jobs green on Ubuntu, macOS and Windows. The owner does not test on their working machines; CI with real binaries replaces manual tests.

### Session 4 — Copilot CLI, Antigravity CLI, Codeburn, AutoSkills, GSD, skills, models

Branch: `session-4-more-agents`.

1. **Research first** with the `research` subagent and record findings (source + date) in `docs/compatibility.md` before writing code:
   - GitHub Copilot CLI: install command, global instructions file, custom agents location and format, MCP config file, skills support, telemetry and auto-update settings.
   - Antigravity CLI: binary name, install, global rules location, MCP config, subagents (if any), telemetry.
   - Codeburn: confirm the package and repo (expected `getagentseal/codeburn`, run with `npx codeburn`), supported agents, output format for `token-audit`.
   - AutoSkills: confirm the exact package identity before shipping (`npx autoskills`); if it cannot be confirmed, leave it out and say so.
   - GSD Core: `npx @opengsd/gsd-core@latest`, supported agents, where defaults live (`~/.gsd/defaults.json`).
2. **Adapters** `copilot-cli.mjs`, `antigravity.mjs` with honest support: rules (marker block or file), subagents if supported, MCP (Serena, Playwright, Context Mode), RTK (`rtk init -g --copilot`, `rtk init -g --agent antigravity`, already verified), Context Mode hooks for Copilot CLI if upstream documents them. Mark anything unsupported as ➖ in the README table.
3. **Tools:** Codeburn (no install; doctor checks `npx codeburn --version`), AutoSkills (if confirmed), GSD (optional, off by default, back up `~/.gsd/defaults.json`; ship `profiles/<name>/gsd-defaults.json` mapping GSD agents to tiers).
4. **Original skills** in `skills/<name>/SKILL.md` (Agent Skills format, installable with `npx skills add estebanmr99/lean-agents`): `setup-doctor`, `token-audit`, `update-models` (see section 10).
5. **Profiles:** add `github-copilot`, `opencode-go`, `openai-api`; verify model IDs on the build date; `.github/workflows/models-refresh.yml` (monthly + manual) opens a PR or an issue when models change.
6. `INSTALL_WITH_AGENT.md`: final prompts per agent.
7. CI: a real-binary job per new agent where the CLI installs without login.
8. **Carried over from session 3:**
   - Engine: honor `XDG_CONFIG_HOME`. Today it always writes `~/.config/opencode`, so OpenCode misses the config when that variable is set. Prove it with a test that sets the variable.
   - Windows: exercise the winget route (`rtk-ai.rtk`, `astral-sh.uv`, `--scope user`) on a machine or runner that has winget.
   - Migration doc: check `policies` and `cli.json` against a real OpenCode 2 binary and remove the **VERIFY** marks.

### Session 5 — Launch

Branch: `session-5-launch`.

1. `docs/assets/banner.svg` and social preview PNG (1280×640).
2. Demo GIF: `docs/assets/demo.tape` for [vhs](https://github.com/charmbracelet/vhs) showing `install.sh --dry-run` then the plan; render in CI or locally.
3. Dropped: no before/after numbers (owner decision, 2026-11-03).
4. Final README + README.es, `docs/launch.md` (posts for X, LinkedIn, Reddit, Show HN; awesome lists to submit to), CHANGELOG `1.0.0`, tag `v1.0.0`, `release.yml`.
5. Checklist for the owner: repo description, topics, social preview, Discussions on, pin the repo on their profile.

### Session 6 — Enterprise and team basics

Branch: `session-6-enterprise`.

1. **Research first** (`research` subagent, record source and date in `docs/compatibility.md`): how each supported agent and tool reads `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` and a corporate CA (`NODE_EXTRA_CA_CERTS`, `git http.proxy`, `npm proxy`, `uv` and `pip`); which telemetry, auto-update and other outbound switches exist per agent and tool.
2. **Proxy:** detect the proxy variables, pass them to every child command, show them (redacted) in `--dry-run` and `--doctor`. Never write credentials to disk.
3. **Network prompt:** one question with presets: all off (enterprise PC), all on (personal PC), or choose per category (telemetry, auto-update, other outbound calls). Each category also has a flag for `--yes` runs. Extends section 11; records the choice in `state.json`.
4. **Prerequisites:** `git` (already) and `gh` asked and installed with brew or winget at user scope; `gh auth login` stays a manual step the installer prints.
5. **Interactive CLI:** a polished interactive installer with select menus, a progress list and a final summary. The owner allows one dependency for it (candidate `@clack/prompts`, **VERIFY** it works in Git Bash, PowerShell 5.1 and without a TTY). `--yes` and the no-TTY path stay as they are; update the dependency rule in `AGENTS.md`.
6. **`docs/SECURITY-REVIEW.md`:** a prompt any agent (VS Code Copilot, Cursor, Claude Code, OpenCode) runs on this repo before install. It lists every file written, command run, network host and third-party tool, and asks the user to paste internal IT or proxy wiki pages when no wiki MCP server or browser tool is available. Links it from both READMEs and `INSTALL_WITH_AGENT.md`.

Done when: CI proves an install through a local proxy (for example a squid container) with outbound blocked otherwise, and the all-off preset leaves no telemetry or update switch on.

### Session 7 — VS Code Copilot extension, Cursor, team repos, Claude through Copilot

Branch: `session-7-ide-adapters`.

1. **Research first:**
   - VS Code Copilot: user-level instructions, custom agents (`.agent.md`), prompt files, skills, user `mcp.json`.
   - Cursor IDE and Cursor CLI: install command, rules, MCP config, CLI config, the HTTP/1.1 setting for proxies.
   - Claude through GitHub Copilot: the official route is Agent HQ partner agents (Copilot Pro, Pro+, Business or Enterprise; an admin enables Claude at enterprise and org level; VS Code 1.109+). Check whether Copilot CLI supports it now. Proxies that reuse a Copilot token for the Claude Code CLI are not official: document them as not supported, never install them.
2. **Adapters** `vscode-copilot.mjs`, `cursor.mjs` (IDE and CLI) with honest ✅ / ⚠️ / ➖ marks in the README table.
3. **`--project <dir>` mode:** writes the shared files into one repo (`AGENTS.md`, `.github/copilot-instructions.md`, `.github/agents/`, `.vscode/mcp.json`, Cursor rules) so a team gets the setup through git. User-level installs keep working.
4. `docs/claude-with-copilot.md`: the allowed route step by step, what the admin must enable, and what is not allowed.

Done when: CI renders and validates the project files, and real binaries (`cursor-agent`, VS Code `code --list-extensions` style checks where they run without login) pass in a throwaway HOME.

### Session 8 — Terminals: Warp, Orca, or neither

Branch: `session-8-terminals`.

Owner decision (2026-11-04): a user who already uses Warp or Orca gets that terminal's agent integration for the agents they chose. Earlier plan (installing the apps, FAQ-only plugins) is dropped.

1. Research: `docs/compatibility.md` "Terminals" (Orca `v1.4.247`, Warp docs, 2026-11-03). Open items stay **VERIFY** there.
2. Detection per OS (app folder or CLI on PATH) in `scripts/lib/terminals.mjs`. Menu appears only when a terminal is found and preselects what was detected; `--yes` uses the detected ones; `--terminal warp|orca|both|none` overrides (`none` opts out). PO decision 2026-11-04. Nothing detected: no prompt, no change. The terminal apps are never installed.
3. Warp: Claude Code plugin `warp@claude-code-warp`; OpenCode plugin `@warp-dot-dev/opencode-warp` (2.x `plugins`, 1.x `plugin`, pinned). Orca: `orca-cli` skill through the Skills CLI (Orca's own status hooks are left to Orca). Undo for each is in `--uninstall`.
4. All-off network preset prints the switches (Warp `[privacy] telemetry_enabled = false`, Orca `DO_NOT_TRACK=1` and Settings > Privacy) and never edits app settings.
5. `--doctor` lists detected terminals and the integrations installed.

Done when: a CI job with real Claude Code and OpenCode in a throwaway HOME shows the Warp and Orca plans install and uninstall cleanly; GUI-only facts stay **VERIFY**.

### Session 10 — Parallel agent sessions

Branch: `session-10-parallel-sessions`.

1. **Research** (done 2026-11-03, see `docs/compatibility.md`): Orca orchestration CLI, Claude Code worktrees, background sessions and plan mode, OpenCode `run`, plan agent and server. Only OpenCode takes a prompt file (`-f`); Orca and Claude take the prompt as argv text. Start after sessions 6 and 8 merge, and reuse session 8's Orca install, hook and bypass-mode findings instead of researching them again.
2. **Skill** `skills/parallel-sessions/SKILL.md` (Agent Skills format, installed like the other skills): the coordinator playbook.
   - Split the work into tasks that touch different files; shared files only get new lines.
   - Write one prompt file per task: goal, allowed files, checks to run, "do not push", and how to report (a status file with `running`, `blocked: <question>` or `done`).
   - Start each worker in plan mode where the agent has one; the coordinator reads only status files and bounded output tails, never full transcripts.
   - Merge one worker at a time, in the planned order, and only after the user confirms each merge: checks pass, merge into the base branch, rebase the rest, rerun their checks, then the next.
3. **Helper** `scripts/parallel.mjs` (Node, no new dependencies, commands built as argv arrays, never shell strings): `start <task.md>…`, `status`, `merge <task>`, `clean`.
   - Prompt files live in the worker's git dir (`git rev-parse --git-path lean-agents/task.md`), so they are never committed and go away with the worktree.
   - Every agent gets only `Read <path> and follow it.` as its prompt; OpenCode also gets `-f <path>`.
   - **Orca found** (`orca` that answers `agent-context`): `orca worktree create --name <task> --agent <id> --prompt <instr> --surface terminal --json`; status from `orca worktree ps --json`; bounded output from `orca terminal read --screen --limit`; answers through `orca terminal send --enter`.
   - **No Orca:** `git worktree add -b <branch> <dir> <base>`, then Claude Code `claude --bg -n <task> --permission-mode plan <instr>` (status: `claude agents`, `claude logs`) or OpenCode `opencode run --title <task> --agent plan -f <file> <instr>` started with the worktree as its working directory (2.1.4 has no `--dir` flag) and output to a log file in the worker's git dir; when the agent needs a TTY, print the exact command for the user to paste into a new terminal.
   - Copilot CLI and Antigravity: print-the-command only, until their `-p` mode is verified (**VERIFY**).
   - `clean` removes only worktrees and branches the helper created and only when merged; never `--force`.
4. **Uninstall**: `--uninstall` removes the skill. The helper writes only worktrees, branches, prompt, status and log files in the user's repo; `clean` removes them, and `--doctor` lists any left behind.
5. Docs: `docs/parallel-sessions.md` (EN), README and README.es sections, compatibility rows per agent, CHANGELOG.

Done when: a CI job on Ubuntu and macOS (`tests/real-parallel.sh`), in a throwaway HOME with real git, starts two workers from prompt files with a stub agent that commits and writes `done`, shows both in `status`, merges them one at a time with the second rebased, and `clean` leaves no worktree or branch behind. Real Claude Code and OpenCode binaries in the same job check every flag the helper builds (`claude --help`, `opencode run --help`). The Orca path is checked against `orca agent-context --json` in the CI step session 8 adds to install Orca; until that step exists, the Orca path stays **VERIFY**. Unit tests in `tests/engine.test.mjs` cover argv building, prompt paths and merge order. A run with a real model stays **VERIFY** (needs a login).

### Session 11 — Antigravity full setup

Branch: `session-11-antigravity`. Code starts after sessions 6 and 7 merge: reuse the session 6 proxy and network presets and the session 7 IDE adapter pattern. Target the Antigravity app; the standalone Antigravity IDE is out of scope.

1. **Research first** (done 2026-11-03, see `docs/compatibility.md`). Before coding, check the latest app and `agy` versions again, because a new release is due, and re-run the research if paths changed.
2. **Install per OS**, at user scope and asked like other prerequisites. CLI: `install.sh`, `install.ps1`, `brew install --cask antigravity-cli`, winget `Google.AntigravityCLI` (**VERIFY** scope). App: `.dmg` or a brew cask, `.exe` or winget, Linux `.tar.gz` (**VERIFY** cask and winget ids). Never require admin.
3. **Shared config:** the app and the CLI read the same `~/.gemini/config/{rules,agents,plugins}` and `mcp_config.json`, so one set of files serves both. Check the app's MCP file (`~/.gemini/config` or `~/.gemini/antigravity`, **VERIFY**). If Antigravity does not read `~/.agents/skills`, install skills into `~/.gemini/config/skills` (**VERIFY**).
4. **App adapter** in the session 7 IDE pattern: detect the app, write only what the CLI files do not cover (app settings in `~/.gemini/config/config.json`, **VERIFY** per OS), and `--uninstall` removes only lean-agents keys.
5. **Windows CLI:** `tests/real-antigravity.ps1` like `tests/real-copilot.ps1`; `%LOCALAPPDATA%\agy\bin` on PATH; RTK and Context Mode plugins under a temp `USERPROFILE` (`rtk init` writes to the OS profile folder); Skills CLI detection.
6. **Network:** reuse the session 6 proxy passing (already proven for `agy plugin install` in `tests/real-proxy.sh`) for the app too. Antigravity documents no proxy or auto-update setting (only `sandboxProxy` for sandboxed commands), and its CA variable `AGY_LLM_GATEWAY_CA_CERT` covers only the enterprise gateway. Telemetry stays on the account: the all-off preset prints the account step; recheck each (**VERIFY**).
7. Docs: an Antigravity app column in the README tables (EN and ES), `docs/compatibility.md`, `docs/privacy.md`, CHANGELOG.
8. **Bun for Context Mode (evaluate, opt-in).** Upstream says Context Mode detects Bun on PATH or in `~/.bun/bin` and then runs JS/TS in `ctx_execute` "3-5x faster" and uses `bun:sqlite` instead of `better-sqlite3`. No benchmark backs the number (**VERIFY**). A CI job `bench-context-mode` on Ubuntu, macOS and Windows, throwaway HOME (`USERPROFILE` on Windows), runs the same fixed `ctx_execute` JS and TS workload (fixtures in `tests/fixtures/bench/`, 2 warm-up runs then 10 timed runs per language) with Node only and then with Bun, and records:
   - median and spread of the run time, Node and Bun;
   - install time of `npm i -g context-mode` and of Bun;
   - whether `better-sqlite3` used a prebuilt binary or compiled, and which SQLite backend Context Mode picked (`bun:sqlite`, `node:sqlite`, `better-sqlite3`);
   - the numbers go to the job summary and to `docs/compatibility.md` with the Bun, Node and Context Mode versions.
9. **Bun decision from the numbers.** If the median Bun run is at least 1.5x faster than Node on all three OSes and Bun installs at user scope without a TTY on each OS, the installer offers `--bun` (off by default) with `curl -fsSL https://bun.com/install | bash`, `brew install oven-sh/bun/bun` or winget `Oven-sh.Bun` (**VERIFY** scope and PATH), and `--uninstall` removes only a Bun that lean-agents installed. Otherwise `docs/manual-install.md` only documents it. Record the decision in this section; the numbers stay in `docs/compatibility.md`.

Done when: CI jobs with real binaries and a throwaway HOME (`USERPROFILE` on Windows) install `agy`, run the installer, `agy agents`, `agy mcp list`, `--doctor` and `--uninstall` on Ubuntu, macOS and Windows; the app installs in CI where the OS allows it, or the job documents why it cannot, and the files lean-agents writes for it are validated. Anything that needs a login to prove stays ⚠️ with a **VERIFY** note.

**Bun decision (2026-11-04, session 12):** the median Bun JS run is at least 1.5x faster than Node on all three OSes (1.53x, 2.00x, 1.56x) and Bun installs at user scope without a TTY on each, so the rule in item 9 says offer `--bun` (off by default). The flag is not built yet: it is a follow-up session. Numbers: `docs/compatibility.md`.

Done when (Bun): `bench-context-mode` is green on Ubuntu, macOS and Windows, its numbers are in `docs/compatibility.md`, and the `--bun` or docs-only decision is recorded.

### Session 12 — Release readiness

Branch: `session-12-release`. Goal: 0.5.0 ready to publish on the GitHub page; the owner tags and publishes. Ships what sessions 6 and 7 merged; sessions 8, 10 and 11 stay "planned" in the READMEs (owner decision, 2026-11-03).

1. **Demo path first:** README and README.es show OpenCode with GitHub Copilot models end to end (install OpenCode, `--agents opencode-v2 --profile github-copilot`, `/connect`, `--doctor`). No free OpenCode models. Claude Desktop and Cursor follow later. Every installer command in both READMEs passes `--dry-run` with `--home "$(mktemp -d)"`; EN and ES say the same thing; the tables match `docs/compatibility.md`.
2. **Signed-in browser:** opt-in tool `playwright-extension` (`@playwright/mcp --extension`, attaches to the user's own signed-in Chrome) next to the headless `playwright` entry, for OpenCode, Copilot CLI, VS Code Copilot and Cursor. The installer prints the Chrome Web Store link for the Playwright Extension (no silent install without admin policy). `docs/browser-extension.md` explains the optional `PLAYWRIGHT_MCP_EXTENSION_TOKEN` (`setx` on Windows, shell profile on macOS and Linux), the leak warning and rotation. The installer never asks for, stores or prints the token; per-session approval stays the default. Claude Code and Claude Desktop keep Claude in Chrome.
3. **Issue #6:** `models-refresh` no longer reports a model the same profile already uses or one with different output modalities (image models). Profiles unchanged; reasons in `profiles/README.md`.
4. **Bun benchmark:** build `bench-context-mode` from session 11 items 8 and 9 and record the decision. A `--bun` flag, if the numbers qualify, is a later session.
5. **Gemini CLI:** documented in `docs/compatibility.md`, not supported (individual access moved to Antigravity CLI). **Cursor:** open VERIFY items listed, not fixed.
6. **Release:** `package.json` and CHANGELOG `0.5.0`, release notes from `releaseNotes()`, `release-build` green. No tag.

Done when: CI is green with the new real-binary checks (extension entry in each agent's MCP list, `@playwright/mcp --help` lists `--extension`, `bench-context-mode` on three OSes), and the owner has the release notes.

### Session 13 — Bun for Context Mode

Branch: `session-13-bun`. Goal: the `--bun` follow-up from the session 12 decision, ON by default (owner decision, 2026-11-03).

1. **Install Bun when `context-mode` is selected**, one route per OS: Linux `curl -fsSL -o <file> https://bun.com/install` then `bash <file>` with `BUN_INSTALL=~/.bun` and an unknown `SHELL` (no profile edit); macOS `brew install oven-sh/bun/bun`; Windows `curl.exe` + upstream `install.ps1` (user PATH, no admin). `--no-bun` / `-NoBun` opts out. A Bun already on PATH or in `~/.bun/bin` is reused and never removed by `--uninstall`.
2. **Where Context Mode finds Bun:** on Linux the plugin entry `start.mjs` re-execs the server under Bun from `~/.bun/bin` (the npm bin `context-mode` does not, but its `ctx_execute` still finds Bun there); on macOS and Windows the server stays on Node and takes Bun from PATH only for `ctx_execute` JS/TS (owner check, context-mode 1.0.169, Bun 1.4.4).
3. **Fallback:** a failed Bun install prints one line and Context Mode runs on Node; it is not a failed step.
4. **Telemetry:** with telemetry off, a marked block `telemetry = false` at the top of `~/.bunfig.toml`; `--uninstall` removes only the block.
5. **Playwright rule fix:** `playwright-extension` alone adds no Playwright rule lines for a Claude-only install.

Done when: the `real-bun` CI job proves install, PATH or `~/.bun/bin` detection through the MCP client (`ctx_doctor`, TypeScript `ctx_execute`), reuse, `--no-bun`, fallback and `--uninstall` on Ubuntu, macOS and Windows, and `real-proxy` shows Bun installed through the proxy.

### Session 14 — 0.5.0 final check

Branch: `session-14-final-check`. Goal: 0.5.0 is ready for the owner to tag; the owner presents it with OpenCode + GitHub Copilot.

1. **READMEs (EN and ES):** every feature from sessions 6, 7, 12 and 13 is explained for a new user, the OpenCode + GitHub Copilot demo path is first and works end to end, the tables match `docs/compatibility.md`, EN and ES say the same. Every installer command shown exits 0 with `--home "$(mktemp -d)" --no-exec --dry-run`. Gaps only, no rewrites.
2. **CHANGELOG:** the `0.5.0` section includes session 13; nothing that belongs to 0.5.0 stays under Unreleased. Version is 0.5.0 everywhere.
3. **Release dry run:** `node scripts/release.mjs 0.5.0` in a scratch clone builds the notes and both archives. No tag, no publish, no GitHub release.
4. **Owner commands:** the exact tag and release commands go in the PR body, not in the repo.

Done when: `npm test` and `scripts/check-private.sh` pass, CI is green and the owner has the PR summary.

### Session 15 — README look and feel

Branch: `session-15-readme`. Goal: both READMEs look professional on the GitHub page and are easy to skim for a team demo. Content stays true; no feature claim changes.

1. **Audit** both READMEs (structure, scannability, links and anchors, table widths, heading levels, image alt text), list findings, then plan.
2. **Improve:** short hero (one-line value, one badge row, the demo path as the first call to action), table of contents, `<details>` for long per-agent sections, consistent tables, no walls of text. EN and ES keep the same structure.
3. **Check by script** (`scripts/check-readme.mjs`, run by `npm test`): relative links and `#anchors` resolve, EN and ES have the same headings and table rows, every installer command shown exits 0 with `--home <temp dir> --no-exec --dry-run --yes`.
4. **Housekeeping:** 0.5.0 is untagged, so the CHANGELOG `Unreleased` items move into `[0.5.0]`; `node scripts/release.mjs 0.5.0` in a scratch clone lists Warp/Orca, parallel sessions and Antigravity. No tag.

Done when: `npm test` and `scripts/check-private.sh` pass and CI is green.

### Session 16 — Fixes and docs from real installs

Branch: `session-16-fixes`. Release: 0.5.1. Each issue's body has the repro, cause and a tested fix; reproduce first, then apply the smallest fix. PR body: `Closes #20, #27, #31, #32, #39`.

1. **#20 GSD crash with Cursor.** Add `cursor: '--cursor'` to `FLAGS` in `scripts/lib/gsd.mjs`. Agents without a flag (`vscode-copilot`) are skipped with a note instead of crashing. Test: `--agents cursor,vscode-copilot --tools gsd` dry run plans `--cursor` and notes the skip. Proof: run GSD for Cursor in the `real-cursor` CI job (throwaway HOME).
2. **#31 test depends on the host proxy.** Strip `HTTP(S)_PROXY`/`ALL_PROXY` from the env of that one test, as in the issue.
3. **#27 docs.** Fix the `docs/privacy.md` table (blank line, rows for Cursor, VS Code Copilot, Warp, Orca), rewrite `tests/README.md` for `npm test` and the `tests/real-*` scripts, correct the Cursor CLI install row for Windows in `docs/compatibility.md`.
4. **#32 OpenCode 2 on Windows.** Add the verified PowerShell block to the demo step 1 (EN, ES). `install.ps1` (or the engine on win32) finds `%USERPROFILE%\.opencode\bin\opencode.exe` when `opencode` is not on PATH and prints the PATH fix; it does not change PATH. Note in `docs/SECURITY-REVIEW.md` that the upstream script checks no tarball checksum.

5. **#39 Context Mode v2 install.** Upstream removed `configs/copilot-cli` and `configs/antigravity-cli`. Copilot CLI uses `npm i -g context-mode` then `context-mode setup --yes --agents copilot-cli`; Antigravity uses `setup` if `context-mode setup --list` has it, else skips with a note. `--uninstall` undoes it. Proof: `real-copilot`, `real-antigravity` and `real-proxy` green.

Done when: `npm test` passes on all three OS in CI, `scripts/check-private.sh` and `scripts/check-readme.mjs` pass, CHANGELOG `Unreleased` lists each fix with its issue number.

### Session 17 — Windows: Cursor CLI and Orca

Branch: `session-17-windows-cursor-orca`. Release: 0.5.1. Start from the patch in #29, which covers #21, #22, #26 and #28 and was tested on Windows 11 behind a proxy; review it against section 2 before applying. PR body: `Closes #21, #22, #23, #25, #26, #28, #29`.

1. **#21 Orca skill for every agent.** `ORCA_SKILL_AGENT` gets `cursor` and `vscode-copilot: 'github-copilot'`.
2. **#23, #28 Cursor CLI in Git Bash.** When Git Bash is detected on Windows, a marked block in `~/.bashrc` adds `alias agent='MSYSTEM= SHELL= agent.cmd'` and the same for `cursor-agent`; undone by `--uninstall`. `tests/real-cursor.sh` uses `agent.cmd` on Windows.
3. **#25 Cursor behind a proxy.** Only when a proxy is set and Cursor is selected: `json` action sets `network.useHttp1ForAgent: true` in `~/.cursor/cli-config.json`, keeping other keys; print one line that `NODE_USE_ENV_PROXY=1` and the proxy vars belong in the shell profile. Proxy values are never written to disk.
4. **#28 Orca status behind a proxy.** On Windows with a proxy, add only the missing loopback entries (`localhost`, `127.0.0.1`, `::1`) to `NO_PROXY` in the marked `~/.bashrc` block and the Windows user env; undo removes only those entries. **Owner decision before building:** writing the Windows user env is new for lean-agents; if not approved, print it as a checklist item instead.
5. **#22 Orca facts.** Move the verified Windows paths, first-launch status hooks (including the always-allow Cursor hook) and `DO_NOT_TRACK=1` from **VERIFY** to verified in `docs/compatibility.md`, source "real install, #22, 2026-11-05". `--doctor` reports Orca's hook entries in `~/.claude/settings.json` and `~/.cursor/hooks.json` as `note`; `--uninstall` leaves them alone. README "Warp and Orca" says Orca writes these on first launch.
6. **#26 "Still needed from you".** The run ends with a list built from the selected agents, terminals and MCP servers (Cursor login, `agent mcp login`, Cursor User Rules, Orca first launch and **Install CLI & Skills**). `--doctor` prints the same list, marking done or pending where it can check.

Done when: unit tests cover each item against a temp HOME, the Windows `real-cursor` and `real-terminals` jobs are green, and the README tables (EN, ES) and `docs/compatibility.md` match. Orca GUI behaviour that CI cannot launch stays sourced to #22 and #28.

### Session 18 — Pick only what you need, pin what runs

Branch: `session-18-core-and-pins`. Release: 0.6.0. PR body: `Closes #30, #33, #40`.

1. **#30 `--no-core`** (`-NoCore`): removes `rtk` and `context-mode` from the tool list, and the menu starts empty. `--update` keeps the choice from `state.json`. Test from the issue: `--no-core --tools playwright-extension` plans only that server.
2. **#33 pinned versions.** `core/mcp.json` uses exact versions (for example `@playwright/mcp@<current>`), checked against npm on the day. Skills installed with `npx skills add` are pinned to a tag or commit if the skills CLI supports it (**research first**); otherwise the installed commit is recorded in `state.json` and `--doctor` reports drift. `codeburn` and `autoskills` get pinned versions too.
3. **Bumping:** extend the `update-models` skill (or add `update-tools`) to list newer versions and change them only after the user approves, like the dated model profiles.
4. List run-time fetches as their own category in `docs/SECURITY-REVIEW.md` and in the README "On a work PC".

5. **#40 Daily version watch.** The pins from item 2 are the list of versions confirmed to work (date and CI run each). A scheduled workflow (daily plus `workflow_dispatch`, `GITHUB_TOKEN` with `issues: write` only) checks npm and GitHub releases; per item with a newer version it opens one `version-watch` issue `Update available: <item>`, or comments on the open one, never twice for the same version. Each lists the confirmed and new version, release notes, and the `real-*` jobs to run before bumping. It never changes pins.

Done when: a CI job installs with the pinned versions in a throwaway HOME and `--doctor` reports no drift; a dispatched version-watch run opens one issue, a second adds a comment, a third does nothing; `npm test`, the privacy check and the README check pass.

### Session 21 — Lean CI: pinned on PRs, latest daily

Branch: `session-21-lean-ci`. Release: 0.6.0, after session 18. PR body: `Closes #42`. Owner decisions (2026-11-05): PR jobs use the pins from #33; `@latest` runs daily and opens or comments on an issue instead of blocking PRs; the maintainer runs the branch-protection command, CI never changes repo settings.

1. **Pins for harness CLIs.** `claude-code`, `opencode-v1` and `copilot-cli` are npm pins marked `"ciOnly": true` in `core/pins.json`: CI installs them with `npm install -g <pin>`, users never get them from lean-agents, so `pinVersions()` leaves them out of `state.json` and `--doctor`. The version watch covers them. OpenCode 2, Cursor and `agy` have no npm package; they stay on the latest installer and their jobs print the version.
2. **`paths` filter.** A `changes` job skips every `real-*`, `bench-*` and `release-build` job on a PR that only touches `docs/**`, `assets/**` or `*.md`. `lint`, `test` and the Secret scan always run.
3. **`timeout-minutes`** on every job.
4. **Trimmed matrix.** One OS where the OS adds nothing; Windows jobs and macOS where macOS behaviour is the point stay. `real-opencode-xdg` stays its own job: OpenCode 2's background service keeps the first HOME, and the port is fixed.
5. **Gaps.** PSScriptAnalyzer and shellcheck run on every tracked `*.ps1` and `*.sh`. `--project` only exists for Cursor and VS Code Copilot (both covered); the other adapters have no project mode.
6. **Latest daily.** `ci-latest.yml` (cron plus `workflow_dispatch`) calls `ci.yml` with `latest: true`; each real job runs `scripts/pins-latest.mjs` on its own checkout. A failure opens or comments on one `version-watch` issue "Latest versions break CI" (`scripts/ci-latest-report.mjs`), once per run.
7. **Required checks.** `docs/branch-protection.md` has the exact `gh api` command.

Done when: a docs-only PR runs only `lint`, `test` and the Secret scan; a code PR runs the trimmed set green with pinned versions; a dispatch of `ci-latest` with `force-fail` opens an issue and a second dispatch comments; `docs/branch-protection.md` lists the checks and the command. The PR body lists job count and job-minutes before and after for a docs-only and a code PR.

### Session 19 — Migrate from one harness to another

Branch: `session-19-migrate`. Release: 0.6.0. PR body: `Closes #34`.

1. **Research first** (`research` subagent): each harness's current file locations for rules, agents, skills, MCP servers, prompts/commands and hooks, at user and project scope (VS Code Copilot `.github/` and `.vscode/mcp.json`, Claude Code, Cursor, OpenCode 1 and 2, Copilot CLI). Record source and date in `docs/compatibility.md`; anything unproven stays **VERIFY**.
2. **`--migrate <from|auto>`** at user scope and with `--project <dir>`: read the source harness, convert to the neutral core shape, render for the target agents with the existing adapters.
3. **Safety:** copy, never move; never overwrite (on a conflict, skip and note); every write is a `file`, `json` or `block` action undone by `--uninstall`; MCP `env` and header values are never copied, only the variable names, with a line telling the user to set them. Hooks are report-only unless the target's hook format is verified; migrating hooks for real needs the owner's yes.
4. **`--dry-run`** prints a migration table: item, source path, target path, migrated / skipped / reported.

Done when: a CI job builds a fixture `.github/` plus `.vscode/mcp.json`, migrates it to `opencode-v2` and `claude` with real binaries in a throwaway HOME, and checks the result with `opencode debug config` / `opencode debug agents`; `npm test`, the privacy check and the README check pass.

### Session 20 — Install with an agent, opt-in feedback, gh by default

Branch: `session-20-agent-install`. Release: 0.6.0, after sessions 18 and 19. PR body: `Closes #35, #36, #37`.

1. **#35 Install with an agent.** `docs/install-with-an-agent.md` and a copy-paste prompt near the top of README EN and ES. The agent: detects the setup (`--doctor --json`); asks which agents and tools, whether to migrate (session 19) and which network preset; shows the `--dry-run` plan and gets a yes; installs with exact flags (`--tools`, `--no-core`); verifies with `--doctor`. Add `--json` output for `--dry-run` and `--doctor`.
2. **#36 Opt-in feedback.** Only when the network preset allows it, the agent offers to file an issue after a failure. The draft holds redacted data only (OS, versions, failing command, error) via `redact`; no usernames, paths, employers or proxy values. It checks duplicates with `gh issue list --search`, shows the draft, and runs `gh issue create` only after a yes. The strict/off preset never offers.
3. **#37 `gh` by default.** Preselect `gh` when missing (today default "n" in `scripts/lean.mjs`); add `--no-gh` / `-NoGh`. Check that `git` is present and print the install hint if not. The user runs `gh auth login` themselves.

Done when: tests parse the `--json` output and check the redacted draft against a temp HOME; `npm test`, the privacy check and the README check pass; README tables (EN, ES) and `docs/compatibility.md` list the new flags.
