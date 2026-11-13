# Reviewed VM Boot Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Checkbox steps track evidence.

**Goal:** Safely reorder the same existing explicit enabled-device set on a stopped QEMU VM.

**Architecture:** Purpose-specific server parser/readiness/single-use review engine, synchronous boot+digest PUT and canonical postcondition verification, with on-demand card/dialog and arrow reorder controls.

**Tech Stack:** Existing TypeScript/Zod/Fastify, React/TanStack/Radix, node:test/TLS and Playwright; no new product dependencies.

**Spec:** docs/superpowers/specs/2026-11-13-boot-order-design.md

## Global constraints / review focus

- Nonempty explicit order only, at least2 supported existing entries, identical membership; no bootdisk/legacy/default conversion/custom args.
- Exactly boot+digest PUT, expected null then fresh postconditions. Preserve every device/firmware/unrelated config value; object-key ordering is not a mutation.
- Native VM.Config.Disk permission, stopped/readability/HA/pending/snapshot/task guards, five-minute typed fixed-source single-use reviews. No replay/rollback/power/SSH/task fabrication.
- View source identity guards replacement before Review as well as execution. Keep all RAID members, never silently filter unsupported enabled entries.
- Strict uncertain outcome after partial/native-error/post-read or removed revision; fresh observation never unlocks consumed writes.390px themes, long names and pinned demo remain intact.
- Fixtures now; real SeaBIOS/OVMF/media/PXE/boot behavior and full roadmap stay open; changelog Unreleased only.

### Task1: Native engine and unit fixtures

Files: new server/src/guest-boot-order.ts and server/test/guest-boot-order.test.ts; optional pure readNicProperty export from guest-nic-link.ts, without link-write behavior changes.

Interfaces: loadBootOrder(client,guest) returns inventory; BootOrderReviews.preview(client,guest,revision,{sourceIdentity,order}) returns fixed source/current/proposed review; execute(client,guest,revisionResolver,{reviewId,confirm}) returns observed verified result only after native null and fresh canonical comparison.

- [x] Write/observe RED for module absence and supported same-set reorder, identity/labels/exclusions, native family/media bounds and untouched option preservation.
- [x] Implement strict explicit-order parser, pure device classification, canonical identities and shared-pattern readiness guards.
- [x] Add RED legacy/bootdisk auto-delete refusal/no-op/membership/schema/unknown/raw syntax/readability/pending/HA/tasks/identity/revision/expiry/concurrent/cached cases; implement admission.
- [x] Add RED null/non-null/partial/running/pending/changed-device/firmware/unrelated-config/unreadable-postcondition cases; implement observation/no replay.
- [x] Focused unit/history/NIC regressions pass with zero other mutation endpoints.

### Task2: API and browser flow

Files: server/src/index.ts, server/test/guest-boot-order-api.test.ts; web API/query hooks/GuestDetail; GuestBootOrder.tsx, GuestBootOrderDialog.tsx and web/test/guest-boot-order.e2e.cjs.

Interfaces: QEMU-only GETboot-order, POSTboot-order-review(read-only), POSTboot-order; typed inventory/review/result shapes from spec, same auth/origin guards.

- [x] Write RED real TLS/agent fixture for auth/origin/type/schema/exact encoding, stale no-PUT, null verified result, partial apply and restart old-review no replay; add routes.
- [x] Write RED browser flow for exact source/arrow permutation/focus, before-after review/name/expiry/double click, stale retained draft, replacement, unknown/read retention/agent switch/long names and390px themes.
- [x] Implement fixed card/dialog and config invalidations independently of observation success; no native task/log claim or power action.
- [x] Focused and adjacent NIC/disk/maintenance/restore/console/demo browser checks pass.

### Task3: Review and publication

Files: README.md, design.md, project.md and CHANGELOG.md Unreleased. Website after app merge.

- [x] Document exact first-slice boundaries, native bootdisk side effect avoidance, configured-order vs boot success and manual synchronous recovery.
- [x] Run typecheck/fulltests/production/demo builds, whitespace and browser checks; fresh independent whole-branch review and regression-test material fixes.
- [ ] Publish verified tree/PR through connected GitHub, require exact-head Ubuntu/Windows CI, guarded merge, synchronize main/build and then website copy/preview/production as needed. Keep wider goal and designated live validation pending.
