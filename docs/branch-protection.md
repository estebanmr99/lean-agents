# Protect `main` with required checks

CI never changes repository settings. The maintainer runs this once (needs admin rights on the repo):

```bash
gh api -X PUT repos/estebanmr99/lean-agents/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "checks": [
      { "context": "lint" },
      { "context": "scan" },
      { "context": "test (ubuntu-latest, 22)" },
      { "context": "test (windows-latest, 22)" },
      { "context": "real-claude" },
      { "context": "real-opencode" },
      { "context": "real-windows" },
      { "context": "release-build" }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

- `scan` is the job of the **Secret scan** workflow (GitHub names a check after its job).
- On a docs-only PR the `real-*` jobs and `release-build` are skipped (see `changes` in `.github/workflows/ci.yml`). GitHub counts a skipped job as passing for a required check, so docs PRs still merge.
- This is the **required-check list from issue #42**. Add a check here only after the job has been stable for a week.
- Undo: `gh api -X DELETE repos/estebanmr99/lean-agents/branches/main/protection`.
- `tests/ci-latest.test.mjs` fails if a name above stops matching a job.
