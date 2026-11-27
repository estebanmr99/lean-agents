# e2e-update replay fixtures

Redacted copies of the `e2e-update` artifact from the 1.3.0 proof runs (runs 4 to 9, issue #586). Each folder
keeps only the files `tests/e2e-update.mjs evaluate` reads: both transcripts, the doctor JSON, the install
record version, the plugin list and the shim log. Keys were replaced with `sk-or-REDACTED` and absolute home
paths with `/tmp/x`. `tests/e2e-replay.test.mjs` replays them through the current evaluator.