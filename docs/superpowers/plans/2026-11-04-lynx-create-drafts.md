# Lynx Creation Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn a creation request in Lynx chat into a constrained draft reviewed in the existing Create form.

**Architecture:** Opt-in chat mode uses the public built-in catalog and a strict resource-only draft. A memory-only one-use handoff opens the existing Create screen; provisioning still requires the user's own final submission.

**Tech Stack:** Existing TypeScript, Zod, React, React Router, TanStack Query and fixture tests; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-lynx-create-drafts-design.md`

## Global constraints

- Preserve bearer/origin guards, fixed provider endpoints, encrypted credentials and existing resource/setup behavior.
- Draft fields: templateId, cores (1..128), memoryMiB (256..1048576), diskGiB (2..65536), integers only; immutable built-in templates only.
- Never attach custom scripts/templates, inventory, addresses, credentials or template options. No model-chosen destination or arbitrary tool execution.
- Creation mode and setup snapshot sharing are mutually exclusive. Clear mode changes and ignore late requests.
- Handoff is memory-only, one-use and agent/template bound. User reviews placement/network/credentials and explicitly submits the existing provisioning form.
- Professional restrained Lynx voice, plaintext, keyboard and 390px support. No real host or paid provider calls.

## Review focus

- A template is deleted/replaced or marked built-in by client data: only the server catalog may produce a draft; Create must reject non-built-in/stale handoffs.
- Opening an existing creation form: a new handoff must replace that draft deliberately, never silently overwrite user edits.
- Agent change/back/reload: a consumed or cross-agent handoff must not reappear.
- Invalid structured provider output: no partial action, script/source/options or unbounded values survive.
- Mode switches and delayed replies: old proposals may not become actionable in a new context.

## Tasks

### Task 1: constrained provider draft

Files: server/src/ai-create.ts (new), server/src/ai.ts, server/src/index.ts; server/test/ai-create.test.ts (new), chat API validation tests.

- [x] Write tests for opt-in mode/exclusivity, all three provider payloads, catalog privacy, valid trusted metadata, invalid/extra/unknown templates, reply truncation after parsing and advice-only fallback. Run and observe expected missing-operation failure.
- [x] Add strict createDraft consent flag to chat schema, contextual helper and catalog validator. Reuse bounded transport/gate. Run focused tests; expect all pass.

### Task 2: reviewed form handoff

Files: web/src/lib/lynx-create-draft.ts (new), web/test/lynx-create-draft.test.ts (new), web/src/components/LynxChat.tsx, web/src/lib/api.ts, web/src/pages/Create.tsx, web/test/lynx-create.e2e.cjs (new).

- [x] Write tests for one-use agent/template-bound handoff, malformed values and expiry; run and observe missing helper failure.
- [x] Add validated memory-only handoff; chat mode/card/review button; guarded consumption into Create, review summary and required acknowledgment before submission. Existing manual creation and setup allocation remain intact.
- [x] Browser fixture: no automatic creation, exact fields copied, destination/network/secrets untouched, review gate, explicit submit, invalid/stale handoff, mode/reset/late responses, mobile and normal creation regression. Build and run; expect pass without provider/host access.

### Task 3: finish and publish

- [x] Update docs/site with draft/review behavior and actual limits. Run full typecheck/test/build plus relevant chat/setup/pet/site fixtures. Fresh whole-branch review and address material findings.
- [x] Commit the verified implementation (`46343b2`). Push and publication are delegated below.
- [x] Publishing completed: app PR #8 and site PR #5 squash merged after exact-head CI; tested and merged trees match and Netlify production bytes/provenance were verified. No new app hosting.

## Progress

- Base: app 12404ad7953885c368bc4824d26d5e9c3530ad5e; site 789153856c6643813b43a1db194bdcad0fd90a77. Earlier Lynx setup task is complete, not repeated.
- Pre-flight: provider helper produces a validated draft and trusted public template metadata; browser handoff consumes only that draft. Existing resource proposals use a separate exclusive mode. No interface conflicts.

- Task 1: complete; focused provider tests observed RED → GREEN, including all three providers and invalid/extra draft rejection.
- Task 2: complete; memory handoff tests observed RED → GREEN. Browser fixture reproduced a delayed review reset after edits; exact-value acknowledgment now gates the same render and passes boot/text-edit regressions. Back/reload, current-catalog validation, cancellation, duplicates and failure preservation pass.
- Consolidated verification: 89/89 tests, server/web typecheck, full build and creation/chat/setup/pet/site browser fixtures pass. Desktop/mobile form views inspected; no overflow. Whole-branch review identified one navigation race; fixed in the single fix pass.

- Final: fixed browser-navigation race — held-catalog Back regression RED → GREEN; queued draft abandonment during connection loading RED → GREEN; suite 89/89, typecheck and production build pass. Origin location binding, native history cancellation and staged-destination cleanup prevent stale navigation or later manual-form reuse. No deferred findings or rulings.

- Final browser regression checks: ordinary chat and no-key companion pass on the final code. The setup fixture initially raced its one-second expiry during parallel execution; it passed alone, then passed with explicit browser-clock control around consent/expiry. Production preview TTL is unchanged. No unresolved test failures.

- Tasks 1–2: complete (commits 12404ad..46343b2, 89/89 tests, both TypeScript projects, build and browser fixtures pass). Whole-branch review finding addressed with RED → GREEN navigation regressions; no parked findings.
- Task 3: implementation, documentation and verification complete. Publishing subagent will report exact-head CI, merge SHAs and production provenance; no application hosting is introduced.

- Publication complete: app merge 4b086e66ec672d2dbfcac2661cbb8855a5d46d15; site merge a9c7bf4f791a0649e6a563a6444c04a192c98e1a. Ubuntu/Windows CI run 41854190051 passed; production deploy 6aeb4ac52aaef1b2788c45d3 is verified from the exact site merge.
