# Graphical VM Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit graphical VM console sessions without exposing upstream credentials or changing existing text consoles.

**Architecture:** A focused RFB authentication adapter feeds a dedicated authenticated WebSocket route. The shared console dialog selects a lazy-loaded noVNC component or the existing terminal. Protocol, transport and UI tests use local fixtures only.

**Tech Stack:** Node22 TypeScript/crypto/ws, Fastify, React/Radix, pinned noVNC1.7.0, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-graphical-console-design.md`

## Global constraints

- First-frame5s/setup15s; handshake<=4096B, WS<=16MiB, buffered<=32MiB, relay chunks<=256KiB.
- RFB3.8/VNC upstream, authenticated RFB3.8/None frontend; no upstream credential exposure.
- No start/configuration/privilege expansion, automatic reconnect or clipboard synchronization.
- Preserve text-console/SSH behavior and demo isolation;390px light/dark usable.
- Fixtures now; live PVE8/9 validation pending.

## Review focus

- Handshake boundaries can fragment/coalesce arbitrarily; no dropped or corrupted binary bytes.
- Cancellation during each await must prevent later worker/socket attachment.
- noVNC takes over socket handlers; JSON must end before binary handoff.
- Failed/stale/offline targets must cause zero console worker requests.
- Credential, backpressure and malformed-traffic failures must clean both sessions without leaking upstream text.

### Task1: RFB authentication adapter and bounded transport

Files: create `server/src/rfb-auth.ts`, `server/src/graphical-console.ts`, `server/test/rfb-auth.test.ts`, `server/test/graphical-console-api.test.ts`; modify `server/src/index.ts` and optional destination-restricted client WS payload option.

Interfaces: `RfbAuthBridge(password,hooks)` exposes `upstream(bytes)`, `browser(bytes)`, `dispose()`, with binary send callbacks, ready callback and generic error handling in caller. `handleGraphicalConsoleSocket(socket,authorize)` owns all deadlines/lifecycle and saved target access.

- [x] Write RED tests for a known authentication vector, every fragmented handshake boundary, coalesced data, wrong versions/security/results and bounds.
- [x] Implement the credential-private adapter; verify focused tests pass.
- [x] Write RED actual-agent/TLS fixture tests for exact auth/request fields, running target checks, protocol relay, cancellation and forbidden origins/frames.
- [x] Implement dedicated route/transport; retain existing native text invariants. Verify focused tests pass.

### Task2: Graphical UI and browser fixtures

Files: modify package/lock, `web/src/components/GuestConsoleDialog.tsx`; create `web/src/components/GraphicalConsole.tsx`, minimal noVNC type declaration, `web/test/graphical-console.e2e.cjs`, third-party notices.

Interfaces: graphical component accepts existing ConsoleTarget and onStatus callback and owns focus, CtrlAltDelete, phone keyboard and explicit clipboard controls. noVNC loads before creating WS and attaches synchronously on ready.

- [x] Install exact noVNC1.7.0 with its license notice.
- [x] Write RED built-browser fixture for graphical selection, real framebuffer paint and keyboard/pointer input with no upstream credentials in browser.
- [x] Implement explicit transport choice, lazy loading, local scaling/focus and bounded explicit clipboard input, with deliberate session reset.
- [x] Verify reconnect/switch/offline/agent cleanup and390px light/dark behavior; preserve text-console fixtures.

### Task3: Documentation, review, verification and publication

Files: update README/project/design and these plan checkboxes; website copy follows implemented scope without advancing the pinned demo.

- [x] Document exact graphical/text capabilities, permissions, credentials and fixture-only validation limits.
- [x] Run `npm run typecheck && npm test && npm run build`, `npm run build:demo`, graphical/text-console/demo browser tests.
- [x] Obtain fresh independent review, fix findings with regression tests and repeat affected checks.
- [ ] Publish incremental PR; require exact-head Ubuntu/Windows CI before guarded merge. Retain pending real validation and staged goal.

Verification: full204tests/typecheck/production/demo builds and graphical/text/restore/demo browser fixtures passed. Real noVNC renders independent known pixels, sends keys/pointer/CAD/explicit clipboard and phone keystrokes, handles load failure/cleanup, and fits390x844 without obscuring footer actions. Both loopback secure-context and synthetic non-secure HTTP origins were exercised. Fresh independent review approved final boundaries. Exact-head CI/publication is tracked by the PR; real PVE8/9 validation remains pending.
