# lean-agents: build specification

This file is the single source of truth for building and maintaining this repository. It is written so that one coding agent (Claude Code recommended) can read it and build the whole project without further context.

## How to use this spec as a single prompt

The repository root has `AGENTS.md` (and `CLAUDE.md`, which imports it) with the commands and hard rules for agents working here. Open Claude Code in the repository root and send:

```text
Read docs/SPEC.md completely before doing anything. Then implement the next
session that is not yet marked done in the "Build sessions" section. Follow
every rule in "Non-negotiable rules". Work on a new branch named
session-<n>-<short-name>, run the checks in "Definition of done" for that
session, commit, and stop to show me a summary and the diff before pushing.
When the session is done, mark it done in this file in the same commit.
```

Repeat the same prompt for each session. Each session must leave the repository in a working, tested state.

---

## 0. Current state (read first)

- Installer architecture: thin bootstraps (`install.sh`, `install.ps1`) that hand over to the Node engine `scripts/lean.mjs`. Adapters live in `scripts/lib/adapters/`; tool prerequisites in `scripts/lib/system.mjs`; doctor in `scripts/lib/doctor.mjs`. The folders `agents/` and `tools/` hold documentation only. Where later sections mention `render.mjs`, `doctor.sh` or `tools/<tool>/install.sh`, the engine replaces them.
- Supported today: Claude Code, OpenCode 1.x and 2.x, and Copilot CLI on macOS, Linux and Windows; Antigravity CLI on macOS, Linux and Windows (session 11).
- Copilot CLI facts verified on 1.0.105 and Antigravity (`agy`) on 1.4.12: see `docs/compatibility.md`. Neither proves model choice or Antigravity rule and skill loading without a login.
- Negative checks in test scripts must not start with `! `: `set -e` ignores that. Use `refute` or `if`.
- OpenCode 1 facts verified on 1.19.0: singular `agent` and `plugin`, flat `mcp`, `compaction.reserved`, `autoupdate`, `disabled_providers`. `opencode debug config` prints one object; `opencode agent list` lists agents. DCP now also installs on OpenCode 2, but lean-agents keeps it 1.x only; the notes in sections 6 and 14 saying it has no V2 release are out of date.
- OpenCode 2 facts verified on 2.2.5: native keys are `agents` (not `agent`), top-level `policies`, `plugins`, `mcp.servers`, `compaction.buffer`, `update`, `share`. `opencode debug config` prints a JSON array of config sources (`{type, path, info}`); `opencode debug agents` lists agents.
- The owner dropped the before/after savings claim (2026-11-03): the repo cannot show one, so the README "Why" has no numbers. `docs/launch.md`, `release.yml`, the banner, the demo GIF and the `assets` workflow exist. `1.0.0`, the tag and the release still need the owner's separate go.
- Session 8 research is done (2026-11-03, Orca `v1.4.247`): `docs/compatibility.md` "Terminals". Orca's default permission mode adds no bypass flag; only Yolo adds one. Session 8 (2026-11-04): terminal integrations for users who already have Warp or Orca; the apps are never installed.
- Testing policy: the owner does not test on their working machines. Every claim is proven in CI with throwaway HOME directories and real binaries (`tests/real-opencode.sh`).
- Commits are authored by the owner (`git config user.name/user.email` set to their GitHub no-reply address) with a `Co-Authored-By` trailer for the agent.
- Since session 6: Node.js 22.20+ (20.12+ before 0.6.0) and one more dependency, `@clack/prompts` (menus only on a real terminal). Network choices live in `scripts/lib/network.mjs` (`options.network` in `state.json`, `privacy` derived from it, so adapters can still read `opts.privacy`); undocumented settings in `scripts/lib/unverified.mjs` are never configured, only saved as user notes under `~/.config/lean-agents/notes/`.
- Session 7 (2026-11-03): adapters `vscode-copilot` and `cursor`, `--project <dir>` team mode, `docs/claude-with-copilot.md`. Cursor user rules have no file (settings UI only). The VS Code user `mcp.json` path is proven by `code --add-mcp` in `real-vscode` (Linux, macOS); Copilot Chat ships built into VS Code; Cursor skills land in `~/.agents/skills`.
- 0.6.0 (2026-11-06) holds sessions 16 to 21; 0.5.1 was folded into it, and the minimum Node is now 22.20 (breaking). The owner tags it. Next, on hold: Session 9 and issues #44, #45, #46, #56. `docs/ROADMAP.md` maps each to its issues and release.
- 0.7.0 (2026-11-12) is built: version and CHANGELOG are ready in the release prep PR, and the owner tags it after that PR merges. Next is 0.8.0: #78, #80, #60, #106, #104 points 4 and 5, and the #124 follow-up (Git Bash as OpenCode's shell).
- Private terms are blocked by `scripts/check-private.sh` using the `PRIVATE_DENYLIST` repository secret in CI and a gitignored `.private-denylist` locally.

## 1. Product

**One-line pitch:** A cross-agent, token-efficient AI coding setup. One command installs the same rules, cheap-by-default subagents, context-saving tools and MCP servers into Claude Code, OpenCode (1.x and 2.x), GitHub Copilot CLI and Antigravity CLI, on macOS and Windows.

**Audience:** developers who already use one AI coding agent and want it to spend fewer tokens, answer more clearly and behave the same across agents. Secondary: teams who want a shared, reviewable baseline.

**What it is not:** not a fork of any tool. Every third-party tool is installed from its upstream source, credited and linked. The repo only ships glue: rules, agent definitions, config templates, installers, a doctor script and a few original skills.

**Design principles**

1. One source of truth (`core/`), rendered per agent by adapters (`agents/`). A rule is written once.
2. Minimal by default, everything else opt-in. Nothing is installed or changed without the user seeing it first.
3. Never destroy user config. Back up, merge, import. Never overwrite an existing `AGENTS.md` / `CLAUDE.md`.
4. Same behavior on macOS and Windows. Linux works as a side effect of the POSIX installer but is not a promised target in v1.
5. Honest compatibility. If a feature does not work in an agent, the compatibility table says so.
6. No secrets, ever. The installer never asks for, stores or prints API keys or tokens. Provider login stays with the user (`/connect`, `/login`, browser flows).
7. Models stay current. Subagents ask for a tier, not a hard-coded model ID.

## 2. Non-negotiable rules for whoever builds this repo

