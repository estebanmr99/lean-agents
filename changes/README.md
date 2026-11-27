# Changelog fragments

Each PR adds one fragment `changes/<issue>.md` instead of editing `CHANGELOG.md`, so parallel PRs do not conflict.

Format: one or more Markdown bullets, each under a section heading. Allowed sections, in the order a release lists them: `### Added`, `### Changed`, `### Docs`, `### Fixed`, `### Security`. Keep the bullets in the style of `CHANGELOG.md`: one line, ending with `(#<issue>)`.

Example (`changes/123.md`):

```markdown
### Added
- `--example` prints one row per finding (#123)

### Fixed
- A missing config file no longer stops `--doctor` (#123)
```

A release runs `node scripts/changelog.mjs <version>`: it folds every fragment into `## [<version>] - <UTC date>` below `## [Unreleased]`, deletes the fragments and leaves `README.md` in place. Running it again is a no-op; with no fragments and no section for that version it stops with an error.