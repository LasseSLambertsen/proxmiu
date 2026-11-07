# Proxmox Host Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development, with two sequential implementation tasks and independent task gates, followed by whole-branch security review and the authorized publishing subagent. Controller owns project/release/website documentation.

**Goal:** Explicitly check, review and install same-major Proxmox host updates from Proxmiu using narrowly enrolled access.

**Architecture:** A root-owned forced-command Python helper provides durable checked/reviewed APT operations; a dedicated per-node pinned SSH key binds the agent to that host. A node Updates page and Settings recovery links expose setup, full plans, typed confirmation and real status without granting broader Proxmox API privileges.

**Tech Stack:** Existing Node/Fastify/React/Zod/ssh2/encrypted store, Python3.11+ stdlib, Linux systemd/APT. No new runtime dependency or provider call.

**Spec:** `docs/superpowers/specs/2026-11-07-proxmox-updater-design.md` (binding; includes the exact protocol/guards/bounds).

## Global constraints

- No real host commands, key installation, APT refresh/install, migration or reboot in development tools/tests. Only synthetic/temp fixtures. Actual enrollment and package application remain explicit future user actions.
- Normal Proxmox role, guest SSH key and existing SSH/console/self-update behavior remain unchanged. No Sys.Modify/Sys.Console grant or unrestricted root access. Per-node dedicated key, strict raw ed25519 pin, forced node-bound RPC, root paths/env/interpreter.
- Root protocol1 exact verbs inspect/check/status/apply;32-hex IDs,64-hex digest,64KiB input/256KiB output,96KiB complete plan/2000 packages,600s expiry,500 event lines/128KiB/2048 chars,20 completed jobs. No truncated plan authorized.
- Fixed same-major Proxmox8/Bookworm or9/Trixie updates only. No removals/downgrades/held override, repo edits, insecure installs, automatic repair or reboot. Exact reviewed actual v3 APT actions/archives guarded before any package/config scripts; preserve existing hooks and reject earlier Pre-Invoke.
- Durable atomic admission/consumption/systemd jobs, live nonblocking status and honest lost-unit/boot/connection recovery. Agent-global persistent exclusion stays held while admitted work is unresolved; no auto replay or misleading cancellation.
- Strict bearer/origin/DNS/API schemas, fresh node for new actions, offline pinned status recovery. Private keys encrypted and never exposed, fixed safe diagnostics only, no AI/history/browser-storage sharing, demo pin/mascot/hosting unchanged.
- Existing warm glass/Geist/focus/390px themes; bounded UI visual cycle. Full typecheck/tests/normal+demo builds and Linux helper tests/ShellCheck before completion; exact-head Ubuntu+Windows CI before merge.

## Review focus

- APT solver/config/repository/dpkg/hold state changes between preview, admission and locked execution: no unreviewed action or config script may run.
- Shared Proxmox authorization, dangerous accepted SSH env, key duplicates/rotation or mismatched node/host pin: no broader shell or cross-node authority.
- Agent/browser/SSH/host restart, launch handoff or uncertain unit evidence: no duplicate work, lost global exclusion, false success or blocked live status.
- Malformed/oversized RPC/action/archive plans and persistence failures: fail before host effects and never authorize a partial review list.
- Target/agent/config changes or Proxmox API outage during accepted updates: status remains reachable, old callbacks/plans cannot apply to a replacement target.

### Task 1: Root helper, guarded APT execution and enrollment installer

**Files:** Create `scripts/host-updater.py`, `scripts/host-updater-apt-guard.sh`, `scripts/install-host-updater.py`, `scripts/tests/test_host_updater.py`, `scripts/tests/test_host_updater_installer.py`, and `server/test/host-updater-helper.test.ts` to run Unix helper tests in normal Linux npm test (explicitly skip on Windows). Do not edit other app source. Report `.superpowers/sdd/proxmox-updater/task-1-report.md`.

**Interfaces:** Host installation paths, exact requests/responses/info/job/plan shapes in binding spec. Guard wrapper executable path and VERSION3 contract are shared with the worker; RPC uses --rpc --node, worker/guard use generated strict IDs. Installer accepts `--public-key` and optional trusted `--ref` (default main), verifies root/Proxmox/sshd and node-bound authorization; resolves trusted project source to one immutable commit before downloading helper+wrapper. Outputs public node/fingerprint/protocol/setup result only. Imported Python functions may accept internal Layout/runner/clock dependencies for tests; production CLI offers no test-root/env/command override.

- [ ] Write meaningful RED helper/installer cases against missing implementation: strict protocol/target/env/sshd, read-only inspect, refresh+simulation, source/dpkg/hold/major policy, full v3 stream/archive allowlist, all freshness race stages, existing hook preservation/order, state limits, failed admission and systemd/boot/timeout recovery. Installer tests preserve ordinary/shared keys, root ownership policy, node binding, conflicting duplicates/no quorum and explicit idempotence. No real root paths or package commands.
- [ ] Run `python3 -m unittest discover -s scripts/tests -p 'test_host_updater*.py'` and observe intended failures. Implement exact spec, settle APT2.6/3.0 v3 semantics from official source/docs; fixed argv only. Keep raw diagnostics out of managed events; use fixed codes. Run focused tests GREEN plus Node bridge test, py_compile, ShellCheck/syntax of wrapper and required project checks. Expected all pass; report unsupported host configurations explicitly.
- [ ] Self-review and commit only task-owned product/test files after required full project checks. Append detailed report with RED/GREEN commands/results, actual fixtures, remaining limits and exact commit. No subagents; no actual installation/enrollment. Root dispatches independent helper security review before Task2.

