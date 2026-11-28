# e2e-update replay fixtures

Redacted copies of the `e2e-update` artifact from the 1.3.0 proof runs (runs 4 to 9, issue #586). Each folder
keeps only the files `tests/e2e-update.mjs evaluate` reads: both transcripts, the doctor JSON, the install
record version, the plugin list and the shim log. Keys were replaced with `sk-or-REDACTED` and absolute home
paths with `/tmp/x`. `tests/e2e-replay.test.mjs` replays them through the current evaluator.

## Adding a run

1. Download the `e2e-update` workflow artifact from the run you want (it already holds redacted files, so do not
   re-download raw logs). Its names match the `runN/` files below.
2. If you start from raw files instead, redact each one first:
   `node tests/e2e-update.mjs redact --in <raw file> --out <redacted file>`. It replaces the key with `sk-or-REDACTED`.
   Also replace absolute home paths with `/tmp/x`, then check the folder for secrets and private paths.
3. Create `tests/fixtures/e2e/runN/` with exactly these files: `transcript.jsonl`, `transcript-first.jsonl`,
   `doctor.json`, `record.json`, `plugin-list.json` and `shim.log`.
4. Add an entry to the `RUNS` list in `tests/e2e-replay.test.mjs` with the `pluginRef`, the `yesTurns` and the
   expected `failures` (an empty list means the run is ok).
5. Run `npm test`. The new run must match the expected outcome before you commit.
