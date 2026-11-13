# Proxmiu

[Changelog](CHANGELOG.md) · [GitHub releases](https://github.com/LasseSLambertsen/proxmiu/releases) · [Release process](docs/releases.md)

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
- **Boot-device order** – inspect and reorder the same existing explicit enabled-device set on an eligible stopped VM, review before/after priorities and confirm by name. Device membership, firmware and power state remain unchanged; saved order does not prove boot success.
- **Existing backups** – browse this guest’s archives on a selected backup storage, with creation dates, sizes, formats and clear permission warnings.
- **Native task history** – browse Proxmox-retained tasks in Activity or a guest workspace, choose a connection/node, filter by guest ID and inspect actual results. Operations started outside Proxmiu are included when permitted by Proxmox. History can reopen older task logs after an agent restart.
- **Retained setup history** – provisioning and template-update runs survive agent restarts in an encrypted local journal. Interrupted runs keep the last saved steps and diagnostic tail, with manual recovery guidance; the agent never replays setup automatically.
- **Task logs** – inspect native task output, page through additional lines, and retain loaded output after failed refreshes. Access stays tied to the original connection and node.
- **Optional AI setup review** – add an OpenAI, Anthropic or OpenRouter API token in Settings. The agent encrypts it at rest. Preview the anonymous numeric resource snapshot and explicitly send it for advice. Names, addresses, notes, credentials, logs and configuration are excluded; advice never changes your infrastructure automatically. Provider usage is billed by your provider.
- **Lynx companion** – a visible companion button brings the mascot into the app; five quick logo clicks still work. Dismiss it with Escape or the close button. Reduced motion is respected.
- **Discovery** – scans the subnets the agent is on for Proxmox (port 8006) and connects with an API token or password.
- **Saved connection settings** – rotate a token/password, rename a connection or adjust TLS verification without deleting its identity, guest pins or history. Proposed settings are verified before saving; stale edits and failed checks preserve the saved connection.
- **Overview** – nodes, VMs and containers across all connections with live CPU, memory, IP addresses and uptime.
- **Power actions** – start, shut down, reboot, force stop and delete guests; reboot or shut down nodes.
- **SSH in the browser** – full terminal to any guest or node, with copy/paste, select all, and on-screen Ctrl/Alt/Shift plus navigation keys for phones.
- **Native guest console** – Proxmox termproxy for running LXC guests and VMs with an existing serial socket, without a guest IP or SSH service. Connect explicitly from the guest workspace; guest login may be required.
- **Templates** – one-click LXC containers (or VMs cloned from a cloud-init template), provisioned over SSH with a live log:
  - **Claude Code server**, **Codex server**, **OpenCode server**, **AI dev box** (all three), **Docker host**, **Plain server**
  - Optional: persistent tmux sessions, GitHub CLI + token, clone a repo, git identity, Tailscale
  - Install scripts come from [proxmiu-scripts](https://github.com/LasseSLambertsen/proxmiu-scripts), with an embedded fallback if GitHub is unavailable.
- **Custom templates** – duplicate a built-in or write your own bash script with typed options, or point a template at a script in a GitHub repository.
- **Guest updates** - re-run the template's install script, or use the upstream Community Scripts update path, from the guest menu.
- **Agent self-update** - opt-in Settings card that checks the configured upstream ref for a newer commit; the update runs in a transient systemd unit and reloads the page when the agent is back.
- **Reviewed host updates** - opt in from a node’s Updates menu, enroll a dedicated restricted helper, review every package/version and type the node name before installation. Durable host jobs recover through Settings after disconnects. See [host update setup and recovery](docs/proxmox-host-updates.md).
- **Command palette** – <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump to any guest, page or template.
- **Community Scripts** - browse [community-scripts.org](https://community-scripts.org) and turn any container app into a template; the installer runs inside the guest.

Container creation honors the template's nesting setting without automatically enabling root-only feature flags such as `keyctl`. For unprivileged containers, this avoids requesting features the installer's limited account cannot set. Apps that require additional container features need deliberate administrator configuration in Proxmox; Proxmiu does not grant privileges or retry creation as root.

Automatic Community Scripts OS selection uses the script's declared default. Older known-default imports lose their generic fallback choices at read time; old guessed defaults are treated as unknown rather than requirements. A cached older OS cannot take priority over downloading the declared default, and failure to find or download it stops creation. Refresh missing or outdated metadata from Community Scripts before choosing an OS. The form's manual image list contains Debian/Ubuntu; other distributions are outside that picker. Explicit choices remain overrides and must be compatible with the app. Ordinary templates may still use their allowed cached fallback if the catalogue is unavailable. These changes do not upgrade, delete or replace existing guests or overwrite saved template records.

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
pveum role add Proxmiu --privs "Sys.Audit,Sys.PowerMgmt,VM.Audit,VM.PowerMgmt,VM.Allocate,VM.Clone,VM.Console,VM.Snapshot,VM.Snapshot.Rollback,VM.Backup,VM.Migrate,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.Options,VM.Config.Cloudinit,VM.Config.HWType,Datastore.Audit,Datastore.AllocateSpace,Datastore.AllocateTemplate,SDN.Audit,SDN.Use,VM.GuestAgent.Audit"
pveum user add proxmiu@pve
pveum acl modify / --users proxmiu@pve --roles Proxmiu
pveum user token add proxmiu@pve agent --privsep 0
```

On Proxmox VE 8, replace `VM.GuestAgent.Audit` with `VM.Monitor`. Then go to **Connections → Scan → Connect** in Proxmiu, with token ID `proxmiu@pve!agent` and the secret printed above.

For the quickest test setup, `pveum user token add root@pam proxmiu --privsep 0` also works, but that token has full root access.

### Update saved credentials and TLS

In **Connections**, choose **Edit** on a saved connection. Change its name, token/password or certificate verification, then choose **Test** or **Save changes**. Save always verifies the proposed settings again. The existing secret stays on the agent; leave the replacement field blank to keep it. Changing the username or authentication method requires a new secret. Credentials remain encrypted at rest.

The connection keeps its ID, guest metadata and retained history. Its host and port stay fixed; add another connection to use a different destination. A failed check leaves the saved settings untouched. If another edit wins, the draft remains until you explicitly reload saved settings. Saving is blocked while this connection has a running provisioning/update job; try again after it finishes.

Open terminals keep their current session; reconnect to use updated credentials. Changing saved credentials does not revoke the old token or password in Proxmox. Revoke old credentials separately when appropriate. No additional Proxmox privileges are needed for this feature. Older agents need an update before editing is supported.

### Existing installations: enable advanced guest operations

Updating Proxmiu does not elevate an existing connection's privileges. An administrator can extend the existing `Proxmiu` role on the Proxmox host:

```bash
pveum role modify Proxmiu --append 1 --privs "VM.Snapshot,VM.Snapshot.Rollback,VM.Backup,VM.Migrate"
```

Editing notes also needs `VM.Config.Options`; backup storage needs `Datastore.Audit` and `Datastore.AllocateSpace`, already included in the setup above. With a privilege-separated token, grant the required rights to both the user and token. Permission errors stay visible in Proxmiu. These features do not manage backup schedules, storage, firewall, users or cluster membership. Snapshot rollback can discard changes after the snapshot; keep independent backups.

Tasks started through the workspace are immediately available. After an agent restart, browse native task history and select the operation to reopen its status and logs before retrying it. Availability depends on Proxmox retention and token permissions. If historical task access expires, refresh history and select the task again. No real Proxmox host or live AI account has been used for verification; the test suite uses isolated fixtures and a mock Proxmox API.

## Reorder existing VM boot devices

In a stopped QEMU VM workspace, choose **Inspect boot order**, then reorder its existing enabled devices with the arrow controls. Review the before/after priorities and type the native VM name before saving. The next start may boot another OS or installer, or fail to boot; Proxmiu does not start the VM or test bootability.

This first increment requires an explicit order with at least two supported existing targets: ordinary storage-backed data disks, configured storage ISO CD-ROMs and ordinary configured NICs. It preserves the enabled set and every configured device. Adding/removing or enabling/disabling targets, legacy/default conversion, cloud-init/host devices and firmware editing remain outside this editor. A single unsupported enabled target makes the whole order read-only. Existing `bootdisk`, custom arguments and visible native cleanup hazards also block editing: a native boot-order write can otherwise remove legacy settings or duplicate unused references.

Five-minute single-use reviews bind the fixed VM/device identities, native digest and connection revision. Fresh checks require stopped state, no pending changes, snapshots or active/unconfirmed tasks, verified unmanaged HA state and complete exact-node task visibility. Existing `VM.Config.Disk`, guest audit and exact-node `Sys.Audit` rights apply; no role is elevated. Keep the VM stopped until saving finishes; another administrator can still start it after preflight.

Native PUT is synchronous, with no native task or log. A verified result means the requested order and unrelated returned current-configuration values were freshly checked; it does not prove media availability, bootloader, PXE or OS startup. Uncertain submission or failed verification never triggers retry, rollback, power or cleanup. Inspect current order, devices and pending changes before another explicit review, including after closing or restarting the agent. Read failures retain the last successful observation without treating it as current. Real PVE 8/9 SeaBIOS/OVMF, media and startup validation remains pending.

## Configure an existing NIC’s link state

In a stopped guest workspace, choose **Inspect network links**, then **Edit link state** for an eligible device. Select connected or disconnected **on next start**, review the fixed NIC/MAC/bridge/VLAN and before/after state, then type the reviewed guest name. This is configured device state, not a test of live network reachability. A disconnected device will not carry ordinary guest traffic; remote services may become unreachable when the guest next starts.

This first increment changes only `link_down` on an existing ordinary `net0`–`net31`. QEMU supports the common virtio/e1000/e1000e/rtl8139/vmxnet3 models; LXC supports ordinary veth with an explicit interface name. Existing MAC spelling, model/name, bridge, VLAN, addressing, firewall, rate, MTU and queues are preserved in the submitted property string. Unknown or ambiguous options, missing identities, trunks, host-managed LXC devices and custom low-level container configuration remain read-only. Adding/removing NICs, bridge/VLAN changes and host/SDN networking are separate roadmap work. Keeping the exact bridge/MAC avoids the native stopped-update IPAM branch that changing them can invoke.

Reviews expire after five minutes and are single-use, with fresh current configuration/digest, pending/snapshot, stopped/HA, node and complete native-task checks before submission. Keep the guest stopped until the update finishes; another administrator can still start it between checks. Existing `VM.Config.Network`, guest audit, exact-node `Sys.Audit` and relevant native `SDN.Use` rights apply; privilege-separated tokens need intended rights on both user and token. No role is elevated automatically.

Native configuration PUT is synchronous and has no native task log. Proxmiu verifies fresh interface/configuration/pending/runtime state before reporting success. An error or lost reply can follow a partial native write: inspect current interface and pending changes before another explicit review. The dialog retains stale drafts and last successful observations, but does not automatically retry, roll back, clean up or change guest power. After closing or an agent restart, inspect the configured interface again; old review IDs cannot replay. Verification uses local TLS/agent/API and browser fixtures; actual PVE 8/9 traffic, native startup and connectivity validation remains pending designated test infrastructure.

## Grow an existing disk

In a guest workspace, choose **Inspect disk capacity**, then **Grow disk** for an eligible slot. Inspection reads actual storage metadata rather than configuration size hints or filesystem usage. Enter an absolute final capacity in whole GiB, review the disk, current/target size and available space, then type the reviewed guest name. Reviews expire after five minutes; submission rechecks the exact volume, ownership, configuration digest, stopped state and connection revision. A replacement volume requires closing and selecting again.

This first editor supports ordinary QEMU ide/sata/scsi/virtio raw/qcow2 disks and LXC rootfs/mp raw/subvol volumes on supported dir/lvm/lvmthin/zfspool combinations. It excludes optical/cloud-init/EFI/TPM/unused devices, bind mounts, passthrough, shared/read-only or linked-parent volumes, duplicate attachments, unknown metadata, snapshots, pending changes, locks, HA-managed guests and active or unconfirmed native tasks. Unsupported or unverifiable disks remain read-only. There is no shrink, move, detach, delete or automatic guest power action.

Keep the guest stopped until the task ends. Stopped state is an application preflight check; another administrator can still start the guest. Available storage is advisory, not reserved, and thin provisioning and other workloads affect capacity. QEMU growth requires separate partition/filesystem expansion inside the guest. For raw LXC volumes, Proxmox may check and repair the filesystem and expand it after volume growth; a later failure can leave a larger volume. ZFS subvolumes use quota changes. Native allocation can round the requested size, so the dialog reads actual capacity again and shows full observed bytes separately from the requested target and task result.

Accepted resize tasks use the original node/guest identity and retained native logs. Warnings, failures and unknown acceptance never trigger automatic retry, shrink or cleanup. Inspect **Activity → Proxmox tasks** and actual capacity before another explicit review; use **Refresh history** to load retained tasks after closing or restarting the agent. Failed capacity reads retain the last successful observation with an unconfirmed-current-state notice.

Existing setup rights cover this editor: `VM.Config.Disk`, `VM.Config.Options`, `Datastore.Audit`, `Datastore.AllocateSpace` and effective `Sys.Audit` on the node for complete active-task visibility, alongside existing guest audit rights. Privilege-separated tokens need the intended rights on both user and token. Proxmiu does not elevate an existing role. Verification uses local TLS/API/protocol and browser fixtures; designated PVE 8/9 allocation, filesystem and rounding validation remains pending.

## Restore a backup into a new guest

In a guest workspace, choose a backup storage and **Restore backup**. Choose an unused cluster-wide ID and disk storage on the same node, then **Review restore**. Confirm the archive, destination and identity warning; type the new ID before submitting. The review expires after five minutes and is single-use. The agent rechecks source/configuration, storage, ID availability and saved connection revision before sending a restore request.

Restoration creates a separate guest, with new network MAC addresses, `start=0` and `onboot=0`. Static IPs, hostname, OS machine ID and application identities can remain unchanged. Inspect the restored guest’s identity, configuration and actual state before starting it. Archive byte size is not restored disk allocation size. Failed or partial restores require manual inspection; uncertain acceptance never triggers automatic replay or cleanup.

This first increment supports ordinary VM VMA backups and unprivileged LXC TAR backups, including their configured Proxmox Backup Server volume equivalents. It rejects ambiguous archive identities, privileged/custom LXC configuration, additional mount points, passthrough, hook scripts, unavailable bridges and other unsupported dependencies. Existing guests cannot be overwritten. Cross-node backup transfer, legacy QEMU TAR and global/deleted-source backup browsing are not included.

The existing installation role already includes the relevant privileges: `VM.Allocate` for the new ID, `Datastore.AllocateSpace` for destination storage, and source backup access through `VM.Backup` plus `Datastore.AllocateSpace` on source storage (not just `Datastore.Audit`). Networks require `SDN.Use`; source/configuration inspection also uses the existing audit permissions. Privilege-separated tokens need the intended rights on both the token and user. No broad `Datastore.Allocate` or host-shell grant is added automatically.

The dialog tracks the actual restore UPID against the **new guest ID**. After leaving or restarting the agent, open **Activity → Proxmox tasks**, select the original node and new guest ID, then select the retained restore task to read its status/logs. Warnings and unknown status remain distinct from success. Native permissions and retention remain authoritative.

Verification uses isolated TLS/API and browser fixtures. Real PVE 8/9 archive restoration, guest disks/identity/state and PBS behavior remain pending designated disposable infrastructure. The public sample tour remains read-only and pinned to its existing source revision.

## Native guest console

Open a running guest workspace and choose **Console**. For a QEMU VM, choose **Graphical display** or **Serial text**, then **Connect**. The console uses the saved Proxmox connection and works without a guest IP or SSH service. The dialog identifies its guest/node, and the existing terminal provides clipboard and phone key controls. Reconnect is deliberate; closing or disconnecting ends the transport. Console traffic is not saved to provisioning history or automatically attached to Lynx requests.

LXC uses its native text console. QEMU graphical sessions use the VM’s configured display; `vga=none` or a serial display requires choosing Serial text or configuring a graphical display first. Serial text requires a configured `serial0`–`serial3` socket and a guest OS configured for a serial console/login prompt. Proxmiu does not add devices, start guests or configure login services when opening either console. SPICE and host shells remain separate; SSH is available through **Open terminal**.

The graphical display supports local fit/actual-size scaling, keyboard and pointer input, explicit Ctrl+Alt+Delete, and phone keyboard controls. **Send text to guest** provides direct keystrokes and a separate deliberate clipboard transfer; system clipboard contents are never read or changed automatically. Guest clipboard support varies, so direct keystrokes remain available for login/boot screens. Reconnect and transport switching are deliberate; changing the selected guest, node, connection or availability closes the old dialog rather than redirecting it. A failed graphical asset load preserves the Serial text choice and prompts a reload.

The agent authenticates Proxmox VNC upstream and offers the display only inside the agent-authenticated browser session. Native tickets, generated console passwords, cookies and API credentials stay server-side. Binary transport is bounded and all setup/heartbeat/disconnect paths release sessions. noVNC 1.7.0 loads only when a graphical session is requested; see [third-party notices](THIRD_PARTY_NOTICES.md) for its MPL-2.0 source and bundled notices. The independent demo has no graphical transport or new capability.

Verification uses isolated HTTPS/WSS fixtures with API-token and password authentication, an independent VNC challenge vector, synthetic clocks and the real noVNC browser client rendering known pixels and sending input. Designated real PVE8/9 display/guest OS validation remains pending; fixture results do not establish production readiness.

The Proxmox role needs **VM.Console** on the intended guests. New/re-run Proxmox installer setup includes it. Existing agent updates do not expand the Proxmox role automatically; on the Proxmox host, explicitly update the role if appropriate:

```bash
pveum role modify Proxmiu --append 1 --privs "VM.Console"
```

With a privilege-separated API token, grant the intended rights to both its user and token. Missing permissions, unsupported serial configuration and stale guest placement remain visible. No `Sys.Console` host-shell privilege is required. Native tickets and upstream credentials stay on the agent; sessions are transient. Hosted browser access has the same agent HTTPS/WebSocket requirements as the SSH terminal above.

## How creating a server works

1. Picks the next free VMID, and downloads the Debian/Ubuntu container template if the node does not have it.
2. Creates an unprivileged container (nesting on for dev templates) with the agent's SSH key and your own keys, then starts it.
3. Waits for an IP: container interfaces, the QEMU guest agent, or the agent's ARP table for VMs without one.
4. SSHes in and runs the template: base setup (updates, a `dev` sudo user, your keys), the template script, then the optional extras.

When it's done you get `ssh dev@<ip>` and a button to open a terminal. For the AI templates, run `claude`, `codex` or `opencode`. Without an API key, you sign in on first run.

To update a guest later, open its menu on **Guests** and choose **Update…**. Proxmiu finds the template from the `proxmiu;<template>` tag and re-runs its install script; Community Scripts guests use their upstream `/usr/bin/update` entrypoint. The run shows up in **Activity** with a live log.

**VMs** need an existing Debian/Ubuntu cloud-init VM template with a cloud-init drive on the selected node (see [Cloud-Init Support](https://pve.proxmox.com/wiki/Cloud-Init_Support)). The image must support SSH key login for the selected template user and passwordless sudo, and should include the QEMU guest agent for DHCP address discovery. Proxmiu does not build or repair the image.

Before cloning, Proxmiu refreshes the source identity/configuration and checks placement, cloud-init and boot-disk selection. Set an explicit boot disk in Proxmox for multi-disk templates. **Disk (GiB)** is a minimum for VMs: a larger source disk is kept; a smaller boot disk is grown. Disks are never shrunk. Requested CPU cores use one socket, and selected bridge/VLAN changes preserve the other NIC settings.

Configuration and growth tasks must finish successfully before the VM starts. If a clone or later step fails, inspect the retained job and any partially created VM in Proxmox before trying again. Proxmiu does not automatically delete or retry it.

## Agent configuration

| Variable | Default | |
|---|---|---|
| `PROXMIU_PASSWORD` | – | Required unless listening on localhost only |
| `PROXMIU_ALLOWED_ORIGINS` | – | Comma-separated origins of hosted UIs allowed to use the agent |
| `PROXMIU_TLS` | – | `1` to serve HTTPS with a generated self-signed certificate |
| `PROXMIU_TLS_CERT` / `PROXMIU_TLS_KEY` | – | Paths to your own certificate and key |
| `HOST` | `127.0.0.1`, or `0.0.0.0` with a password | |
| `PORT` | `8787` | |
| `PROXMIU_DATA_DIR` | `./data` | State, encrypted credentials and job history, SSH key, TLS certificate |
| `PROXMIU_SECRET_KEY` | generated | 32-byte base64 key for encrypting credentials/job history and signing sessions |

## Security

The agent holds credentials that control your whole Proxmox setup.

- **Password:** it refuses to listen beyond localhost without `PROXMIU_PASSWORD`. Hosted UIs are only allowed when a password is set.
- **Sessions:** signed bearer tokens that expire after 30 days. Changing `PROXMIU_SECRET_KEY` signs everyone out.
- **Cross-site requests:** requests from origins not in `PROXMIU_ALLOWED_ORIGINS` are rejected, WebSockets included. Without a password, only loopback `Host` headers are accepted, which blocks DNS rebinding.
- **Credentials at rest:** encrypted with AES-256-GCM.
- **Host keys:** SSH host keys of guests are not pinned, since guests are created and rebuilt often.
- **Self-update:** off by default. When enabled, the `proxmiu` user may run only `/usr/local/bin/proxmiu-self-update`; the helper ignores the caller's environment and reads root-owned `/etc/proxmiu/update.env`. Disable it by re-running the installer with `PROXMIU_ALLOW_SELF_UPDATE=0`.
- **Host updates:** separate, opt-in administrator enrollment with a per-node encrypted SSH key and pinned ed25519 host fingerprint. A node-bound forced command accepts only inspect/check/status/reviewed-apply JSON. The ordinary Proxmox role and guest key gain no privileges. Matching repositories, healthy package state, ten-minute plans and a locked APT action/archive guard protect exact-version installation; no removal, downgrade, major upgrade, package repair or automatic reboot is offered. One unresolved host operation blocks further admissions and forgetting its target. [Enrollment and recovery](docs/proxmox-host-updates.md) includes manual key revocation. Development checks use fixtures; real-host validation remains an operator step.

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

### Provisioning history after a restart

Activity's **Provisioning** tab retains creation and template-update runs on the agent in an encrypted `jobs.json` journal. It keeps up to 50 runs, with the newest diagnostic tail bounded to 5,000 lines and 128 KiB of serialized data per run. Truncated logs are labeled. Active runs are preserved when older completed runs are evicted; when all slots are active, wait for a run to finish before starting another.

After a restart, a previously running job is **Interrupted**, with its last saved steps and intended guest identity where known. The guest or a remote operation may still exist or be running. Inspect Proxmox and the guest before starting again. Restoration never resumes commands, retries provisioning or changes infrastructure automatically. Completed history records what happened during that run; saved addresses and results are not a current guest health check. Jobs already lost by an older agent cannot be recovered.

Activity reports journal availability and write failures. An unreadable, unsupported or undecryptable journal stays untouched and blocks new setup runs; it does not silently become empty history. A write failure during an existing run preserves live execution and shows that recent diagnostics may not survive a restart. Initial registration and state transitions are saved immediately; log-only updates may coalesce for up to 250 ms, so a hard kill can lose the last uncheckpointed tail.

Run one active agent process per data directory. Back up the entire data directory, including `secret.key`, or retain the configured `PROXMIU_SECRET_KEY`. The same key is needed to restore job history and credentials. If history cannot load, stop the agent before repairing disk/permissions or restoring a valid journal and matching key from backup. Provisioning request, credential, option, script and resume fields are never recorded in the journal; known secrets are redacted from diagnostic text, and the journal itself is encrypted because script output can contain other sensitive data. No job data is automatically sent to an AI provider.

`CHROMIUM_PATH=/usr/bin/chromium node web/test/job-history.e2e.cjs` checks retained and interrupted setup history, persistence degradation/unavailability, truncation, historical result wording, read failures and desktop/390px layouts with isolated API fixtures. Server integration tests restart the real local agent and verify that recovery makes no source connections or command replays.

### Chat with Lynx

Save an OpenAI, Anthropic or OpenRouter API key in Settings, then open the lynx companion to chat about Proxmox and Proxmiu. Messages are sent to your configured provider and model when you press Send; inventory, notes and logs are not attached automatically. Conversation stays in the open app’s memory and can be cleared. Existing inventory reviews in Settings retain their separate preview and consent flow. Without a configured key, the lynx keeps its pet interaction. Provider charges apply to chat requests.

For help with your actual setup, choose **Help with my setup**, select a guest and load its preview. Lynx can inspect the resource settings and available recent usage you explicitly agree to share. The preview excludes names, addresses, notes, logs, network/disk configuration and credentials; the guest identity and configuration digest stay on your agent. Previews expire and must be refreshed and approved again. Data already sent to your provider cannot be recalled by clearing chat.

Lynx can propose CPU cores per socket, memory in MiB and start-at-boot settings. Review the exact target and before/after values, then confirm **Apply changes**. The existing resource editor checks fresh configuration digests, stopped state, pending changes, topology and permissions. Lynx never shuts down a guest, runs shell commands or applies a proposal automatically. Missing history and unsupported configurations remain explicit; short usage history alone cannot establish a safe allocation.

To plan a new guest, enable **Plan a new guest** in chat and describe the workload. Lynx can suggest one of the built-in templates with CPU, memory and disk values. It receives only your messages and public template presets in this mode; custom templates, scripts and infrastructure data are excluded. Creation planning and selected-guest snapshot sharing are separate modes, and switching clears the conversation and proposals.

Choose **Review in Create** to copy the suggested resources into the existing creation form. The template is checked again before opening it; an unavailable template leaves your current form intact. The handoff stays in memory, belongs to the current agent and template, expires after ten minutes, and is consumed once. Back navigation and reload do not reapply a consumed handoff. Replacing an open form needs explicit confirmation. Placement, networking, credentials and template options use the normal form defaults and remain editable. A review checkbox gates the final **Create** submission; Lynx never starts provisioning on its own. Keep secrets in the form, outside chat.

`node web/test/themes.e2e.cjs` checks light text/semantic contrast, background continuity beside the desktop/tablet sidebar, theme persistence/browser chrome, dialogs and visible Connections controls at 390px using local fixtures.

`node --import tsx --test server/test/vm-clone.test.ts` exercises the production VM runner against strict local HTTPS and authenticated SSH protocol fixtures. `node web/test/vm-clone.e2e.cjs` checks source/node/options alignment and explicitly submitted VM creation after a build. Neither test creates a real VM or executes the generated setup script.

## Agent-free demo

`npm run build:demo` builds an independent read-only sample tour into `dist/demo`, intended for `/demo/` on the presentation website. It reuses the app’s visual components with fixed synthetic data and hash routes. It never connects to an agent, terminal or AI provider and never reads normal app credentials or views. Only `proxmiu-demo-theme` persists; filters and exploration reset on reload. This preview does not simulate successful infrastructure writes.

After a demo build, `node web/test/demo.e2e.cjs` checks real navigation, filters, metric controls, saved-step logs, deep links, theme persistence and storage/network isolation. `DEMO_BASE_URL` can target the existing hosted `/demo/` in a fresh test browser context; `SCREENSHOT_DIR` enables the bounded visual captures. The website pins a reviewed app commit and records it at `/demo/build.json`.
