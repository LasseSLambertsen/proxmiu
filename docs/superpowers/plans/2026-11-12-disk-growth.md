# Reviewed Disk Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow an ordinary existing VM/LXC disk through a reviewed absolute-capacity request with native task tracking.

**Architecture:** A focused server module reads authoritative storage metadata and builds bounded single-use reviews. Existing authenticated routes and native task access expose inventory/review/execute/status/logs. A disk-capacity card/dialog uses existing visual primitives and never rewrites raw disk property strings.

**Tech Stack:** Node22-compatible TypeScript/Zod/Fastify, React/TanStack/Radix, node:test, local TLS fixtures and Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-disk-growth-design.md`

## Global constraints

- Native PUT resize only, exact disk/absolute size/digest; require resize UPID for both types.
- Five-minute single-use review, typed identity, target integer GiB 1–65536; no shrink/relative targets/automatic replay/cleanup or guest commands.
- Preserve all other native options/notes; stopped is preflight policy, not a native atomic constraint.
- Supported backend/type allowlist; storage availability is advisory; reread actual allocation after task completion.
- Fixtures now; no production/live-allocation claim;390px light/dark and demo isolation preserved.

## Review focus

- Sanitized insights omit native options; read raw current configuration for policy only, never write it back.
- Worker errors/warnings can follow successful block growth; report actual capacity separately from filesystem/task result.
- Separate reviews and lost responses cannot become relative-size retries.
- Digest protects configuration but not power state; no hidden guest stop/start to satisfy the form.
- Restart recovery comes from native retained resize tasks; unknown outcomes cannot be invented as synchronous success.

### Task1: Inventory, review and admission engine

Files: create `server/src/guest-disk-growth.ts`, `server/test/guest-disk-growth.test.ts`; optional shared task identity utility in `server/src/task-history.ts`.

Interfaces: `loadDiskInventory(client,guest)` returns typed eligible/disabled disks and guest readiness. `DiskGrowthReviews.preview(client,guest,revision,{disk,targetGiB})` returns purpose-specific review; `execute(client,guest,currentRevision,{reviewId,confirm})` returns native `{node,upid,vmid,type}`. Client exposes only get/put.

- [x] Write RED fixtures for canonical ownership/capacity, exact payloads/task identity, all readiness/unsupported states and preservation of unrelated options.
- [x] Run focused tests and confirm missing functionality fails.
- [x] Implement read-only parsing, strict metadata validation and short-lived review binding.
- [x] Add RED stale/expiry/concurrent-two-review/active-resize/null/lost-response/rounding-warning cases; implement single-use and per-guest admission.
- [x] Focused tests pass with no power/config/delete/SSH calls.

### Task2: Authenticated routes and disk UI

Files: modify `server/src/index.ts`, `web/src/lib/api.ts`, `web/src/lib/queries.ts`, `web/src/pages/GuestDetail.tsx`; create focused disk-capacity components and TLS/API + browser tests.

Interfaces: guest-scoped disk inventory GET, review POST(read-only), growth POST; reuse existing native status/log/history routes with validated original node and VMID. UI returns to fresh observed capacity after terminal tasks and retains failed/stale drafts.

- [x] Write RED actual-agent/TLS assertions for auth/origin, exact PUT, no raw-config exposure, duplicate admission and native history recovery after restart.
- [x] Add routes/typed client/hooks and accepted task allowlisting.
- [x] Write RED browser flow for current/target/availability/filesystem review, typed identity, task warnings/unknown and no replay, stale draft and 390px layout.
- [x] Implement card/dialog with existing primitives, explicit boundaries and native task/log controls; invalidate relevant queries after completion.
- [x] Run API/browser/adjacent restore and console regressions.

### Task3: Documentation, review and publication

Files: update README/project/design and website copy only after the app increment is merged. Keep pinned demo source and mascot unchanged.

- [x] Document eligibility, real native filesystem effects, advisory capacity and observed-state limitations.
- [x] Run typecheck/fulltests/production/demo builds and focused browser fixtures.
- [x] Obtain fresh independent review, resolve material findings with regressions and rerun affected checks.
- [ ] Publish incremental PR, require exact-head Ubuntu/Windows CI, then guarded merge; keep larger hardware roadmap and live validation pending.
