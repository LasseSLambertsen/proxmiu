# Advanced Proxmox workspace implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement and verify the server; independent app and presentation surfaces may use parallel agents. Steps use checkbox syntax for tracking.

**Goal:** Deliver the approved snapshots, backups, migration, Proxmox notes, encrypted AI advice, and visible mascot in both repositories.

**Architecture:** Retain the authenticated LAN agent and existing React/Fastify stack. Guest operations go only through the agent and return Proxmox task IDs whose actual status is polled. AI sends a minimal numeric inventory only after a user requests a review; no actions are executed from AI output.

**Tech Stack:** TypeScript, Fastify, Zod, React, TanStack Query; static HTML/CSS presentation site.

**Spec:** User-approved direction in this conversation, recorded below.

## Global constraints

- Preserve warm glass, amber, Geist and lynx identity, phone layouts at 390px, keyboard controls and reduced motion.
- Existing authentication, origin restrictions, encrypted secrets, and typed destructive confirmations remain mandatory.
- Notes are Proxmox descriptions with digest-based concurrency checks. Legacy agent notes remain recoverable and never overwrite Proxmox notes automatically.
- Support OpenAI and Anthropic via fixed HTTPS endpoints, with encrypted tokens, redacted responses/errors, timeouts, bounded input/output and explicit consent per review.
- New privileges: VM.Config.Options, VM.Snapshot, VM.Snapshot.Rollback, VM.Backup, VM.Migrate, Datastore.AllocateSpace. Existing installations need an administrator to update the role; no automatic escalation.

## Review focus

- Notes changed in Proxmox after loading: reject stale digest, preserve draft, offer reload.
- Proxmox rejects a section or operation: usable sections stay visible; never turn a denied read into an empty-success claim.
- Tasks fail after being accepted: display exitstatus, never announce completion from a POST alone.
- AI outage/invalid response: show actionable sanitized errors; no credential or guest note leaves the agent.
- Mobile forms, long names and keyboard-only actions: no clipped controls, typed confirmation for rollback/delete.

## Contracts

Guest base is `/clusters/:id/guests/:node/:type/:vmid` under `/api`.
- `GET base/notes` → `{notes:string,digest:string,legacyNotes?:string}`; `PUT base/notes` body `{notes:string,digest:string}` → same fresh result.
- `GET base/operations` → `{snapshots:{name:string,description?:string,snaptime?:number}[],storages:string[],targets:string[],errors:string[]}`.
- `POST base/operations` strict discriminated body: `{action:'snapshot',name:string,description?:string}` | `{action:'rollback'|'delete-snapshot',name:string,confirm:string}` | `{action:'backup',storage:string}` | `{action:'migrate',target:string}` → `{upid:string,node:string}`. `confirm` is the guest name or ID, server-checked. Snapshot names start with a letter, letters/digits/underscore/hyphen, maximum 40; reserve current.
- `GET /clusters/:id/tasks/:node/:upid` → `{status:string,exitstatus?:string}`. Only app-issued tasks are available; key bound to cluster and node.
- `GET /ai/settings` → `{configured:boolean,provider:'openai'|'anthropic',model:string}`. `PUT /ai/settings` body `{provider,model,token?:string}` → redacted settings; missing token preserves existing only for same provider. DELETE removes token.
- `GET /ai/context` → `{clusters:{nodes:{cpu?:number,maxcpu?:number,mem?:number,maxmem?:number}[],guests:{type:string,status?:string,cpu?:number,maxcpu?:number,mem?:number,maxmem?:number,disk?:number,maxdisk?:number}[]}[],unavailableConnections:number}`. No names, IPs, credentials, descriptions, configuration, logs or identifiers.
- `POST /ai/review` body `{consent:true,context:<exact preview>}` → `{advice:string}`. Validate whitelist and numeric bounds; do not trust client extras. Fixed provider URLs and no tools.

### Task 1: Server operations and notes
Files: create `server/src/guest-operations.ts`, `server/test/guest-operations.test.ts`; modify `server/src/index.ts`, `scripts/proxmox-install.sh`, `server/dev/mock-proxmox.ts`.
- [x] Write and run failing tests for notes clearing, stale digest, strict actions, target validation, task failures and partial reads.
- [x] Implement contracts, guarded task tracking and mock support.
- [x] Run server tests and typecheck; document required role updates.

### Task 2: AI server and settings
Files: create `server/src/ai.ts`, `server/test/ai.test.ts`; modify `server/src/store.ts`, `server/src/index.ts`.
- [x] Write failing tests for encrypted storage/redaction, provider changes, data minimization, consent, provider errors and invalid responses.
- [x] Implement settings, numeric context and advice with timeout and concurrency limits.
- [x] Verify all tests and typecheck.

### Task 3: App workspace and advisor
Files: new focused components in `web/src/components`, modify `GuestDetail.tsx`, `Settings.tsx`, `queries.ts`, `api.ts`, add browser test.
- [x] Implement notes conflict recovery and explicit legacy-note recovery.
- [x] Add snapshot/backup/migration controls, confirmations and actual task polling.
- [x] Add encrypted token settings, preview/consent and plain-text advice display.
- [x] Exercise notes save/clear/conflict, operation failure/completion, credential removal and AI errors in browser.

### Task 4: Mascot and presentation
Files: shared lynx script, `Layout.tsx`, site HTML/CSS/README/tests, documentation.
- [x] Make companion discoverable by a visible keyboard-accessible single-click control, preserving logo Easter egg and dismissal/reduced motion.
- [x] Add mascot-led content and accurate feature/privacy copy to website; retain current branding and links.
- [x] Verify desktop/mobile views and existing mascot tests.

### Task 5: Integration and review
- [x] Run `npm run typecheck`, `npm test`, `npm run build`; browser checks at desktop and 390px, plus site checks.
- [x] Fresh review across both repositories, fix material findings, update docs/screenshots.
- [x] Commit both repositories, push feature branches and open reviewable PRs if connected credentials permit. Do not merge or claim a live deployment without evidence.

## Completion evidence

32 server/domain tests pass; typecheck and full production build pass. Advanced/outage/companion browser checks and website desktop/mobile checks pass. Independent server and frontend reviews produced regression-tested fixes for HA wrapper tasks, in-flight note conflicts, and task tracking through node changes. ShellCheck 0.10.0 and bash syntax checks pass. See `docs/releases/2026-11-03-advanced-workspaces.md` for the complete behavior and limits. Source and screenshots are prepared for app and site pull requests; no main-branch merge or production deployment is claimed.
