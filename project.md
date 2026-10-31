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

- Replacing the Proxmox UI for cluster administration (storage, HA, backups, firewall, users).
- Running agents for the user. Proxmiu sets up the box; the user runs `claude` / `codex`.
- Multi-tenant hosting. Each agent belongs to one person or household.

## Architecture

```
browser ── UI (static SPA) ──► agent (Node, on the LAN) ──► Proxmox API :8006
                                                        └──► SSH to guests/nodes
```

- **UI:** React + Vite SPA. Served by the agent, or deployed to Vercel/Netlify (`vercel.json`, `netlify.toml`).
- **Agent:** Fastify. Holds encrypted credentials, scans the LAN, bridges SSH over WebSockets, and runs provisioning jobs (in memory).
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
- Overview with stats and sparklines, a node list, and guests with live CPU, memory, IP and uptime.
- Guest power actions and delete; node reboot and shutdown with typed confirmation.
- In-browser SSH (xterm.js) using the app key, a password, or a pasted key; pop-out terminal tab; copy/paste, select all and sticky Ctrl/Alt/Shift keys.
- Templates: Claude Code server, Codex server, OpenCode server, AI dev box, Docker host, Plain server. Optional extras: tmux persistence, GitHub CLI, repo clone, git identity, Tailscale.
- Custom templates with typed options and a bash editor, plus install scripts fetched from a GitHub repository.
- Community Scripts: browse [community-scripts.org](https://community-scripts.org) and turn any container script into a template, with its options and resources prefilled.
- Guest updates: re-run the template's GitHub/inline install script, or the upstream Community Scripts update entrypoint, with the same live job log.
- Provisioning: LXC creation (auto-downloads the OS template) or cloud-init VM clone; IP discovery via LXC interfaces, guest agent, or ARP; live step and log view.
- ⌘K command palette; light and dark themes; phone layout with bottom tab bar; installable (web manifest).
- One-command install on a Proxmox host (`scripts/proxmox-install.sh`): autostarting LXC, systemd service, limited `proxmiu@pve` user/role, API token and host registration; `scripts/install.sh` for any Debian/Ubuntu box and for updates.

## Status

**Verified** against the mock Proxmox API with real SSH:
- LXC provisioning end to end (base, Claude Code, AI dev box scripts)
- browser terminal, same-origin and cross-origin
- auth, CORS and origin blocking
- hosted UI flow in Chromium; mobile layout in an iPhone viewport

**Not yet verified**
- Against a real Proxmox VE host.
- The QEMU/cloud-init clone path (never executed).
- Completing the Claude Code / Codex installs (sandbox network blocked the downloads; failure handling verified).
- HTTPS agent mode (`PROXMIU_TLS=1`) in a browser, and the Tailscale route on a real iPhone.
- Chrome LNA behaviour for WebSockets (terminal) from a hosted https page.
- Actual Vercel/Netlify deploys (tested with a local static server).
- The install scripts on a real Proxmox host. They were tested end to end with stubbed `pct`/`pveam`/`pveum` and a real install of the agent, but `pct create` and `pveum` never ran for real.

## Roadmap / open items

- [x] README screenshots (`docs/screenshots/`).
- [ ] Validate against a real Proxmox host; fix API differences from the mock.
- [ ] Exercise the VM clone path; consider a helper that builds a cloud-init template.
- [ ] Persist provisioning jobs across agent restarts.
- [ ] Demo mode for the hosted site (client-side mock data) so visitors see the app without an agent.
- [ ] Guest detail page (config, console via Proxmox termproxy, snapshots).
- [ ] Watch WebKit Local Network Access; drop the iOS HTTPS requirement when it ships.
- [ ] Optionally squash branch history (the first commit contains an earlier logo).

## Configuration

See the README table. Key variables: `PROXMIU_PASSWORD`, `PROXMIU_ALLOWED_ORIGINS`, `PROXMIU_TLS`, `PROXMIU_TLS_CERT`/`KEY`, `HOST`, `PORT`, `PROXMIU_DATA_DIR`, `PROXMIU_SECRET_KEY`.
