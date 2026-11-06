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

## Require review from Code Owners (owner action)

`.github/CODEOWNERS` names `@estebanmr99` for every path. Nothing enforces it until you turn it on. This repo does not change the setting; you do it.

1. Open the repo's **Settings > Rules > Rulesets** (or **Branches > Branch protection rule** for `main`). (VERIFY the menu names against the current GitHub UI.)
2. Tick **Require a pull request before merging**, then **Require review from Code Owners**.
3. Save. Do not tick **Do not allow bypassing** unless you have a second reviewer.

The same switch in the API is `required_pull_request_reviews.require_code_owner_reviews`. The JSON above sets `required_pull_request_reviews` to `null`. For the API route, replace it with `"required_pull_request_reviews": {"require_code_owner_reviews": true}`.

Caveat: GitHub does not let a PR author approve their own PR. With one owner, a code-owner review blocks every PR unless you add a second reviewer or allow admin bypass. Decide that before you turn it on.

To check the file: `gh api repos/estebanmr99/lean-agents/codeowners/errors` should return an empty list.
