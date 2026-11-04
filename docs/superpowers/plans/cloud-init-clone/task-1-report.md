# Task 1 implementation report

Status: implementation and focused server verification complete. Controller owns consolidated full suite/build, fresh review, browser GREEN, commit and publication.

## Root causes and resulting contracts

- The runner searched cluster resources by VMID alone and reassigned the requested node. It now reads current cluster resources and source config immediately before clone, requires a QEMU template on the explicitly selected node, checks the config template flag and a cloud-init volume, and resolves/validates the boot disk and size before any clone write. Missing, moved, LXC, non-template, missing-cloud-init and ambiguous/missing boot sources fail with actionable diagnostics.
- The old disk search only considered index zero, always requested an absolute resize, and caught every resize error. The new resolver supports `scsiN`, `virtioN`, `sataN`, `ideN`; modern disk boot order precedes legacy `bootdisk`, with exactly one data disk permitted as the implicit fallback. CD-ROM and cloud-init volumes are excluded. The selected source disk key is retained and its fresh clone size checked: only a smaller disk grows. Larger/equal disks receive no resize call. Unknown source size fails preflight; unknown/missing clone disk fails before configuration/start.
- Source CPU topology and online CPU count were inherited. Configuration now sets sockets=1, cores=requested cores and vcpus=requested cores (fixture: inherited sockets=2/vcpus=1, requested cores=3).
- The network rewrite dropped rate/firewall/other settings and could retain an inherited VLAN. One config write now uses the fresh clone NIC, preserves model/MAC and unrelated options, replaces bridge and VLAN settings (`tag`/`trunks`), and removes inherited VLAN settings for an untagged request.
- Official API behavior identified by the controller: config POST can return a task UPID (or finish synchronously), resize PUT returns a task UPID. The runner awaits returned config tasks and required resize tasks before start; task/HTTP errors propagate instead of being swallowed. Clone task/config/resize failures leave the partial identity in existing encrypted/redacted job history, with no cleanup, retry, VM start or SSH installation.
- Default QEMU source selection in Create set only the VMID, leaving the disabled Node selector on another node. It now sets the visible node from the default source, allowing existing query keys to refresh that node's storage/bridge options. The QEMU disk field explains minimum-size behavior. Existing ordinary submission and Lynx-only acknowledgment behavior remain unchanged.

## Files owned/changed

- `server/src/provision.ts`: fixed clone pipeline; existing request/job interfaces, LXC branch, SSH encoding and script runner retained.
- `server/src/vm-clone.ts`: focused preflight, boot-disk/size and NIC helpers.
- `server/test/fixtures/vm-clone.ts`: strict local HTTPS API plus key-authenticated SSH2 server; ephemeral loopback listeners and temporary self-signed EC TLS; only test code routes guest SSH to the local fixture.
- `server/test/vm-clone.test.ts`: 21 protocol regressions through actual `startProvision`, real stored encrypted connection and real `ProxmoxClient`; isolated DATA_DIR before production imports and cleanup after journal flush.
- `web/src/pages/Create.tsx`: default source/node synchronization and QEMU disk minimum help only.
- `web/test/vm-clone.e2e.cjs`: local browser/API fixture for default source placement, refreshed node storage/bridge options, explicit source changes, minimum help and explicitly submitted request.
- `server/dev/mock-proxmox.ts`: clone-related parity: source template flag, inherited allocation, persisted clone config fields, asynchronous config/resize UPIDs, disk growth/no-shrink behavior.

## RED → GREEN evidence

All network/browser commands used authorized local fixtures and `sandbox_permissions=require_escalated`; no real hypervisor, provider, download or generated setup execution.