- **Privacy scrub.** This is a public repository. Never commit: personal usernames or home paths (use `~`, `$HOME`, `%USERPROFILE%`), employer names or employer-specific policies, internal/company MCP servers (issue trackers, wikis, test management tools of any company), cloud project IDs, regions tied to a person, emails, API keys, tokens, auth files. Write security rules generically ("your company's policy").
- Run `scripts/check-private.sh` (section 12) before every commit. CI runs it too.
- Do not install, recommend or configure these tools; mention them only in `docs/faq.md` under "Why not X": Oh My OpenAgent (OMO), Graphify (expensive graph generation; Serena replaces it). Warp and Orca agent integrations are allowed only for a user who already has that terminal (owner decision 2026-11-04, replaces the old FAQ-only rule): detected and preselected (`--terminal none` opts out), never installing the terminal app, fully undone by `--uninstall`.
- Every third-party tool gets: upstream link, license note, what it does in one line, and how to remove it.
- Verify every install command, config key and CLI flag against the tool's current upstream docs at build time. Where this spec says **VERIFY**, you must check upstream and record the date checked in `docs/compatibility.md`. Do not invent flags.
- Keep comments and docs in English. Spanish lives only in `README.es.md` and in the optional `--lang es` rule translation.
- Commit messages: conventional commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).

## 3. Repository layout

```text
lean-agents/
├─ README.md                 # English, the landing page (section 13)
├─ README.es.md              # Spanish mirror, linked at the top of README.md
├─ LICENSE                   # MIT
├─ CONTRIBUTING.md
├─ CHANGELOG.md              # keep-a-changelog format
├─ SECURITY.md               # how to report issues; what the installer touches
├─ install.sh                # macOS, Linux, Git Bash on Windows
├─ install.ps1               # Windows PowerShell 5.1+ and PowerShell 7
├─ INSTALL_WITH_AGENT.md     # copy-paste prompts so the user's agent installs it
├─ core/
│  ├─ AGENTS.md              # global rules, English (section 5)
│  ├─ AGENTS.es.md           # Spanish translation, used with --lang es
│  ├─ agents/                # neutral subagent definitions (section 6)
│  │  ├─ explore.md
│  │  ├─ research.md
│  │  ├─ review.md
│  │  ├─ debug.md
│  │  └─ planner.md
│  ├─ mcp.json               # neutral MCP server list (section 8)
│  └─ tiers.json             # tier -> model per profile (section 9)
├─ agents/                   # adapters: templates + render logic per agent
│  ├─ claude-code/
│  ├─ opencode-v1/
│  ├─ opencode-v2/
│  ├─ copilot-cli/
│  └─ antigravity/
├─ tools/                    # one recipe per third-party tool (section 7)
│  └─ <tool>/{README.md, install.sh, install.ps1, uninstall.sh, uninstall.ps1}
├─ profiles/                 # dated model templates per subscription (section 9)
├─ skills/                   # original skills (section 10)
│  ├─ setup-doctor/SKILL.md
│  ├─ token-audit/SKILL.md
│  └─ update-models/SKILL.md
├─ scripts/
│  ├─ doctor.sh / doctor.ps1
│  ├─ render.mjs             # renders core/ into each agent's format (Node 22.20+)
│  └─ check-private.sh
├─ docs/
│  ├─ SPEC.md                # this file
│  ├─ manual-install.md      # every step by hand, per OS, per agent
│  ├─ update.md              # update routine (ported from the original update guide)
│  ├─ migrate-opencode-v1-to-v2.md
│  ├─ compatibility.md       # agent x feature table + "verified on" dates
│  ├─ privacy.md             # what strict mode changes, per agent
│  ├─ faq.md
│  └─ assets/                # banner.svg, demo.gif, codeburn screenshots
├─ tests/                    # installer tests (bats for sh, Pester for ps1)
└─ .github/
   ├─ workflows/{ci.yml, secret-scan.yml, models-refresh.yml, release.yml}
   ├─ ISSUE_TEMPLATE/{bug.yml, agent-support.yml}
   └─ pull_request_template.md
```

Install target on the user's machine: `~/.config/lean-agents/` (Windows: `%USERPROFILE%\.config\lean-agents\`). It holds the rendered `AGENTS.md`, `state.json` (what was installed, versions, chosen options, backup paths) and `backups/<timestamp>/`.

## 4. Installer behavior

**Architecture (decided in session 2):** `install.sh` and `install.ps1` are thin bootstraps. They make sure git and Node.js 22.20+ exist, fetch the repo to `~/.config/lean-agents/src`, run `npm ci --omit=dev` (one dependency: `jsonc-parser`, so JSONC comments survive merges) and hand over to `scripts/lean.mjs`. All planning, rendering, merging, backups, tool commands, uninstall and the doctor live in the Node engine, so macOS and Windows share one implementation. Adapters are in `scripts/lib/adapters/<agent>.mjs`; tool prerequisites in `scripts/lib/system.mjs`. The `agents/` and `tools/` folders hold documentation only.

Both installers implement the same flow and flags. Bash uses POSIX-friendly bash 3.2 (macOS default). PowerShell must work in 5.1.

### 4.1 One-liners

```bash
curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash
```

```powershell
irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1 | iex
# with flags:
& ([scriptblock]::Create((irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1))) -DryRun
```

PowerShell flags use PascalCase equivalents of the bash flags (`-DryRun`, `-Yes`, `-Agents`, `-Privacy`, `-Lang`, `-NoAdmin`, `-Update`, `-Uninstall`, `-Doctor`).

When piped, the script clones (or downloads a release tarball of) the repo to `~/.config/lean-agents/src` and re-executes itself from there. Interactive prompts read from `/dev/tty` so piping still works.

### 4.2 Flags

| Flag | Meaning |
| --- | --- |
| `--dry-run` | Print every action (file writes as diffs, commands) and change nothing. |
| `--yes` | Accept defaults non-interactively (minimal tier only unless other flags add more). |
| `--agents claude,opencode-v2,...` | Which agents to configure. Default: auto-detect installed ones and ask. Values: `claude`, `opencode-v1`, `opencode-v2`, `copilot`, `antigravity`. |
| `--install-agents` | Also install missing agent CLIs with their native installers. Default off. |
| `--skip-agents` | Never install agent CLIs; only configure the ones found. |
| `--tools rtk,context-mode,...` / `--all-tools` / `--no-tools` / `--no-core` | Optional tool selection; `--no-core` drops rtk and context-mode. |
| `--privacy standard\|strict` | Default `standard`. `strict` applies section 11. |
| `--profile <name>` | Model profile from `profiles/` (section 9). Default: ask, or auto-pick by detected providers. |
| `--lang en\|es` | Language of the installed rules and of agent replies. Default `en`. |
| `--no-admin` | Never use sudo/admin; user-scope installs only (corporate laptops). Default on Windows. |
| `--update` | Re-render configs and update tools that were installed by lean-agents (read `state.json`). |
| `--uninstall` | Remove what lean-agents added, restore backups, leave user changes. |
| `--doctor` | Run the doctor only. |

