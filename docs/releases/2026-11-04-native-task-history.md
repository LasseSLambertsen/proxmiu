# Native Proxmox task history

The continued feature iteration adds retained Proxmox history to Activity and guest workspaces. A connection/node source is explicit, with optional guest filtering, bounded paging and clear success, warning, failure, running and unknown outcomes. Activity keeps local provisioning runs in a separate tab, including existing job deep links.

Historical task status and logs are available only after the task appears in a validated Proxmox history response. A bounded 30-minute access cache is scoped to connection, original node and native task ID; upstream permission checks remain in force. Removing a connection clears its remembered access. After an agent restart or expired access, refreshing history and selecting the task restores eligible log access. No task controls, privileges or infrastructure writes were added.

Task IDs support long-running-node tick fields and native OIDC/directory owner names. The router accepts longer encoded native IDs while decoded inputs remain bounded. Proxmox authentication failures in history/status reads cannot invalidate the user's agent session. Invalid/foreign rows produce explicit warnings and advance the upstream cursor; data is never presented as a verified empty success when parsing failed. Proxmox retention bounds available history.

The browser displays up to 200 tasks with deduplication and newest-page refresh. Logs retain the existing 200-row request, 2000-character line and 2000-line display bounds. Source changes and late responses cannot replace another source's task or logs. An unavailable source retains its connection, last-known node, history, selection and loaded logs, including when the offline overview contains empty node/guest arrays.

## Verification and review

Tests cover strict input and native identity/state normalization, safe upstream errors, malformed pages, paging, cache scope/expiry/renewal/eviction/cleanup, and reopening older logs across an actual agent restart. Browser checks cover source and guest filters, cap/deduplication, escaped results/logs, running task polling, terminal warnings/unknown markers, restart-like access recovery, source races, realistic outages, provisioning deep links, migration and 390px layouts.

Independent review identified uppercase RUNNING classification, directory-user task IDs and Activity source loss during an outage. Each had a failing regression before correction. Proxmox's native 'unexpected status' terminal marker now stays unknown in both history and polled details. A browser fixture assertion was scoped to selected details after the result correctly appeared in both row and details.

Publication follows Linux/Windows PR checks and website preview verification, with a delegated expected-head merge and production-site verification. Screenshots use the real local agent and bundled synthetic Proxmox mock; no live host, live user data or AI provider call is involved. Existing LAN agents need updating to activate the new endpoints.

Final local verification: 71 server/domain/integration tests, both TypeScript projects and the production build passed. Native history, maintenance, advanced-workspace and outage browser fixtures passed. Desktop and 390px screenshots were captured through the actual local agent and bundled mock, then inspected for valid content and overflow. The prior outage assertion was scoped to its guest-specific notice because history now has a separate stale notice.
