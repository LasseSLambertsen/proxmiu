# Premium Workspaces Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Continue autonomously under the user's explicit delegation of product choices and commit authorization.

**Goal:** Ship useful guest workspaces and faster daily operations with a premium, coherent interface.
**Architecture:** Extend the current React/Vite SPA and Fastify LAN agent; use the existing authenticated API for operations. Persist guest metadata at the agent and saved views in agent-scoped browser storage.
**Tech Stack:** TypeScript, React, TanStack Query, Fastify, existing SVG/Lucide components.
**Spec:** `docs/superpowers/specs/2026-11-02-premium-workspaces-design.md`

## Global Constraints

- Preserve the warm glass, amber and lynx identity and all security invariants in CLAUDE.md.
- No new production dependencies or Proxmox privileges. Notes maximum 4,000 characters.
- Bulk actions are start/shutdown/reboot only, at most two concurrent requests, with explicit confirmation and individual outcomes.
- Views are scoped to the current agent, maximum 20, names maximum 40 characters.
- Validate API inputs; return only whitelisted configuration. Preserve partial failures and empty states.
- Never claim operation completion merely because a request was accepted.

## Review Focus

- Partial config/history permission failures and offline connections must not fabricate metrics or erase useful state.
- Favorites survive node migration and partial note/favorite writes cannot overwrite each other.
- Corrupt browser storage, stale views and deleted guests recover without crashing.
- Batch selection is explicit and cannot silently include guests hidden by filters; duplicate submission is disabled.
- CSV text starting with spreadsheet operators is neutralized; long names, text and phone layouts remain usable.

## Task 1: Guest workspaces and durable metadata

Files: new `server/src/guest-insights.ts`, `server/test/guest-insights.test.ts`; modify `server/src/index.ts`, `server/src/store.ts`, `server/dev/mock-proxmox.ts`; new `web/src/pages/GuestDetail.tsx`, `web/src/components/ResourceHistory.tsx`, `web/src/lib/guest-workspace.ts`; modify `web/src/lib/api.ts`, `web/src/lib/queries.ts`, `web/src/App.tsx`, `web/src/components/GuestTable.tsx`.

- [x] Write failing tests for metadata merging/cleanup and configuration/metric normalization; implement the API contract from the spec.
- [x] Add deterministic RRD/config responses to the mock API.
- [x] Implement guest identity/path helpers and typed metadata/insights hooks.
- [x] Build detail pages, accessible history graphs, editable notes and pin controls; link guest names to their detail pages.
- [x] Verify source and mock integration; run typecheck, tests and build; review; commit the working guest workspace.

## Task 2: Inventory views, CSV and bulk operations

Files: new `web/src/lib/guest-inventory.ts`, `web/src/lib/bulk-actions.ts`, `web/test/workspace.test.ts`, `web/src/components/BulkGuestActions.tsx`; modify `web/src/pages/Guests.tsx`, `web/src/components/GuestTable.tsx`, `package.json`.

- [x] Write and observe failing pure tests for combined filters/sorting, corrupt saved view recovery, CSV injection, concurrency limits and partial failures.
- [x] Add filters, sorting, pins, saved views and export; persist views with an agent-specific storage key.
- [x] Add explicit guest selection on desktop and phone, a confirmation list, bounded operations, and individual results.
- [x] Clear selections on view/filter changes; prevent selection or submission while a batch runs.
- [x] Run typecheck, full unit suite, build and browser flows; review; commit the working inventory upgrade.

## Task 3: Overview, product presentation and release validation

Files: modify `web/src/pages/Overview.tsx`, `web/src/components/CommandPalette.tsx`, `README.md`, `design.md`; site `index.html`, `styles.css`, `screenshots/*`.

- [x] Add health warnings, pinned guest shortcuts and guest-detail navigation from command search.
- [x] Update documentation and site copy with implemented capabilities, keeping install and existing mascot flows working.
- [x] Capture and inspect the finished app on desktop/light/phone and refresh site screenshots.
- [x] Run final checks and fresh whole-change review; address material findings; commit app and site changes and push both repos.

## Progress

- Planning: scope chosen under explicit user delegation. Existing repository contents synchronized with prior pushed work before implementation.
- Implementation: backend metadata/insights/mock data and guest detail UI are in place. Saved views, inventory filters, CSV, selection/bulk UI, overview health/pins and command-palette links are implemented.
- Full typecheck, all 22 unit tests and production build passed. Mock-backed browser checks passed for notes/pins/history, saved views, CSV, bulk confirmation/cancellation/partial failures, selection reset and mobile controls. The isolated outage and existing lynx browser regressions passed.
- Integration fixture finding resolved: a build changed asset hashes after Fastify startup. A live Vite preview removed the stale registration while developing; the production browser regression serves the final bundle independently.
- Fresh review found and verified fixes for outage-related draft loss and stale healthy status, then confirmed full phone guest names/addresses and compact completed-batch presentation. Final disposition: ship, no remaining findings from that review.
- Ruling: cap a batch at 50 explicit targets, retaining the planned two-request concurrency, to keep confirmations and result review manageable.
- Release evidence (2026-11-03): 22 passing unit tests, typecheck and production build; passing isolated outage and mascot browser checks; passing mock-backed guest/inventory workflows; 12 current screenshots; website desktop/phone checks with all 14 images loaded and working install-copy, screenshot, navigation and mascot flows. Fresh app and website reviewers both returned ship after the identified issues were corrected.
- Commits are separated into the design plan, functional app upgrade, and presentation/screenshots updates. GitHub publication verifies blob hashes and the complete tree against each local reviewed commit.
