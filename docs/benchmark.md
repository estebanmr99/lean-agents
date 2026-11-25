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
