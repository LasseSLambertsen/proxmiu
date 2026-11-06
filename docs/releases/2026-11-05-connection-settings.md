# Saved connection settings

Connections can be renamed or given new credentials/TLS settings without deleting their ID, guest metadata or retained history. Host and port stay fixed to keep historical context tied to its original destination.

The agent verifies proposed credentials over the saved endpoint, checks an opaque revision before and after the asynchronous probe, and persists encrypted settings atomically. Failed checks, stale edits, concurrent removal and write failures preserve the previous saved state. Successful saves clear the saved client cache; tests do not. Username/authentication changes require a replacement secret, and existing secrets never return to the browser. Same-connection provisioning/update jobs block saves while running.

The existing add flow and pinned read-only demo stay separate. Open terminals retain their current session; old credentials are revoked separately in Proxmox. No new privileges, dependencies, provider requests or infrastructure actions are added. Local fixture verification and review results are recorded in the implementation plan; real Proxmox validation remains open.

Completed verification Nov6:150/150 tests, server/web typechecks, normal and isolated demo builds, settings browser regressions and desktop/mobile ready/error visual checks pass. Fresh review found three gaps in candidate redirects, successful-response validation and pending-save dismissal. All were fixed with observed RED→GREEN regressions and cleared by scoped spec/security/quality re-review. Candidate-only strict checks preserve other client behavior; existing dialog callers retain their defaults. Publication is gated on the exact reviewed heads and normal CI/Git-connected website deployment.
