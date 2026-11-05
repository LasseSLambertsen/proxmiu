# Agent-free Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the app task with a fresh whole-branch review; controller owns the independent website packaging task. Use the authorized publishing subagent after checks.

**Goal:** Let visitors explore an honest, read-only sample environment at proxmiu.com/demo/ without an agent.

**Architecture:** Isolated static app entry reuses pure components and bundled sample data, with hash routes. Existing website builds a pinned merged app source and publishes the demo alongside allowlisted marketing assets.

**Tech Stack:** Existing React/Vite/Tailwind, Node built-ins, Git and npm; no new dependencies/services.

**Spec:** `docs/superpowers/specs/2026-11-04-agent-free-demo-design.md`

## Global constraints

- Demo entry imports no live session/agent/API/query/write/SSH/provider code and never reads/writes normal app storage. Only `proxmiu-demo-theme` persists.
- No real host/provider/actions, successful fake writes, PWA/service worker, new dependencies/hosting project, domain/access changes or changed mascot asset.
- Persistent sample notice, useful read-only navigation and actual shared pure UI components; preserve established app design and normal build.
- Demo build output `dist/demo/index.html`, asset base `/demo/`, hash routes, explicit unknown route recovery, CSP connect-src none.
- Website builds immutable app source from a fixed public repo/full SHA; clean local override must match. Publish only explicit public files plus demo, with provenance.
- Node22 Linux/Windows, desktop/tablet/390px both themes, reduced motion and one bounded visual inspection plus at most one confirmation.

## Review focus

- A visitor who already uses a real agent on this origin must not expose or alter its URL/token/SSH keys/views.
- Every route or filter must remain useful/readable after refresh, empty results, unknown IDs and narrow screens; no dead action disguised as functioning provisioning.
- Shared imports must not drag in live connection/session behavior or inaccurate live labels; sample metrics/history must remain explicit and plain text.
- Missing/bad source pin, dirty/mismatched local checkout or failed build must not publish partial/secret/source artifacts.
- Public /demo/ links, asset bases, CSP and source SHA must agree across local build, preview and exact merged production artifact.

### Task 1: Isolated demo app

**Files:** Add `web/demo.html`, `web/src/demo/*`, `web/test/demo.e2e.cjs` (and useful focused Node tests only when needed); modify `vite.config.ts`, package.json scripts and existing CI for demo build. Pure shared components may get a small optional presentation prop if needed to avoid misleading sample labels; no live page/session/agent/API changes. Controller owns documentation/site.

**Interfaces:** `npm run build:demo` produces only `dist/demo/index.html` + local assets, deployable under `/demo/`; no hardcoded preview origin. Entry uses hash routes with isolated theme preference. Website consumes this exact artifact.

- [x] Write meaningful browser isolation/interaction regressions and observe RED before implementing the entry. Use normal app storage sentinels and network construction probes.
- [x] Implement fixed sample dataset, clear shell and four read-only sections/guest workspace using actual pure components and design tokens. Include filtering/reset, metric controls, template detail and interrupted/plaintext history.
- [x] Add separate demo HTML/build configuration, connect-src none CSP, no manifest/service worker and Node22 CI demo compilation; preserve normal app output.
- [x] Run demo build/focused browser/typecheck; report files, RED→GREEN, bounded visual screenshots and practical limits. No duplicate full suite/build; controller owns final consolidated checks.
- [ ] Fresh whole-branch spec/quality review of app+website, material fixes, commit/push and app exact-head CI/merge.

### Task 2: Existing website packaging (controller)

**Files:** `scripts/build.mjs`, `demo-source.json`, `netlify.toml`, `index.html`, `.gitignore`, README and tests.

**Interfaces:** Consume merged app SHA and build:demo artifact from Task1. Build staged `dist/` from allowlisted marketing assets and demo, add `demo/build.json` with source SHA. Optional `--source <clean checkout>` must match pin.

- [x] TDD source-pin validation/staging/provenance/failure boundaries with Node built-ins, no network in unit tests.
- [ ] Build from pinned public app source (or validated local checkout); preserve current site if build fails and never copy source/dependencies/secrets to publish output.
- [x] Add Try the demo link, honest sample copy and noindex demo headers; preserve site identity/global security/domain/access/mascot.
- [ ] After app merge pin exact merge SHA; verify final staged website/presentation/companion/demo, review site pin change and publish exact-head preview/production through subagent.

## Ledger

- Base app main `bbcee057b039534c84b995a1166d0990e28669ed`; base site main `a5f734d72ea463732f80956280bc3584b41bad9d`. Both clean branches `feat/agent-free-demo`.
- Previous VM clone task shipped as app PR #10 with Linux/Windows CI; do not repeat it.
- User delegated continued iteration/publication, including a publishing subagent. Controller chose the next feasible roadmap item and isolated curated-tour approach; these are controller calls, not attributed user design choices.
- Cross-task interface: app artifact is `dist/demo/index.html`, base `/demo/`, source SHA pinned only after guarded app merge. Site uses hash routes, so no SPA fallback is needed. No file ownership conflicts.

- Resume Nov5: original app implementer hit a usage limit before reporting; same agent resumed after reset using saved files. No completed work was reimplemented and no lost test evidence is assumed. Root website boundary tests pass5/5 with Node built-ins.
- Consolidated app typecheck,130/130 tests, normal production build and isolated demo build passed. First rendered review found CTA text overridden by a plain-link selector; a bounded correction/contrast regression and one confirmation capture are in progress.

- Task1 source handoff: isolated demo compilation, typecheck and all six desktop/tablet/390px dark/light browser cases pass. Rendered CTA defect reproduced at1.819:1, corrected in one batch, then confirmed at≥4.5 with no underline. Sample totals and metric timestamps agree with the fixed snapshot. Root accepted the one confirmation capture; no more app visual changes are planned.
- Source review packages: `/tmp/demo-app-review.diff`, `/tmp/demo-site-review.diff`; independent reviewer checks both code scopes while final site pin/build awaits app merge.

- Fresh independent review: specification and quality pass with no material findings. Runtime purity, synthetic saved outcomes, combined restrictive CSP and installed local-override build files were inspected and accepted. App is ready for CI-gated merge; site remains gated on actual merged source pin, full CLI build, staged/preview/production proof. Dense component formatting was considered a preference without a demonstrated defect, not a deferred material issue.
