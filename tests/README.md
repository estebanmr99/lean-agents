# Tests

Engine tests run with `npm test` (`node --test tests/*.test.mjs`). They use a temp HOME and run no external commands.

Scripts named `tests/real-*.sh` and `tests/real-*.ps1` run real tools in a throwaway HOME. CI runs them; most are safe locally when the tool is on PATH. The full list with prerequisites is in the Commands table of [AGENTS.md](../AGENTS.md).
