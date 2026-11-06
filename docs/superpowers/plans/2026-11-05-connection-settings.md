# Saved Connection Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for one coherent implementation task, fresh review and the authorized publishing subagent. Controller owns project/release/site documentation and final verification.

**Goal:** Rotate credentials, rename connections and change TLS verification without losing connection identity/history.

**Architecture:** A strict authenticated settings API builds and verifies a fresh candidate against the immutable saved endpoint, then commits with an opaque revision check and atomic encrypted persistence. An explicit existing-style dialog keeps secrets blank and requires deliberate saves/reloads.

**Tech Stack:** Existing Fastify, React, Zod, undici and encrypted store; no new dependency.

**Spec:** `docs/superpowers/specs/2026-11-05-connection-settings-design.md`

## Global constraints

- Preserve bearer/origin/DNS guards, credential encryption, explicit confirmations and UI api/agentFetch boundaries. No secret returned/logged or sent to AI/history/browser storage.
- Immutable id/host/port/createdAt; preserve guest metadata and retained jobs. Strict editable fields and HMAC revision; compare before/after asynchronous verification.
- New client for test/save probes; test no persistence/cache mutation; durable save invalidates cached saved client. Credential changes require replacement on authType/username changes; omitted secret otherwise keeps it.
- Probe only auth/read version+nodes, fixed sanitized errors; no guest/host actions, permissions or automatic revocation/cancellation. Block save during same-connection running provisioning/update jobs before and after probe.
- Atomic encrypted persistence and memory rollback on failure. No resurrection or lost updates on concurrent save/removal. Drafts remain through errors until explicit reload.
- Preserve existing add flow, warm glass design and pinned read-only demo. No dependency/provider/hosting/access change or real hypervisor use. Desktop/mobile390px and both themes.

## Review focus

- Another browser or removal races the candidate probe: stale requests cannot overwrite or recreate records.
- Credential identity change with omitted/empty secret, poisoned upstream failure or persistence failure: old state survives, no sensitive text leaks.
- Saved-client/password-ticket cache is warm before edit: tests keep it intact and successful save replaces it for later requests.
- Agent changes or delayed test/save results: no draft submission or callback applies to another connection/agent; conflict reload is explicit.
- A provisioning/update starts during verification or failed state write: no active job uses a surprising swapped credential, and durable/in-memory state agree.

### Task 1: Saved connection editing end to end

**Files:** New focused server module `server/src/connection-settings.ts` for schemas/revision/candidate workflow as useful; modify `server/src/store.ts`, `server/src/index.ts` route wiring and `server/src/proxmox.ts` only if existing forgetClient is insufficient. New `web/src/components/ConnectionSettingsDialog.tsx`; minimal Connections.tsx Edit action and API types if needed. Tests `server/test/connection-settings.test.ts` and `web/test/connection-settings.e2e.cjs`. Worker report `docs/superpowers/plans/connection-settings/task-1-report.md`. Root owns all other docs/site.

**Interfaces:** Exact endpoints, body fields, bounds, return values and error statuses in spec. Saved host/port never accepted from browser. Existing public list/create shapes unchanged. Test `{ok:true}`, GET/save public fields+revision. UI consumes fresh GET; no secret from server. Running job statuses/clusterId come from existing provision exports.

- [x] Write local real-agent/HTTPS API REDs and observe missing settings endpoint failure; add focused state rollback/concurrency tests without real Proxmox/commands.
- [x] Implement candidate verification, revision checks, strict credential rules, active-job guard and atomic encrypted saved update/cache handling; run focused tests GREEN. Material review fixes remain below.
- [x] Write browser feature RED on missing Edit; implement focused dialog/minimal row integration. Exercise secret omission, test success invalidation/pending state, errors/conflict reload, agent lifecycle and390px layout. Support opt-in ready/error desktop/mobile dark/light screenshots, waiting for theme transitions; no repeated visual loops.
- [x] Run focused API/browser tests, typecheck, diff checks and report exact RED/GREEN, source stable, limitations. No commits or subagents from worker; root batches final required full checks/docs.
- [x] Fresh broad task+whole-branch spec/security/quality review and material fixes with observed regressions; scoped re-review PASS.
- [x] Final controller full verification and bounded visual confirmation.
- [ ] Authorized exact-head CI/preview/production publication; external evidence recorded after commit.

## Ledger

