# Project: Proxmiu

## What it is

A modern web app for managing Proxmox VE on the local network. The conversation goal is to grow it into a full-featured replacement for the Proxmox VE web interface, delivered in reviewed, tested increments. Current strengths include everyday guest operations, browser terminals, templates and reviewed host updates; the administration roadmap below is still in progress.

## Who it's for

Homelab and small-team Proxmox users who want a faster, friendlier front end than the stock Proxmox UI for everyday tasks. They want it from a phone too.

## Goals

1. **Find and connect** to Proxmox hosts on the LAN with minimal setup.
2. **Everyday operations** in one or two clicks: start, shut down, reboot, force stop, delete; node reboot and shutdown.
3. **SSH from the browser** to any guest or node.
4. **Templates** that turn "I want a Claude Code server" into a ready box in a few minutes.
5. **Use it anywhere**: self-hosted on the LAN, or hosted on Vercel/Netlify, including on iPhone.
6. **Complete administration progressively**: guest hardware, graphical consoles and restore first, followed by storage, networking, firewall, cluster/HA, backup administration and permission-aware accounts. Preserve native Proxmox notes, encrypted optional AI credentials, reviewed infrastructure changes and the professional Lynx personality.

## Non-goals

- Running agents for the user. Proxmiu sets up the box; the user runs `claude` / `codex`.
- Operating a public multi-tenant hosting service. Individual accounts and permission-aware administration are on the roadmap for self-hosted installations.

## Architecture

```
browser ── UI (static SPA) ──► agent (Node, on the LAN) ──► Proxmox API :8006
                                                        └──► SSH to guests/nodes
```

- **UI:** React + Vite SPA. Served by the agent, or deployed to Vercel/Netlify (`vercel.json`, `netlify.toml`).
- **Agent:** Fastify. Holds encrypted credentials, scans the LAN, bridges SSH over WebSockets, and runs provisioning jobs with encrypted, retained diagnostic history.
- **Why an agent:** cloud hosts can't reach private networks; Proxmox sends no CORS headers; browsers can't open raw TCP/SSH or discover devices.

### Hosted UI → agent connectivity

| Client | What works |
|---|---|
| Any browser, agent on `https://` with a trusted cert (e.g. `tailscale serve`) | Everything |
| Chrome/Edge desktop 142+, agent on `http://<private IP>` | API calls via Local Network Access (`targetAddressSpace`, user permission). WebSocket exemption unconfirmed |
| Safari / iOS, agent on `http://` | Blocked (WebKit Local Network Access not shipped) |
| Agent with self-signed cert (`PROXMIU_TLS=1`) | Desktop after accepting the cert once; unreliable on iOS |

## Features (current)

