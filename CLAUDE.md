# CLAUDE.md

Guidance for AI assistants working in this repo. Read `project.md` for what the product is and `design.md` before touching UI.

## Commands

```bash
npm install
npm run dev        # agent (tsx watch, :8787) + Vite (:5173, proxies /api incl. WebSockets)
npm run mock       # fake Proxmox API on https://127.0.0.1:8006 — token root@pam!proxmiu, secret "mock"
npm run build      # UI → dist/web, agent → dist/server (+ copies server/src/scripts)
npm run build:web  # UI only (what Vercel/Netlify run)
npm start          # node dist/server/index.js
npm run typecheck  # both tsconfigs
npm test           # node:test suite in server/test
```

Run `npm run typecheck && npm test && npm run build` before committing.

## Layout

```
server/src/
  index.ts        Fastify app: auth, CORS/origin checks, all /api routes, static UI, WebSocket /api/ssh
  proxmox.ts      Proxmox API client (token or ticket auth, task polling, guestIp)
  provision.ts    Job runner: create/update guests → find IP → SSH → run template or update script
  templates.ts    Built-in templates + zod schema + buildScript()/buildUpdateScript()
  template-sources.ts  GitHub scripts, Community Scripts catalogue and install/update resolution
  scripts/        helpers.sh (helper functions), prelude.sh (base setup), epilogue.sh (optional extras)
  ssh.ts          ssh2 exec for provisioning, xterm WebSocket bridge
  network.ts      LAN discovery, CIDR expansion, ARP lookup
  store.ts        data/state.json, AES-256-GCM secrets, HMAC signing, app SSH key
  tls.ts          optional HTTPS (self-signed or PROXMIU_TLS_CERT/KEY)
server/dev/mock-proxmox.ts   fake Proxmox for development and tests
scripts/install.sh           installs/updates the agent as a systemd service (Debian/Ubuntu)
scripts/update.sh            updates an existing agent via install.sh; installed as proxmiu-update
scripts/proxmox-install.sh   run on a PVE host: creates an autostarting LXC, runs install.sh, registers the host
server/test/                 node:test unit tests
web/src/
  lib/agent.ts    agent URL + token (localStorage), Local Network Access helpers, agentFetch
  lib/api.ts      typed API client and shared types
  lib/queries.ts  TanStack Query hooks
  components/ui/  primitives (button, card, form, badge, dialog, dropdown, switch)
  components/     Layout (sidebar + mobile tab bar), CommandPalette, GuestTable, Terminal, SshDialog, …
  pages/          one file per route; Connect.tsx is the agent connect/login screen
```

## Architecture rules

- **The UI never talks to Proxmox directly.** Everything goes through the agent. Proxmox sends no CORS headers and the UI may be hosted on Vercel/Netlify, which can't reach the LAN.
- **All agent calls go through `api` / `agentFetch` / `agentWsUrl`** in `web/src/lib`. They add the bearer token and Chrome's `targetAddressSpace`. Never use bare `fetch('/api/…')` in components.
- **Auth is stateless bearer tokens** (`<expiry>.<hmac>`), not cookies, because cookies don't work cross-site. The WebSocket gets its token in the first `connect` message, since browsers can't set WebSocket headers.
- **Provisioning runs over SSH** with the app key, which Proxmox injects as `ssh-public-keys` (LXC) or `sshkeys` (cloud-init). Template scripts must be idempotent and work on Debian and Ubuntu.
- **Guest updates re-run the template body without the base setup.** The template is found from the `proxmiu;<id>` Proxmox tag. GitHub/inline templates use `buildUpdateScript()`; Community Scripts guests run `/usr/bin/update`.

## Security invariants (do not weaken)

- The agent refuses to bind beyond loopback without `PROXMIU_PASSWORD`, and refuses `PROXMIU_ALLOWED_ORIGINS` without a password.
- `originAllowed()` runs on every `/api` request, WebSocket upgrades included. CORS alone does not protect WebSockets or simple requests.
- Without a password, only loopback `Host` headers are accepted (DNS-rebinding guard).
- Secrets are encrypted at rest and redacted from job logs (`secretValues` in provision.ts). Never log request bodies.
- Destructive UI actions (delete guest, node reboot/shutdown) require typing the name.

## Gotchas this codebase already hit

- **ssh2 is CommonJS.** Use `import ssh2 from 'ssh2'` then `ssh2.Client` / `ssh2.utils`. Named imports typecheck but crash at runtime.
- **Bash lives in `.sh` files, not JS template literals.** `${VAR}` inside a template literal is JS interpolation. Inline template scripts in templates.ts must escape `\${…}`.
- **`curl … | bash` hides download failures** (bash runs an empty script and exits 0). Use `set -o pipefail` in the sub-shell and verify the tool afterwards (`claude --version`).
- **Fastify static (`wildcard: false`) registers routes at startup.** After rebuilding the UI, restart the agent, or new hashed assets return index.html.
- **`guestIp()` ignores 127.x, 169.254.x and 172.17.x.** The mock must hand out a real interface IP (`MOCK_GUEST_IP`) for end-to-end provisioning tests.
- **Proxmox `sshkeys` for QEMU must be URL-encoded on top of form encoding.** LXC `ssh-public-keys` must not be.
- **React hooks before early returns.** Overview has an early return for the empty state; keep hooks above it.
- **Shell hygiene in this sandbox:** `pkill -f <pattern>` matches the running shell's own command line and kills it. Use `pgrep -f "foo[.]bar"` with a bracket so the pattern doesn't match itself, or kill by PID.

## Testing end to end

1. `npm run mock` (set `MOCK_GUEST_IP` to this machine's LAN IP for provisioning).
2. Start the agent and add the connection `127.0.0.1`, token `root@pam!proxmiu`, secret `mock`.
3. For provisioning, run a throwaway sshd with `-o AuthorizedKeysFile=<scratch file containing the app public key>` bound to that IP. Don't modify `/root/.ssh`.
4. Drive the UI with Playwright (preinstalled; `require('playwright')`).

## Install scripts

- `scripts/*.sh` must pass `shellcheck -S warning` and stay idempotent: re-running `install.sh` is the update path and must keep `/etc/proxmiu/proxmiu.env` and `/var/lib/proxmiu`.
- `install.sh` runs as root on a checkout owned by the `proxmiu` user, so git calls go through `git -c safe.directory=…`.
- `proxmox-install.sh` grants the `Proxmiu` role only the privileges in `PROXMIU_PRIVS`. When the agent starts using a new Proxmox endpoint, add its privilege there and to the README's manual setup.
- Test `proxmox-install.sh` with stubbed `pct`/`pveam`/`pvesm`/`pvesh`/`pveum`/`ip`/`systemctl` on PATH, where `pct exec ID -- cmd` runs `cmd` locally.

## Conventions

- TypeScript strict, ESM, 2-space indent, no semicolons, single quotes.
- Comments explain *why*, sparingly.
- UI copy: sentence case, verbs on buttons ("Create container", "Connect"), empty states say what will appear.
- No third-party or company branding. The product is "Proxmiu" with its own logo (`web/public/logo.svg`).
