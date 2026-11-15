# Existing VM Boot Eligibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Review and change which already configured supported devices participate in a stopped VM's explicit boot order, preserving hardware and all existing write/recovery guards.

**Architecture:** Extend the existing purpose-specific inventory/review engine with the complete eligible candidate set and nonempty selection validation. Add a small pure frontend contract helper, then inclusion controls in the existing card/dialog; native mutation stays a synchronous boot+digest PUT with fresh postconditions.

**Tech Stack:** Existing TypeScript/Zod/Fastify/React/TanStack/Radix, node:test/TLS and Chromium fixtures. No new dependency, privilege or schema migration.

**Spec:** docs/superpowers/specs/2026-11-13-boot-eligibility-design.md

## Global constraints

- Only stopped QEMU and unambiguous explicit nonempty current boot order; current and proposed orders contain 1–89 supported configured IDs. No legacy/default/bootdisk conversion, unsupported-source cleanup or empty submitted target.
- Inventory/review eligibleDevices includes all supported configured candidates and every current member with matching identity/kind/label. Source identity binds disabled candidates too.
- Exactly boot+digest PUT/null; preserve all other returned current-config values, device/firmware/link state and every existing reservation/revision/typed-name/expiry/readiness guard. No power/SSH/delete/cleanup or native task/log invention.
- Unknown outcomes stay consumed and unconfirmed; observations never unlock writes. Preserve old-agent order-only compatibility, source/agent guards, stale drafts and running-VM read recovery.
- No new dependency, privilege, demo pin, mascot, global styling or provider sharing.390px themes remain usable. Record only Unreleased; real PVE8/9 boot/media/PXE/firmware validation stays open.

## Review focus

- A disabled device changes before preview/submit: source mismatch must reject with zero PUT, including when enabled rows are identical.
- A supplied malformed candidate inventory is not a legacy capability signal: reject null/duplicates/unsupported/missing current identities, and reject capability changes during refresh/review.
- One enabled source/target and a temporarily empty draft: modern single-device flow works; server rejects empty, UI explains it, old agents keep their original two-member floor.
- Software-RAID/firmware and OVMF network prerequisites: all required members are an explicit operator choice and warning, never guessed or auto-attached; cross-version RNG copy stays conditional.
- Native unknown result while runtime readiness changes or an agent is replaced: no replay; allow current-order read for same identity, retain last good observation and ignore old-agent callbacks.

### Task1: Engine and native API fixture

**Files:** modify server/src/guest-boot-order.ts, server/test/guest-boot-order.test.ts and server/test/guest-boot-order-api.test.ts. No new endpoints or index routes.

**Interfaces:** loadBootOrder returns existing inventory plus required eligibleDevices:BootDevice[]. Review output adds the same field; preview input remains strict {sourceIdentity,order:string[]} and execute/result keep their current shape. BootOrderReviews accepts changed nonempty eligibility from the full supported configured set, not arbitrary hardware IDs.

- [x] Write unit RED: inventory exposes all supported candidates including disabled scsi1/ISO/NIC without leaking raw options, guest IP/DNS, notes or secrets; supported candidates leave excluded while EFI/TPM/unsupported remain there. Run focused test and confirm missing-field assertion fails.
- [x] Implement complete deterministic candidate inventory and exact matching review candidates; preserve source hash and unsupported-current refusal.
- [x] Write RED for adding/removing/mixed priorities, modern singleton source and target, pure reorder and no-op/empty/duplicate/missing/unselectable rejection. Replace only the obsolete same-membership/single-source rejection expectations. Run and confirm positive changed-membership cases fail first.
- [x] Implement 1–89 validation, candidate membership and length-aware no-op detection; construct proposedOrder from eligibleDevices. Native execute, reservation and canonical postconditions remain unchanged.
- [x] Write RED for OVMF/no-RNG network caution alongside disconnect warning, with configured RNG/non-OVMF controls; implement conditional wording without attaching hardware.
- [x] Add disabled-candidate replacement before preview/execute and preserve all raw hardware/firmware/link config cases. Retain existing expiry/revision/HA/pending/snapshot/task/null/partial/restart guards; focused regressions pass with zero extra mutation paths.
- [x] Extend actual TLS/agent API fixture with the unit-TDD-covered singleton changed-eligibility target and exact encoded boot+digest only. Verify hardware remains present, native null result and unknown/restart replay protections. Implement any integration gap, then focused engine/API/NIC/history tests pass.

### Task2: Frontend contract and inclusion workflow

**Files:** new web/src/lib/boot-order.ts and web/test/boot-order.test.ts; modify web/src/lib/api.ts, GuestBootOrder.tsx, GuestBootOrderDialog.tsx and web/test/guest-boot-order.e2e.cjs. Query keys/hooks and GuestDetail integration stay unchanged.

**Interfaces:** optional eligibleDevices on frontend inventory/review types permits older agents. Pure helper exports bootChoiceInventory(inventory):{mode:'eligible'|'legacy'|'invalid',devices:BootDevice[],reason?:string}, sameBootOrder(actual:unknown,expected:BootDevice[]):boolean, sameBootChoices(a:GuestBootOrder,b:GuestBootOrder):boolean and bootReviewMatches(value,initial,proposed,guest):boolean. Card/dialog share these guards; native property parsing stays on the server.

- [x] Write helper unit RED for absent old-agent two-member mode, modern singleton/full-set mode, malformed/null/duplicate/unsupported/missing-current identity rows, candidate-order independence, changed capability and replaced inactive candidate. Run and observe missing-module failure, then implement the minimal pure contract guards.
- [x] Add browser RED inclusion controls and before/after/newly enabled/disabled review lists, empty draft blocking, singleton modern flow and legacy two-device order-only flow. Build shipped UI and observe missing-control failure before edits.
- [x] Add optional typed fields and share contract helper in card/dialog. Keep opening device and candidate snapshots fixed; malformed supplied inventory stays read-only, absent field alone keeps legacy reorder and shows update guidance.
- [x] Implement explicit draft inclusion controls and priority arrows, with focus/announcement retained after either action. Enabling appends; disabling only removes eligibility. Show hardware/link preservation and native firmware/RAID/startup warnings before typed confirmation; show explicit added/removed rows with labels.
- [x] Extend browser fixtures for disabled-candidate replacement before review and refresh; malformed review candidate contract; capability replacement; stale draft/new review; unknown then running observation, last-good reading and independent invalidation; agent late-response guards; long labels/names390/1440 light/dark. Run full expanded fixture GREEN.

### Task3: Docs, final gates and publication

**Files:** README.md, project.md, design.md, CHANGELOG.md Unreleased; website index.html/README only after app merge.

- [x] Document supported configured eligibility vs hardware attachment/link state, singleton support, retained legacy/unsupported-source boundaries, firmware/software-RAID and conditional OVMF/PXE caution, old-agent order-only fallback and unchanged synchronous recovery.
- [x] Run typecheck, full project tests, production/demo builds and whitespace; expanded boot browser and adjacent NIC/disk/maintenance/restore/graphical-console/demo fixtures pass. Fresh read-only whole-branch review; material findings get a reproduced RED before a fix and green suite.
- [ ] Publish exact tested tree using connected GitHub, require exact-head Ubuntu/Windows CI and guarded merge, sync clean main/build. Update/review website copy only afterward, preserving demo pin and mascot, then exact Netlify preview and production browser/artifact checks through Git deployment. Keep wider goal and live validation pending.