- LAN discovery (port 8006 scan + Proxmox fingerprint), API token or password auth.
- Saved connection editing for name, credentials and TLS verification, with fixed destination, verified revision-checked saves and encrypted credentials; connection identity, guest metadata and history are retained.
- Overview with stats and sparklines, a node list, and guests with live CPU, memory, IP and uptime.
- Guest power actions and delete; node reboot and shutdown with typed confirmation.
- In-browser SSH (xterm.js) using the app key, a password, or a pasted key; pop-out terminal tab; copy/paste, select all and sticky Ctrl/Alt/Shift keys.
- Explicit native Proxmox text consoles for running LXC guests and existing QEMU serial sockets, plus graphical QEMU displays with server-side VNC authentication, deliberate text transfer and phone keyboard controls. No guest networking or SSH is required; guest login may still be required. Graphical access does not configure display devices or start guests.
- Templates: Claude Code server, Codex server, OpenCode server, AI dev box, Docker host, Plain server. Optional extras: tmux persistence, GitHub CLI, repo clone, git identity, Tailscale.
- Custom templates with typed options and a bash editor, plus install scripts fetched from a GitHub repository.
- Community Scripts: browse [community-scripts.org](https://community-scripts.org) and turn any container script into a template, with its options and resources prefilled.
- Guest updates: re-run the template's GitHub/inline install script, or the upstream Community Scripts update entrypoint, with the same live job log.
- Opt-in agent self-update from Settings: a narrow root helper runs the update in a transient systemd unit, so the agent can restart and the UI reconnects.
- Reviewed growth of eligible ordinary VM/LXC disks with on-demand authoritative storage reads, absolute targets, typed confirmation, native task tracking and observed capacity; real allocation/filesystem validation remains pending.
- Opt-in Proxmox host updates: dedicated restricted node enrollment, pinned SSH identity, complete package review and typed confirmation before exact-version same-major installation. Durable jobs and global reservations survive agent disconnect/restart; Settings links support recovery during Proxmox API outages. Verified with synthetic package/systemd/SSH/API fixtures; real-host validation remains open.
- Provisioning: LXC creation (auto-downloads the OS template) or cloud-init VM clone; IP discovery via LXC interfaces, guest agent, or ARP; live step and log view.
- ⌘K command palette; light and dark themes with a continuous ambient canvas and readable light surfaces; phone layout with bottom tab bar; installable (web manifest).
- One-command install on a Proxmox host (`scripts/proxmox-install.sh`): autostarting LXC, systemd service, limited `proxmiu@pve` user/role, API token and host registration; `scripts/install.sh` for any Debian/Ubuntu box and for updates.

## Status

**Verified** against the mock Proxmox API with real SSH:
- LXC provisioning end to end (base, Claude Code, AI dev box scripts)
- App-level QEMU clone pipeline with strict local HTTPS and authenticated SSH protocol fixtures; generated setup scripts captured without execution. This does not verify a real clone, cloud-init boot or guest installation.
- browser terminal, same-origin and cross-origin
- Native guest-console authentication, protocol, payload limits and session lifecycle with strict local HTTPS/WSS and browser fixtures; real-host validation remains open.
- auth, CORS and origin blocking
- hosted UI flow in Chromium; mobile layout in an iPhone viewport

**Not yet verified**
- Against a real Proxmox VE host.
- A real QEMU/cloud-init clone, guest boot and installation on a Proxmox host.
- Completing the Claude Code / Codex installs (sandbox network blocked the downloads; failure handling verified).
- HTTPS agent mode (`PROXMIU_TLS=1`) in a browser, and the Tailscale route on a real iPhone.
- Chrome LNA behaviour for WebSockets (terminal) from a hosted https page.
- Actual Vercel/Netlify deploys (tested with a local static server).
- The install scripts on a real Proxmox host. They were tested end to end with stubbed `pct`/`pveam`/`pveum` and a real install of the agent, but `pct create` and `pveum` never ran for real.

## Conversation goal and staged roadmap

Deliver usable increments toward full Proxmox VE administration; a completed slice does not complete a stage. Use fixtures now and arrange designated disposable infrastructure for live validation later. Do not claim production readiness from fixture results alone. Infrastructure changes require explicit review and confirmation.

1. **Guest administration:** full VM/LXC hardware editing, graphical VM consoles and backup restoration. Existing CPU/memory/boot edits and text consoles are partial foundations. The first restore increment covers selected backups into new stopped guests only; overwrite recovery, deleted-source/global backup browsing and wider configurations remain open.
2. **Storage:** datastore administration, ISO/template management, disk movement and capacity planning.
3. **Networking:** bridges, bonds, VLANs and SDN, with reviewed changes and rollback protection.
4. **Firewall:** guest/node rules, security groups, aliases and IP sets.
5. **Cluster:** HA, replication, maintenance and membership workflows.
6. **Backup administration:** schedules, retention and Proxmox Backup Server integration.
7. **Access and operations:** individual accounts, permission-aware controls, roles, audit history and notifications.

Preserve the warm glass visual identity, phone usability, native notes, encrypted optional AI credentials and consent-based Lynx assistance throughout. Each increment gets appropriate CI/browser checks and independent review. Real infrastructure validation remains a separate release gate.

## Roadmap / open items

- [x] Reviewed growth of eligible ordinary VM/LXC disks with native tasks and actual capacity observations; synthetic fixtures only.
- [ ] Validate disk allocation, rounding and LXC filesystem/quota effects on designated disposable PVE 8/9 storage.

- [x] Reviewed restore of a selected same-node backup into a new stopped guest, with typed ID confirmation and native task recovery; synthetic API/browser fixtures only.
- [ ] Validate new-guest restore on designated disposable PVE 8/9 guests and backups; validate PBS separately.
- [ ] Extend restore to wider configurations, global/deleted-source backup browsing and separately reviewed overwrite recovery.
- [ ] Full VM/LXC hardware administration beyond CPU/memory/boot settings.
- [x] Graphical VM displays with agent-side authentication, explicit controls and real-noVNC browser fixtures; existing text/SSH preserved.
- [ ] Validate graphical displays/input on designated PVE8/9 guests; SPICE and host shells remain separate.

- [x] README screenshots (`docs/screenshots/`).
- [ ] Validate against a real Proxmox host; fix API differences from the mock.
- [x] Exercise the app VM clone path with strict local HTTPS/SSH protocol fixtures and correct source/configuration/disk task handling.
- [ ] Validate real QEMU/cloud-init boot and storage behavior; consider a helper that builds a cloud-init template.
- [x] Persist provisioning jobs across agent restarts, with interrupted outcomes and manual recovery.
- [x] Agent-free read-only demo with fixed sample data, shared app components and isolated storage/network behavior; published by the presentation website at a pinned app revision.
- [x] Guest detail workspace with configuration, history, Proxmox notes, snapshots, backups and migration.
- [x] Guest Proxmox termproxy console for LXC and existing QEMU serial sockets, with explicit connection and transient server-side tickets.
- [x] Rotate saved Proxmox credentials and edit connection name/TLS without deleting the connection or its retained context.
- [ ] Validate native text and graphical guest consoles against designated real Proxmox hosts/guest OSes; SPICE and host shells remain separate scope.
- [ ] Watch WebKit Local Network Access; drop the iOS HTTPS requirement when it ships.
- [ ] Optionally squash branch history (the first commit contains an earlier logo).

## Configuration

See the README table. Key variables: `PROXMIU_PASSWORD`, `PROXMIU_ALLOWED_ORIGINS`, `PROXMIU_TLS`, `PROXMIU_TLS_CERT`/`KEY`, `HOST`, `PORT`, `PROXMIU_DATA_DIR`, `PROXMIU_SECRET_KEY`.

Advanced guest workspaces now use native Proxmox notes and track snapshot, backup and migration tasks. Optional AI setup advice uses encrypted provider credentials and a user-reviewed, anonymous numeric preview; it has no infrastructure write tools. The lynx companion is discoverable from the app and website. See README for privilege updates and verification limits.

With a configured OpenAI, Anthropic or OpenRouter key, Lynx offers chat and opt-in selected-guest setup assistance. Server-built previews share only approved allocation and recent usage data. Supported resource proposals name their target and show before/after values; users explicitly confirm through the existing guarded stopped-guest resource editor. Model output cannot choose a write target, execute commands or apply changes automatically. Lynx speaks with a professional, perceptive, lightly cunning personality while keeping technical advice precise.

Lynx can also draft a new guest from the public built-in template catalog. Only template identity and CPU/memory/disk allocations are suggested. An agent-bound memory handoff opens the normal Create form after a fresh template check; the user reviews placement, networking, access and template options and explicitly submits provisioning. No custom scripts, secrets or infrastructure context are attached in creation-planning mode.

Guest maintenance includes reviewed stopped-guest CPU/memory/boot-setting edits with digest checks, an existing-backup browser per storage, and paged diagnostic logs for tracked tasks. These reuse existing connection permissions.

Native Proxmox task history is available in Activity and guest workspaces. It reads retained node tasks, including operations started outside Proxmiu, and re-enables historical status/log access after agent restart. Activity keeps provisioning/update runs on a separate tab, backed by an encrypted bounded journal. Restarted work becomes interrupted without automatic continuation; last saved diagnostics and intended guest identity guide manual inspection. Source and log access remain scoped to the original connection and node, with explicit offline/stale/unknown states.

VM creation refreshes the selected source template/node/cloud-init/boot-disk config before cloning. It waits for configuration and required disk-growth tasks, preserves larger disks, sets the requested vCPU count and keeps unrelated NIC options. Default source selection refreshes the displayed node and its storage/network options. Failed partial clones remain available for manual inspection, without automatic cleanup or retry.

The independent demo entry builds with `npm run build:demo` to `dist/demo` for `/demo/` on the presentation site. Visitors can explore sample inventory, metrics, templates and saved history without an agent. It contains no session/agent/API/provider/terminal code, reads no normal app storage and performs no infrastructure actions. Only its namespaced theme preference persists; all data is explicitly synthetic. The production app entry/build and agent behavior remain separate.

Native guest console access revalidates the selected running guest and node, then bridges Proxmox termproxy from the agent using saved authentication/TLS policy. QEMU requires an existing serial socket. Console sessions never start or configure guests, grant permissions, persist tickets/output or automatically share output with Lynx. Existing roles need VM.Console explicitly; Sys.Console is not added. The existing SSH workflow and read-only deployed demo remain separate.

Reviewed backup restoration verifies canonical archive identity, locally extracted configuration, unused cluster-wide target ID and active same-node destination storage before submission, then checks them again against a short-lived single-use review. Restores request new MACs, no immediate start and no ordinary boot autostart. Initial support is limited to VM VMA/PBS and ordinary unprivileged LXC TAR/PBS backups without unsupported host references, extra mount points or custom configuration. Credentials and raw extracted configuration remain on the agent. Native task history attributes qmrestore/vzrestore to the new ID and can reopen logs after restart. Synthetic TLS/API/browser verification does not establish real archive/PBS restoration or observed guest disk/runtime behavior.

Graphical VM consoles use a separately bounded authenticated binary route and a small RFB3.8 authentication adapter. It consumes the generated upstream VNC password on the agent, then permits noVNC only in the authenticated browser session. The client is lazy-loaded with upstream notices, offers display/keyboard/pointer/explicit text controls, and releases old sessions on transport/identity changes without reconnecting automatically. Synthetic TLS/token/password/protocol and real-noVNC pixel/input fixtures are distinct from pending real-host validation.
