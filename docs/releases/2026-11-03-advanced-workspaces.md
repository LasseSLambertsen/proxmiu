# Advanced workspaces, native notes and optional AI advice

Approved scope: guest snapshots, on-demand backups, migration, existing Proxmox notes, an optional provider token for setup advice, and a more visible lynx in the app and presentation site.

## Product choices

Use guest-level controls within the existing workspace rather than add cluster administration. Create/delete/rollback snapshots, start snapshot-mode Zstandard backups to eligible storage, and migrate to another online node. Typed guest-name confirmation protects rollback and deletion. Track actual Proxmox task status, including failure, from the original source node. HA-managed migrations are left to Proxmox HA controls because their wrapper task only acknowledges an HA request.

Read and write native guest descriptions with configuration digests. Preserve unsaved drafts during outages/conflicts; normalize a changed digest after a failed PUT to a conflict. Keep legacy agent notes recoverable by explicit copy into a draft, never an automatic overwrite. Pins remain on the agent.

Support OpenAI and Anthropic through fixed HTTPS endpoints, using the agent's existing AES-256-GCM credential store. Settings only return configured/provider/model. Providers can be changed only with a replacement token. The user previews and explicitly sends the same anonymous numeric context for each review. Names, addresses, notes, configuration, credentials and logs are excluded. Advice is plain text and cannot execute infrastructure changes. Input/output sizes, transport timeout, redirects, concurrent reviews and rapid retries are bounded.

Make the existing lynx discoverable through a companion button, preserve logo activation, keyboard focus return, dismissal and reduced motion, and reuse its art in Settings and the website hero. Retain the existing amber, Geist and warm glass visual system.

## Verification

- Server unit tests exercise notes clearing, preflight and in-flight digest conflicts, permission failures, validated operations, HA migration exclusion, correct QEMU/LXC migration flags, partial-read errors and failed task results.
- AI unit tests cover encryption/redaction/removal, provider changes, context minimization and strict consent, fixed transport targets, provider failures, bounded advice and invalid responses.
- An authenticated integration test runs the actual agent against the bundled HTTPS Proxmox mock. It checks auth/origin rejection, native description changes visible through insights, stale writes, task ownership/completion, backup/migration requests, and AI settings/context. It never calls a live AI provider. The HTTPS mock test skips with an explicit reason on machines without OpenSSL.
- Browser fixtures exercise note save/clear/conflict/reload/manual legacy recovery, draft preservation during outages and migration, typed confirmations, task failure/completion and source-node polling after moving nodes, AI token handling/consent/privacy/error/plain-text output, and layouts at 390px.
- Companion/site tests cover visible controls and the logo Easter egg, keyboard focus, reduced motion, desktop/tablet/mobile, loaded images and horizontal overflow.
- Commands: `npm run typecheck`, `npm test`, `npm run build`, `CHROMIUM_PATH=/usr/bin/chromium node web/test/advanced.e2e.cjs`, `node web/test/outages.e2e.cjs`, `node web/test/lynx.e2e.cjs`; site: `node tests/lynx.e2e.cjs` and `node tests/presentation.e2e.cjs`. Installer check: ShellCheck 0.10.0 `-S warning` and `bash -n`.

## Independent review and fixes

A fresh server reviewer found the HA wrapper completion issue and an in-flight digest conflict UX gap. Regression tests failed before the fixes and pass afterward. A fresh frontend/visual reviewer reproduced task tracking disappearing when migration changed the guest node; the operations component now keeps its identity across node moves, and the browser fixture moves a guest while its task is still running. The existing notes component already has stable identity and keeps its draft.

## Limits

These checks use isolated fixtures and the bundled mock, not real Proxmox hosts or paid AI accounts. Backup schedules, restoring archives, storage administration and HA management remain in Proxmox. Proxmox validates snapshot/storage/migration compatibility and may reject a task. Existing installations require an administrator to extend the role as documented in README; the running app never elevates credentials. Task tracking is process-local; after an agent restart check Proxmox before retrying. Public screenshots use mock homelab data; no private infrastructure is pictured.

## Maintenance iteration

The follow-on iteration adds reviewed stopped-guest CPU/memory/start-at-boot changes, a backup archive inventory per storage, and paged logs for tracked tasks. Writes require a fresh digest and verified absence of pending changes. QEMU CPU-hotplug and explicit NUMA mappings are read-only in this editor to avoid invalidating CPU/memory topology. No power operation runs automatically. Backups show archive creation time, size and format for the selected guest; permission failures are distinct from a verified empty list. Task output remains plain text, bounded to 200 rows per request, 2,000 characters per line and 2,000 displayed lines.

Verification now covers 53 tests, full typecheck/build, the new maintenance browser fixture, previous advanced/outage behavior, and website checks. A fresh source/visual reviewer returned ship after topology safeguards; both findings have RED-to-GREEN regression evidence. Public captures were refreshed through the actual local agent and bundled mock. Publication is delegated to a subagent at the user’s explicit request. Merging makes new app source available; existing LAN agents still need an update.
