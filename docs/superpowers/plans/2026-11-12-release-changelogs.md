# Release Changelogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Proxmiu GitHub releases a versioned, human-readable changelog, starting with the existing package version 0.1.0 as a preview.

**Architecture:** CHANGELOG.md is the source of release notes. A dependency-free extractor validates the tag/package/dated section and writes the body. A version-tag workflow reuses CI, checks reviewed main ancestry, then creates or updates only that tag's release notes; preview versions stay prereleases. The user requested changelogs in releases, and no GitHub releases or tags currently exist.

**Tech Stack:** Markdown, Node22 built-ins, node:test, GitHub Actions reusable CI, authenticated GitHub CLI.

## Global constraints

- Include shipped main features only; unmerged disk-growth work stays out of the first release.
- Tag must be valid SemVer prefixed v and match package.json exactly; one nonempty dated changelog section is required.
- Release publication follows both CI platforms and a main-ancestry check; no workflow secrets exposed to PR jobs.
- Existing release metadata/assets stay intact when updating its notes; no manual infrastructure/deployment changes.
- State fixture/live-validation limits, permissions and helper upgrade requirements accurately; no production-ready claim.

## Review focus

- A missing/duplicate/empty version section must fail without publishing unrelated or unreleased text.
- Native GitHub tag values must never enter unquoted shell interpolation.
- First 0.x and SemVer prereleases must remain marked preview.
- Editing notes must not discard existing release assets or change publication flags.
- The release points to reviewed main code and excludes unfinished hardware work.

### Task1: Extractor and versioned content

Files: create CHANGELOG.md, scripts/release-notes.mjs, server/test/release-notes.test.ts; update README.md and create docs/releases.md.

Interfaces: buildReleaseNotes(markdown,{tag,version,repository}) returns body/version/prerelease. CLI consumes --tag/--output, reads package/changelog from working directory, writes notes and safe fixed GitHub step outputs.

- [x] Write RED cases for exact section extraction, fenced headings, invalid/mismatched tags, duplicate/missing/empty/invalid-date sections, propagation of preview status and CLI output isolation.
- [x] Implement extractor and curated initial 0.1.0 changelog covering shipped features, fixes, upgrade notes and pending real validation.
- [x] Run focused tests and inspect exact rendered initial body; document future release steps.

### Task2: Automatic release publication

Files: modify .github/workflows/ci.yml to allow workflow_call; create .github/workflows/release.yml.

- [x] Add tag-only workflow with read-only reusable CI and narrowly scoped contents:write publish job.
- [x] Check tag commit ancestry on main; prepare matching notes; edit only notes when release exists or create preview/stable according to validated version metadata.
- [x] Verify workflow syntax/security and run standard typecheck/fulltests/build/demo; obtain fresh independent review.

### Task3: Ship and verify

- [ ] Publish reviewed PR and require exact-head Ubuntu/Windows CI before guarded merge.
- [ ] Create the first v0.1.0 tag on the merged commit, let the workflow publish its preview release and verify exact tag/body/flag/commit.
- [ ] Keep overall administration goal active and return to the isolated disk-growth implementation.