### 4.3 Flow

1. **Detect** OS, arch, shell, package manager (Homebrew on macOS; winget, then Scoop, on Windows), Node (>=22.20), git, uv, jq, gh, and installed agents with versions (`claude --version`, `opencode --version` -> decide v1 vs v2 by major, `copilot --version`, Antigravity CLI **VERIFY binary name**).
2. **Plan**: build the full action list from flags + answers. Show it grouped by agent and tool. Ask "Apply? [y/N]" unless `--yes`.
3. **Back up** every file it will touch into `~/.config/lean-agents/backups/<ISO timestamp>/` keeping relative paths.
4. **Prerequisites**: install only what the selected tools need (Node for npm tools, uv for Serena, jq for some hooks). Policy: system package manager for system tools, npm only for npm-only packages, native installers for agent CLIs.
5. **Render** `core/` into each selected agent (section 6) with `scripts/render.mjs`.
6. **Merge** JSON/JSONC configs: deep-merge, arrays de-duplicated by value, never remove user keys. JSONC comments must survive (use a JSONC-aware merge; if impossible, write the lean-agents block to a sibling file the agent supports, or show a manual diff and stop for that file).
7. **Instructions files**: never overwrite. Claude Code: add one import line `@~/.config/lean-agents/AGENTS.md` to `~/.claude/CLAUDE.md` inside a marker block. OpenCode: add the path to the `instructions` array. Others: append a marker block (`<!-- lean-agents:start -->` ... `<!-- lean-agents:end -->`) whose content is replaced on `--update`.
8. **Tools**: run each selected tool recipe (section 7).
9. **Write** `state.json`.
10. **Doctor** (section 4.5) and print next steps: restart agents, log in to providers, run `update-models`.

### 4.4 Tiers of installation

| Tier | Contents | Default |
| --- | --- | --- |
| Minimal | Global rules (`core/AGENTS.md`), tiered subagents, compaction settings, output limits (`BASH_MAX_OUTPUT_LENGTH=15000`), RTK, Context Mode | Always |
| Optional tools | Serena MCP, Playwright MCP, Ponytail, Caveman skills, i-have-adhd, Codeburn, Skills CLI + AutoSkills, GSD | Asked one by one; `--all-tools` selects all |
| Strict privacy | Section 11 | Off; one question or `--privacy strict` |

### 4.5 Doctor

`scripts/doctor.{sh,ps1}` prints a table: item, expected, found, status (ok / missing / outdated / not supported here). Checks: agent versions, rendered rules present and imported, subagent files present, MCP servers registered (`claude mcp list`, OpenCode resolved config via `opencode debug config` **VERIFY on v2**), each tool's `--version`, privacy keys if strict, no duplicate Context Mode (plugin and MCP both enabled is an error), and that OMO is absent. Exit code non-zero on any error. Never prints secrets: redact any value whose key matches `(?i)(key|token|secret|password|auth)`.

### 4.6 Use cases the installer must cover

| Case | Path |
| --- | --- |
| Nothing installed | One-liner with `--install-agents` |
| Already has an agent | One-liner (default `--skip-agents`): only adds tools and config, respecting existing config |
| Wants their agent to do it | `INSTALL_WITH_AGENT.md` prompt: the agent clones the repo, reads this spec section 4, asks the optional questions, runs the installer with flags, then runs the doctor |
| Only one piece | `tools/<tool>/README.md` recipes and `docs/manual-install.md` |
| Corporate laptop, no admin | `--no-admin` and `--dry-run` output that IT can review |
| Update / uninstall | `--update`, `--uninstall` |

## 5. Global rules (`core/AGENTS.md`)

English, short (target under 1,200 tokens, because it is loaded every turn). Sections, in order:

1. **Explain well**: lead with the answer or decision; skimmable structure; complete concrete sentences; one-line why for non-obvious decisions; state uncertainty and how to verify; never invent APIs, flags or versions; when showing a change say what, where (`file:line`) and how to verify; compressed style (Caveman) only when asked or trivial, never for debugging, security or complex explanations.
2. **Think before coding**: state assumptions; offer interpretations when ambiguous; propose a simpler path if one exists; name unclear points.
3. **Simplicity first**: minimal code that solves it; no unrequested features, single-use abstractions or speculative config; senior-engineer test.
4. **Surgical changes**: touch only what the task needs; follow file style; mention unrelated dead code, do not delete it; every changed line traceable to the request.
5. **Goal-driven execution**: turn vague tasks into verifiable criteria; short plan with a check per step; never claim done without verifying.
6. **Token efficiency**: search before reading (grep, Serena symbols); Context Mode for large outputs; do not repeat file content; delegate exploration and bounded tasks to cheap subagents (`explore`, `research`, `review`); strong tier only for planning, architecture, hard bugs; parallel subagents only when they do not touch the same files; each subagent gets goal, limits, allowed files, output format; finish with a `review` pass.
7. **Safety**: never read, print, copy or log secrets; confirm before irreversible actions (push, deploy, migrations, mass delete); back up before editing system/user config; no new plugins, hooks or MCP servers without an explicit security review.
8. **Final report**: what I did, what I verified (command/result), what is pending; at most one next-step suggestion.

Placeholders rendered at install time: `{{LANG_RULE}}` -> "Always reply in English." or "Always reply in Spanish."; `{{TOOLS_RULES}}` -> only lines for installed tools (no Serena line if Serena is not installed).

`core/AGENTS.es.md` is a faithful Spanish translation with the same structure.

## 6. Subagents and adapters

### 6.1 Neutral format (`core/agents/<name>.md`)

```markdown
---
name: explore
description: Fast read-only codebase search. Use for finding files, symbols and call sites before reading code.
tier: fast            # fast | balanced | strong
reasoning: low        # low | medium | high (ignored where unsupported)
access: read-only     # read-only | read-write | git-read
---
<system prompt body>
```

