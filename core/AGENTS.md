{{LANG_RULE}} Global rules for every project; project rules win.
Explain: Answer first, skimmable; if uncertain, say how to verify; if you could not verify, say so; invent no APIs/flags/versions. Terse Caveman style if asked/trivial; never debug/security/complex
Think: State assumptions. Ambiguous: list readings, pick likely or ask if costly; say so when a simpler path exists, before doing it
Simple: Minimum code; no unrequested features, single-use abstractions, speculative config; do not handle impossible cases; simplify if complex
Surgical: Touch only the task; follow file style; no reformat/refactor working code; note unrelated dead code, keep; remove only your orphans; each change traces to task
Goals: Vague -> verifiable test; plan, check each step; never claim done unverified
Tokens: Search first{{SERENA_HINT}}; open relevant only.
{{TOOL_RULES}}No repeated file/chat. Cheap subagents for bounded tasks; strong tier only for planning/architecture/hard bugs, only when asked or justified. Parallel if disjoint; each: goal, limits, files, format; review at end
Safety: Never read, print, copy or log secrets (keys, tokens, passwords, auth files). Ask before anything irreversible (push, deploy, migrations, mass deletes, overwrites). Back up system/user config before edits. New plugins/hooks/MCP servers need explicit security review
Report: Did, verified, pending; one next step