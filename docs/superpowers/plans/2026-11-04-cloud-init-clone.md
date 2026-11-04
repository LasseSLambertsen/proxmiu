# Cloud-init Clone Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for one coherent task with a fresh final review and authorized publication.

**Goal:** Verify and correct the existing VM clone path without contacting a live hypervisor.

**Architecture:** Preflight source config before cloning; preserve selected placement, boot-disk identity and requested allocation through the existing job runner. Strict local HTTPS/SSH fixtures exercise the actual runner and encoding boundaries.

**Tech Stack:** Existing TypeScript/Node, ssh2, selfsigned, node:test and React; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-04-cloud-init-clone-design.md`

## Global Constraints

- No real Proxmox host, guest OS setup, paid provider calls, additional privileges or hosting project.
- Existing auth/origin/DNS protections, encrypted/redacted history and explicit reviewed provisioning remain unchanged.
- No automatic retry/cleanup/resume. Failed partial clones retain their identity for manual inspection.
- QEMU source must remain a template on the explicitly selected node with cloud-init and a determinable boot disk before clone.
- Disk GiB is a minimum; no shrinking. Configuration and required growth failures prevent VM start. Await returned task completion.
- Keep actual requested vCPU count, network options and SSH double encoding; work on Windows/Linux Node 22.

## Review Focus

- Missing/moved/non-template/LXC source and missing cloud-init must cause zero clone writes.
- Multi-disk and nonzero boot-disk indices must not resize a data disk; ambiguous selection must fail explicitly.
- Inherited sockets/VLAN/rate/firewall/MAC must not silently change requested allocation or discard unrelated network options.
- Failed clone task/configuration/growth/script must remain an error, with no premature start or false success.
- Strict fixtures must exercise production API encoding and SSH flow without executing generated setup commands or leaking credentials.

### Task 1: Clone source preflight and verified runner

**Files:** Modify `server/src/provision.ts`; optionally extract focused `server/src/vm-clone.ts`; add `server/test/vm-clone.test.ts` and fixture file(s) if needed. Change the QEMU disk field help in `web/src/pages/Create.tsx` to explain minimum size. Controller owns docs.

**Interfaces:** Consume existing `startProvision(ProvisionRequest): Job`, ProxmoxClient, encrypted history and SSH runner. Preserve public API request/response shapes; no test-only production endpoint or bypass.

- [x] Write strict local HTTPS/SSH runner regression tests for the spec and observe material old-code failures. Assert ordered calls and forbidden writes rather than only success labels.
- [x] Implement smallest coherent preflight/config/network/disk fixes. Pin actual values in tests: source node `pve1`, requested target mismatch `pve2`, boot `scsi1`, inherited sockets 2, requested cores 3, inherited VLAN removal, source 8G/request 16G and source 32G/request 16G.
- [x] Verify success through actual key-authenticated SSH protocol with generated script captured but never executed; verify nonzero script exit is error. Include DHCP and static paths.
- [x] Verify failure boundaries and existing journal/LXC compatibility. Run focused suite, typecheck, full tests/build, and relevant Create browser fixture for help text/unchanged handoff.
- [x] Write task report, generate whole-branch review package and get fresh specification/quality review; fix material findings.
- [ ] Update honest docs/roadmap, commit/push and use publishing subagent to wait exact-head Linux/Windows CI and guarded merge. Website only if needed by changed claims.

## Ledger

- Base app main `04840dbe33a01c16328de72f0bb082e91b272c55`; clean branch `fix/cloud-init-clone`.
- Previous history/theme work is published: app PR #9, site PR #6. Do not repeat it.
- Standing delegated iteration/publication authorization persists; no renewed approval gate. Controller-selected design choices are documented above, not attributed to the user.
- One coherent implementation task: no cross-task interface conflicts. Pre-existing baseline 107 tests passed at unchanged base tree.

- API investigation confirmed asynchronous POST config and PUT resize in official source; task-order regressions must cover delayed completion and failed tasks. Default source selection also needs to synchronize node/options explicitly in Create.

- Initial consolidated checks before review fixes: `npm run typecheck`, `npm test` (128/128) and `npm run build` passed. `node web/test/vm-clone.e2e.cjs` passed default/explicit source-node-options and minimum disk help; `node web/test/lynx-create.e2e.cjs` passed existing handoff/review/submit/race/390px coverage. Server tests include 21 strict HTTPS/SSH runner regressions; no generated script is executed.

- Independent whole-branch review confirmed source/disk/task/CPU/NIC improvements and found two P2 gaps: missing SSH exit status treated as success; stale source/node after QEMU/LXC or connection transitions. One consolidated test-first fix wave is in progress; see `cloud-init-clone/review-fix-brief.md`. No findings are deferred.

- Final review fix wave: both P2 findings reproduced RED→GREEN; protocol suite now23/23. Scoped re-review approved specification and quality, both findings addressed, no new material breakage. Final typecheck,130/130 tests and full build pass. Expanded browser fixture uses bounded waits for converged source/node/options rather than inspecting an intermediate React render; only the fixture changed after that timing failure. No product-source changes followed the final build.

- Final browser confirmation passed: expanded VM source/node/mode/connection/empty-catalog/direct-submit checks and existing Lynx creation/handoff/review/390px checks. One review fix wave is complete with zero remaining material findings. Publication proceeds through the already authorized PR subagent; website source is unchanged because existing generic VM claims remain accurate.