| Name | Tier | Reasoning | Access | Purpose |
| --- | --- | --- | --- | --- |
| explore | fast | low | read-only | Locate files, symbols, call sites; return paths + 1-line summaries, never whole files |
| research | balanced | low | read-only + web | Docs/web research; return sources with dates |
| review | balanced (Claude: fast) | medium | git-read | Review a diff for bugs and spec drift; ranked findings |
| debug | strong (Claude: balanced) | high | read-write | Reproduce, isolate, fix with a failing-then-passing check |
| planner | strong | high | read-only | Plans and architecture; only when asked or justified |

Primary agents (OpenCode): `plan` (strong, high, read-only, default agent) and `build` (balanced, medium, read-write). Claude Code keeps its built-in main loop; default model alias `sonnet`, `opusplan` documented as an option.

### 6.2 Claude Code adapter (`agents/claude-code/`)

Targets (macOS `~`, Windows `%USERPROFILE%`):

- `~/.claude/CLAUDE.md`: marker block containing `@~/.config/lean-agents/AGENTS.md`.
- `~/.claude/agents/<name>.md`: frontmatter `name`, `description`, `model` (`haiku` | `sonnet` | `opus` | `inherit`, from tier via the profile), `tools` (read-only -> `Read, Grep, Glob`; git-read adds `Bash(git diff:*), Bash(git log:*), Bash(git show:*)`; read-write omits `tools`). **VERIFY current frontmatter keys.**
- `~/.claude/settings.json` (deep-merge):

```json
{
  "model": "sonnet",
  "env": {
    "BASH_MAX_OUTPUT_LENGTH": "15000",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "80"
  }
}
```

  Strict privacy adds to `env`: `DISABLE_AUTOUPDATER=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_BUG_COMMAND=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (**VERIFY** each name in current docs). It also prints the manual step: turn off "Help improve Claude" in claude.ai privacy settings.
- RTK: `rtk init -g` (adds PreToolUse Bash hook and `~/.claude/RTK.md`; **VERIFY**). Keep the `@RTK.md` import RTK adds.
- Plugins (via `claude plugin marketplace add` + `claude plugin install`, **VERIFY marketplace names**): context-mode, ponytail (`ponytail@ponytail`), i-have-adhd (+ flag file `~/.claude/.i-have-adhd-always` when the user wants always-on).
- MCP (user scope):

```bash
claude mcp add --scope user serena -- uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project-from-cwd
claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest
```

  Serena: disable the web dashboard auto-open (`web_dashboard_open_on_launch: false` in `~/.serena/serena_config.yml`, **VERIFY**). Add `.serena/` to the global git ignore (`git config --global core.excludesFile`, default `~/.config/git/ignore`).
- Skills: install to `~/.agents/skills/` (shared) and symlink into `~/.claude/skills/` (Windows: directory junction via `New-Item -ItemType Junction`).
- Compaction: Claude has no DCP equivalent; autocompact override at 80% is the replacement.

### 6.3 OpenCode 2.x adapter (`agents/opencode-v2/`)

Installer: `curl -fsSL https://opencode.ai/v2/install | bash` (Windows: from Git Bash; add `%USERPROFILE%\.opencode\bin` to user PATH). Update: `opencode upgrade`. Config dir `~/.config/opencode/`. Known V2 differences from V1 (from a real migration, **VERIFY** against current docs): `plugin` -> `plugins`; `autoupdate: false` -> `update: "disable"`; `experimental.openTelemetry` ignored; `mcp` -> `mcp.servers`; `tui.json` -> `cli.json`; V1 plugins do not run; a custom `system` on an agent replaces the base prompt (do not set one on plan/build/explore).

`opencode.jsonc` block to merge:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",   // VERIFY v2 schema URL
  "instructions": ["~/.config/lean-agents/AGENTS.md"],
  "default_agent": "plan",
  "compaction": { "auto": true, "buffer": 40000 },
  "plugins": ["@dietrichgebert/ponytail"],
  "mcp": {
    "servers": {
      "context-mode": { "type": "local", "command": ["npx", "-y", "context-mode"] },
      "serena": { "type": "local", "command": ["uvx", "-p", "3.13", "--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"] },
      "playwright": { "type": "local", "command": ["npx", "-y", "@playwright/mcp@latest"] }
    }
  },
  "agent": { /* rendered from core/agents + profile, see below */ }
}
```

- Context Mode runs as MCP on V2 because its plugin targets the V1 API; switch to plugin when upstream supports V2 (doctor warns if both are enabled).
- RTK: `rtk init -g --opencode`, plus `plugins/rtk.ts` written for the V2 plugin API (**VERIFY** RTK ships a V2 plugin; if not, ship ours in `agents/opencode-v2/plugins/rtk.ts`).
- i-have-adhd: `git clone https://github.com/ayghri/i-have-adhd ~/.config/opencode/vendor/i-have-adhd`, loader `~/.config/opencode/plugins/i-have-adhd.ts` containing `export { default } from '../vendor/i-have-adhd/.opencode/plugins/i-have-adhd.mjs';`, optional flag `~/.config/opencode/.i-have-adhd-always`.
- Ponytail default mode: `~/.config/ponytail/config.json` (Windows `%APPDATA%\ponytail\config.json`) `{"defaultMode": "lite"}`; ask the user (lite recommended, full is upstream default).
- Agents: each rendered entry has `model` (`provider/model-id` from profile), `reasoning`/variant per tier (**VERIFY** v2 key, e.g. `model#high` suffix vs `reasoningEffort`), `description`, `mode` (`primary` for plan/build, `subagent` otherwise), `permission` for read-only (`edit: deny`, `bash: ask` or git-read allowlist).
- Strict privacy: `"share": "disabled"`, `"update": "disable"`, provider policy denying the `opencode` (Zen) provider unless the user picked an OpenCode profile (**VERIFY** v2 key; on the reference Mac it was a `policy` deny on `provider.use opencode`).
- Compaction note: DCP has no V2 release; native compaction with a 40K buffer on ~200K-context models replaces it.

### 6.4 OpenCode 1.x adapter (`agents/opencode-v1/`)

Target: OpenCode `>=1.18.29` (needed by i-have-adhd), reference version 1.19.0. Installer `curl -fsSL https://opencode.ai/install | bash`.

```jsonc
{
  "instructions": ["~/.config/lean-agents/AGENTS.md"],
  "plugin": ["@tarquinen/opencode-dcp@latest", "context-mode", "@dietrichgebert/ponytail"],
  "mcp": {
    "serena": { "type": "local", "command": ["uvx", "-p", "3.13", "--from", "git+https://github.com/oraios/serena", "serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"], "enabled": true },
    "playwright": { "type": "local", "command": ["npx", "-y", "@playwright/mcp@latest"], "enabled": true }
  },
  "agent": { /* rendered */ }
}
```

