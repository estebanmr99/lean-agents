# Install JSON summary

`lean-agents --yes --json` (a real apply, also with `--everything`) prints exactly one JSON object on stdout when it finishes. Messages, progress and the output of the commands it runs go to stderr. Exit code is 1 when `ok` is false. Used by agents and by the finish page (#181).

```json
{ "ok": true, "files": [".claude/CLAUDE.md"], "commands": [{ "desc": "Install rtk", "ok": true, "exit": 0 }], "errors": [], "version": "0.9.0" }
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ok` | boolean | `true` when `errors` is empty |
| `files` | string[] | Paths written, relative to the home (a path outside the home, such as `--project`, stays as given) |
| `commands` | object[] | Commands that ran: `desc` (text, home shown as `~`), `ok`, `exit` (exit code of the last step, `null` if none) |
| `errors` | string[] | Failed steps (the `desc` of a failed command, or the error message when writing files failed) |
| `version` | string | lean-agents version |

Never included: env values, proxy values, secrets, command arguments. Field names are stable; new fields may be added at the end. With `--no-exec`, `commands` is empty. Without `--yes`, `--json` is refused (the menus would write to stdout).
