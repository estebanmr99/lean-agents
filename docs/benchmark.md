# Savings Benchmark

The savings benchmark measures the token efficiency and wall-clock speed of using lean-agents compared to running the same agent and model in a bare environment.

### No published numbers yet

We do not publish savings claims without proof (as per [launch rules](./launch.md)). The numbers will be published here once the benchmark is run.

### How to run it

> **Warning: Costs inference budget.**
> Running this benchmark executes real LLM queries against your provider. The benchmark currently consists of 3 tasks, run twice (baseline and lean), for a total of 6 LLM calls.

To run the benchmark:

```bash
node tests/bench-savings.mjs --home "$(mktemp -d)" --run --model <provider/model#variant>
```
*Example: `--model google-vertex/gemini-3.1-pro-preview`*

You can also run it in dry-run mode (without `--run`) to see the plan without executing any LLM calls:
```bash
node tests/bench-savings.mjs --home "$(mktemp -d)" --model <provider/model#variant>
```

### How to read the results

The script writes a `results.md` (and `results.json`) file to `--out` (by default `bench-out` inside the throwaway home).

- **Task**: The benchmark task being run.
- **Mode**: `baseline` (bare agent) vs `lean` (lean-agents installed).
- **Pass**: Whether the final result matches the deterministic success condition.
- **In Tokens / Out Tokens**: The raw token usage reported by the agent.
- **Time**: Wall-clock execution time in milliseconds.

A successful savings outcome is when `lean` mode uses significantly fewer tokens (or completes faster) while still passing the task.