- Strict privacy: `"share": "disabled"`, `"autoupdate": false`, `"experimental": {"openTelemetry": false}`, `"disabled_providers": ["opencode"]` (unless an OpenCode profile is chosen).
- DCP: `opencode plugin @tarquinen/opencode-dcp@latest --global`; then `~/.config/opencode/dcp.jsonc`:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json",
  "compress": { "minContextLimit": 100000, "maxContextLimit": 160000 }
}
```

  Values are for 200K context; scale for other windows (min = 50%, max = 80%).
- Context Mode: plugin route only (`npm install -g context-mode` + `"context-mode"` in `plugin`). Never also enable `mcp.context-mode`.
- Ponytail: `opencode plugin @dietrichgebert/ponytail --global` (update with `--force`).
- RTK: `rtk init -g --opencode` (local plugin `plugins/rtk.ts`).
- i-have-adhd: same vendor + loader as V2. If `plugins/package.json` declares CommonJS, the `.ts` loader is required (do not copy upstream source).
- `docs/migrate-opencode-v1-to-v2.md`: back up, translate keys (table in 6.3), drop V1-only plugins (DCP), move Context Mode to MCP, check `tui.json` for stale references, verify with `/status`.

### 6.5 GitHub Copilot CLI adapter (`agents/copilot-cli/`) — VERIFY ALL

Research current docs first and record findings in `docs/compatibility.md`. Expected surface: global instructions file (e.g. `~/.copilot/copilot-instructions.md` or AGENTS.md support), custom agents (`~/.copilot/agents/*.agent.md`), MCP config (`~/.copilot/mcp-config.json`), skills support. Map: rules -> instructions file marker block; subagents -> custom agents with model from the Copilot profile; MCP -> Serena, Playwright, Context Mode. Ponytail and i-have-adhd: not supported as plugins; i-have-adhd rules may be included as an instruction block if the user opts in. Install: official installer or `npm install -g @github/copilot` (**VERIFY**).

### 6.6 Antigravity CLI adapter (`agents/antigravity/`) — VERIFY ALL

Same approach: research the current CLI (binary name, global rules location, workflows, MCP config file). Map rules -> global rules file, MCP -> Serena, Playwright, Context Mode; subagents only if supported. Mark everything else "not supported" honestly.

### 6.7 Later candidates

Codex CLI, Gemini CLI, Cursor: they read AGENTS.md; add adapters only after v1 ships. Note them in the README roadmap.

Gemini CLI (checked 2026-11-03): individual access moved to Antigravity CLI on 2026-06-18, so Gemini CLI now serves Gemini Code Assist Standard and Enterprise. Not supported; facts in `docs/compatibility.md`.

## 7. Third-party tools (`tools/<tool>/`)

Each recipe: `README.md` (what, why, upstream, license, per-agent wiring, remove), `install.sh`, `install.ps1`, `uninstall.*`, and a `check` function used by the doctor.

| Tool | Upstream | macOS | Windows | Wires into | Tier |
| --- | --- | --- | --- | --- | --- |
| RTK | github.com/rtk-ai/rtk | `brew install rtk` (**VERIFY** formula) | winget `rtk-ai.rtk` or release zip `rtk-x86_64-pc-windows-msvc.zip` to `%USERPROFILE%\tools\rtk` + user PATH | Claude hook, OpenCode plugin | Minimal |
| Context Mode | github.com/mksglu/context-mode | `npm install -g context-mode` | same | Claude plugin, OC v1 plugin, OC v2/Copilot/Antigravity MCP | Minimal |
| Bun (optional speed-up for Context Mode) | bun.sh | `brew install oven-sh/bun/bun` | `winget install Oven-sh.Bun` | — | Optional |
| Serena | github.com/oraios/serena | needs `uv` (`brew install uv`) | `winget install astral-sh.uv` | MCP everywhere | Optional |
| Playwright MCP | github.com/microsoft/playwright-mcp | npx | npx | MCP everywhere | Optional |
| Ponytail | github.com/DietrichGebert/ponytail | plugin per agent | same | Claude, OC v1, OC v2 | Optional |
| Caveman | github.com/juliusbrussee/caveman | `npx skills add juliusbrussee/caveman -a <agent> -g` (skills: caveman, caveman-compress, caveman-stats) | same | Skills | Optional |
| i-have-adhd | github.com/ayghri/i-have-adhd | plugin (Claude), vendor + loader (OpenCode) | same | Claude, OC | Optional |
| Codeburn | getagentseal/codeburn (**VERIFY** repo URL and package) | `npx codeburn` (no global install by default) | same | Usage/cost report across agents | Optional, recommended |
| Skills CLI | vercel `skills` (`npx skills`) | npx | npx | Skill install for any agent | Optional |
| AutoSkills | **VERIFY** package identity before shipping (`npx autoskills`) | npx | npx | Suggests skills from the project | Optional |
| GSD Core | github.com/open-gsd/gsd-core | `npx @opengsd/gsd-core@latest` (interactive; pick agent + global) | same | OC, Claude | Optional, off by default |
| GitHub CLI | cli.github.com | `brew install gh` | `winget install GitHub.cli` | Used by update-models and PR workflows | Optional |
| Context7 | upstream `npx ctx7 setup --<agent>` | needs an account/API key: document only, never store the key | same | MCP | Docs only |

For `npx` tools, pin a version in the recipe once verified, and document how to update. For GSD, ship `profiles/<profile>/gsd-defaults.json` examples that map GSD agents to tiers (planner/roadmapper/advisor/executor/verifier = balanced or strong; researchers/checkers/mappers = fast; debugger = strong) and back up `~/.gsd/defaults.json` before applying.

## 8. MCP servers (`core/mcp.json`)

Neutral list rendered per agent: `serena`, `playwright`, `context-mode` (MCP only where the plugin route is not available). A clearly marked comment in docs explains how to add company MCP servers locally without committing them. Keep the list short: every MCP server costs context tokens on every turn.

## 9. Models that stay current

### 9.1 Tiers

`core/tiers.json` maps tiers to models per profile:

```json
{
  "claude-pro":   { "fast": "haiku", "balanced": "sonnet", "strong": "opus" },
  "vertex-gemini": { "fast": "google-vertex/<flash-lite-id>", "balanced": "google-vertex/<flash-id>", "strong": "google-vertex/<pro-id>" }
}
```

Claude Code uses the aliases `haiku`, `sonnet`, `opus`, which already track the latest model, so the Claude profile never needs IDs.

### 9.2 Profiles (`profiles/<name>/profile.json`)

Each file has `name`, `verified_on` (date), `provider`, `notes` (cost, context window, data-training policy), `tiers`, and optional per-agent overrides (OpenCode `title` agent = fast). Ship v1 with: `claude-pro-max`, `vertex-gemini` (reference: plan/debug = strongest Gemini, high reasoning; build/research/review = latest Flash; explore/title = latest Flash-Lite), `github-copilot`, `opencode-go`, `anthropic-api`, `openai-api`. Fill model IDs by checking each provider's current model list on the build date. Exclude models whose terms allow training on user data when `--privacy strict`.

### 9.3 `update-models` skill + monthly workflow

- The skill (section 10) refreshes the user's local mapping.
- `.github/workflows/models-refresh.yml` runs monthly (`cron: '0 9 1 * *'`) and on `workflow_dispatch`. It must not need secrets for v1: it fetches public model lists/changelogs where available (**VERIFY** endpoints), compares with `profiles/*/profile.json`, and opens a PR with proposed bumps and links. If no public list exists for a provider, the workflow opens an issue reminder instead.

## 10. Original skills (`skills/`)

Use the Agent Skills format (`SKILL.md` with `name` and `description` frontmatter) so they install with `npx skills add estebanmr99/lean-agents`.

1. **setup-doctor**: runs `scripts/doctor.*`, explains each failing line and proposes the exact fix; asks before applying.
2. **token-audit**: runs Codeburn (if installed) for the last 7 days, summarizes top cost drivers (models, sessions, tools, big outputs), and suggests concrete config changes from this repo (e.g. route X to fast tier, enable Context Mode for test output).
3. **update-models**: lists models the user's account can actually use (`opencode models`, Claude `/model` aliases, Copilot model list), reads provider release notes, proposes a new tier mapping as a diff of `~/.config/lean-agents/state.json` + agent configs, explains why per change, writes only after approval, then re-renders.

## 11. Strict privacy mode

Off by default. When on, per agent:

| Agent | Changes |
| --- | --- |
| Claude Code | env flags in 6.2; manual step to disable model-training in account settings |
| OpenCode v2 | `share: disabled`, `update: disable`, deny Zen provider (unless chosen) |
| OpenCode v1 | `share: disabled`, `autoupdate: false`, `experimental.openTelemetry: false`, `disabled_providers: ["opencode"]` |
| Copilot CLI | **VERIFY** telemetry/auto-update settings; document the org/account policy for prompt retention |
| Antigravity | **VERIFY** |
| Tools | GSD/OMO-style telemetry env vars off where they exist; Serena dashboard off; no tool that phones home without opt-in |

Strict mode also: forbids profiles using providers that train on prompts, shows a reminder that updates are now manual (`lean-agents --update` and `docs/update.md`), and records the choice in `state.json`. `docs/privacy.md` explains every switch, its source link and verification date.

## 12. Quality, CI and release

- `scripts/check-private.sh`: fails if any tracked file matches the denylist. The denylist lives outside the repo: local file `.private-denylist` (gitignored) and, in CI, the `PRIVATE_DENYLIST` repository secret (newline-separated regexes). Always-on generic patterns committed in the script: `/Users/[a-z0-9._-]+/` and `C:\\Users\\[^\\%]+\\` (except `<username>` placeholders), email addresses, `AKIA[0-9A-Z]{16}`, `ghp_[A-Za-z0-9]{36}`, `sk-[A-Za-z0-9-]{20,}`, `AIza[0-9A-Za-z_-]{35}`, `xox[baprs]-`, private key headers.
- `secret-scan.yml`: gitleaks on push and PR + `check-private.sh`.
- `ci.yml` matrix `macos-latest`, `windows-latest` (and `ubuntu-latest` for shellcheck): shellcheck, PSScriptAnalyzer, bats tests, Pester tests, `render.mjs` snapshot tests, and an end-to-end `--dry-run --yes --all-tools` in a temporary `HOME`/`USERPROFILE` asserting no file outside it changes. A second job installs for real in a temp home with `--no-tools` and runs the doctor.
- `release.yml`: on tag `v*`, build release notes from CHANGELOG and attach a tarball/zip.
- Branch protection suggestion in CONTRIBUTING: CI green required.

## 13. README strategy (stars)

Order of `README.md`:

1. Banner (`docs/assets/banner.svg`), one-line pitch, badges: license, CI, platforms (macOS | Windows), agents supported, latest release, stars.
2. "Leer en español" link.
3. 15-second demo GIF of the installer (`docs/assets/demo.gif`, recorded with vhs or asciinema + agg; script in `docs/assets/demo.tape`).
4. **Quick start**: the two one-liners, then "or let your agent install it" linking `INSTALL_WITH_AGENT.md`.
5. **Why**: three bullets. No savings numbers: the owner dropped the before/after claim. Never invent numbers.
6. **What you get**: compatibility table agent x feature (✅ / ⚠️ partial / ➖ n/a).
7. Tiers (minimal / optional / strict privacy) in one table.
8. Models that stay current (3 lines).
9. Uninstall and safety guarantees (backups, no secrets, dry run).
10. Credits: every upstream tool with link.
11. Roadmap, contributing, license.

GitHub settings to suggest to the owner: description = pitch, topics `claude-code`, `opencode`, `github-copilot`, `ai-agents`, `agents-md`, `mcp`, `token-optimization`, `dotfiles`, `developer-tools`; social preview image from the banner; Discussions on.

Launch kit (`docs/launch.md`, not linked from README): posts for X, LinkedIn, Reddit (r/ClaudeAI, r/opencode, r/LocalLLaMA, r/ChatGPTCoding), Show HN title + first comment, list of awesome-lists to submit to (awesome-claude-code, awesome-opencode, awesome-mcp), and tags for each upstream author.

## 14. Build sessions

Mark each `[x]` when merged.

- [x] **Session 1 — Foundation** (PR #1). Spec, rules, neutral subagents, README (EN/ES), contributing files, privacy check, secret scan.
- [x] **Session 2 — Claude Code + OpenCode 2.x** (PR #2). Node engine, `install.sh`, Claude Code and OpenCode 2 adapters, profiles, docs, CI on Ubuntu and macOS, real OpenCode 2.2.5 check in CI.
- [x] **Session 3 — Windows + OpenCode 1.x + wider CI** (PR #4). `install.ps1`, OpenCode 1.x adapter, optional DCP, tool rules, CI with real binaries on Windows, OpenCode 1.19, Claude Code and real tool installs.
- [x] **Session 4 — Copilot CLI, Antigravity CLI, tools, skills, models** (PR #5). Both adapters, Codeburn, opt-in GSD and AutoSkills, three skills, three profiles, `models-refresh`, `XDG_CONFIG_HOME`, `--home` passed to child tools, real Copilot, Antigravity and winget jobs. Open: Copilot `model` format and Antigravity rule and skill loading need a logged-in check.
- [x] **Session 5 — Launch** (PR #7). Banner, demo GIF, social preview, launch kit, release workflow, skills undo and HOME fixes.
- [x] **Session 6 — Enterprise and team basics** (PR #11). Proxy passed to every command and shown redacted, network presets (`--network`, per-category flags, saved in `state.json`), `gh` prerequisite, interactive menus with `@clack/prompts`, notes or default for undocumented settings, `docs/SECURITY-REVIEW.md`, real proxy and pty CI jobs. Open: Antigravity telemetry and auto-update, Serena config path, winget persistent proxy, download hosts, DCP/GSD/AutoSkills telemetry and Windows arrow-key menus stay VERIFY.
- [x] **Session 7 — VS Code Copilot, Cursor, team repos, Claude through Copilot** (PR #10). Adapters `vscode-copilot` (user rules, agents, MCP, skills, strict settings) and `cursor` (agents, MCP, RTK hook, skills), `--project <dir>` team mode with state outside the repo, `docs/claude-with-copilot.md` (partner agent only, token proxies not supported), `--home` kept inside the temp dir on Windows, real Cursor CLI and VS Code CLI CI jobs. Open: VS Code user `mcp.json` path on Windows, `.agent.md` `model` format, VS Code reading Copilot CLI hooks, Cursor CLI reading `~/.cursor/agents`, Context Mode hooks for Cursor and VS Code, Claude agent plans, policy labels and minimum VS Code version stay VERIFY.
- [x] **Session 8 — Terminals: Warp, Orca, or neither.** Integrations for users who already have the terminal (`--terminal`, detected and preselected), apps never installed, CI `real-terminals`. Open: Orca hooks on/off from lean-agents, Orca OpenCode plugin, Warp minimum version and no-op outside Warp, app paths on Windows stay **VERIFY**.
- [ ] **Session 9 — Showcase.** Logo, GIF per use case, who it is for.
- [x] **Session 10 — Parallel agent sessions.** Coordinator plus one worker per task in its own git worktree, prompt files, status, one-at-a-time merges; Orca when installed, plain git worktree otherwise. Starts after sessions 6 and 8 merge.
- [x] **Session 11 — Antigravity full setup.** CLI on Windows (real `agy` in CI), CLI and app installed through verified brew and winget ids, vendor link otherwise. One adapter serves app and CLI; no `config.json` keys written (none documented). Bun (item 8) skipped: session 13 shipped it. Open: app loading, app MCP path, settings keys, CLI winget scope stay VERIFY.
- [x] **Session 12 — Release readiness.** OpenCode + GitHub Copilot demo path, signed-in browser through the Playwright Extension, issue #6, Bun benchmark, Gemini CLI research, 0.5.0 release notes. No tag.
- [x] **Session 13 — Bun for Context Mode** (PR #14). Bun installed by default at user scope when Context Mode is selected (`--no-bun` opts out), faster `ctx_execute` and TypeScript. Fixes the Playwright rule line for Claude-only installs.
- [x] **Session 14 — 0.5.0 final check.** README audit for the demo, proxy, menus, VS Code Copilot, Cursor, `--project`, Playwright extension and Bun; CHANGELOG 0.5.0 complete; release dry run in a scratch clone. No tag.
- [x] **Session 15 — README look and feel.** Hero, one badge row, table of contents, collapsible long sections, consistent tables in README EN and ES; a script checks links, anchors, EN/ES parity and that every shown installer command exits 0 in a dry run. 0.5.0 CHANGELOG housekeeping. No feature claims change.
- [x] **Session 16 — Fixes and docs from real installs** (0.5.1). Issues #20, #27, #31, #32, #39.
- [x] **Session 17 — Windows: Cursor CLI and Orca** (0.5.1). Issues #21, #22, #23, #25, #26, #28, #29.
- [x] **Session 18 — Pick only what you need, pin what runs** (0.6.0). Issues #30, #33, #40.
- [x] **Session 21 — Lean CI: pinned on PRs, latest daily** (0.6.0, after session 18). Issue #42.
- [x] **Session 19 — Migrate from one harness to another** (0.6.0). Issue #34.
- [x] **Session 20 — Install with an agent, opt-in feedback, gh by default** (0.6.0). Issues #35, #36, #37.
- [x] **Session 22 — Repo audit, issue forms, labeled backlog** (0.7.0). `docs/audit-2026-11.md`, forms in `.github/ISSUE_TEMPLATE` (bug, feature, update-finding, agent-support, config), `scripts/labels.sh`, the backlog as labeled issues, "Before each release" checklist. Audit findings are filed as issues, not fixed here.
- [x] **Session 45 — Agent-first updates** (0.7.0). Issue #45. `lean-update` skill, read-only detection table in `docs/manual-install.md`, one temp backup removed after `--doctor`, `--update` prints old -> new, `--doctor --json` lists `behind`, daily green `ci-latest` opens a pin-bump PR.
- [x] **Session 58 — 1-minute README** (0.7.0). Issue #58, PR #81. Short README EN and ES with a support matrix, "what you get" and "who it is for"; `scripts/check-readme.mjs` enforces the 1-minute rule in CI.
- [x] **Session 59 — Architecture checkpoint** (0.7.0). Issue #59. [`docs/checkpoints/0.7.0.md`](checkpoints/0.7.0.md): one keep / change / spike per question, and the 0.7.0 sessions below.

0.7.0 sessions from the checkpoint, accepted by the owner on 2026-11-06 (order and parallel groups in [`docs/checkpoints/0.7.0.md`](checkpoints/0.7.0.md) section 5):

- [x] **Session 69 — CI trust** (0.7.0). Issues #69, #70, #56. #69 done (PR #83); #70 and #56 done (PR #95). Actions pinned by SHA plus Dependabot, least-privilege tokens, macOS jobs fixed or trimmed, one update channel (pin-bump PR, no per-tool issues), `ci-latest` green. One update channel and green ci-latest finished in Session 108 (#108). Sonnet.
- [x] **Session 68 — File safety and redaction** (0.7.0). Issues #68, #67, #74, #72. (PR #94; #72 in PR #89). Opus plans the env allowlist, Sonnet builds.
- [x] **Session 71 — Contributor and governance docs** (0.7.0). Issues #71, #73. (#71 in PR #88, #73 in this PR). Haiku.
- [x] **Session 79 — OpenCode 1.x safety and Orca** (0.7.0). Issues #79, #78. #79 done (PR #86), #76 done (PR #90). #78 moved to 0.8.0 (owner decision: it waits for the work PC), so it is not in the 0.7.0 scope. Never cross OpenCode 1.x to 2.x, warn about session loss; Orca status icons on OpenCode 1.19 (`scripts/lib/terminals.mjs`). After 44 if it touches `scripts/lib/system.mjs`. Sonnet.
- [x] **Session 107 — Context Mode MCP starts with server** (0.7.0). Issue #107, PR #110. Sonnet.
- [x] **Issue #123 — Copilot credits in OpenCode** (0.7.0). PR #125. Sidebar on OpenCode 2.x stays **VERIFY**.
- [x] **Issue #124 — Windows shell notice** (0.7.0). PR #127. Warning only; making Git Bash the OpenCode shell default is a follow-up.
- [x] **Issue #60 — Multi-agent coordinator workflow** (0.8.0). PR #131. `docs/agent-workflow.md`, opt-in `coordinate` skill, `coord-watch.sh`, `real-coord-watch` CI job.
- [x] **Issue #124 follow-up — Git Bash as OpenCode's default shell** (0.8.0). PR #133. Branch `session-124b-opencode-shell`. `real-opencode-shell` CI job (windows-latest, OpenCode 1.19.0 and 2.2.5) with a mock OpenAI-compatible LLM proves (or disproves) that the `shell` config key selects Git Bash on Windows; only if proven do the adapters set it by default (`--shell default` opts out).
- [x] **Issue #126 — README rewrite** (0.7.0). PR #128.
- [x] **Session 108 — One update channel** (0.7.0). Issue #108. Haiku.
- [x] **Session 64 — Pin and verify downloaded code** (0.7.0, after 69). Issues #64, #66, #75. Sonnet. PR #115.
- [x] **Session 93 — migrate owned-file check** (0.7.0). Issue #93. Sonnet. #112 done (skills 1.8 Antigravity skill path).
- [x] **Session 50 — Pin bumps** (0.7.0, after 64). Issues #50, #51, #52. Merge the ci-latest pin-bump PR instead of hand bumps; keep opencode-v1 at 1.19.0 (work PC version); also closes #97 to #102. Haiku.
- [x] **Session 44 — Context Mode on Node < 24.15** (0.7.0, after 64). Issues #44 and #104 points 1 to 3 (engines check, `node` field per pin, matching nvm Node with absolute registration). Opus plans, Sonnet builds. #104 points 4 and 5 and #106 go to 0.8.0; #103 later.
- [x] **Session 65 — How you get it: release tag default, npm package** (0.7.0, after #58, 69 and 44). Issues #65, #46. Opus plans, Sonnet builds.
- [x] **Archive done sessions** (0.7.0, last, alone). Checkpoint Q3: 18 finished session blocks moved to [`docs/sessions-done.md`](sessions-done.md); one line each stays here. Session 9 stays open. Haiku.
- [x] **Issue #123 follow-up — Copilot credits on OpenCode 2.x, status lines** (0.8.0). PR #137. Claude `statusLine` only when none is set.
- [x] **Issue #130 — Code navigation: Serena vs codebase-memory-mcp** (0.8.0). PR #134. Serena stays the default.
- [x] **Session 106 — Adopt a hand-built machine** (0.8.0). Issues #106, #104 points 4 and 5, #132. PRs #135 (doctor Node per tool), #138 (`--adopt` dry run, `--json`), #140 (apply, undo, backup, `real-adopt`).
- [x] **Issue #78 — Orca status on OpenCode 1.x** (0.8.0). PR #136. Windows-only shim, `NO_PROXY` and Ctrl+P notes. The bug was not reproduced in CI, so #78 stays open for the work PC.
- [x] **Session 80 — Agent lifecycle, part 1** (0.8.0). Issue #80. PRs #139 (`--migrate` to and from Antigravity), #141 (`--upgrade-agent opencode` dry run, `lean-migrate` skill), #142 (`--install-agent` / `--uninstall-agent`), #143 (side-by-side spike, manual workflow). The guided upgrade itself (PR B) moves to 0.9.0: the spike showed 2.x migrates the shared 1.x db in place; owner layout note in the 0.9.0 plan.

### Session 9 — Showcase

Branch: `session-9-showcase`.

1. Logo (SVG) and an updated banner.
2. Short GIFs rendered in CI with vhs, one per use case: dry run, uninstall, enterprise all-off preset, team `--project` mode.
3. README sections: who it is for (solo dev, team on VS Code Copilot, enterprise PC behind a proxy) and what it does on a budget. Only claims the repo can show; any owner experience is quoted as personal, with no company budget figures.
4. Update `docs/launch.md` and the social preview.

Done when: the `assets` workflow renders every image and GIF, and the owner has checked the frames.

## 15. Definition of done (every session)

- `scripts/check-private.sh` passes locally; gitleaks passes.
- No file outside a temporary HOME is touched by tests.
- Every new command or config key is either verified (date in `docs/compatibility.md`) or marked **VERIFY** with an open issue.
- README and docs updated for what changed; CHANGELOG entry under Unreleased.
- A short summary for the owner: what changed, how it was tested, what is pending.

### Before each release

- README EN and ES in sync with the code and the CHANGELOG (flags, tables, Node version, pins). `node scripts/check-readme.mjs` is enforced by CI (the `lint` job and the release workflow); a person still re-reads the first screen.
- README still fits the 1-minute rule: hero within the line budget before Details, support matrix matches the CI jobs in `ci.yml` (cells without a real-binary job say VERIFY), alt text on every image.
- Audit rerun: update `docs/audit-2026-11.md` (or the newest `docs/audit-*.md`); every medium or higher finding is fixed or has an open issue.
- Labels triaged: no open issue without a `type:` and a `priority:` label (`bash scripts/labels.sh` first if labels are missing); p0 issues are closed or consciously deferred.
- Architecture checkpoint (#59): write `docs/checkpoints/<version>.md`, one keep / change / spike per question. Latest: [`docs/checkpoints/0.7.0.md`](checkpoints/0.7.0.md).
- `docs/ROADMAP.md` and `CHANGELOG.md` match what is merged.