- App base/main `41e18fca44837f6e580797a66741adf97f9dcd6a`, tree `038891e20bd1f0313932b52349815ca8760e14e6`; site base/main `5352fa154e29609d6f6ff0a980e2253db169c419`, tree `0319f75cc491817479ef4afdde067a9ebf039beb`. Both clean dedicated branches `feat/connection-settings`; current managed checkout used in place, no additional worktree. Baseline tree is identical to just-verified147/147 and Ubuntu/Windows CI for guest-console release; no redundant baseline suite.
- Pre-flight: one coherent task, no inter-task interfaces. Root docs/site do not overlap worker product files. Existing standing user instructions delegate continued iteration and PR publication; no repeated design/integration approval gate. Feature selection and immutable-endpoint policy are controller decisions, not user-authored requirements.
- Cloud status current/enforced/unrestricted HTTP, no secrets/outbound identities/VPN configured. Strict local synthetic fixtures only; preserve proxy/CA and all security invariants. Impeccable launcher unavailable earlier in this same session; context/design/craft-floor read directly, no launcher retry.
- Worker `/root/connection_implement` observed both initial REDs: settings GET404 in real-agent/local HTTPS test and missing Edit in browser fixture. Implementation is in progress; controller's scoped website copy preserves the demo pin and mascot.
- Website verification complete:5/5 build-boundary tests, normal pinned-source build, staged desktop/390px presentation (including new factual copy assertions) and companion checks pass. Logs `/tmp/settings-site-{tests,build,presentation,lynx}.log`; no demo source, hosting/access or mascot changes.
- Stable first handoff: initial API/browser RED→GREEN, focused checks, typecheck and web build pass. Root full verification passes148/148 tests, typecheck, normal/demo builds and browser; representative ready/error desktop/mobile dark/light layouts inspected. Logs `/tmp/settings-final-*.log` and captures `/tmp/proxmiu-connection-settings`. No material issue in those short-destination captures.
- Fresh read-only review found three material gaps: candidate clients inherit redirect following (including password POST bodies), successful probe payloads are not runtime-validated, and pending Save can be dismissed while still committing without a query refresh. Root source inspection confirms these effects. One consolidated fix wave will add meaningful RED→GREEN redirect/payload/dismissal regressions, retain existing-client compatibility, clearly show pending progress and wrap long destinations. Specification clarifies these already-intended fixed-destination/verified-save/cancel/mobile guarantees. Publication is gated on fixes, scoped re-review and final required checks; no renewed approval is needed under existing delegated scope.
- Resumed Nov6: same managed workspace and feature branches retained; no product fixes had landed during the pause. Original `/root/connection_implement` resumed the already-assigned consolidated fix wave; no duplicate implementation worker. Current cloud readiness rechecked, no real host credentials/VPN available. Prior148/148 pass is evidence only for the pre-fix source, not completion of the reviewed fixes.
- Task1 fix round1: all three material findings addressed with observed RED→GREEN regressions. Candidate-only redirect restriction covers password login and reads; runtime validation covers version/nodes/login ticket+CSRF, with empty nodes accepted. Pending Save disables Cancel/X, blocks Escape/outside dismissal and visibly reports progress, while preserving agent changes. Long destinations wrap. Focused API3/3, browser, typecheck and web build pass; detailed evidence is appended to the worker report.
- Scoped re-review by `/root/connection_review`: spec PASS and quality/security PASS; all three findings ADDRESSED, no material new breakage or deferred accepted finding. Existing Add/client behavior and shared dialog defaults are preserved. Final root full tests pass150/150; remaining build/browser/visual completion is being collected before commit. No source changes after stable fix handoff.
- Nov6 final controller checks all PASS on stable fixed source:150/150 tests, server/web typechecks, normal app/server build, isolated demo build, full settings browser fixture and diff whitespace checks. Logs `/tmp/settings-reviewed-{types,tests,build,demo-build,browser}.log`. One post-fix visual confirmation inspected representative ready/error desktop/mobile dark/light captures under `/tmp/proxmiu-connection-settings-final`; no material visual issue remains. No installer or dependency changes require additional checks. Website's pinned demo build remains separate from the current app demo build.
- Source is ready for authorized publication by `/root/connection_publish`. Exact-head Ubuntu/Windows CI, Netlify preview and production evidence will be recorded at `/tmp/connection-settings-publication.md`; the reviewed immutable commit cannot embed its own later publication result. Existing installations need an agent update; no real Proxmox validation or credential revocation was performed.
