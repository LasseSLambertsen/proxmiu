# Changelog

User-visible changes are recorded here. GitHub releases use the matching dated version section; unfinished work stays unreleased.

## [Unreleased]

## [0.1.0] - 2026-11-12

First preview release of Proxmiu. The broader Proxmox administration roadmap is still in progress.

### Added

- Graphical VM displays with explicit connection controls, keyboard/pointer input, phone keys and deliberate clipboard transfer. Proxmox tickets and generated console passwords stay on the agent. Existing LXC and VM serial text consoles remain available. ([#22](https://github.com/LasseSLambertsen/proxmiu/pull/22))
- Reviewed backup restoration into a new, unused guest ID on the same node, with typed confirmation, new MAC addresses, no immediate start and start-at-boot disabled. Restore tasks and logs belong to the new ID. ([#21](https://github.com/LasseSLambertsen/proxmiu/pull/21))
- Opt-in Proxmox host updates with restricted helper enrollment, pinned SSH identity, complete package/version review, typed confirmation and durable task recovery. ([#17](https://github.com/LasseSLambertsen/proxmiu/pull/17), [#20](https://github.com/LasseSLambertsen/proxmiu/pull/20))
- Guest workspaces with native Proxmox notes, performance history, snapshots, backups, migration, reviewed CPU/memory/boot settings and retained native task logs.
- Lynx chat with OpenAI, Anthropic and OpenRouter, encrypted optional credentials, consent-based setup advice and template drafts handed to the normal Create form for review.
- Saved connection editing, browser SSH, template provisioning, Community Scripts integration and encrypted provisioning history that survives agent restarts.
- An isolated read-only sample tour on the presentation website, with synthetic data and no agent or provider access.

### Fixed

- Accept standard `apt-listchanges` configuration, legitimate APT dependency annotations and native-to-`all` package replacements without weakening exact-version host-update checks. ([#18](https://github.com/LasseSLambertsen/proxmiu/pull/18), [#19](https://github.com/LasseSLambertsen/proxmiu/pull/19))
- Respect Community Scripts OS defaults and avoid root-only container feature flags when using the limited Proxmox account. The host must still support the selected guest OS. ([#15](https://github.com/LasseSLambertsen/proxmiu/pull/15), [#16](https://github.com/LasseSLambertsen/proxmiu/pull/16))
- Recheck cloud-init clone sources and boot disks, preserve existing NIC options and larger disks, and retain partial failures for manual inspection. ([#10](https://github.com/LasseSLambertsen/proxmiu/pull/10))
- Improve light-mode readability and the continuous background beside the sidebar. ([#9](https://github.com/LasseSLambertsen/proxmiu/pull/9))

### Upgrade notes

- Update the agent using the existing installer/updater. Existing connections, settings and keys are retained. Agent updates do not silently expand Proxmox privileges; older roles may need the explicit updates documented in the README.
- Host-updater fixes also require the updated root-owned host helper. Use the enrollment command shown by the updated agent; updating the agent alone does not replace an installed host helper.
- Before starting a restored guest, inspect its network and application identity. New MAC addresses do not change static IPs, hostnames, OS machine IDs or application credentials.
- Graphical consoles require a configured VM display. Serial text requires an existing serial socket and guest OS support. Neither mode starts or configures guests automatically.

### Validation and scope

- This is a preview: automated CI, isolated protocol/API fixtures and browser tests cover the implemented workflows. Designated real PVE 8/9 provisioning, migration, restoration, graphical display and host-update validation remains pending. Production readiness has not been established.
- Full hardware editing, storage/network/firewall administration, cluster/HA operations, backup scheduling and multi-user management remain on the staged roadmap.

[Unreleased]: https://github.com/LasseSLambertsen/proxmiu/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LasseSLambertsen/proxmiu/releases/tag/v0.1.0
