# Native Proxmox task history implementation plan

> **For agentic workers:** Implement server and UI against these contracts, test meaningful failure cases, use a fresh review and delegate publication after green checks.

**Goal:** Continue the approved feature iteration with native Proxmox history in Activity and guest workspaces, including reopening task status/logs after agent restarts.
**Architecture:** Read Proxmox's active/archive task history through the existing authenticated agent. Keep temporary provisioning jobs separate. Historical tasks become eligible for the existing bounded status/log endpoints only after they appear in a validated history response; upstream permissions remain authoritative. No new dependencies, writes or role privileges.
**Spec:** User's ongoing instruction to continue iterating and publish app/site updates, retaining previous notes/AI/mascot behavior and visual system.

## Contracts

`GET /api/clusters/:id/task-history?node=NAME&start=0&vmid=100` (`vmid` optional) returns `{tasks:NativeTask[],next:number,hasMore:boolean,warnings:string[]}`. Strict query: node existing identifier syntax, start canonical decimal integer0..1e6, vmid canonical positive safe integer. Source request `/nodes/:node/tasks` with `{source:'all',start,limit:50,vmid?}`. No cross-connection aggregate.

`NativeTask` is `{upid:string,node:string,type:string,vmid?:number,starttime:number,endtime?:number,status:string,state:'running'|'success'|'warning'|'error'|'unknown'}`. Only safe native UPIDs whose node matches the requested node are accepted. No arbitrary raw fields, pid or credentials. Times are nonnegative epoch seconds within native uint32 range; missing terminal status stays unknown. OK=>success; WARNINGS prefix=>warning; nonempty terminal error=>error; no terminal status/end=>running. `status` is plain text bounded1000 characters. Invalid relevant rows are omitted with a warning, never treated as successful empty history.

Pagination advances by upstream row count (max50), not accepted row count, so malformed rows cannot trap paging. next=min(1e6,start+rawCount), hasMore only when a full50-row page was returned and cursor can advance. Upstream failures are safe errors, not empty lists. Proxmox retention/permissions bound available history.

History access cache: 30-minute TTL, max5000 entries, keyed by connection+original node+native UPID, bounded and validated again when remembering. Existing operation-started tasks stay eligible. Existing `/tasks/:node/:upid` and `/log?start=` authorize either source. Unknown IDs remain404 with guidance to refresh history; no arbitrary task paths. Removing a connection clears remembered history access.

## UI

- Activity has Proxmox tasks and Provisioning tabs; existing `/activity/:jobId` opens Provisioning and keeps all current local-job behavior.
- History selects an available connection/node, optional positive guest ID filter in Activity; guest workspace provides the current node+vmid automatically. One source is explicit at a time.
- Manual refresh resets to the newest page. Load more appends/deduplicates UPIDs; max200 displayed tasks with a clear cap. No status filters applied only to the current page while claiming a complete filtered history.
- Display operation/type, guest ID where known, date, state/result and inspect action. Poll a selected running task via its original node using the existing endpoint; show actual terminal failures, warnings and unknown states.
- Reuse GuestTaskLog for escaped, bounded, manually paged logs. Selection is keyed to connection/node/upid; stale responses from previous selections must not authorize/display another source's task. Errors keep useful data explicitly marked stale and offer retry/refresh-history recovery.
- Node/connection/guest filter changes reset list+selection; a guest migration switches its history source while existing separate operation tracking remains intact. Native descriptions/notes are unchanged.
- Preserve warm glass/amber/Geist/lynx, keyboard labels/focus and390px layouts. Distinguish Proxmox-retained history from in-memory provisioning jobs.

## Review focus

- Another node's UPID, malformed history rows, forged IDs or cache expiry: no unintended log/status access; actionable errors.
- Agent restart clears cache: fresh history read re-enables native task logs under upstream permissions.
- Active tasks can shift offset pages: deduplicate and offer newest refresh, never promise snapshot-consistent history.
- Empty, denied, stale, offline and unknown statuses stay distinct; no false success.
- Existing Activity deep links and guest drafts survive the new sections.

### Task1: Server history and access
Files: new `server/src/task-history.ts` and `server/test/task-history.test.ts`; modify index.ts/mock-proxmox.ts and authenticated integration test.
- [x] RED tests for strict params, scoped request, state normalization, malformed rows/cursor, safe errors, validated TTL/bounded access and source identity.
- [x] Implement `loadTaskHistory(client,node,{start,vmid?})`, exported `taskHistoryQuerySchema`, `TaskHistoryAccess` with remember/canRead/removeConnection methods; integrate auth and route.
- [x] Extend mock with native history (including pre-existing tasks) and actual original logs/status; integration tests prove inaccessible task before list, allowed after list, wrong-node/connection denial and restart recovery.

### Task2: Frontend
Files: new `web/src/components/ProxmoxTaskHistory.tsx`, optional helpers; api.ts/queries.ts; Activity.tsx/GuestDetail.tsx; new browser fixture.
- [x] RED fixture before component: selection/filter/page/reset, warnings/errors, state+logs and status polling, restart-like401/404 recovery, Activity deep links, mobile.
- [x] Implement the contracts, original-node status/log selection, safe state display and bounded task list.
- [x] Verify typecheck/build/browser checks and desktop390px captures.

### Task3: Review and publication
- [x] Update docs and site claims, capture native mock history screenshots.
- [x] Full suite, typecheck/build and relevant existing browser regressions. Fresh source/visual review, regression-test material fixes.
- [x] Commit/push new app/site branches, create PRs, delegate expected-head merges after CI, verify website production bytes and assets. Preserve domains/access/env. LAN-agent upgrade remains a user action.

## Completion evidence

71 tests and typecheck/full build pass. Browser fixtures cover all history, maintenance, advanced and outage cases. Review findings for native uppercase RUNNING, directory/OIDC owners and realistic offline overviews have RED-to-GREEN regressions; native unknown terminal markers remain unknown. Long native task IDs route successfully and actual agent restarts clear/re-establish scoped access. Public desktop/390px captures use the actual local agent with the bundled synthetic mock, and were visually inspected. Publishing is delegated to a subagent for exact-head CI-gated merges and production verification; LAN-agent upgrades remain a user action.
