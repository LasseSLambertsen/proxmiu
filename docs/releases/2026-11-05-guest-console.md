# Native guest console

Guest workspaces offer an explicit Proxmox Console connection for running LXC guests and VMs with a configured serial socket. The shared terminal keeps clipboard and mobile keys; no guest IP or SSH service is required. Guest login may still be needed. Stale placement, permissions and unsupported VM serial configuration remain actionable errors.

The agent authenticates and validates the exact target before opening termproxy, keeps native tickets/upstream credentials server-side, and bounds handshake/input/output/setup lifetime. Cancellation and failure close the transport without automatic reconnect, power action, hardware/login-service configuration or permission escalation. Console traffic is transient and is not automatically attached to history or AI requests.

Only VM.Console is added to new/re-run installer role setup; existing roles require a deliberate manual update. No Sys.Console host-shell privilege, graphical VNC/SPICE, real guest execution or hosting/access change is included. Real Proxmox/guest OS validation remains open.

Verification passes147/147 tests, server/web typechecks, normal and demo builds, installer syntax and ShellCheck0.11.0 at warning level. Local HTTPS/WSS and browser fixtures cover native framing, authentication, TLS rejection, transport limits before buffering, backpressure, timeouts and delayed callbacks across reconnect. Fresh review identified two material gaps, both fixed with regressions and cleared by scoped re-review. Exact-head CI and Git-based website publication follow the plan; the website demo remains pinned to app0a972c83.
