# Savings Benchmark

The savings benchmark measures the token efficiency and wall-clock speed of using lean-agents compared to running the same agent and model in a bare environment.

### No published numbers yet

We do not publish savings claims without proof (as per [launch rules](launch.md)). The numbers will be published here once the benchmark is run.

### Tasks

The benchmark consists of several tasks designed to test various agent capabilities:

1. **Task 1-3 (Tiny)**: Simple single-file edits or deletions. These show the overhead of rules and tools when there is nothing to save.
2. **Task 4 (Search)**: Find a specific error code in a 3,000-line file.
3. **Task 5 (Fix)**: Fix a single failing test in a small project.
4. **Task 6 (Large Fix)**: Fix a failing test among 60 tests in a 400-line output.
5. **Task 7 (Refactor)**: Rename a configuration key across 30 files where only 3 files actually use it. Tests the agent's ability to prune searches and edits.
6. **Task 8 (Log Analysis)**: Identify the function and line number from a 5,000-line log file containing one stack trace.
7. **Tasks 9-11 (Long)**: Multi-step workflows requiring many turns (multi-file bug hunt, adding a cross-file feature, large-file refactoring). These measure whether lean's tools pay off over extended reasoning sessions. Run these alone using the `--long` flag.
   - **Task 9 (Bug Hunt)**: ~40 generated modules in an import chain, 3 bugs at different depths, ~3,600 lines across files.
   - **Task 10 (Feature)**: A CLI tool with ~15 helpers and documentation, ~1,500 lines total.
   - **Task 11 (Refactoring)**: Extract a duplicated logic block from a legacy script of ~600 lines.
8. **Task 12 (Splittable)**: Four independent features in four different files, each with its own test file, plus three seeded bugs in those files that the task's own tests do not catch. The multi-agent benchmark splits the four features across workers and records how many hidden bugs each arm fixed. `--task task9` still selects the old task.

### What "stable" means

A task result is marked as **stable** (★) in reports when:
1. Both modes (`baseline` and `lean`) have the same pass rate across all repeats.
2. The interquartile ranges (IQR, p25 to p75) of input tokens for both modes do not overlap.

This ensures the observed savings are statistically significant and not just a lucky run.

### How to run it

> **Warning: Costs inference budget.**
> Running this benchmark executes real LLM queries against your provider. The benchmark runs each task multiple times (default 10) in both modes.

To run the benchmark:

```bash
node tests/bench-savings.mjs --home "$(mktemp -d)" --run --model <provider/model#variant>
```
*Example: `--model google-vertex/gemini-3-flash-preview`*

Add `--prices in,cacheRead,cacheWrite,out` (USD per million tokens, from the provider's price page) to get a cache-aware "Priced Cost" and a median turn count per task in the results.

### Cost, artifacts and the bench key

- Each run's cost comes from OpenCode's own `--format json` step usage (`cost` per step), not from the key's spend. The key spend delta is read only as part of the `--max-usd` budget guard, together with the summed session cost so far (the larger of the two stops the run); OpenRouter updates the key spend late, so it alone is not a reliable per-run cost.
- The workflows install the pinned OpenCode 2 build with `scripts/ci-install-opencode-v2.sh` (SHA256-checked; the OpenCode version comes from `core/pins.json`, key `opencode-v2`).
- Artifacts hold the parsed results (`results.json`, `results.md`, `chart.svg`) and a redacted summary. `chart.svg` is written only when both `baseline` and `lean` variants run; the multi-agent benchmark writes `results.json` and `results.md`. Raw model stdout is not uploaded; a failing case records its check name and the last error line, redacted and capped at 200 characters.
- The `OPENROUTER_API_KEY` repository secret used by these workflows must be a dedicated key with a provider-side credit limit. That limit is an owner step in the provider dashboard, not something the harness can set.

### Results and Artifacts

The benchmark produces several files in the `--out` directory:

- **results.json**: The full machine-readable dataset, including the model, OpenCode version, git commit, and run URL.
- **chart.svg**: A visual comparison of median input tokens and IQRs.
- **results.md**: A skimmable table of results.

In GitHub Actions, these are available in the `bench-savings-results` artifact.

### How to read the results table

- **Task**: The benchmark task being run.
- **Mode**: `baseline` (bare agent) vs `lean` (lean-agents installed).
- **Pass Rate**: Percentage of runs that met the success condition.
- **Median In**: The middle value of input tokens used.
- **IQR In**: The range from the 25th to 75th percentile of input tokens.
- **Median Time**: Wall-clock execution time in milliseconds.

### Multi-agent benchmark

The multi-agent harness (`tests/bench-multiagent.mjs`) compares one solo session with `workers-1`, `workers-2` and `workers-4`. The coordinator is the harness itself: it splits the task's independent parts across workers, merges their edits, then runs one reviewer. It writes `results.json` and `results.md`.

```bash
node tests/bench-multiagent.mjs --home "$(mktemp -d)" --run --model <provider/model#variant>
```

Its table has these columns:

- **Mode**: `solo` (one session) or `workers-N` (N workers plus a reviewer; an empty worker is not started).
- **Pass Rate**: Percentage of runs where the merged tree passed the task check.
- **Seeded Bugs**: Bugs fixed out of the seeded total, as a median per run. `(+N review)` counts the bugs only the reviewer fixed. `n/a` means the task has no hidden bug checks. Solo has no reviewer, so bugs caught by review are not comparable between arms; compare the bugs left in the final tree instead.
- **Median In**, **Median Out**: Median input and output tokens summed across all sessions in a run.
- **Median Turns**: Median `step-finish` events summed across all sessions in a run.
- **Median Time**: Wall-clock time, worker phase plus reviewer.
- **Cost**: Priced cost per session from OpenCode's own step usage, summed across the run. `n/a` when a session reported no cost.
- **Priced Cost**: Only with `--prices`; same token pricing model as the savings benchmark.

The workflow adds a provider smoke test (one request, `max_tokens: 1`) before the run. `--task` defaults to `task12`; `--task task9` keeps the old three-bug task.
