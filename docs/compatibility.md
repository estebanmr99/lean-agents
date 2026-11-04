# Compatibility

What lean-agents configures per agent, how, and when each command or key was last checked against upstream.

| Feature | Claude Code | OpenCode 2.x | OpenCode 1.x | Copilot CLI | Antigravity CLI |
| --- | --- | --- | --- | --- | --- |
| Global rules | `@` import in `~/.claude/CLAUDE.md` | `instructions` entry | `instructions` entry | marked block in `~/.copilot/copilot-instructions.md` | `~/.gemini/config/rules/lean-agents.md` |
| Subagents by tier | `~/.claude/agents/*.md` | `~/.config/opencode/agents/*.md` | `~/.config/opencode/agents/*.md` | `~/.copilot/agents/*.agent.md` | `~/.gemini/config/agents/*.md` (`subagent: true`) |
| Primary agent models | `model` in settings (only if unset) | `agents.plan` / `agents.build` from profile | `agent.plan` / `agent.build` from profile | planned | planned |
| RTK | `rtk init -g --auto-patch` (hook) | `rtk init -g --opencode` (plugin) | `rtk init -g --opencode` (plugin) | `rtk init -g --copilot` | `rtk init -g --agent antigravity` |
| Context Mode | plugin `context-mode@context-mode` | MCP (`mcp.servers`) | `plugin` entry, needs Node.js 22.5+ | `copilot plugin install mksglu/context-mode:configs/copilot-cli` | `agy plugin install` from `configs/antigravity-cli` |
| Serena, Playwright | `claude mcp add --scope user` | `mcp.servers` | flat `mcp.<name>` | `~/.copilot/mcp-config.json` | `~/.gemini/config/mcp_config.json` |
| Ponytail | plugin `ponytail@ponytail` | `plugins` entry | `plugin` entry | ➖ | ➖ |
| i-have-adhd | plugin `i-have-adhd@i-have-adhd` + flag | vendor checkout + loader + flag | vendor checkout + loader + flag | `npx skills add … -a github-copilot -g` | `npx skills add … -a antigravity-cli -g` (partial) |
| Caveman | `npx skills add … -a claude-code -g` | `npx skills add … -a opencode -g` | `npx skills add … -a opencode -g` | `npx skills add … -a github-copilot -g` | `npx skills add … -a antigravity-cli -g` (partial) |
| Compaction | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80` | `compaction.auto` + `compaction.buffer` | `compaction.auto` + `compaction.reserved`, optional DCP | planned | planned |
| Strict privacy | env flags (below) | `share`, `update`, `policies` | `share`, `autoupdate`, `experimental.openTelemetry`, `disabled_providers` | `autoUpdate: false`; telemetry only through the `--disable-client-telemetry` flag | account setting only, printed as a reminder |

## Windows

- `install.ps1` runs on PowerShell 5.1 and 7 and needs no admin rights.
- Tools come from winget (`rtk-ai.rtk`, `astral-sh.uv`). `real-winget` installs both without a TTY: rtk 1.1.0 and uv 0.13.6 on 2026-10-31.
- Without winget, extract `rtk-x86_64-pc-windows-msvc.zip` into `%USERPROFILE%\tools\rtk`; `install.ps1` adds it to the user PATH.
- No directory junctions are needed: the Skills CLI installs into `~/.claude/skills` and `~/.agents/skills`, and OpenCode reads `~/.agents/skills`.
- `rtk init` writes to the OS profile folder, not `USERPROFILE`. It only matters when testing with a temp `USERPROFILE`.
- The runner image has no winget; `real-winget` adds it with `Repair-WinGetPackageManager`.

## Verification log

| Item | Source | Checked |
| --- | --- | --- |
| Context Mode Claude plugin `mksglu/context-mode`, `context-mode@context-mode`; license ELv2 | [README](https://github.com/mksglu/context-mode) | 2026-10-31 |
| Context Mode: plugin and MCP together break OpenCode tool registration | same | 2026-10-31 |
| Ponytail Claude plugin `DietrichGebert/ponytail`, `ponytail@ponytail`; OpenCode 2 uses `plugins`, 1.x uses `plugin` | [INSTALL.md](https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md) | 2026-10-31 |
| i-have-adhd Claude plugin `ayghri/i-have-adhd`, `i-have-adhd@i-have-adhd` | [README](https://github.com/ayghri/i-have-adhd) | 2026-10-31 |
| RTK install (`brew install rtk`, `winget install rtk-ai.rtk`), `rtk init -g`, `--opencode` (OpenCode 1.18.29+), `--copilot`, `--agent antigravity`, `--uninstall` | [README](https://github.com/rtk-ai/rtk), [installation guide](https://github.com/rtk-ai/rtk/blob/master/docs/guide/getting-started/installation.md) | 2026-10-31 |
| Caveman `npx skills add JuliusBrussee/caveman -g` and `skills remove` | [README](https://github.com/juliusbrussee/caveman) | 2026-10-31 |
| OpenCode config: `instructions`, `default_agent`, `agent.<name>.model`, markdown agents in `~/.config/opencode/agents/`, `permission`, `experimental.policies` (OpenCode 2 only) | [config docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/config.mdx), [agents docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/agents.mdx) | 2026-10-31 |
| OpenCode 2 native keys accepted and loaded: `instructions`, `default_agent`, `agents`, `plugins`, `update`, `share`, `policies`, `mcp.servers`, `compaction.buffer`, markdown subagents | `opencode debug config` / `debug agents` on OpenCode 2.2.5 in CI (`tests/real-opencode.sh`) | 2026-10-31 |
| OpenCode 1.x keys: `instructions`, `default_agent`, `agent`, `plugin`, flat `mcp`, `share`, `autoupdate`, `disabled_providers`, `compaction.auto`, `compaction.reserved`, `experimental.openTelemetry` | [1.19.0 schema](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/v1/config/config.ts), `opencode debug config` on 1.19.0 in CI (`tests/real-opencode-v1.sh`) | 2026-10-30 |
| `opencode.ai/install` installs 1.x only and takes `--version`; `opencode debug config` prints one object; subagents are listed by `opencode agent list` (no `debug agents`) | [install script](https://opencode.ai/install), [1.19.0 source](https://github.com/anomalyco/opencode/tree/v1.19.0/packages/opencode/src/cli/cmd) | 2026-10-30 |
| DCP `@tarquinen/opencode-dcp` 3.2.0, peer `@opencode-ai/plugin >=1.18.29`, `~/.config/opencode/dcp.jsonc`, `compress.minContextLimit` / `maxContextLimit`; AGPL-3.0; also installs on OpenCode 2 now; upstream recommends Sleev for new users | [README](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) | 2026-10-30 |
| Context Mode OpenCode route: `"plugin": ["context-mode"]`, Node.js >=22.5 | [README](https://github.com/mksglu/context-mode), npm | 2026-10-30 |
| Ponytail one package serves V1 and V2 plugin APIs; config at `$XDG_CONFIG_HOME/ponytail`, `~/.config/ponytail`, Windows `%APPDATA%\ponytail` | [plugin source](https://github.com/DietrichGebert/ponytail/blob/main/.opencode/plugins/ponytail.mjs), [config source](https://github.com/DietrichGebert/ponytail/blob/main/hooks/ponytail-config.js) | 2026-10-30 |
| i-have-adhd supports OpenCode V1 1.18.29+ and V2 with the same loader | [README](https://github.com/ayghri/i-have-adhd) | 2026-10-30 |
| RTK: core formula `rtk`, winget `rtk-ai.rtk`, zip `rtk-x86_64-pc-windows-msvc.zip` | [installation guide](https://github.com/rtk-ai/rtk/blob/master/docs/guide/getting-started/installation.md), [Homebrew](https://formulae.brew.sh/formula/rtk), [winget-pkgs](https://github.com/microsoft/winget-pkgs/tree/master/manifests/r/rtk-ai/rtk) | 2026-10-30 |
| Skills CLI: `--skill <names>` and `-y` are needed without a TTY; `skills remove` takes skill names; `-a opencode -g` writes `~/.agents/skills`, `-a claude-code -g` writes `~/.claude/skills` | `npx skills --help` and a real run in a throwaway HOME; `real-tools`, `real-windows` in CI | 2026-10-30 |
| OpenCode 1.x and 2.x read global skills from `~/.agents/skills` | [1.x docs](https://opencode.ai/docs/skills), [2.x docs](https://opencode.ai/v2/docs/skills) | 2026-10-30 |
| Claude Code native installer `claude.ai/install.sh`; privacy env names `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | [setup docs](https://code.claude.com/docs/en/setup), [env vars](https://code.claude.com/docs/en/env-vars) | 2026-10-30 |
| `rtk init -g` without a TTY prints a manual step and skips the hook; `--auto-patch` writes it to `settings.json` | `rtk init --help` 1.1.0, `real-claude` in CI | 2026-10-30 |
| `claude mcp add`, `claude mcp list`, `claude plugin marketplace add`, `claude plugin install` and `claude plugin uninstall` work without login | `real-claude` in CI | 2026-10-30 |
| `opencode-ai` on npm provides the 1.19.0 binary | npm, `tests/real-windows.ps1` in CI | 2026-10-30 |
| Copilot CLI 1.0.105: `npm i -g @github/copilot` (Node 22+), `gh.io/copilot-install`, `winget install GitHub.Copilot`; `COPILOT_HOME`; `copilot-instructions.md`, `agents/*.agent.md`, `mcp-config.json`, `hooks/`, `settings.json`; `autoUpdate`; tool aliases `read`, `edit`, `search`, `execute`, `web` | [docs](https://docs.github.com/en/copilot/how-tos/copilot-cli) and real binary, no login | 2026-10-30 |
| `copilot mcp list --json`, `instruction list`, `skill list`, `plugin list` work without login. Piping them to `grep -q` kills copilot with EPIPE; read from a file | real binary | 2026-10-30 |
| Copilot telemetry has no setting, only `--disable-client-telemetry` | real binary (`copilot config --list`, `--help`) | 2026-10-30 |
| Antigravity CLI 1.4.12: binary `agy`, `antigravity.google/cli/install.sh` and `install.ps1`; `~/.gemini/config/{rules,agents,plugins}`, `mcp_config.json`; agent frontmatter `subagent`, `model` (`inherit`, `flash`, `pro`), `tools` | [docs](https://antigravity.google/docs) and real binary, no login | 2026-10-30 |
| `agy agents`, `agy mcp list`, `agy plugin list --json` work without login; `agy models` needs sign-in | real binary | 2026-10-30 |
| `rtk init -g --copilot` and `--agent antigravity` work without a TTY; `--uninstall` removes them. On Copilot it also adds a block to `copilot-instructions.md` | rtk 1.1.0, real binary | 2026-10-30 |
| `rtk init` does not read `COPILOT_HOME`: with that variable set, the RTK hook still lands in `~/.copilot` | rtk 1.1.0, real binary | 2026-10-30 |
| Context Mode plugin routes for both agents install and uninstall without a TTY. Copilot warns that direct plugin installs are deprecated | real binaries | 2026-10-30 |
| Skills CLI ids `github-copilot`, `antigravity-cli`. `skills remove -a <agent>` reports success but keeps `~/.agents/skills` while another detected agent may share it, so the Copilot, Antigravity and OpenCode undo drops `-a`. Side effect: those skills go for every agent on the machine. On 1.7.4 the folder stays with `~/.gemini/antigravity-cli` and `~/.config/opencode`, but not in every folder mix, so `tests/real-skills-undo.sh` uses that pair. `-a claude-code` copies to `~/.claude/skills` and does not write `~/.agents/skills`, so the Claude Code undo keeps `-a` | real binary, `real-skills-undo` in CI | 2026-10-31 |
| Codeburn: npm `codeburn` 0.9.27, repo `getagentseal/codeburn`, MIT, Node 22.13+; `report -p week --format json` | npm, real binary | 2026-10-30 |
| AutoSkills: npm `autoskills` 0.4.1, repo `midudev/autoskills`, CC-BY-NC-4.0. Identity confirmed: npm `gitHead` is the `release: v0.4.1` commit in that repo, and autoskills.sh links it. No `--version`, doctor uses `--help` | npm, GitHub, real binary | 2026-10-30 |
| GSD Core: `@opengsd/gsd-core` 1.19.0, MIT, repo `open-gsd/gsd-core`. `--copilot`, `--antigravity`, `--opencode`, `--claude` with `--global`, `--uninstall`. `model_overrides` is read from `~/.gsd/defaults.json` (`bin/lib/config-loader.cjs`) | npm, package source, real binary | 2026-10-30 |
| Model IDs for `github-copilot`, `openai-api`, `opencode-go` exist | [models.dev](https://models.dev/api.json), `scripts/models-refresh.mjs --check` | 2026-10-30 |
| OpenCode Go training terms: the default models are marked not used for training; Contributor and Free models may train; DeepSeek needs a region setting, so it is not a default | [docs](https://opencode.ai/docs/go) | 2026-10-30 |
| OpenCode 2: `cli.json` replaces `tui.json` (migration code and docs inside the binary); `policies` accepted | real binary 2.1.4, `tests/real-opencode.sh` | 2026-10-30 |
| i-have-adhd ships `disable-model-invocation: true`: a prompt cannot load it, only `/i-have-adhd` or the always-on flag. lean-agents sets it to `false` in the installed copies | plugin 0.4.1 | 2026-10-30 |
| vhs: needs `ttyd` and `ffmpeg`; tape commands `Output`, `Set`, `Hide`, `Show`, `Type`, `Enter`, `Sleep`. `charmbracelet/vhs-action` latest is v2.1.1, input `path`; the tag `v2` is used in `assets.yml` | [vhs README](https://github.com/charmbracelet/vhs), [action](https://github.com/charmbracelet/vhs-action), `assets` job | 2026-10-31 |
| `gh release create` flags `--notes-file`, `--verify-tag` | `gh release create --help` on 2.103.0 | 2026-10-31 |
| Installer with no TTY and no `--yes`: stops with a message, changes nothing; `--dry-run` with every choice as a flag exits 0. With `/dev/tty` and stdin from `/dev/null`, it asks and exits. Windows `CONIN$` is not tested | `tests/engine.test.mjs`, pty run in the `test` job | 2026-10-31 |
| Awesome lists: `hesreallyhim/awesome-claude-code` (web issue form), `awesome-opencode/awesome-opencode` (YAML PR), `punkpeye/awesome-mcp-servers` (MCP servers only). Show HN rules. Social preview 1280x640, under 1 MB. Up to six pinned repos | each project's CONTRIBUTING, [Show HN](https://news.ycombinator.com/showhn.html), GitHub docs; all links in `docs/launch.md` fetched | 2026-10-31 |

## Proxy and corporate CA

lean-agents copies each proxy variable it finds (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`) to the other letter case for the commands it runs, because tools disagree on the case. It reports CA variables but never copies them: each one replaces a tool's whole bundle.

| Item | Proxy | Corporate CA | Source | Checked |
| --- | --- | --- | --- | --- |
| Node.js | `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` (22.21+, 24+) makes `fetch` read `HTTP(S)_PROXY`, `NO_PROXY` | `NODE_EXTRA_CA_CERTS=<file>`; `NODE_USE_SYSTEM_CA=1` (22.19+, 24.6+) | [Node CLI](https://nodejs.org/api/cli.html) | 2026-11-03 |
| npm, npx | `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, or `proxy`, `https-proxy`, `noproxy` (`npm_config_*` env) | `cafile`; keep `strict-ssl` on | [npm config](https://docs.npmjs.com/cli/v10/using-npm/config) | 2026-11-03 |
| git | `http_proxy`, `https_proxy`, `all_proxy` (lowercase); `http.proxy` wins | `http.sslCAInfo`, `GIT_SSL_CAINFO` | [git-config](https://git-scm.com/docs/git-config) | 2026-11-03 |
| uv, uvx (Serena) | `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (uppercase) | `SSL_CERT_FILE`, `SSL_CERT_DIR`, `UV_SYSTEM_CERTS=true` (`UV_NATIVE_TLS` is deprecated) | [uv env vars](https://docs.astral.sh/uv/reference/environment/) | 2026-11-03 |
| Homebrew | `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy` (lowercase, through curl and git) | no variable documented | [brew manpage](https://docs.brew.sh/Manpage) | 2026-11-03 |
| winget | `--proxy <url>`, `--no-proxy` per run; not used by lean-agents | not documented | [winget settings](https://learn.microsoft.com/en-us/windows/package-manager/winget/settings) | 2026-11-03 |
| Claude Code | `https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY` (first set wins), `NO_PROXY`; no SOCKS | `NODE_EXTRA_CA_CERTS`; bundled CAs plus the OS store; mTLS `CLAUDE_CODE_CLIENT_CERT` / `CLAUDE_CODE_CLIENT_KEY` | [network config](https://code.claude.com/docs/en/network-config) | 2026-11-03 |
| OpenCode | standard proxy variables (docs show uppercase); add `localhost` to `NO_PROXY` | `NODE_EXTRA_CA_CERTS` | [network](https://opencode.ai/docs/network/) | 2026-11-03 |
| Copilot CLI | `HTTPS_PROXY` > `https_proxy` > `HTTP_PROXY` > `http_proxy`; restart after a change | `NODE_EXTRA_CA_CERTS` plus the OS store | [network settings](https://docs.github.com/en/copilot/concepts/network-settings) | 2026-11-03 |
| Antigravity CLI | **VERIFY** | `AGY_LLM_GATEWAY_CA_CERT` (enterprise gateway, agy 1.2.15+), falls back to `SSL_CERT_FILE` | [gateway docs](https://docs.cloud.google.com/gemini/enterprise/docs/ai-developer-tools/connect-enterprise-gateway) | 2026-11-03 |
| Playwright MCP | **VERIFY** | browser download: `NODE_EXTRA_CA_CERTS`; mirror with `PLAYWRIGHT_DOWNLOAD_HOST` | [Playwright browsers](https://playwright.dev/docs/browsers) | 2026-11-03 |

## Outbound switches

The network question (`--network`, `--telemetry`, `--auto-update`, `--outbound`) sets these; see [privacy.md](privacy.md).

| Agent or tool | Category | Switch | Source | Checked |
| --- | --- | --- | --- | --- |
| Claude Code | telemetry | env `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DO_NOT_TRACK=1` | [data usage](https://code.claude.com/docs/en/data-usage), [env vars](https://code.claude.com/docs/en/env-vars) | 2026-11-03 |
| Claude Code | auto-update | env `DISABLE_AUTOUPDATER=1` (`claude update` still works) | [env vars](https://code.claude.com/docs/en/env-vars) | 2026-11-03 |
| Claude Code | other | env `DISABLE_BUG_COMMAND=1` (now also `DISABLE_FEEDBACK_COMMAND`); `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off updates, telemetry, error reports, feedback and surveys together, so lean-agents sets it only when all three are off | [env vars](https://code.claude.com/docs/en/env-vars) | 2026-11-03 |
| OpenCode 2 | auto-update | `update: "disable"` | [v2 config](https://opencode.ai/v2/docs/config), real binary 2.2.5 | 2026-11-03 |
| OpenCode 2 | other | `share: "disabled"`; `policies` deny `provider.use` `opencode` | real binary 2.2.5 (`tests/real-opencode.sh`) | 2026-10-31 |
| OpenCode 1 | telemetry, auto-update, other | `experimental.openTelemetry: false`; `autoupdate: false`; `share: "disabled"`, `disabled_providers` | [1.x config](https://opencode.ai/docs/config/), real binary 1.19.0 | 2026-11-03 |
| Copilot CLI | auto-update | `autoUpdate: false` in `~/.copilot/settings.json` | [change settings](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/change-settings) | 2026-11-03 |
| Copilot CLI | telemetry | `COPILOT_OFFLINE=true` disables all telemetry (and more); printed as a reminder only | [responsible use](https://docs.github.com/en/copilot/responsible-use/copilot-cli) | 2026-11-03 |
| gh | telemetry | `GH_TELEMETRY=false`, `DO_NOT_TRACK=true`, or `gh config set telemetry disabled` | [gh telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry) | 2026-11-03 |
| gh | auto-update | `GH_NO_UPDATE_NOTIFIER`, `GH_NO_EXTENSION_UPDATE_NOTIFIER` (any value) | [gh environment](https://cli.github.com/manual/gh_help_environment) | 2026-11-03 |
| Caveman | telemetry | on by default; `DO_NOT_TRACK=1` or `caveman telemetry off` | [SECURITY.md](https://github.com/JuliusBrussee/caveman/blob/main/SECURITY.md) | 2026-11-03 |
| Skills CLI | telemetry | `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | 2026-11-03 |
| RTK | telemetry | off until `rtk telemetry enable` | [README](https://github.com/rtk-ai/rtk) | 2026-11-03 |
| Context Mode | telemetry | none, per README; `ctx-insight` opens a hosted dashboard only when run | [README](https://github.com/mksglu/context-mode) | 2026-11-03 |
| Serena | other | `web_dashboard: False` in Serena's config (default on; dashboard on `localhost:24282`); not set by lean-agents | [config template](https://github.com/oraios/serena/blob/main/src/serena/resources/serena_config.template.yml) | 2026-11-03 |
| Codeburn | other | CLI sends nothing; `CODEBURN_CURSOR_SYNC=0` | [README](https://github.com/getagentseal/codeburn) | 2026-11-03 |
| Homebrew | telemetry, auto-update | `HOMEBREW_NO_ANALYTICS`, `HOMEBREW_NO_AUTO_UPDATE` | [brew manpage](https://docs.brew.sh/Manpage) | 2026-11-03 |
| npm | auto-update | `update-notifier=false` | [npm config](https://docs.npmjs.com/cli/v10/using-npm/config) | 2026-11-03 |
| uv | — | no telemetry or update-check switch documented | [uv env vars](https://docs.astral.sh/uv/reference/environment/) | 2026-11-03 |

## Not yet verified

- `reasoningEffort` as the pass-through option for Gemini on Vertex.
- **VERIFY:** the `model` value format in Copilot `*.agent.md`. Without a login, Copilot cannot show which model it picked.
- **VERIFY:** Antigravity loading `~/.gemini/config/rules` and `~/.agents/skills`. No list command shows them without a login, so README marks both as partial.
- **VERIFY:** subreddit rules, whether r/opencode exists, and X handles in `docs/launch.md`. Reddit blocked the fetch.
- **VERIFY:** `brew install copilot-cli` (README) against `brew install --cask copilot-cli` (docs). lean-agents does not use either.
- **VERIFY:** Antigravity proxy variables (no docs; `tests/real-proxy.sh` runs `agy plugin install` through squid with direct traffic blocked) and any telemetry or auto-update switch (none documented; the CLI updates itself in the background, per [antigravity.google/cli](https://antigravity.google/cli), checked 2026-11-03).
- **VERIFY:** gh has no documented proxy or CA variable ([gh environment](https://cli.github.com/manual/gh_help_environment), 2026-11-03); `tests/real-proxy.sh` checks that it uses `https_proxy` and that `SSL_CERT_FILE` replaces its trust store.
- **VERIFY:** proxy and CA handling in RTK, Context Mode, Serena, Playwright MCP and the Skills CLI beyond the variables their runtimes (Node, uv, git) read.
- **VERIFY:** Copilot CLI `NO_PROXY` and `--disable-client-telemetry` (seen in release notes, not in the docs).
- **VERIFY:** Serena config path `~/.serena/serena_config.yml` and a usage-stats switch; GSD and Ponytail outbound calls.
- **VERIFY:** pip `PIP_PROXY`, `PIP_CERT`; winget persistent proxy settings and CA handling.
