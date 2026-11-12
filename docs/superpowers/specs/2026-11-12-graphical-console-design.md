# Graphical VM consoles

Continue the first milestone by adding an explicit graphical display choice for running QEMU VMs, alongside existing LXC/QEMU text consoles. Preserve the warm glass dialog, mobile usability, deliberate Connect/Disconnect/Reconnect, destination restrictions and agent-side credential privacy. Use fixtures now; live PVE8/9 validation remains pending. Console connection does not start or configure guests and requires no new privilege beyond existing VM.Console and audit rights.

## Protocol and boundaries

A separate `/api/graphical-console` WebSocket uses the existing origin/Host guards and strict first-message agent authentication. Its first frame names only saved connection/node/QEMU ID/token. Revalidate online node and fresh running, non-template guest, then read VGA configuration; reject serialN/none displays. The agent requests `vncproxy` with websocket=1 and generate-password=1, validating returned eight-character password, ticket and 5900–5999 port. It opens WSS through the existing saved-connection client/TLS policy. Browser-supplied upstream URLs, tickets, credentials and ports remain forbidden.

A bounded agent adapter negotiates RFB3.8/VNC authentication upstream, using the generated password and standard bit-reversed DES challenge response. After upstream success it sends one JSON ready frame and offers synthetic RFB3.8/None inside the authenticated agent session. noVNC then exchanges binary RFB only. Upstream tickets/passwords, cookies and API secrets never leave the agent. Reject unsupported versions/security modes, malformed/nonbinary traffic and unexpected ordering, and preserve fragmented/coalesced payload bytes. No terminal framing, UTF-8 conversion or application keepalive enters RFB.

Set first-frame deadline5s, setup deadline15s, handshake accumulation<=4096bytes per direction, WS message<=16MiB and total buffered amount<=32MiB per peer. Relay output in<=256KiB chunks. Use WS ping/pong30s, close unresponsive peers after60s, and release all timers/listeners/password references on cancel/error/close. Generic errors only; after binary handoff use generic close reasons rather than JSON. No automatic reconnect, persisted output, AI attachment or clipboard synchronization.

## UI and dependency

Pin `@novnc/novnc`1.7.0 and retain MPL2.0 notices. Lazy-load the graphical component/library so the demo remains isolated and the normal app loads cheaply. An existing open WebSocket is handed to RFB synchronously after ready; import the library before connecting. Session status comes from noVNC events. Use fit-to-window scaling with resizeSession=false, optional actual-size, focus and explicit Ctrl+Alt+Delete. Clipboard transfer is deliberate text input/send only, bounded at64KiB; never read/write system clipboard automatically. Keep existing reviewed power actions separate.

The console dialog defaults QEMU to Graphical display and offers Serial text; LXC stays Text console. A transport switch disconnects the previous attempt. Existing identity/agent/offline teardown remains authoritative. At390px controls wrap and the display stays inside a scrollable viewport. Credentials/errors render only safe plain text.

## Evidence and acceptance

Tests use actual local HTTPS/WSS API-token and password-auth fixtures, an independent known DES/VNC vector, fragmented/coalesced handshakes, binary fidelity, bounded buffers, cancellation races, timeout/backpressure and zero-upstream-effect auth/origin/stale-target failures. Browser tests use the real noVNC implementation against a minimal local RFB server, paint known framebuffer pixels, send keyboard/pointer input, switch/reconnect deliberately, inspect desktop/mobile themes, and verify credentials never enter browser URLs/storage/messages. Preserve existing text-console/SSH tests and demo isolation. Run typecheck, full tests, production/demo builds and browser fixtures before publication, with fresh independent review. No real-host readiness claim.

## Official references

- PVE8 vncproxy: https://github.com/proxmox/qemu-server/blob/45f67709ea91fb4e6e487c56e1958b324be4f817/PVE/API2/Qemu.pm
- PVE9 vncproxy: https://github.com/proxmox/qemu-server/blob/5208318f8147305891a0b56c00cd1585eaa23f8c/src/PVE/API2/Qemu.pm
- Generated-password compatibility: https://github.com/proxmox/qemu-server/commit/3c5bdde815c503f2461d24db0caddaac37527a14
- noVNC1.7 API: https://github.com/novnc/noVNC/blob/v1.7.0/docs/API.md
