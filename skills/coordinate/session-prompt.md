# Session prompt template

Copy to `<coord-dir>/session-<n>.md`, fill the `<…>` parts, delete what does not apply. The worker gets this file as its first prompt, in plan mode. `<coord-dir>` is a folder outside the work tree (for example `.git/lean-coord/`), so nothing here is committed.

---

Read `AGENTS.md` (or `CLAUDE.md`) first, then the part of the project spec for this session. Work only on this session.

Session: **#<n> — <title>**. Branch `session-<n>-<short-name>`. Read `gh issue view <n> --json body,comments`.

Goal: <one or two sentences: what is true when this is done>.

Steps (one check each):
1. <step> -> <command that shows it works>
2. <step> -> <check>
3. Docs: changelog, README, any table that lists the feature -> <check>

Not in scope: <files or topics the worker must not touch; the other worker's files>.

Done when: <a check a machine can run, ideally a CI job with real binaries>.

Rules:
- Plan first: write the plan to `<coord-dir>/plan-<n>.md` (at most 30 lines), then stop and wait for approval.
- Use cheap subagents for searching and upstream research.
- Fix CI in a local sandbox first (temp HOME and tool prefix), then push once per fix.
- `bash -n` every changed shell block in workflows.
- Commit on the session branch. PR body: one `Closes #<issue>` per line.
- Ask before anything irreversible (push, deploy, migration, delete) unless this prompt says you may.
- End each turn with a 5-line status, one line each: `done: …`, `verified: …`, `blocked: …`, `next: …`, `PR: …`.
