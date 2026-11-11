# Project: Proxmiu

## What it is

A modern web app for managing Proxmox VE on the local network. The headline features are power actions, SSH in the browser, and one-click creation of servers from templates, especially remote **Claude Code** and **Codex** boxes you can SSH into from anywhere.

## Who it's for

Homelab and small-team Proxmox users who want a faster, friendlier front end than the stock Proxmox UI for everyday tasks. They want it from a phone too.

## Goals

1. **Find and connect** to Proxmox hosts on the LAN with minimal setup.
2. **Everyday operations** in one or two clicks: start, shut down, reboot, force stop, delete; node reboot and shutdown.
3. **SSH from the browser** to any guest or node.
4. **Templates** that turn "I want a Claude Code server" into a ready box in a few minutes.
5. **Use it anywhere**: self-hosted on the LAN, or hosted on Vercel/Netlify, including on iPhone.

## Non-goals

- Replacing the Proxmox UI for cluster administration (storage, HA, backup scheduling, firewall, users).
- Running agents for the user. Proxmiu sets up the box; the user runs `claude` / `codex`.
- Multi-tenant hosting. Each agent belongs to one person or household.

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
- Explicit native Proxmox text consoles for running LXC guests and existing QEMU serial sockets, without requiring guest networking or SSH; guest login may still be required.
- Templates: Claude Code server, Codex server, OpenCode server, AI dev box, Docker host, Plain server. Optional extras: tmux persistence, GitHub CLI, repo clone, git identity, Tailscale.
- Custom templates with typed options and a bash editor, plus install scripts fetched from a GitHub repository.
- Community Scripts: browse [community-scripts.org](https://community-scripts.org) and turn any container script into a template, with its options and resources prefilled.
- Guest updates: re-run the template's GitHub/inline install script, or the upstream Community Scripts update entrypoint, with the same live job log.
- Opt-in agent self-update from Settings: a narrow root helper runs the update in a transient systemd unit, so the agent can restart and the UI reconnects.
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

## Roadmap / open items

- [x] README screenshots (`docs/screenshots/`).
- [ ] Validate against a real Proxmox host; fix API differences from the mock.
- [x] Exercise the app VM clone path with strict local HTTPS/SSH protocol fixtures and correct source/configuration/disk task handling.
- [ ] Validate real QEMU/cloud-init boot and storage behavior; consider a helper that builds a cloud-init template.
- [x] Persist provisioning jobs across agent restarts, with interrupted outcomes and manual recovery.
- [x] Agent-free read-only demo with fixed sample data, shared app components and isolated storage/network behavior; published by the presentation website at a pinned app revision.
- [x] Guest detail workspace with configuration, history, Proxmox notes, snapshots, backups and migration.
- [x] Guest Proxmox termproxy console for LXC and existing QEMU serial sockets, with explicit connection and transient server-side tickets.
- [x] Rotate saved Proxmox credentials and edit connection name/TLS without deleting the connection or its retained context.
- [ ] Validate native guest console against a real Proxmox host/guest OS; graphical VNC/SPICE and host shells remain separate scope.
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