1. `node --import tsx --test server/test/vm-clone.test.ts` on unchanged production runner: **15 tests, 4 passed / 11 failed**, 3.53s. Material failures: missing sockets reset, attempted shrink of 32G source to 16G, successful jobs for moved/LXC/non-template/no-cloud-init/ambiguous/missing boot/unknown size sources, swallowed resize failure. Existing missing-source, clone-task/config-HTTP and nonzero-script boundaries already passed. This first fixture version returned synchronous config/resize responses to isolate those original defects.
2. Same command after modeling official asynchronous config/resize responses, still unchanged production runner: **17 tests, 3 passed / 14 failed**, 1.63s. It attempted the next config read before the pending config task finished. Fixture tasks enforce running→stopped state and reject dependent reads/writes/start while a task is pending.
3. `node --import tsx --test --test-name-pattern='boot resolution|equal-sized' server/test/vm-clone.test.ts` before production changes: **4/4 failed**, 0.86s (unawaited async config boundary).
4. `node web/test/vm-clone.e2e.cjs` against pre-change built UI: **expected RED**, default source 900 on pve1 left visible node pve2 (`'pve2' !== 'pve1'`). Initial fixture-only setup errors were corrected (overview response structure, complete template fields, ordinary explicit submission without a Lynx-only checkbox) before relying on this assertion. No UI implementation was changed until the intended placement mismatch was reproduced.
5. After implementation: `node --import tsx --test server/test/vm-clone.test.ts`: **21/21 passed**, 26.58s. Includes selected node pve1 versus requested mismatch pve2, boot scsi1 with data scsi0, source 8G/request16G and 32G/request16G, equal fresh clone size, boot precedence, nonzero SATA/VirtIO and MiB/TiB units, source rejection with zero clone writes, DHCP/static cloud-init, preserved current clone model/MAC/options, inherited VLAN removal/replacement, exact CPU topology, real double-encoded SSH keys, ordered task completion, task and HTTP failure boundaries, captured SSH stdin/synthetic stdout/stderr and nonzero script exit, retained encrypted/redacted partial journal identity.
6. `npm run typecheck`: **passed**, exit 0 (server and web).
7. `node --import tsx --test server/test/job-history-runner.test.ts`: **passed**, exit 0, 0.42s. Existing runner registration/LXC failure/redaction/update history coverage retained.
8. `npx tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --noEmit server/test/vm-clone.test.ts server/test/fixtures/vm-clone.ts server/dev/mock-proxmox.ts`: **passed**, exit 0. Its first run found fixture-only implicit-any/readonly/assert-message typing issues; these were corrected without runtime behavior changes, then rerun successfully. No dependencies installed.
9. `git diff --check` and `node --check web/test/vm-clone.e2e.cjs`: **passed**.

## Remaining verification / limits

- Controller should build once, then run `node web/test/vm-clone.e2e.cjs` for browser GREEN and existing `node web/test/lynx-create.e2e.cjs` for handoff compatibility. Browser fixture uses existing Playwright/Chromium; no package install is required in this environment. It intentionally intercepts provisioning and returns a fixture error after capturing the explicitly submitted payload.
- Controller owns final full tests/build, source/spec/quality review and exact-head Linux/Windows CI. This worker did not duplicate them or commit/push.
- These fixtures prove application protocol behavior. No actual clone disk, cloud-init boot, guest OS installation, hypervisor-specific storage behavior, real SSH command execution or Windows runtime has been validated here.
- No installer script runs in the SSH fixture: it buffers stdin, emits synthetic output and chosen exit status. The generated script is only inspected as captured payload. Existing production SSH retries/network deadlines are unchanged; successful fixture paths finish within the test's ten-second per-job observation bound, while configuration/resize task transitions use the existing short 1.5-second production polling interval.

## Consolidated review fix wave

The independent review identified two material P2 gaps. Both were reproduced before production fixes; no unrelated changes or additional full suite/build runs were made by this worker.

### SSH completion requires an explicit status

