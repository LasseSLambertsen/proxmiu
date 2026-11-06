# Task 1 handoff: saved connection settings

## Source and interface

- `server/src/index.ts`: authenticated GET/PUT `/api/clusters/:id/settings` and POST `/api/clusters/:id/settings/test`; strict bounded settings object, opaque keyed revision, saved destination, fresh version/nodes probe, fixed error messages, before/after revision and running-job checks, and cache invalidation after persistence. Existing list/create shapes and add flow are unchanged.
- `server/src/store.ts`: encrypted settings replacement using the existing atomic state write, restoring the in-memory record on a write failure.
- `web/src/components/ConnectionSettingsDialog.tsx`, `web/src/pages/Connections.tsx`: row Edit action and fresh settings dialog with fixed destination, blank secret, draft-preserving failures and deliberate reload, test/save pending controls, agent-change cleanup and query refresh after save.
- `server/test/connection-settings.test.ts`, `web/test/connection-settings.e2e.cjs`: synthetic local fixtures. Browser fixture supports `SCREENSHOT_DIR` for one batched ready/error, desktop/mobile, light/dark capture; no screenshots taken by this worker.

## Observed red and green

- Before implementation `node --import tsx --test server/test/connection-settings.test.ts` failed at GET settings: expected 200, actual 404. Before implementation `node web/test/connection-settings.e2e.cjs` timed out waiting for the Edit button, after a baseline web build.
- Final `node --import tsx --test server/test/connection-settings.test.ts`: 1 test passed, 0 failed (`/tmp/connection-api-auth.log`). Its real agent and self-signed synthetic HTTPS endpoint use an isolated temporary data directory.
- Final `npm run build:web` completed successfully (`/tmp/connection-final-build.log`); `node web/test/connection-settings.e2e.cjs` passed (`/tmp/connection-browser-stable.log`).
- Final `npm run typecheck` completed successfully (`/tmp/connection-final-typecheck.log`); `git diff --check` passed. Full suite, normal/demo builds, batched visuals and independent review are controller-owned and remain to be run.

## Coverage and limitations

The API fixture exercises GET secrecy, strict rejection of endpoint edits, credential omission/identity-change and empty secret rejection, Unicode control rejection, stale revisions, origin/bearer guards, failed credential/TLS verification and sanitized errors, preservation of identity and guest metadata, encrypted disk content, restart, warmed client behavior across test and save, token-to-password replacement, concurrent save and deletion while probing, write-failure memory rollback, and same-connection running-job admission before and after probing. Job work is held at a synthetic local HTTPS endpoint and deliberately failed there; no real infrastructure is contacted.

The browser fixture exercises blank/omitted secret, fixed destination, pending controls, test invalidation, failure/conflict draft retention, explicit reload, save refresh, cancel, agent-change close and a late test response after that change. The visual combinations are supported for the controller's opt-in pass. It does not separately automate every validation boundary, older-agent 404 guidance, every malformed error shape, an in-flight connection replacement, password field copy, or each theme/viewport without the opt-in capture; these are review/verification limits rather than claimed coverage. No real Proxmox compatibility is claimed.

## Consolidated review fix wave

- Candidate `ProxmoxClient` now opts into redirect rejection for both password login and version/nodes requests; other clients retain their existing behavior. Candidate password login requires nonempty ticket and CSRF strings; the settings route validates a nonempty version string and a nodes array of entries with nonempty node names, allowing an empty array and optional additional fields. Invalid responses produce the existing fixed 502 without persisting or invalidating the saved client.
- During a pending save, Cancel and the dialog close button are disabled and Escape/outside dismissal is prevented; agent-change cleanup remains active. The dialog shows “Saving…” and “Testing…”, and the immutable destination wraps on narrow screens. `DialogContent` has an optional `closeDisabled` prop defaulting to false for existing callers.
- Observed REDs before these fixes: redirect-version POST returned 200 rather than 502 (`/tmp/settings-redirect-red.log`); a 200 HTML version response returned 200 rather than 502 (`/tmp/settings-payload-red.log`); pending-save Cancel was enabled (`/tmp/settings-dismiss-red.log`).
- Final `node --import tsx --test server/test/connection-settings.test.ts` passed 3/3 (`/tmp/settings-api-all-final.log`). The default suite now runs normal, redirect and payload cases. Redirect tests exercise both settings actions against version, nodes and password-login redirects to a second local listener, asserting zero trap requests and unchanged state, revision and warmed saved client. Payload cases exercise HTML, missing, null and wrong-shaped version/nodes and malformed password login (including absent CSRF), plus acceptance of empty nodes; each rejects safely without changing saved state/cache.
- `npm run build:web` passed (`/tmp/settings-fix-web-build.log`); `node web/test/connection-settings.e2e.cjs` passed (`/tmp/settings-dismiss-final.log`). The browser fixture holds successful and failed saves, checks Cancel and X disabled, attempts both controls, Escape and outside interaction, verifies visible progress and successful row refresh, and checks failure preserves the draft and restores dismissal controls. It also checks Testing feedback and retains the earlier lifecycle tests.
- `npm run typecheck` passed (`/tmp/settings-final-fix-typecheck.log`); `git diff --check` passed. Full post-fix suite/builds, visual confirmation and independent re-review remain controller-owned. No screenshot capture or real infrastructure action was performed by this worker.