### Task 2: Agent enrollment/transport/API, node Updates UI and recovery links

**Files:** Create `server/src/host-updates.ts`, `server/src/host-updater-ssh.ts`, `server/test/host-updates.test.ts`, `server/test/host-updater-ssh.test.ts`, `web/src/pages/HostUpdates.tsx`, `web/src/lib/host-updates.ts` and `web/test/host-updates.e2e.cjs`. Modify `server/src/store.ts`, `server/src/index.ts`, `web/src/App.tsx`, `web/src/pages/Overview.tsx`, `web/src/pages/Settings.tsx`, and `web/src/lib/api.ts` only as needed. Report `.superpowers/sdd/proxmox-updater/task-2-report.md`. Root owns README/project/design/release/site copy.

**Interfaces:** Consume Task1 protocol unchanged. Export typed `invokeHostUpdater(config, request)` from dedicated transport, never generic command execution or insecure guest SSH. Store private keys encrypted; public target/config revisions and persisted plan/job bindings drive routes specified in spec. POST/setup is idempotent key preparation; private key never returns. Configuration handshake may persist a verified node/protocol/machine identity with ready=false to show safe remediation, but no operation bypasses readiness. DELETE/configuration takes `{confirmNode}` (api.del may accept optional JSON body backward-compatibly), only after terminal work; pending changes/invalidation enforce exact target. Global host-updaters list backs Settings route links even during inventory outage.

- [ ] Write real-agent/local SSH/Proxmox fixtures RED before source: strict pin/node/protocol/output bounds, no private-key leakage, idempotent setup, encrypted restart, save failure, configuration/plan binding, typed confirmation, exact RPC and offline known-job recovery. Test agent-global exclusion across restart, lost reply/unknown state, target removal/deletion blocks, stale/config change, auth/origin/DNS and no mutation retry.
- [ ] Implement modules/routes/store on existing patterns; preserve old serialized state and existing app-key behavior. Live check/apply admissions validate fresh online node; inspect/status do not depend on an available Proxmox API for already configured targets. Persist root review binding before enabling install and reservations before remote admission; unknown accepted outcomes remain blocked/recoverable. Run API/transport tests GREEN and required full checks before commit.
- [ ] Write browser feature RED, then implement Updates page+node menu+Settings list, enrollment command/key/pin, busy/stale/offline/setup/error/interrupted, full package additions/versions/expiry, typed node confirmation, durable status/event truncation and advisory reboot text. No automatic start/retry, never conflate Close with cancellation; agent changes discard old context. Test both actual desktop/mobile layout, keyboard/focus and target changes with mocks; support one opt-in light/dark screenshot batch. Run browser, typecheck and full checks, report honest synthetic limits and commit task-owned source only.
- [ ] Root independent task/whole-branch security+quality review, material regression fixes, final build/test/visual/ShellCheck, accurate setup/docs/site copy and exact-head CI-gated publication. No real-host verification claim.

## Ledger

- Base/main f53cf05d766a5042b71c1e45a3a5fd422f37c1da, tree c40e079cf1da0a5eafa5df348f8ca305930896ff, clean feature branch feat/proxmox-updater. Baseline170/170 and Ubuntu/Windows CI already verified on identical source; no redundant baseline suite. Root docs/.gitignore are the only initial uncommitted changes.
- User explicitly chose review/install; root chose narrow opt-in helper architecture and conservative no-removal/no-major/no-reboot policy. Standing delegated iteration/publication applies; actual root setup/update never runs in this environment. No repeated design/merge permission gate.
- Cloud readiness current, HTTP policy enforced; no real-host secrets/VPN configured. New workspace `.superpowers/sdd/proxmox-updater` is git-ignored. Cloud skill helper launchers have no local path; equivalent direct brief/ledger files used, not guessed script paths. Existing Impeccable launcher unavailable earlier in session; preserve read project/design context and use bounded tests/visual pass.
- Builder `/root/updater_design_check` checked official APT2.6.1/3.0.3 docs/source and Proxmox auth/cluster-lock behavior read-only. Eight concrete design clarifications incorporated: late ordered VERSION3 hook overlay and early-hook rejection, locked freshness/archive actions, hash inputs/arch:all, isolated Python/sshd env policy, shared key/node/cluster locking, durable admission/recovery, serialized plan budget/fixed diagnostics, agent target bindings. No user-only unresolved question. Supplement: live status cannot deadlock behind worker lock; Settings recovery links remain available during API outage.
- Pre-flight Task1→Task2: protocol1 shapes, exact host paths/node binding and budgeted JSON are binding; transport/API consume them without inventing commands. Task1→Task2 installation command uses trusted immutable bundle and dedicated key. Task2→Task1 job/plan handles remain opaque; no user package/argv input. No overlapping implementation files; tasks sequential and task1 security gate precedes task2.
