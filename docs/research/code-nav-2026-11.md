# codebase-memory-mcp vs Serena (#130)

**Recommendation: keep Serena.** codebase-memory-mcp answers more questions correctly, but it fails two of the four gate items (tokens on the medium repo, clean undo). No swap PR.

Run: [`bench-code-nav` run 43298340741](https://github.com/estebanmr99/lean-agents/actions/runs/43298340741), green on ubuntu-latest, macos-latest (arm64) and windows-latest (Git Bash; PowerShell launch also green). Date: 2026-11-12. GitHub cannot dispatch a workflow file that is not on `main` yet, so this run was started by a push to the session branch (a temporary trigger, in commit `8883db5` and removed in the next commit; the workflow body and `tests/bench-code-nav.mjs` are otherwise identical); after the merge the workflow is dispatch-only. Script: `tests/bench-code-nav.mjs`. Workflow: `.github/workflows/bench-code-nav.yml` (manual only).

## What was measured, and its limit

CI has no model login, so **tokens used by an agent were not measured**. The bench starts each server over MCP stdio in a throwaway HOME and calls its tools directly:

- Tokens = bytes of the tool result / 4. "Fixed tokens" = the tool schemas (`tools/list`) plus the instructions the agent must read once per session (Serena's `initial_instructions`).
- Quality = how many of the known right answers (symbol names, file stems) appear in the result. Ground truth for rename impact comes from `git grep -lw` at the pinned commit.
- Medium repo: this repo at `e96c67b7` (JavaScript). Large repo: Django `5.2.9` (`c14b7561`, Python, shallow clone).
- Five tasks per repo, one call each: find symbol, find callers, rename impact, explain module, locate config. A real agent may need several calls per task; this does not model that.
- Serena runs as `core/mcp.json` launches it (pinned git spec, `--project-from-cwd`), in both agent interfaces: `repl` (the Serena 2 default, what lean-agents installs today: 3 tools) and `tools` (classic, 29 tools). Its dashboard, browser tab and GUI log window are switched off.
- codebase-memory-mcp 0.12.1 runs as the bare binary (`codebase-memory-mcp`, no subcommand), indexing with defaults.

## Results (Linux; macOS and Windows differ by timing only, tokens within about 5%)

| | Server | Fixed tokens | Task tokens (5 calls) | Total | Answers found | Index / start | On disk |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Medium | codebase-memory-mcp | 5281 | 1777 | 7058 | 17/18 | 1.2 s | 9.8 MB |
| Medium | Serena (repl) | 3317 | 676 | 3993 | 9/18 | 8.2 s | 3.3 MB |
| Medium | Serena (tools) | 11335 | 676 | 12011 | 9/18 | 1.7 s | 3.3 MB |
| Large | codebase-memory-mcp | 5281 | 4109 | 9390 | 33/33 | 22.2 s | 263.6 MB |
| Large | Serena (repl) | 3315 | 10165 | 13480 | 32/33 | 3.1 s | 80.2 MB |
| Large | Serena (tools) | 11334 | 10165 | 21499 | 32/33 | 2.6 s | 80.2 MB |

Index / start: codebase-memory-mcp builds a graph before the first answer. Serena has no index; its "start" is the server up plus one file overview (`get_symbols_overview`), which starts the language server for that file. The first project-wide `find_symbol` that follows is slower (1.1 s on medium, 11.4 s on large), and that cost is in the per-task times, not in "start". On macOS the large index took 34 s, on Windows 38 s. Serena's on-disk figure is `<repo>/.serena` only.

Per task, large repo (tokens): find symbol 160 vs 74, callers 781 vs 2190, rename impact 2515 vs 7726, explain module 240 vs 38, locate config 413 vs 137 (codebase-memory-mcp vs Serena). Per-OS tables are in the run's artifacts (`bench-code-nav-<os>`).

Things the numbers show:

- Serena answers each call with a smaller, exact result, so it wins on the medium repo. codebase-memory-mcp is cheaper on the large repo, where Serena's reference lists are long (rename impact: 7.7k vs 2.5k tokens).
- Serena missed 8 of 9 rename-impact files and the test caller on the JavaScript repo: with no `tsconfig.json` or `jsconfig.json`, its TypeScript language server resolves references only inside one file. A `jsconfig.json` may fix that; it was not tried, so this result is for the repo as it is.
- codebase-memory-mcp also missed the test-file caller (`engine.test`) even with `include_tests`.
- The classic Serena interface costs 11.3k tokens of schemas per session; the REPL interface costs 3.3k. Both return identical results.

## Setup per OS (all verified in the run, binary only)

| Step | Linux | macOS | Windows |
| --- | --- | --- | --- |
| codebase-memory-mcp | `codebase-memory-mcp-linux-amd64.tar.gz` | `codebase-memory-mcp-darwin-arm64.tar.gz` | `codebase-memory-mcp-windows-amd64.zip` |
| Source | `https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/<asset>`, SHA256 from `checksums.txt` of that release, pinned in `tests/ci-downloads.json` and checked by `scripts/ci-download.sh` | same | same; unzip with `Expand-Archive` |
| Launch | `codebase-memory-mcp` (stdio, no arguments) | same | `codebase-memory-mcp.exe`, from Git Bash and from PowerShell |
| Serena | `uvx -p 3.13 --from git+https://github.com/oraios/serena@<pinned sha> serena start-mcp-server --project-from-cwd` with `uv` 0.13.5 (`pip install uv==0.13.5` in a venv) | same | same |
| Index location | `$CBM_CACHE_DIR`, default `~/.cache/codebase-memory-mcp` | same | `%CBM_CACHE_DIR%`; the daemon also writes lock files under `%LOCALAPPDATA%\cbm-daemon-*` |

Not verified: a Scoop manifest (the README names Scoop but gives no bucket), the npm wrapper's download path, and macOS Intel (`darwin-amd64`). Open upstream issues that mention Windows at the time of the run (search "windows", 164 open): #2964, #2955, #2945, #2941, #2933, #2920, #2908 (large CSV auto-indexing exhausts memory).

## Gate from the issue

| # | Gate item | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Fewer tokens or fewer premium requests than Serena on both repos | **Fail** | Against the Serena that lean-agents installs (repl), codebase-memory-mcp uses more on medium (7058 vs 3993) and fewer on large (9390 vs 13480). Against the classic interface it is fewer on both. Premium requests could not be measured: no model login in CI. |
| 2 | Equal or better answer quality | **Pass** | 17/18 vs 9/18 (medium) and 33/33 vs 32/33 (large). Proxy only: substring match on expected names. The medium gap is partly Serena's missing `jsconfig.json`. |
| 3 | Real-binary CI job passes on Windows, macOS and Linux | **Pass** | Run 43298340741: all three green. |
| 4 | Clean undo, no hooks installed without the user's opt-in | **Fail** | Upstream `install -y` (default) writes Claude Code hooks (`PreToolUse`, `SessionStart`, `SubagentStart`), three agents, a skill, an OpenCode plugin, `AGENTS.md` text and a `PATH` line in the shell profile. After `uninstall -y --delete-indexes` these stayed: the shell `PATH` line, `opencode.json`, `AGENTS.md`, `plugins/cbm-augment.ts`, `_config.db` and logs (8 files on Linux and macOS, 20 on Windows with daemon lock files and a `.cbm-backup-*` file). Used binary-only (what lean-agents would do), the launch writes only its cache directory, but `uninstall` still leaves `_config.db` and logs (4 files; 17 on Windows). A lean-agents uninstall would have to delete the cache directory itself. |

Gate rule: all must pass. Two fail.

## What would change the answer

Re-run after: Serena gets a `jsconfig.json` in the medium repo (quality gap), upstream `uninstall` removes its leftovers, or `--no-hooks`-style defaults make `install` opt-in. Item 1 would still need a real agent run (tokens and premium requests), which CI cannot do.

## Sources

- codebase-memory-mcp 0.12.1 release (published 2026-10-16), assets, `checksums.txt`, tool list, cache location, `install`/`uninstall` flags, MIT licence: https://github.com/DeusData/codebase-memory-mcp (README, `install.sh`) and https://api.github.com/repos/DeusData/codebase-memory-mcp/releases/latest, checked 2026-11-12. Behaviour of `install` and `uninstall` is from the CI run above, not from the README.
- Serena 2.1.0 launch, `--agent-interface`, `--enable-web-dashboard`, `--open-web-dashboard`: `serena start-mcp-server --help` on the pinned commit, 2026-11-12.
