# Guest maintenance tools implementation plan

> **For agentic workers:** Implement independent server helpers and UI surfaces in parallel under the existing approved iteration. Use test-driven development and one fresh final review.

**Goal:** Continue the user-authorized iteration with resource settings, existing backup browsing and diagnostic task logs.
**Architecture:** Keep the authenticated agent and existing React/Fastify stack. Read actual Proxmox data; no new dependencies or privileges. Resource writes require a stopped guest, no pending changes and a fresh configuration digest. Backups are read-only in this iteration. Logs are limited to tasks already tracked by this agent.
**Spec:** User instruction “Yes, and then iterate on more functions”, continuing the previously approved advanced guest workflows.

## Global constraints

- Preserve native Proxmox descriptions, auth/origin checks, encrypted secrets, typed destructive confirmations and the existing warm glass/Geist/lynx system.
- No restore/delete-backup actions, automatic shutdown/reboot, arbitrary Proxmox paths or additional Proxmox privileges.
- Drafts survive failed/stale writes and node migration. Partial permission errors are shown, never called empty success.
- 390px layouts and keyboard controls remain usable; provider advice never executes changes.

## Contracts

Base `/api/clusters/:id/guests/:node/:type/:vmid`.

`GET base/resource-settings` returns `{cores:number|null,sockets:number,memoryMiB:number|null,onboot:boolean,digest:string,status:string,pending:boolean,editable:boolean,reason?:string}`. GET reads config/status/current/pending; absent/unrecognized pending state disables edits. Unsupported dynamic memory strings remain null and cannot be silently replaced. CPU field is cores per socket (LXC sockets=1). QEMU pending read failures are errors, not assumed absent.

`PUT base/resource-settings` strict body `{cores:number,memoryMiB:number,onboot:boolean,digest:string}` returns the fresh settings. Cores 1..128, memory 16..1048576 MiB, integer values. A preflight checks digest, stopped status and no pending changes. Preserve sockets and all unrelated config. Upstream digest failure is normalized via fresh digest comparison. Reject unsafe/unsupported original config. No automatic shutdown/reboot. Changes take effect at the next full guest start; show pending/changed status if it raced with a start.

`GET base/backups?storage=ID` strict query validates the selected storage is active and backup-capable. Returns `{backups:{storage:string,volid:string,size?:number,ctime?:number,format?:string}[],errors:string[],truncated:boolean}`. Query Proxmox storage content with `content=backup,vmid=<guest>`; filter out other guests and malformed records. At most 500 newest entries, with explicit truncation. No restore/delete routes.

`GET /api/clusters/:id/tasks/:node/:upid/log?start=N` returns `{lines:{n:number,t:string}[],next:number,truncated:boolean}`. Only tracked tasks from the original cluster/node. `start` integer0..1000000, upstream `limit=200`; line numbers increase from the offset. Maximum 200 lines/response, 2000 characters/line, with truncation visible. Errors are safe text. UI loads/refreshes by cursor and bounds total display to 2000 lines, points to Proxmox for full logs. Render plain text.

## Review focus

- Another writer or guest start races with resource save: preserve draft, no auto power operations, expose changed state/pending.
- Existing QEMU pending CPU/socket/memory changes or dynamic memory configuration: edit stays disabled instead of clobbering it.
- Storage access denied or backups for another guest: clear error and no unrelated records displayed.
- Large or malicious task log text/cursors: bounded response, escaped text, cursor ownership tied to the original tracked task.
- Migration changes node while notes/resource draft/task log is open: retain identity, correct source-node task polling and no dropped drafts.

### Task 1: Resource settings API
Files: new `server/src/guest-resource-settings.ts`, `server/test/guest-resource-settings.test.ts`; routes/mock updates in index.ts and mock-proxmox.ts.
- [x] Tests first: valid stopped LXC/QEMU edits, strict bounds, pending/running block, digest conflicts including in-flight, unsupported memory, unrelated fields/sockets preserved.
- [x] Implement helpers and routes; extend mock digest/config/status/pending support.
- [x] Run tests/typecheck and authenticated integration checks.

### Task 2: Backup inventory and tracked task logs API
Files: new `server/src/guest-maintenance.ts`, `server/test/guest-maintenance.test.ts`; parent integrates routes in index.ts and mock support.
- [x] Tests first: content request scoped by guest, active storage validation, other-guest/malformed exclusion, errors, sort/cap; log cursor/line/text bounds.
- [x] Implement `loadGuestBackups(client,guest,storage)` and `loadTaskLog(client,node,upid,start)` helpers and schemas.
- [x] Verify tests and return exact integration instructions to parent. Helpers do not bypass route task ownership checks.

### Task 3: Guest maintenance UI
Files: new `web/src/components/GuestResourceSettings.tsx`, `GuestBackups.tsx`, `GuestTaskLog.tsx`; wiring GuestDetail/GuestOperations and API/query types; new `web/test/maintenance.e2e.cjs`.
- [x] Tests first against existing build: stopped settings validation/save/conflict/draft, running/pending states, backup error/empty/results, log escaped text/paging/limits, mobile.
- [x] Implement focused components using exact contracts, existing primitives and API client.
- [x] Keep resource component identity independent of node; task log uses returned task's original node.
- [x] Verify browser tests and typecheck.

### Task 4: Integration, documentation and review
- [x] Extend mock/authenticated integration coverage for actual routes and tracked-log ownership.
- [x] Update app/site feature descriptions and capture fresh mock screenshots where behavior changed.
- [x] Run complete suite, typecheck/build and relevant browser checks; fresh review; regression-test material fixes.
- [x] Commit/push updates to the already authorized GitHub branches, rewrite both PR descriptions for final scope and make ready for review. The user subsequently authorized a publishing subagent to get both PRs live; merge after green checks and verify actual production deployment.

## Completion and publication

53 tests, typecheck and production build pass. Maintenance, advanced and outage browser checks pass; site companion/layout checks pass. A fresh independent reviewer found QEMU CPU-hotplug and explicit NUMA topology risks; failing regression tests were added before read-only guards. Unsupported topology remains in Proxmox and unrelated configuration is preserved. Valid original hotplug fixture verified separately. Fresh desktop/390px captures use the actual local agent with the bundled synthetic mock; no provider calls or live hosts. The user additionally requested a subagent to get both PRs live, authorizing ready/merge/deploy after checks; the publishing agent handles expected-head squash merges and verifies Netlify production. No separate hosted app target exists, and the user’s running LAN agent is not automatically upgraded by merging source.
