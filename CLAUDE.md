@AGENTS.md

## Claude Code notes

- Start each session in plan mode: read `docs/SPEC.md` sections 0, 2 and the next session in 14, then propose a short plan with one check per step before editing.
- Use the `explore` subagent for codebase searches and `research` for upstream docs; run `review` on the diff before the final report.
- Long CI or test output: summarize it, do not paste it whole.
