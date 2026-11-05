# Native Guest Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for one coherent implementation task, followed by fresh whole-branch review and the authorized publishing subagent. Controller owns docs/website.

**Goal:** Connect to running guest consoles through Proxmox without requiring guest SSH/networking.

**Architecture:** First-frame authenticated, guest-bound agent WebSocket bridges the strict native termproxy protocol. Existing terminal UI accepts an explicit console target and keeps SSH unchanged.

**Tech Stack:** Existing Fastify/React/xterm/Zod/Node, installed ws8.22.0 promoted to explicit dependency; no new transport library.

**Spec:** `docs/superpowers/specs/2026-11-05-guest-console-design.md`

## Global constraints

- Preserve bearer/origin/DNS-rebinding, TLS policy, destructive confirmations and existing SSH behavior. No browser tokens in URLs or upstream credentials/tickets/errors in browser/logs/history/AI/storage.
- Guest-only LXC/QEMU serial console; no host shell, graphical VNC, automatic guest power/configuration/getty or permission escalation. Only VM.Console privilege; no Sys.Console.
- Fresh exact stored connection/guest/node/type/status/template checks before termproxy; server selects configured QEMU serial socket. User explicitly connects/reconnects.
- One connect/socket; first frame5s/setup15s; browser frames256KiB/input64KiB UTF-8/upstream frame+buffer1MiB; cols2..500/rows2..300; no unbounded queues or late connect after cancellation.
- Native binary-subprotocol handshake user:ticket newline, split OK and UTF-8 preserved, input byte counts/resize/30skeepalive correct. Error/close cleanup is complete.
- No real host/guest commands/provider; fixture-only proof, honest real-host limits. Normal app and read-only pinned demo remain separate.

## Review focus

- Browser authorization/origin/DNS/malformed or duplicate connect must have zero unauthorized upstream effect; async validation cannot race a close/reconnect into a second session.
- Stale/moved/reused guest identity, stopped/template target and missing serial must not choose another guest/node or change infrastructure.
- Ticket/API/password leakage through URL/error/log/output-handshake paths, string delimiters or unexpected upstream responses.
- Unicode/split acknowledgement/output, early input, large paste, stalled peer/backpressure, disconnect/timeout/rapid reconnect and timer/socket leaks.
- Console UI target/agent/offline lifecycle, explicit connect and unaltered ordinary SSH/mobile clipboard behavior.

### Task 1: Native console end to end

**Files:** Add focused `server/src/guest-console.ts` (split protocol if warranted), tests/fixtures; modify `server/src/proxmox.ts` narrowly for private saved-auth/TLS WSS access, `server/src/index.ts` route, `web/src/components/Terminal.tsx`, new `GuestConsoleDialog.tsx`, `pages/GuestDetail.tsx`, browser tests, `scripts/proxmox-install.sh` permission literal and package manifests if needed. Controller owns docs/site.

**Interfaces:** Browser endpoint `/api/console`; first frame `{type:'connect',clusterId,node,guestType,vmid,cols,rows,token?}`. Common `{type:'data',data}` / `{type:'resize',cols,rows}` and existing status/error/data response shape. Any binary output encoding is explicit and must preserve SSH default behavior. UI ConsoleTarget has discriminator `mode:'console'` and guest identity, no upstream credentials/URL. Internal client capability never accepts a browser-selected URL or arbitrary headers/path.

- [x] Write strict local protocol/auth/API REDs; use isolated DATA_DIR and actual HTTPS/WSS, no generated guest command execution. Browser coverage was added after implementation; no browser RED is claimed.
- [x] Implement authorization/target validation/upstream saved-auth/TLS handshake and bounded lifecycle; verify split OK, Unicode byte lengths, failure/cleanup and secret-free diagnostics. Review fixes below remain a publication gate.
- [x] Integrate explicit console dialog/shared terminal target; preserve SSH; validate no-IP/stale/offline/migration and mobile states with browser fixture. Delayed reconnect regression follows review.
- [x] Add minimum VM.Console role literal and direct installed ws declaration; run focused tests/typecheck/syntax and report. Root owns final full checks/ShellCheck/build/visual/review.
- [x] Fresh broad spec/quality review, material fixes, scoped re-review and docs/site copy.
- [ ] Exact-head CI/preview/production publication through subagent; external evidence recorded separately after commit.

