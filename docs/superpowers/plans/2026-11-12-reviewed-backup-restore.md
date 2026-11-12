# Reviewed Backup Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a selected backup into a new stopped guest through an explicitly reviewed, single-use action.

**Architecture:** A focused server module validates source and destination and retains short-lived reviews. Existing authenticated routes expose options, preview and execution; existing native task history/logs track the new guest. A focused dialog extends the current backup inventory.

**Tech Stack:** TypeScript, Zod, Fastify, React, TanStack Query, Radix, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-reviewed-backup-restore-design.md`

## Global constraints

- Node 22-compatible TypeScript; no new dependencies.
- Same node, new unused guest ID only; force=0, unique=1, start=0.
- Extracted configuration never leaves the agent; no automatic replay or cleanup.
- Use fixtures now; designated live validation remains pending.
- Preserve auth/origin controls, native notes, visual identity and public demo isolation.

## Review focus

- A reused VMID can have opposite-type backups; archive identity must match.
- A timeout can follow upstream acceptance; consume reviews before POST and explain inspection.
- Changes between review and execution require a new review, including connection revision.
- Archived host references and network identities must not silently affect existing infrastructure.
- Leaving/restarting loses local review state; native history must recover tasks for the new ID.

### Task 1: Restore safety engine

Files: create `server/src/guest-restore.ts`, `server/test/guest-restore.test.ts`.

Interfaces: `loadRestoreOptions(client, guest)` returns eligible storage IDs and suggested VMID. `RestoreReviews.preview(client, guest, revision, input)` returns public review; `execute(client, guest, revision, input)` returns `{node, upid, vmid, type}`. Clients expose only `get`/`post`; preview input is archive/storage/destination ID and execution input is review token/typed ID.

- [x] Write failing tests for exact QEMU/LXC requests, archive type, unsafe configs, stale state, collision, duplicate and uncertain acceptance.
- [x] Run `node --import tsx --test server/test/guest-restore.test.ts`; confirm missing engine fails.
- [x] Implement validation, bounded single-use reviews, fresh-state rechecks and safe errors.
- [x] Run focused tests; all pass with no real infrastructure requests.

### Task 2: Agent and review dialog integration

Files: modify `server/src/index.ts`, `web/src/lib/api.ts`, `web/src/components/GuestBackups.tsx`; create `web/src/components/GuestRestoreDialog.tsx` and fixture browser verification script in `scripts/`.

Interfaces: authenticated guest-scoped `/restore-options` GET, `/restore-review` POST (read only), `/restore` POST. Public review carries archive metadata, destination node/type/ID/storage, expiry and opaque ID. Existing native task APIs carry status/logs; new task VMID is returned explicitly.

- [x] Write failing browser/API fixture expectations: no mutation before typed review, stale/denied review, accepted target attribution, warnings/unknown, no replay and history recovery copy.
- [x] Add routes with saved connection revision and task allowlisting; do not expose raw config/upstream secrets.
- [x] Implement dialog with existing primitives, explicit stopped outcome/identity warning, cancellation, keyboard flow and bounded native logs.
- [x] Run fixture browser flow at desktop and 390px light/dark; confirm no overflow or console errors.

### Task 3: Documentation, full verification and publication

Files: modify `project.md`, `design.md`, `README.md`, plan checkboxes as appropriate.

- [x] Replace obsolete replacement non-goal with staged conversation roadmap; document initial restore restrictions/permissions and fixture-only status.
- [x] Run `npm run typecheck && npm test && npm run build` and `npm run build:demo`; record exact results.
- [x] Request fresh independent branch review, fix material findings and rerun affected checks.
- [ ] Publish an incremental PR with exact evidence. Keep public demo revision pinned and live-host validation explicitly pending.

Verification: 195 project tests passed, typecheck/production/demo builds passed; restore, existing maintenance and isolated demo browser fixtures passed. Independent review approved after host parallel-device and affinity/NUMA exclusions. Publication is tracked in the PR rather than changing the verified commit after CI. Real infrastructure validation remains pending.
