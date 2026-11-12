# Multi-agent workflow: coordinator and workers

A method for building one repository with several coding agents at once, with you (or one agent) as coordinator. It is opt-in: the `coordinate` skill loads it for the agent. For the automated variant (one command starts and merges workers) see [parallel-sessions](parallel-sessions.md).

## Roles

- **Coordinator**: plans sessions, writes the session prompts, launches workers, reviews their plans, checks CI, merges, cleans up. Writes no feature code. Reads status lines and short output tails, never whole transcripts.
- **Worker**: one agent in one git worktree on one branch, doing one session. Plans first, then builds, tests and opens a PR.
- **Cheap subagents**: a worker's helpers for searching code and reading upstream docs (tier `cheap`). They only read.

## Session prompt and plan-first flow

1. Write `session-<n>.md` from [`skills/coordinate/session-prompt.md`](../skills/coordinate/session-prompt.md): goal, issues, branch name, steps with one check each, "done when" with a machine check.
2. Start the worker in plan mode with that file as its prompt. It writes `plan-<n>.md` (at most 30 lines) to the coordination folder and stops.
3. Review the plan: it keeps the project's rules, each step has a check, nothing is out of scope. Answer in one or two lines. Only then let it build.
4. The worker ends each turn with five lines: done / verified / blocked / next / PR.

Keep the coordination folder outside the work tree (for example `.git/lean-coord/`) so prompts and plans are never committed.

## Choosing the model

Pick the tier by the work, not by the session's size. Tiers, not model IDs: map them with your [profile](../README.md).

| Tier | Use for |
| --- | --- |
| `cheap` | docs only, version bumps, one-file fixes, every search and research subagent |
| `balanced` (default) | normal features, CI work, and planning for them |
| `strong` | planning only, for a session that designs a new data flow or changes user files in a new way; build on `balanced` after the plan is approved |

## Running workers

- At most **two** workers at a time. Never two that edit the same files: compare their plans, and run those one after the other.
- One worktree per worker (plain git):
  ```bash
  git worktree add ../myrepo-s12 -b session-12-short main
  cd ../myrepo-s12 && claude --permission-mode plan "$(cat .git/lean-coord/session-12.md)"   # or your agent's command
  ```
  With Orca: `orca worktree create` and `orca terminal create --command '<agent command>'` do the same two steps; any terminal that can print its screen works with the watcher.
- Watch with [`skills/coordinate/coord-watch.sh`](../skills/coordinate/coord-watch.sh) in the background. It exits with the reason: plan written, new PR URL, question or menu, usage limit, error, or turn ended. `--file <transcript>` reads a log file; `--read '<command>'` runs your terminal's read command. Do not poll by hand.

## CI and merging

- Fix a failing CI job in a local sandbox first: a temp HOME and tool prefix (`T=$(mktemp -d); HOME=$T/home NPM_CONFIG_PREFIX=$T/npm PATH=$T/npm/bin:$PATH`). Reproduce, fix, push once. Pushing to see what happens burns CI minutes and your time.
- When a job fails, send the worker the exact cause and the smallest fix; summarize long logs instead of pasting them.
- PR body: one `Closes #n` per line, so each issue closes on merge.
- Merge **one PR at a time**, after CI is green on the head commit. Then close any issue that did not auto-close, remove that worker's worktree (`git worktree remove <path>`; with Orca also close its terminal), and tell the other worker to rebase.
- At the end, list worktrees and terminals before and after, and remove only what you created.

## Limits and sleep

On a usage limit or a sleep error the worker stops silently. Wait for the reset, then send: "continue from where you stopped (check git status first)". The watcher reports `limit` or `error` so you know.

## When to stop and ask the owner

Ask before: a new dependency, a write outside the files the project allows, anything irreversible (push, deploy, migration, bulk delete) that the session prompt did not allow, and tags or releases. If a worker fails the same step three times, stop it, name the assumption that may be wrong, and replan instead of retrying.
