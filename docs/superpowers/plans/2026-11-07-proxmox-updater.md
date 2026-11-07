# Proxmox Host Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development, with four sequential implementation tasks and independent task gates, followed by whole-branch security review and the authorized publishing subagent. Controller owns project/release/website documentation.

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

### Task 1: APT plan, freshness policy and locked v3 guard engine

**Files:** Create `scripts/host-updater-apt.py` and `scripts/tests/test_host_updater_apt.py` only. Report `.superpowers/sdd/proxmox-updater/task-1-apt-report.md`. This replaces the blocked combined helper task; preliminary tests are saved in the ignored workspace, not working coverage.

**Interfaces:** Importable Python module, no executable RPC/host CLI. Define a fixed-production `AptContext` with injected runner/layout/clock/events for tests and a safe `UpdaterError(code,message)`; document exact concrete internal API for the next worker. Expose inspect_host(ctx), build_plan(ctx,plan_id,clock,boot_id), validate_plan(ctx,record,clock,boot_id), apply_plan(ctx,record,job_id,clock,boot_id), guard(ctx,record,VERSION3_stream,clock,boot_id), and verify_installed(ctx,record). The private record contains public Plan plus freshness/monotonic/boot inputs; private values never enter RPC output. Generated job paths and guard executable are fixed in production context, never request-controlled. Main runtime (Task2) persists records and invokes this API; engine never enrolls keys or launches systemd. It implements all package/source/config/actual-archive safeguards in binding spec, including final effective hook policy. Read official APT2.6.1/3.0.3 source/docs rather than guess the action grammar. Runtime dispatch is a later task.

- [ ] Write behavioral RED cases before engine code: supported/unsupported/mixed host/source/config policy, readonly inspect, refresh failure, dpkg/holds/removal/downgrade/major blocks, arch:all, size budgets, freshness at preview/worker/locked guard, VERSION3 actions/archive exact match and malformed/extra/missing/unreviewed configure/removal, safe cache paths, original hook preservation/order/options, Pre-Invoke rejection/Binary overrides, exact version targets and postinstall health. Runner is synthetic and no actual APT command executes.
- [ ] Run `python3 -m unittest discover -s scripts/tests -p 'test_host_updater_apt.py'` RED, implement spec incrementally, run GREEN and py_compile. Review generated APT config/argv by executing the consumer against controlled fixture tools, not source-text snapshots. Explain any unsupported configuration as a fixed safe refusal, never omit a required guard.
- [ ] Run required project typecheck/fulltests/build and commit task-owned files only. Report exact API/data shapes, RED/GREEN and coverage/limits; root independent task review gates Task2. No subagents/real commands.

### Task 2: Durable restricted RPC and worker runtime

**Files:** Create `scripts/host-updater.py`, `scripts/host-updater-apt-guard.sh`, `scripts/tests/test_host_updater_runtime.py` only. Consume Task1 engine as a fixed protected installed module; do not edit it without root coordination. Report `.superpowers/sdd/proxmox-updater/task-2-runtime-report.md`.

**Interfaces:** Exact protocol1 spec, --rpc --node, --worker ID and --guard ID CLI entry points. VERSION3 wrapper passes only strict job ID and execs absolute Python -I. Task1 report/source defines AptContext/record/engine calls; use those exact interfaces. Root state atomically persists private plans/jobs/admission/consumption/boot/unit, public results strictly bounded. Admission/operation/short-state ownership must allow live status and guard progress without lock deadlock. No enrollment operations or client env/path/commands.

- [ ] Write RED fake-engine/systemd/clock/filesystem cases for strict JSON/duplicate keys/64KiB/deadline/argv/node binding, every request/result state, readonly inspect, admission races, stale/consumed plans, failed persistence/unit launch, responsive polling, agent/SSH/host disconnection and reboot, interrupted/unknown unit evidence, no replay/false success, final version validation and event/job budgets. Temporary layouts only; CLI exposes no test escape.
- [ ] Implement runtime and wrapper; run `python3 -m unittest discover -s scripts/tests -p 'test_host_updater_runtime.py'` GREEN plus engine tests, py_compile, ShellCheck/syntax, required project checks. Commit owned files, exact report and independent review before Task3.

### Task 3: Root enrollment installer and helper test bridge

**Files:** Create `scripts/install-host-updater.py`, `scripts/tests/test_host_updater_installer.py`, `server/test/host-updater-helper.test.ts`. Report `.superpowers/sdd/proxmox-updater/task-3-installer-report.md`.

**Interfaces:** Root manual installer --public-key and optional trusted --ref(default main); immutable bundle downloads include scripts/host-updater.py, scripts/host-updater-apt.py and guard wrapper. Verify root/Proxmox/node/sshd/pin prerequisites without changing sshd or Proxmox role. Exact isolated forced command node-bound, dedicated key, cluster-safe preservation/reconciliation and fixed installed paths from spec. Public setup output node/fingerprint/protocol only. Source/input paths cannot be overridden through production env/test flags. Linux Node test bridge runs all host_updater unittest files as part of normal npm test; explicitly skip on Windows.

- [ ] Write RED real temporary-filesystem/fake-source/sshd/PVE-lock-tool cases for protected ownership/modes, no-general-shell enrollment, node binding/shared Proxmox symlink/local file, duplicate/conflicting authorization, concurrent changes/no quorum, idempotence, pinned immutable bundle and download failure. Exercise actual installed Perl lock/write consumer using a controlled stub module where feasible, never real root keys/systemd/APT. No snapshot-only tests.
- [ ] Implement and run installer tests GREEN plus all Python helper tests, Node bridge, compilation/wrapper checks and required project checks. Commit owned files and report. Root independent enrollment security review gates app integration.

### Task 4: Agent enrollment/transport/API, node Updates UI and recovery links

**Files:** Create `server/src/host-updates.ts`, `server/src/host-updater-ssh.ts`, `server/test/host-updates.test.ts`, `server/test/host-updater-ssh.test.ts`, `web/src/pages/HostUpdates.tsx`, `web/src/lib/host-updates.ts` and `web/test/host-updates.e2e.cjs`. Modify `server/src/store.ts`, `server/src/index.ts`, `web/src/App.tsx`, `web/src/pages/Overview.tsx`, `web/src/pages/Settings.tsx`, and `web/src/lib/api.ts` only as needed. Report `.superpowers/sdd/proxmox-updater/task-4-report.md`. Root owns README/project/design/release/site copy.

**Interfaces:** Consume Tasks1–3 protocol unchanged. Export typed `invokeHostUpdater(config, request)` from dedicated transport, never generic command execution or insecure guest SSH. Store private keys encrypted; public target/config revisions and persisted plan/job bindings drive routes specified in spec. POST/setup is idempotent key preparation; private key never returns. Configuration handshake may persist a verified node/protocol/machine identity with ready=false to show safe remediation, but no operation bypasses readiness. DELETE/configuration takes `{confirmNode}` (api.del may accept optional JSON body backward-compatibly), only after terminal work; pending changes/invalidation enforce exact target. Global host-updaters list backs Settings route links even during inventory outage.

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

- Scope correction after first combined worker BLOCKED: no production code/commit existed, only three missing-file scaffolding REDs. Preserved them in ignored preliminary/. Split into independently rejectable APT engine, runtime, installer and UI tasks; stronger architecture-capable engine implementer. No relaxed guard or claim of coverage. Original combined worker is complete/inactive.