- Root cause: shared `runScript` resolved `code ?? 0` on channel close, treating signal termination and omitted exit status as success.
- Changed `server/src/ssh.ts` only in the script channel close handler: signal termination rejects with its signal, missing/non-numeric status rejects with an honest exit-status diagnostic, numeric status passes through to the existing caller. Existing callers require numeric zero for success and preserve explicit nonzero errors. Interactive terminal behavior is unchanged.
- Extended the authenticated SSH fixture with synthetic `exit-signal` packets and channel closure without `exit-status`; neither case executes or kills a real command. New runner assertions require error status, no success result or “All done.”, captured script, authenticated app key and retained partial identity in the journal.
- RED: `node --import tsx --test --test-name-pattern='SSH signal|SSH no-status' server/test/vm-clone.test.ts` produced **0/2 passed, 2 failed**, 7.09s. Both returned `success` where `error` was required.
- GREEN: `node --import tsx --test server/test/vm-clone.test.ts` produced **23/23 passed**, 32.70s, including numeric zero, numeric nonzero, signal and missing-status paths.

### Source selection remains coherent across transitions

- Root cause: default synchronization ran only when `sourceVmid` was empty; returning from editable LXC placement or changing connections retained a source VMID detached from the current node/catalog. Native select UI could display the first new option even while React retained the old submitted ID.
- Create now resets the source on connection changes, preserves a still-valid selected source across kind changes, chooses an available source if the catalog changes, clears an empty catalog and always synchronizes QEMU node from the selected source. Existing node query keys refresh storage/bridge options.
- Both `canSubmit` and the actual form submit handler validate the selected source against current loaded options and displayed node, with no pending/error options fetch. Programmatic stale/missing-source submissions are refused with actionable feedback and the draft remains editable. Ordinary explicit submit and Lynx review behavior remain intact.
- Expanded `web/test/vm-clone.e2e.cjs`: QEMU→LXC→pve2→QEMU; second connection whose only source is 902 on pve2; inspected explicitly submitted source/connection/node; empty catalog disables Create and refuses programmatic submission; recovered valid source and explicit submission. The test also checks the new actionable feedback. Request-response barriers avoid mistaking an earlier fixture error for the latest captured submission.
- RED: `node web/test/vm-clone.e2e.cjs` against the pre-fix built UI collected four intended failures: source900 left on locked pve2 after the kind round trip; new connection submitted stale source instead of902; empty catalog left Create enabled; programmatic submission sent a stale source. The Connection locator was corrected from exact to prefix label before this material RED (the native select accessible name includes its option text).
- Final browser GREEN is handed to the controller with the final web build, as requested. No worker rebuild or duplicate full suite.

Additional checks after these changes: `npm run typecheck` passed; strict `npx tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --noEmit server/test/vm-clone.test.ts server/test/fixtures/vm-clone.ts` passed; browser fixture syntax and diff whitespace checks passed. The new tests remain local-protocol/browser-fixture verification, without claims of real guest execution.

### Final browser fixture synchronization correction

The controller's final full suite (130/130), typecheck and build passed, but the expanded browser fixture read Node immediately after switching back to QEMU. `source.waitFor()` merely observed the already-attached source selector; the React effect and resulting node-options query had not necessarily finished. `/tmp/vm-clone-final-browser.log` recorded only this immediate node observation as failing.

Changed **only** `web/test/vm-clone.e2e.cjs` and this report: its bounded `waitForPlacement` observes the exact expected source VMID, selected node, node-specific storage and bridge, and enabled submission after effects/options settle. It runs before initial/default, kind-transition, connection-transition and final explicit-source assertions. No source mutation/recovery occurs during that wait. A persistent old-code source900/pve2 mismatch therefore cannot pass: the required source900/pve1/source-storage/vmbr-source form never appears and the wait fails after five seconds. Submitted-payload and empty-catalog guards remain asserted separately.

`node web/test/vm-clone.e2e.cjs` against the controller's existing final fixed build: **PASS**, exit 0 — QEMU source/node sync across mode/connection/empty catalogs, node options, disk minimum help and explicit request. This confirms the source converges and the previous failure was fixture timing, so no production change or rebuild was made. Existing Lynx browser verification remains controller-owned; no full suite was repeated.
