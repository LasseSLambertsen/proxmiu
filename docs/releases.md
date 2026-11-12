# Releases and changelogs

[CHANGELOG.md](../CHANGELOG.md) is the source of user-facing GitHub release notes. Keep entries factual: features, fixes, upgrade requirements and verification limits. Link PRs inline. Use `###` headings inside a version section, and keep version-link definitions at the end.

To prepare a release:

1. Update `package.json` and the lockfile to the intended version, for example with `npm version --no-git-tag-version 0.2.0`.
2. Move the relevant Unreleased entries into exactly one `## [0.2.0] - YYYY-MM-DD` section. Include explicit permission/helper changes and remaining real-infrastructure validation; do not include unmerged work.
3. Merge the reviewed PR after CI passes.
4. Tag the merged main commit and push that tag. For example, after updating your local main, run `git tag v0.2.0` and `git push origin v0.2.0`. Treat version tags as immutable.

The release workflow reruns the existing Ubuntu/Windows checks on the tag, requires its commit to be on main, rechecks that the remote tag still points to that commit, validates that tag/package/changelog agree, then publishes the matching changelog section. Zero-major versions and SemVer prereleases are marked as preview releases. If that tag already has a release, only its notes are updated; assets, title and publication flags remain unchanged.

To inspect a concrete release body locally without publishing:

```bash
node scripts/release-notes.mjs --tag v0.1.0 --output /tmp/proxmiu-release-notes.md
```

The helper fails for a mismatched version or missing, duplicate, empty or malformed section. It never substitutes unrelated or Unreleased changes. Release jobs have narrowly scoped repository-write access; pull-request CI remains read-only. The process does not update agents, change infrastructure or deploy the website.