## Ledger

- App base/main0a972c83e9084732bf3691be126b655348fb360d; site base/main8f48d22b6330f3fab888076f4ae565b473cd88cb; clean branches feat/guest-console.
- Prior demo shipped appPR11/sitePR7 with production verified. Do not redo it. Site demo source pin remains0a972c83.
- Upstream sources downloaded read-only: `/tmp/proxmiu-qemu-api.pm` termproxy3208/vncwebsocket3328; `/tmp/proxmiu-lxc-api.pm` termproxy1102; `/tmp/proxmiu-pve-xterm-main.js` binary protocol244..286. Public repository paths documented in the spec.
- Controller chose guest-only console scope and strict transient server-side credential boundary under standing delegated iteration/publication authorization. No renewed approval needed for source work or existing authorized publication; no actual infrastructure action is authorized/performed by tests.
- One coherent implementation task; interfaces are self-contained. Root docs/site changes do not overlap implementer source ownership. ShellCheck is not on PATH; controller will arrange a temporary static checker before final checks.

- Resume Nov5 18:26UTC: original worker `/root/console_implement` remained pending_init and was interrupted to prevent future concurrent edits. Saved strict API fixture and observed RED11tests(1pass/10fail) remain; no product source had been written. Fresh `/root/console_finish` (standard coding model) continues from that exact state, no repeated setup. Root docs/site staged copy checks are complete; app source remains worker-owned.

- Controller staged site checks passed:5/5 build boundaries, normal pinned-source site build and desktop/390px presentation/companion. Demo source remains0a972c83 and public mascot SHA unchanged. Temporary ShellCheck0.11.0 baseline scan emits no warnings; final installer scan follows source handoff.

- First implementation handoff passes strict API11/11 and typecheck; browser no-IP/explicit-session/mobile/migration checks pass before final input adjustment. Named verification gaps (timers/keepalive/backpressure, strict TLS, DNS, upstream permission errors, ordinary SSH, QEMU/offline/agent-change/clipboard) remain part of Task1 and are being completed in one bounded worker batch before broad review. No lost/browser RED is invented.

- Expanded verification completed: 15 focused server tests and the browser fixture cover those named gaps. Controller full checks passed 145/145 tests, both typechecks, normal app/server build, isolated demo build, ShellCheck0.11.0 at warning level, installer syntax and browser fixture. Initial desktop/mobile dark/light screenshots were inspected; dialog layout fits all four cases. Connect will use the existing primary variant for clearer action hierarchy.

- Fresh read-only whole-branch spec/security/quality review by `/root/console_review` found two material gaps: the 256KiB completed-message guard did not constrain ws transport buffering before allocation, and callbacks from a disposed Terminal could overwrite replacement connection status. Both are assigned to `/root/console_finish` in one consolidated RED→GREEN fix wave with raw-frame and asynchronous-close regressions. Publication remains gated on those fixes, scoped re-review and final verification. A proposed handshake-phase timer leak was declined because valid pre-ACK traffic cannot reach the cited backpressure threshold. Site copy and remaining security boundaries passed review.

- Both findings fixed with observed RED→GREEN regressions: separate scoped WebSocket servers enforce console maxPayload256KiB before buffering while retaining the SSH default; Terminal invalidates and detaches callbacks before closing. Focused server tests17/17 and asynchronous reconnect browser checks pass. Scoped re-review PASS confirms Fastify routing retains inherited origin/DNS/bearer hooks for both scoped routes and no SSH boundary regression was found.

- Final controller verification on stable source:147/147 full tests, typecheck, normal app/server build, isolated demo build, ShellCheck0.11.0 warning level, installer syntax and diff whitespace checks all pass. Final browser/screenshot confirmation and exact-head CI/preview/publication follow through `/root/console_publish`; no real Proxmox host was contacted.

- Final browser confirmation passes all fixture cases, including delayed stale callbacks. Final screenshot batch captures ready/connected states at desktop/mobile in both themes after transitions; controller inspected all four connected layouts and representative ready layouts in both themes. No material visual issues remain. Source is ready for the authorized exact-head CI-gated publishing agent; the immutable commit cannot embed its own later external publication evidence, which is recorded at `/tmp/guest-console-publication.md` in the execution workspace.
