# Durable Provisioning History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for one coherent implementation task, followed by whole-branch review and the authorized publishing subagent.

**Goal:** Retain safe provisioning/update diagnostics across agent restarts and show interrupted runs honestly.

**Architecture:** A separate encrypted, atomically replaced and bounded job journal feeds the existing job APIs. The runner checkpoints state without replaying work; Activity renders persistence health and interrupted outcomes.

**Tech Stack:** Existing Node/TypeScript filesystem/crypto, Zod, React and fixture tests; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-durable-provisioning-history-design.md`

## Global constraints

- Existing bearer/origin/DNS-rebinding protections, encrypted credentials and infrastructure confirmations remain intact.
- Journal uses the existing encryption key, 0600 snapshots/0700 directory, atomic replacement and bounded allowlisted snapshots. No raw requests/options/credentials/scripts or automatic resume/retry.
- Maximum 50 jobs; 5000 log lines and 128 KiB serialized UTF-8 per job; log lines 4096 characters. Keep newest tail, expose truncation, never evict active work.
- Initial durable save before side effects; immediate state/terminal checkpoints; log-only delay at most 250 ms. Failures are explicit and do not falsify operation outcome.
- Corrupt/oversized/undecryptable journals remain untouched and block new work, while other agent functions remain available. Existing job APIs stay compatible; status metadata is additive.
- Preserve original source/guest identity where known. Interrupted is an uncertainty state, never a success or automatic continuation.
- No new dependencies/privileges/provider sharing; fixture-only verification, plain text and 390px layouts.

## Task 1

Read `durable-provisioning-history/task-1-brief.md` for the exact implementation/report contract. One implementation agent owns source/tests; controller owns docs/site. No parallel source implementers.

- [x] TDD encrypted journal/retention/recovery/failure behavior and runner integration.
- [x] Activity interrupted/status/truncation/read-error UX and meaningful browser fixtures.
- [x] Implementer report, fresh review and material fixes; consolidated typecheck/full tests/build/browser checks.
- [x] Update docs/site; commit and push; publishing subagent waits exact-head CI and verifies guarded squash merges and live Netlify provenance.

## Review focus

- Crash between an external action and the next checkpoint: show last saved facts, never replay or claim completion.
- Secret values in error fields, default template options, short tokens and free-form result notes: API and journal are consistently scrubbed; journal contains no raw request.
- Corrupt journal or disk/write/rename failure: retain the previous file, show unavailability/degradation, never start unrecorded new work or break an already running command.
- Retention pressure with active jobs and huge/control-character logs: preserve active jobs and bound serialized bytes without quadratic trimming.
- Restart/deep links/offline reads: interrupted runs cannot spin forever or look freshly healthy, and read failures cannot become an empty successful list.

## Progress

- Base: app 4b086e66ec672d2dbfcac2661cbb8855a5d46d15; site a9c7bf4f791a0649e6a563a6444c04a192c98e1a.
- Previous creation-draft publication is complete (app PR #8, site PR #5, exact-head Linux/Windows CI run 41854190051 and verified Netlify deploy 6aeb4ac52aaef1b2788c45d3). Do not repeat that work.

- Independent journal review found one P2: lone-CR secrets were split differently from SSH output. Redaction now follows production CRLF/lone-CR/LF normalization. Three actual SSH-to-journal regressions observed RED then GREEN; scoped re-review approved specification and quality with no remaining material findings.
- Final consolidated verification: typecheck, all 107 tests and full production build passed. Retained-history and native-task-history browser fixtures passed on the final build, with local synthetic services only. Site presentation and companion fixtures passed.
- Latest user steering adds the separately scoped light palette/background continuity fix documented in `2026-11-04-light-theme-continuity.md`; no additional journal behavior change.

- Published: app PR #9 head `63ecc8d9ee966f88d32f6fe5bae0cddd8a22d5d7` merged as `04840dbe33a01c16328de72f0bb082e91b272c55`; site PR #6 merged as `a5f734d72ea463732f80956280bc3584b41bad9d`. Exact-head Ubuntu/Windows Node22 CI run 41899742366 passed. Netlify production `6aeb8bdd721e671d6dab812f` current at site merge, live HTML bytes equal committed content.
