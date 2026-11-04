# Parallel agent sessions

`scripts/parallel.mjs` runs one worker agent per task, each in its own git worktree, and merges them one at a time. The coordinator playbook is the `parallel-sessions` skill.

## Task file

`<task>.md` (lowercase letters, digits, dashes) with optional front matter:

```markdown
---
role: build            # plan | build | explore | research
tier: cheap            # optional: cheap | balanced | strong, beats the role default
agent: claude          # optional: orca | claude | opencode | print | custom
check: npm test        # optional: argv run in the worktree before its merge
---
Goal, files you may touch, checks to run, do not push.
```

The helper appends the reporting rule (a status file with `running`, `blocked: <question>` or `done`). The agent only gets `Read <path> and follow it.` as its prompt.

## Commands

Run inside the repository (or pass `--repo <dir>`).

| Command | What it does |
| --- | --- |
| `start <task.md>…` | Creates `lean/<task>` and a worktree in `<repo>.lean/<task>`, writes the prompt, starts the agent |
| `status` | State of each worker and the last lines of its log (never the whole transcript) |
| `merge <task> --yes` | Merges one `done` worker, in start order, after its `check`; rebases the others. Without `--yes` it only says what it would do |
| `clean` | Removes merged worktrees and branches. Never forces; unmerged workers stay |

## Model tier per worker

| Tier | Profile tier | Default for role | Claude Code |
| --- | --- | --- | --- |
| `strong` | `strong` | `plan` | `opus` |
| `balanced` | `balanced` | `build` | `sonnet` |
| `cheap` | `fast` | `explore`, `research` | `haiku` |

`--tier` overrides one run, `--profile <name>` picks another profile (default `claude-subscription`; OpenCode needs one, for example `opencode-go`). Claude gets `--model <alias>`, OpenCode `-m <provider/model>`, Orca `--model <id>`.

## Agents

- **Orca** (when `orca agent-context --json` answers): `orca worktree create`; the helper renames Orca's branch to `lean/<task>`. VERIFY: unproven in CI.
- **Claude Code**: `claude --bg -n <task> --permission-mode plan --model <alias>`.
- **OpenCode**: `opencode run --title <task> --agent plan -m <model> -f <file>`, started with the worktree as working directory.
- **Anything else, or no binary**: the helper prints the command to paste into a new terminal. Copilot CLI and Antigravity stay print-only (VERIFY).

Workers start in plan mode (Claude Code `--permission-mode plan`, OpenCode `--agent plan`): approve a worker's plan in its session before it edits and commits.

Prompt, status and log files live in `<git dir>/lean-agents/<task>/`, so they are never committed. `clean` removes them; `--doctor` lists workers left in the current repo. Facts and sources: `docs/compatibility.md`.
