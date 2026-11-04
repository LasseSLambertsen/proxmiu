# Proxmiu

A modern web app for managing Proxmox VE on your local network: find hosts, start/stop/reboot guests, open SSH terminals in the browser, and spin up ready-to-use servers from templates, including remote **Claude Code**, **Codex** and **OpenCode** boxes.

[![CI](https://github.com/LasseSLambertsen/proxmiu/actions/workflows/ci.yml/badge.svg)](https://github.com/LasseSLambertsen/proxmiu/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Website](https://img.shields.io/badge/website-proxmiu.com-5b3fe4)](https://proxmiu.com/)

![Proxmiu overview](docs/screenshots/overview.png)

Screenshots use synthetic data from the bundled Proxmox mock. They do not show a real Proxmox host.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/task-history.png" alt="Native Proxmox task history in Activity" /><br /><sub><b>Native history</b>: retained Proxmox tasks, source filters and actual results</sub></td>
    <td width="50%" align="center"><img src="docs/screenshots/mobile-history-log.png" width="240" alt="Historical task logs on a phone" /><br /><sub><b>Reopen logs</b>: refresh history after restarting the agent</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/guest-resources.png" alt="Stopped guest resource configuration" /><br /><sub><b>Resource settings</b>: reviewed CPU, memory and start-at-boot edits</sub></td>
    <td width="50%"><img src="docs/screenshots/guest-task-log.png" alt="Diagnostic log from a tracked snapshot task" /><br /><sub><b>Task logs</b>: native Proxmox output, with paging and clear limits</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/guest-operations.png" alt="Snapshot task completion, backup storage and migration controls" /><br /><sub><b>Advanced operations</b>: snapshots, backups and migration with actual task results</sub></td>
    <td width="50%"><img src="docs/screenshots/ai-settings.png" alt="Optional AI provider token settings and inventory privacy explanation" /><br /><sub><b>Optional AI advice</b>: your encrypted token, reviewed metrics and explicit consent</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/guest-detail.png" alt="Guest workspace with performance history, configuration and notes" /><br /><sub><b>Guest workspace</b>: real history, configuration, notes and your important machines pinned close</sub></td>
    <td width="50%"><img src="docs/screenshots/bulk-actions.png" alt="Individual results for a reviewed batch of power requests" /><br /><sub><b>Batch requests</b>: review the targets and see an outcome for every guest</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/guests.png" alt="Guests with live usage and actions" /><br /><sub><b>Guests</b>: live status, addresses and usage, with one-click SSH, reboot and more</sub></td>
    <td width="50%"><img src="docs/screenshots/create.png" alt="Create a Claude Code server" /><br /><sub><b>Create</b>: a Claude Code server from a template, with every setting adjustable</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/activity.png" alt="Provisioning log" /><br /><sub><b>Activity</b>: each step and the full install log, live</sub></td>
    <td><img src="docs/screenshots/terminal.png" alt="SSH terminal in the browser" /><br /><sub><b>Terminal</b>: SSH into any guest or node from the browser</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/command-palette.png" alt="Command palette" /><br /><sub><b>⌘K</b>: jump to any guest, template or page</sub></td>
    <td><img src="docs/screenshots/overview-light.png" alt="Light mode" /><br /><sub><b>Light mode</b></sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/connect.png" alt="Connect to an agent from a hosted UI" /><br /><sub><b>Hosted UI</b>: connect a Vercel/Netlify deployment to your agent</sub></td>
    <td align="center">
      <img src="docs/screenshots/mobile-overview.png" alt="Overview on iPhone" width="45%" />
      <img src="docs/screenshots/mobile-guests.png" alt="Guests on iPhone" width="45%" /><br /><sub><b>On iPhone</b>: bottom tabs, installable to the home screen</sub>
    </td>
  </tr>
</table>

<sub>Screenshots use the bundled mock Proxmox API (<code>npm run mock</code>).</sub>

## How it fits together

```
 browser ──► Proxmiu UI ──────────────► Proxmiu agent ──► Proxmox API (:8006)
             (Vercel, Netlify,          (on your LAN)  └─► SSH to guests and nodes
              or served by the agent)
```

The **UI** is a static single-page app. Host it on Vercel or Netlify, or let the agent serve it. The [project website](https://proxmiu.com/) is a separate static presentation page, not the app.

The **agent** is a small Node service that runs on your network (Docker, or any machine with Node 20+). It talks to Proxmox, scans the LAN, opens SSH sessions and runs provisioning. Cloud hosts can't reach your LAN, so this part always runs at home. The UI only ever talks to the agent, straight from your browser.

## Features

- **Guest workspaces** – open any guest for its configuration, network interfaces and disks, current usage, and CPU, memory, network and disk history over an hour, day or week. History comes from Proxmox RRD; unavailable data stays clearly marked.
- **Pins and notes** – keep important guests on the overview and edit the existing Proxmox notes for each guest. Pins live on the agent and follow the guest across node migrations. Notes read and save the guest’s existing Proxmox description, shared with the Proxmox UI; older agent notes remain available for explicit recovery.
- **Your inventory** – combine status, guest type and node filters, sort by resource usage, save up to 20 named views per browser and agent, and export the visible inventory as CSV.
- **Bulk power requests** – select up to 50 guests, review the targets, and start, reboot or gracefully shut them down. Requests run two at a time with a result for every guest. Accepted requests and completed power changes are shown separately through the results and live status.
- **Health at a glance** – spot unavailable connections, offline nodes and guests currently using at least 90% of their allocated CPU or memory. These are current readings, not background alert notifications.
- **Snapshots, backups and migration** – create snapshots, roll back or delete with typed confirmation, start a snapshot-mode backup to eligible storage, and migrate to another online node. HA-managed guests use Proxmox HA controls. Track the actual Proxmox task through completion or failure. Storage and guest compatibility are checked by Proxmox; LXC migration can restart the container.
- **Resource settings** – review and change cores per socket, memory in MiB and start-at-boot behavior while a guest is stopped. Pending changes and stale configuration digests block saves, and drafts survive failures. Changes take effect at the next full start.
- **Existing backups** – browse this guest’s archives on a selected backup storage, with creation dates, sizes, formats and clear permission warnings.
- **Native task history** – browse Proxmox-retained tasks in Activity or a guest workspace, choose a connection/node, filter by guest ID and inspect actual results. Operations started outside Proxmiu are included when permitted by Proxmox. History can reopen older task logs after an agent restart.
- **Task logs** – inspect native task output, page through additional lines, and retain loaded output after failed refreshes. Access stays tied to the original connection and node.
- **Optional AI setup review** – add an OpenAI, Anthropic or OpenRouter API token in Settings. The agent encrypts it at rest. Preview the anonymous numeric resource snapshot and explicitly send it for advice. Names, addresses, notes, credentials, logs and configuration are excluded; advice never changes your infrastructure automatically. Provider usage is billed by your provider.
- **Lynx companion** – a visible companion button brings the mascot into the app; five quick logo clicks still work. Dismiss it with Escape or the close button. Reduced motion is respected.
- **Discovery** – scans the subnets the agent is on for Proxmox (port 8006) and connects with an API token or password.
- **Overview** – nodes, VMs and containers across all connections with live CPU, memory, IP addresses and uptime.
- **Power actions** – start, shut down, reboot, force stop and delete guests; reboot or shut down nodes.
- **SSH in the browser** – full terminal to any guest or node, with copy/paste, select all, and on-screen Ctrl/Alt/Shift plus navigation keys for phones.
- **Templates** – one-click LXC containers (or VMs cloned from a cloud-init template), provisioned over SSH with a live log:
  - **Claude Code server**, **Codex server**, **OpenCode server**, **AI dev box** (all three), **Docker host**, **Plain server**
  - Optional: persistent tmux sessions, GitHub CLI + token, clone a repo, git identity, Tailscale
  - Install scripts come from [proxmiu-scripts](https://github.com/LasseSLambertsen/proxmiu-scripts), with an embedded fallback if GitHub is unavailable.
- **Custom templates** – duplicate a built-in or write your own bash script with typed options, or point a template at a script in a GitHub repository.
- **Guest updates** - re-run the template's install script, or use the upstream Community Scripts update path, from the guest menu.
- **Agent self-update** - opt-in Settings card that checks the configured upstream ref for a newer commit; the update runs in a transient systemd unit and reloads the page when the agent is back.
- **Command palette** – <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump to any guest, page or template.
- **Community Scripts** - browse [community-scripts.org](https://community-scripts.org) and turn any container app into a template; the installer runs inside the guest.

## 1. Run the agent

### On your Proxmox host (recommended)

Open a shell on the Proxmox host (in the web UI: select the node → **Shell**, or SSH in as root) and run:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/LasseSLambertsen/proxmiu/main/scripts/proxmox-install.sh)"
```

> **While the repository is private**, give the script a GitHub token with read access to it:
>
> ```bash
> export GITHUB_TOKEN=github_pat_...
> bash -c "$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://raw.githubusercontent.com/LasseSLambertsen/proxmiu/main/scripts/proxmox-install.sh)"
> ```

In about three minutes you get the address and password. The script:

1. Downloads the latest Debian 12 container template, if the host doesn't have it.
2. Creates an unprivileged container (`proxmiu`, 2 cores, 1 GiB RAM, 8 GiB disk, DHCP on `vmbr0`). It is set to **start at boot** and tagged `proxmiu`.
3. Installs Node.js and the agent inside it as a **systemd service** that restarts on failure, with a generated password.
4. Creates a Proxmox user `proxmiu@pve` with a **limited `Proxmiu` role** (inventory, power actions, creating and deleting guests, template downloads, node reboot; no user, storage or cluster administration) and an API token `proxmiu@pve!agent-<CTID>`, then **adds this host to the agent**, so it shows up immediately.
5. Asks whether to trust the agent's SSH key for root on this host, so you can open terminals to the node from the browser. On a cluster this applies to every node.

The agent runs in its own container, so nothing is installed on the Proxmox host itself.

**Options:** set any of these in front of the command.

| Variable | Default | |
|---|---|---|
| `CTID` | next free ID | Container ID |
| `CT_HOSTNAME` | `proxmiu` | |
| `STORAGE` | first active container storage | e.g. `local-lvm`, `local-zfs` |
| `BRIDGE` | `vmbr0` | |
| `IP` / `GW` | DHCP | Static address, e.g. `IP=192.168.1.40/24 GW=192.168.1.1` |
| `CORES` / `MEMORY` / `DISK` | `2` / `1024` / `8` | MiB for memory, GiB for disk |
| `PROXMIU_PASSWORD` | generated | |
| `PROXMIU_ALLOWED_ORIGINS` | – | Your hosted UI, e.g. `https://proxmiu.vercel.app` |
| `PROXMIU_TLS` | `0` | `1` to serve HTTPS (needed for a hosted UI, see below) |
| `CONNECT_HOST` | `1` | `0` to skip creating the API token and adding this host |
| `FULL_ACCESS` | `0` | `1` to use a `root@pam` token instead of the limited `proxmiu@pve` user |
| `ADD_SSH_KEY` | ask | `1` or `0` to answer the SSH key question up front |

For example, a static IP with the hosted UI enabled:

```bash
IP=192.168.1.40/24 GW=192.168.1.1 PROXMIU_TLS=1 PROXMIU_ALLOWED_ORIGINS=https://proxmiu.vercel.app \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/LasseSLambertsen/proxmiu/main/scripts/proxmox-install.sh)"
```

**Day to day** (from the Proxmox host shell, with your container ID):

```bash
pct exec <CTID> -- /usr/local/bin/proxmiu-update              # update to the latest version
pct exec <CTID> -- journalctl -u proxmiu -f                  # follow the logs
pct exec <CTID> -- nano /etc/proxmiu/proxmiu.env             # change password, origins, TLS…
pct exec <CTID> -- systemctl restart proxmiu                 # …then restart
```

Updates keep your password, settings, connections and SSH key. Set `PROXMIU_REF` to update to a branch or tag, e.g. `pct exec <CTID> -- env PROXMIU_REF=dev /usr/local/bin/proxmiu-update`.

To update from the Proxmox UI, enable self-update once:

```bash
pct exec <CTID> -- env PROXMIU_ALLOW_SELF_UPDATE=1 /opt/proxmiu/scripts/install.sh
```

Then use **Settings → Update agent**. This installs a narrow root helper; see [Security](#security).

**Uninstall:**

```bash
pct stop <CTID> && pct destroy <CTID>
pveum user token remove proxmiu@pve agent-<CTID>
# if no other agent uses them: pveum user delete proxmiu@pve && pveum role delete Proxmiu
# and delete the "proxmiu" line from /root/.ssh/authorized_keys if you added the key
```

### On any Debian or Ubuntu machine

The same installer works on any always-on Debian/Ubuntu box or VM with systemd. Run as root:

```bash
curl -fsSL https://raw.githubusercontent.com/LasseSLambertsen/proxmiu/main/scripts/install.sh | bash
```

It installs to `/opt/proxmiu`, stores data in `/var/lib/proxmiu` and settings in `/etc/proxmiu/proxmiu.env`, and enables the `proxmiu` service at boot. It installs `proxmiu-update` for later updates. It accepts the same `PROXMIU_*` variables. Afterwards, add your Proxmox host under **Connections**.

To update later, run as root:

```bash
proxmiu-update
# or, without the command: /opt/proxmiu/scripts/update.sh
```

To enable the **Settings → Update agent** button on Debian/Ubuntu, run the installer once with:

```bash
sudo env PROXMIU_ALLOW_SELF_UPDATE=1 /opt/proxmiu/scripts/install.sh
```

### With Docker

```bash
git clone https://github.com/LasseSLambertsen/proxmiu.git && cd proxmiu
cp .env.example .env        # set PROXMIU_PASSWORD
docker compose up -d --build
```

`restart: unless-stopped` brings it back after reboots.

Whichever way you install, open `http://<agent-address>:8787`. The agent serves the UI itself, so this is all you need for a self-hosted setup.

## 2. (Optional) Host the UI on Vercel or Netlify

The repo includes `vercel.json` and `netlify.toml`. Import it in either dashboard, with no settings to change. The build runs `npm run build:web` and publishes `dist/web`.

Then allow that site to use your agent, and serve the agent over HTTPS. Browsers block `http://` requests from an `https://` page unless the target is `localhost`.

```bash
# .env on the agent machine
PROXMIU_PASSWORD=something-long
PROXMIU_ALLOWED_ORIGINS=https://your-proxmiu.vercel.app
PROXMIU_TLS=1
```

Restart the agent, open the hosted site, and enter `https://<agent-machine>:8787`.

With `PROXMIU_TLS=1` the agent generates a self-signed certificate. Visit `https://<agent-machine>:8787` once and accept it, then connect from the hosted UI. To avoid the warning, pass your own certificate with `PROXMIU_TLS_CERT` and `PROXMIU_TLS_KEY`, or put the agent behind Tailscale or a reverse proxy with a real certificate.

### Project website

Live at **<https://proxmiu.com/>**. The source is [LasseSLambertsen/proxmiu-site](https://github.com/LasseSLambertsen/proxmiu-site), a static site with no build step deployed on Netlify with a custom domain. It is a landing page about the project, not the app.

### Browser support for hosted UIs

| Browser | `http://` agent on a LAN IP | Notes |
|---|---|---|
| Chrome / Edge desktop (142+) | Works | Chrome asks to allow access to local network devices. The terminal may still need an `https://` agent. |
| Safari, and every browser on iOS | Blocked | WebKit hasn't shipped Local Network Access yet. Use an `https://` agent with a trusted certificate. |
| Firefox | Blocked | Use an `https://` agent. |

No browser lets a web page *discover* devices on your network. Scanning always happens in the agent.

### iPhone and iPad

iOS needs the agent on HTTPS with a trusted certificate. The easiest way is [Tailscale](https://tailscale.com), which also works away from home:

```bash
# on the agent machine, with Tailscale installed and HTTPS enabled for your tailnet
tailscale serve --bg 8787
```

With the Tailscale app on, connect to `https://<machine>.<tailnet>.ts.net`. To install Proxmiu as an app, use Safari's Share → Add to Home Screen.

## 3. Connect Proxmox

The Proxmox installer does this for you. To add a host by hand, create a limited user and token in a shell on that host:

```bash
pveum role add Proxmiu --privs "Sys.Audit,Sys.PowerMgmt,VM.Audit,VM.PowerMgmt,VM.Allocate,VM.Clone,VM.Snapshot,VM.Snapshot.Rollback,VM.Backup,VM.Migrate,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.Options,VM.Config.Cloudinit,VM.Config.HWType,Datastore.Audit,Datastore.AllocateSpace,Datastore.AllocateTemplate,SDN.Audit,SDN.Use,VM.GuestAgent.Audit"
pveum user add proxmiu@pve
pveum acl modify / --users proxmiu@pve --roles Proxmiu
pveum user token add proxmiu@pve agent --privsep 0
```

On Proxmox VE 8, replace `VM.GuestAgent.Audit` with `VM.Monitor`. Then go to **Connections → Scan → Connect** in Proxmiu, with token ID `proxmiu@pve!agent` and the secret printed above.

For the quickest test setup, `pveum user token add root@pam proxmiu --privsep 0` also works, but that token has full root access.

### Existing installations: enable advanced guest operations

Updating Proxmiu does not elevate an existing connection's privileges. An administrator can extend the existing `Proxmiu` role on the Proxmox host:

```bash
pveum role modify Proxmiu --append 1 --privs "VM.Snapshot,VM.Snapshot.Rollback,VM.Backup,VM.Migrate"
```

Editing notes also needs `VM.Config.Options`; backup storage needs `Datastore.Audit` and `Datastore.AllocateSpace`, already included in the setup above. With a privilege-separated token, grant the required rights to both the user and token. Permission errors stay visible in Proxmiu. These features do not manage backup schedules, storage, firewall, users or cluster membership. Snapshot rollback can discard changes after the snapshot; keep independent backups.

Tasks started through the workspace are immediately available. After an agent restart, browse native task history and select the operation to reopen its status and logs before retrying it. Availability depends on Proxmox retention and token permissions. If historical task access expires, refresh history and select the task again. No real Proxmox host or live AI account has been used for verification; the test suite uses isolated fixtures and a mock Proxmox API.

## How creating a server works

1. Picks the next free VMID, and downloads the Debian/Ubuntu container template if the node does not have it.
2. Creates an unprivileged container (nesting on for dev templates) with the agent's SSH key and your own keys, then starts it.
3. Waits for an IP: container interfaces, the QEMU guest agent, or the agent's ARP table for VMs without one.
4. SSHes in and runs the template: base setup (updates, a `dev` sudo user, your keys), the template script, then the optional extras.

When it's done you get `ssh dev@<ip>` and a button to open a terminal. For the AI templates, run `claude`, `codex` or `opencode`. Without an API key, you sign in on first run.

To update a guest later, open its menu on **Guests** and choose **Update…**. Proxmiu finds the template from the `proxmiu;<template>` tag and re-runs its install script; Community Scripts guests use their upstream `/usr/bin/update` entrypoint. The run shows up in **Activity** with a live log.

**VMs** need an existing cloud-init VM template on the node (see [Cloud-Init Support](https://pve.proxmox.com/wiki/Cloud-Init_Support)).

## Agent configuration

| Variable | Default | |
|---|---|---|
| `PROXMIU_PASSWORD` | – | Required unless listening on localhost only |
| `PROXMIU_ALLOWED_ORIGINS` | – | Comma-separated origins of hosted UIs allowed to use the agent |
| `PROXMIU_TLS` | – | `1` to serve HTTPS with a generated self-signed certificate |
| `PROXMIU_TLS_CERT` / `PROXMIU_TLS_KEY` | – | Paths to your own certificate and key |
| `HOST` | `127.0.0.1`, or `0.0.0.0` with a password | |
| `PORT` | `8787` | |
| `PROXMIU_DATA_DIR` | `./data` | State, encrypted credentials, SSH key, TLS certificate |
| `PROXMIU_SECRET_KEY` | generated | 32-byte base64 key for encrypting credentials and signing sessions |

## Security

The agent holds credentials that control your whole Proxmox setup.

- **Password:** it refuses to listen beyond localhost without `PROXMIU_PASSWORD`. Hosted UIs are only allowed when a password is set.
- **Sessions:** signed bearer tokens that expire after 30 days. Changing `PROXMIU_SECRET_KEY` signs everyone out.
- **Cross-site requests:** requests from origins not in `PROXMIU_ALLOWED_ORIGINS` are rejected, WebSockets included. Without a password, only loopback `Host` headers are accepted, which blocks DNS rebinding.
- **Credentials at rest:** encrypted with AES-256-GCM.
- **Host keys:** SSH host keys of guests are not pinned, since guests are created and rebuilt often.
- **Self-update:** off by default. When enabled, the `proxmiu` user may run only `/usr/local/bin/proxmiu-self-update`; the helper ignores the caller's environment and reads root-owned `/etc/proxmiu/update.env`. Disable it by re-running the installer with `PROXMIU_ALLOW_SELF_UPDATE=0`.

See [SECURITY.md](SECURITY.md) for the full policy and private reporting link.

## License

[MIT](LICENSE)

## Development

```bash
npm install
npm run mock       # fake Proxmox API on https://127.0.0.1:8006 (token root@pam!proxmiu, secret "mock")
npm run dev        # agent on :8787, Vite on :5173 with hot reload
npm run typecheck
npm test
npm run build
```

With Playwright available, `node web/test/outages.e2e.cjs` checks draft-note preservation and stale health states against isolated API fixtures after a build. `node web/test/lynx.e2e.cjs` checks visible companion controls and the logo Easter egg. Set `CHROMIUM_PATH` to use a system Chromium installation. Neither check contacts a Proxmox host.

Stack: Fastify, ssh2 and undici for the agent; React, TanStack Query, Tailwind CSS v4, Radix and cmdk for the UI, set in Geist.

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the setup, architecture rules and pull-request checklist.

`CHROMIUM_PATH=/usr/bin/chromium node web/test/advanced.e2e.cjs` checks Proxmox notes save/clear/conflict recovery, reviewed guest operations and task failures, plus optional AI settings and consent against isolated fixtures. `server/test/advanced-api.test.ts` also runs the authenticated agent against the bundled Proxmox mock; no live infrastructure or AI provider is contacted.

To reproduce current release screenshots after building, run `CHROMIUM_PATH=/usr/bin/chromium node scripts/capture-advanced.cjs`. It starts an isolated local agent and synthetic Proxmox mock, writes captures to `/tmp/proxmiu-release` (override `CAPTURE_DIR`), and cleans up the servers and agent data. AI remains unconfigured and no provider calls occur.

`CHROMIUM_PATH=/usr/bin/chromium node web/test/maintenance.e2e.cjs` verifies stopped-resource editing and conflict recovery, draft preservation through migration, backup inventory states, and escaped/paged task logs with a 2,000-line display limit. Resource edits use the existing `VM.Config.CPU`, `VM.Config.Memory` and `VM.Config.Options` permissions.

`CHROMIUM_PATH=/usr/bin/chromium node web/test/task-history.e2e.cjs` checks native source selection, guest filters, paging, result states, log access recovery, stale history during real-shaped outages, source races, existing provisioning deep links and phone layouts. Server integration tests exercise task log recovery across an actual agent restart. History reads use existing audit permissions and never stop or alter tasks.

### Chat with Lynx

Save an OpenAI, Anthropic or OpenRouter API key in Settings, then open the lynx companion to chat about Proxmox and Proxmiu. Messages are sent to your configured provider and model when you press Send; inventory, notes and logs are not attached automatically. Conversation stays in the open app’s memory and can be cleared. Existing inventory reviews in Settings retain their separate preview and consent flow. Without a configured key, the lynx keeps its pet interaction. Provider charges apply to chat requests.

For help with your actual setup, choose **Help with my setup**, select a guest and load its preview. Lynx can inspect the resource settings and available recent usage you explicitly agree to share. The preview excludes names, addresses, notes, logs, network/disk configuration and credentials; the guest identity and configuration digest stay on your agent. Previews expire and must be refreshed and approved again. Data already sent to your provider cannot be recalled by clearing chat.

Lynx can propose CPU cores per socket, memory in MiB and start-at-boot settings. Review the exact target and before/after values, then confirm **Apply changes**. The existing resource editor checks fresh configuration digests, stopped state, pending changes, topology and permissions. Lynx never shuts down a guest, runs shell commands or applies a proposal automatically. Missing history and unsupported configurations remain explicit; short usage history alone cannot establish a safe allocation.
