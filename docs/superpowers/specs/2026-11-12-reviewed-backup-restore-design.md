# Restore a backup into a new guest

The conversation goal is to make Proxmiu a full-featured Proxmox VE interface in stages: guest hardware, graphical consoles and restoration first; then storage, networking, firewall, cluster/HA, backup administration and permission-aware accounts/audit/notifications. Preserve the visual identity, native notes, encrypted optional AI credentials and explicit review of infrastructure changes. Use fixtures now; arrange designated live validation later.

This increment restores a listed backup from an existing guest workspace into an unused guest ID on the same node. It does not overwrite guests, copy backups across nodes, start guests or perform automatic cleanup/retry. It is one part of the first milestone.

## Workflow and trust

An archive's Restore button opens a focused existing-style dialog. The agent lists active destination storage appropriate to the guest type and suggests the next ID. The user selects storage and a new ID, then requests a read-only review. The agent verifies the source guest, archive membership, archive type, extracted configuration, destination storage, node and cluster-wide ID availability. A short-lived, single-use review binds the exact source, destination, configuration and saved connection revision. Execution rechecks them and requires the typed new ID. An accepted task belongs to the new ID, with its original node and source archive visible in the dialog. Native task history provides recovery after leaving/restarting.

POST `/nodes/{node}/qemu` uses `archive`; POST `/nodes/{node}/lxc` uses `ostemplate` and `restore=1`. Both use explicit storage, `force=0`, `unique=1`, `start=0`, `onboot=0`. No arbitrary client-selected Proxmox parameters. New MACs do not change hostname, static IP, application identity or OS machine ID. Explain this before confirmation and require later identity inspection before starting. Restrict the first increment to configurations whose dependencies can be checked safely; reject privileged/custom LXC, host bind/device mounts and QEMU passthrough/custom hooks or mappings. Extracted configuration never leaves the agent. Respect source-backup access rights; do not grant broad new privileges.

Submission consumes a review before making an upstream request. Duplicate requests cannot POST twice; accepted results can be returned again. An upstream error or malformed result can mean acceptance is unknown: instruct inspection of native task history and the destination ID, with no automatic replay or cleanup. Upstream errors are replaced by safe messages. Task status distinguishes warnings, unknown and failure; logs use existing bounded native task routes. A failed or unavailable task read does not mean the restore failed.

## Validation and limits

Use Node 22-compatible TypeScript, existing React/TanStack/Radix primitives and no new dependencies. Preserve auth/origin/destination controls, native notes and public demo isolation. Test exact QEMU/LXC payloads, wrong archive types, PBS identity, stale reviews/configuration/credentials, storage changes, cluster-wide ID collisions, unknown acceptance, duplicate submissions, task attribution and unsupported dependencies. Browser fixtures cover keyboard review/typed confirmation, task outcomes, recovery, cancellation and 390px light/dark layouts. Standard typecheck/test/build plus demo build must pass. Real PVE 8/9 archive and PBS restoration remain unverified until explicitly designated disposable infrastructure is available.

## Upstream references

- [PVE 8 QEMU API](https://github.com/proxmox/qemu-server/blob/5ccd363e5908aa5a7b969797babdff1df5159475/src/PVE/API2/Qemu.pm)
- [PVE 8 LXC API](https://github.com/proxmox/pve-container/blob/3799ada6b0f778d6f6bbcb900709d2a59733ba3c/src/PVE/API2/LXC.pm)
- [Proxmox restore dialog](https://github.com/proxmox/pve-manager/blob/master/www/manager6/window/Restore.js)
- [Backup configuration extraction](https://github.com/proxmox/pve-manager/blob/master/PVE/API2/VZDump.pm)
