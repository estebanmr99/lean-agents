# Security review before you install

Paste the prompt below into the agent you already use (VS Code Copilot, Cursor, Claude Code, OpenCode, Copilot CLI) with this repository open. The agent checks lean-agents against your company's rules **before** anything is installed. The lists after the prompt are the reference it compares against.

## The prompt

```text
You are reviewing the lean-agents repository before I install it on this machine. Do not run the
installer for real and do not change any file outside a temporary directory.

1. Read docs/SECURITY-REVIEW.md (this file), docs/privacy.md and docs/compatibility.md.
2. Check that the lists in docs/SECURITY-REVIEW.md match the code: scripts/lean.mjs,
   scripts/lib/system.mjs, scripts/lib/network.mjs, scripts/lib/adapters/*.mjs, scripts/lib/gsd.mjs,
   core/mcp.json, install.sh and install.ps1. Report anything the code does that the lists miss.
3. Run a preview in a throwaway HOME and compare it with the lists:
     node scripts/lean.mjs --home "$(mktemp -d)" --no-exec --yes --dry-run \
       --agents claude,opencode-v2,copilot-cli,antigravity --all-tools --network off
   (PowerShell: --home "$env:TEMP\lean-review").
4. Find my company's rules for developer tools, proxies, telemetry and third-party software:
   - If you have a wiki or documentation MCP server (for example Confluence, Notion or SharePoint),
     search it for: proxy, certificate, CA, allowed software, AI tools, telemetry, npm registry.
   - If you have a browser tool, open the internal IT pages I name.
   - If you have neither, STOP and ask me to paste the relevant internal IT or proxy wiki pages.
     Do not guess the policy.
5. Answer with:
   - A table: item (file, command, host or tool) | what it does | allowed by policy? (yes / no /
     unclear, with the policy quote) | what to change.
   - The proxy and CA variables I need to set (HTTPS_PROXY, NO_PROXY, NODE_EXTRA_CA_CERTS, ...),
     using docs/compatibility.md "Proxy and corporate CA". Never ask me for a proxy password; tell me
     to set it in my own shell.
   - Which network preset fits (--network off for most company machines) and which tools to leave out.
   - The exact install command to run, starting with --dry-run.
```

## Files written

Every path is under your home folder. Existing files are backed up to `~/.config/lean-agents/backups/` first; JSON files are edited key by key and keep your comments and values; `--uninstall` undoes all of it.

| Path | When |
| --- | --- |
| `~/.config/lean-agents/AGENTS.md`, `state.json`, `backups/` | always |
| `~/.claude/CLAUDE.md` (marked block), `settings.json`, `agents/*.md`, `.i-have-adhd-always` | Claude Code |
| `~/.config/opencode/opencode.jsonc`, `agents/*.md`, `plugins/i-have-adhd.ts`, `vendor/i-have-adhd/`, `.i-have-adhd-always`, `dcp.jsonc` (1.x only) | OpenCode (`$XDG_CONFIG_HOME` if set) |
| `~/.copilot/copilot-instructions.md` (marked block), `agents/*.agent.md`, `mcp-config.json`, `settings.json` | Copilot CLI |
| `~/.gemini/config/rules/lean-agents.md`, `agents/*.md`, `mcp_config.json` | Antigravity CLI |
| `~/.config/ponytail/config.json` (`%APPDATA%\ponytail` on Windows) | Ponytail |
| `~/.gsd/defaults.json` | GSD (opt-in) |
| `~/.config/lean-agents/notes/<item>.md` | only if you paste docs or IT notes for an undocumented setting; never applied automatically |
| `~/.claude/skills/`, `~/.agents/skills/` | Caveman, i-have-adhd skills (written by the Skills CLI) |

Third-party tools also write their own files when lean-agents runs them (for example `rtk init` adds a hook or plugin, `claude plugin install` fills `~/.claude/plugins/`).

## Commands run

Only after you approve the plan, and never with admin rights. `--dry-run` prints the exact list for your choices.

| Command | Why |
| --- | --- |
| `brew install rtk`, `uv`, `git`, `gh` or `winget install --id rtk-ai.rtk`, `astral-sh.uv`, `Git.Git`, `GitHub.cli` (`--scope user`) | missing prerequisites; `gh` only when asked |
| `npm install -g context-mode` | Context Mode |
| `rtk init -g …` (per agent) | RTK hook or plugin |
| `claude plugin marketplace add …`, `claude plugin install …`, `claude mcp add --scope user …` | Claude Code plugins and MCP servers |
| `copilot plugin install …`, `agy plugin install …` | Context Mode for Copilot CLI and Antigravity |
| `npx -y skills add …` / `skills remove …` | Caveman and i-have-adhd skills |
| `git clone --depth 1 https://github.com/ayghri/i-have-adhd …` | i-have-adhd for OpenCode |
| `npx -y @opengsd/gsd-core@latest …` | GSD (opt-in) |
| `node scripts/adhd-skill.mjs …` | local edit of the installed i-have-adhd skill |

Bootstrap only: `install.sh` / `install.ps1` may run `git clone` or `git fetch` of this repository and `npm ci --omit=dev` (packages `jsonc-parser` and `@clack/prompts`).

## Network hosts

At install time, through your proxy if one is set (the `real-proxy` CI job prints every host it saw):

| Host | Used by |
| --- | --- |
| `github.com`, `raw.githubusercontent.com`, `codeload.github.com`, `objects.githubusercontent.com` | this repository, Claude plugin marketplaces, Skills CLI, i-have-adhd, Serena source, GitHub release downloads |
| `registry.npmjs.org` | npm and npx packages |
| `ghcr.io`, `formulae.brew.sh` | Homebrew bottles (macOS, Linux) |
| `cdn.winget.microsoft.com` and each package's own download host | winget (Windows) |
| `pypi.org`, `files.pythonhosted.org` | uv when it first runs Serena |

When the agents run, they also reach their own model providers, and MCP servers start with `npx` or `uvx` (which may download again). Playwright MCP downloads a browser the first time it needs one. **VERIFY:** the exact winget and Playwright download hosts.

## Third-party tools

Each one comes from its upstream source; see the README "Credits" table for links and licenses.

| Tool | Default | Phones home? |
| --- | --- | --- |
| RTK | always | telemetry is opt-in (`rtk telemetry enable`) |
| Context Mode | always | none documented |
| Serena, Playwright MCP, Ponytail, Caveman, i-have-adhd, Codeburn | optional | Caveman telemetry is on by default (off with `DO_NOT_TRACK=1`); others: see [compatibility.md](compatibility.md#outbound-switches) |
| DCP | optional, OpenCode 1.x | **VERIFY** |
| GSD, AutoSkills | opt-in only | **VERIFY** |
| GitHub CLI | only when asked | telemetry: `GH_TELEMETRY=false` |

lean-agents never asks for, stores or prints API keys, tokens or proxy passwords. Logins (`gh auth login`, `/login`, `/connect`) stay with you.
