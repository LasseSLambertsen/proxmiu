# Proxmox host updates

Host updates are separate from **Update agent** and guest-template updates. They use an optional, narrowly enrolled host helper. Proxmiu's normal Proxmox API role and its guest SSH key are unchanged.

## Enroll a host

1. Open a node's **Updates…** action. Generate the dedicated enrollment key if one is not already prepared.
2. In that Proxmox host's root shell, review and run the setup command supplied by Proxmiu. It downloads an immutable helper bundle from this project's trusted source, installs root-owned files, and authorizes only the node-bound update command. It does not update packages, enable password login or change the Proxmox role.
3. Copy the installer-reported host SSH fingerprint into Proxmiu and enter the intended host address/SSH port. Verify the fingerprint using the host shell before enabling access.

Enrollment is per connection/node, with a dedicated key distinct from the key injected into guests. The agent encrypts its private key; only the public key appears in the interface. The connection verifies the enrolled ed25519 host key on every session. A changed fingerprint requires deliberate investigation and enrollment changes.

The installer preserves existing root keys, including Proxmox's cluster-managed authorization file. The command is bound to the enrolled node, so a shared authorization file does not turn one node's key into another node's updater. Unsupported sshd policies, including conditional Match blocks, are reported rather than rewritten. Helper installation and future helper upgrades are administrator actions and refuse active or unresolved jobs.

To update an enrolled host helper, open **Enrollment and manual recovery** and choose **Copy helper command**. Run the full command as root on the named Proxmox node after outstanding work is resolved. It reuses the same dedicated public key and resolves the latest project commit; the installer preserves the existing authorization entry. Updating the Proxmiu agent alone does not replace root-owned helpers on hosts. After refreshing the helper, use **Refresh status** and build a new package plan.

## Review and install

Choose **Check updates** to refresh package information and build a complete plan. The supported initial targets are Proxmox8 on Debian Bookworm and Proxmox9 on Debian Trixie, using matching fixed repository suites. Floating or foreign suites, unsafe repository settings, broken package state, unsupported APT hooks and unreviewable plans block automation with an explanation.

Review package names, installed/candidate versions and newly required dependencies. Type the node name and choose **Install reviewed updates**. A plan lasts ten minutes and is bound to the selected host, configuration and package state. A changed repository, installed package, hold or planned action requires another check and review.

The host validates the actual package actions immediately before installation, including dependencies. It does not authorize a truncated list or silently replace the reviewed plan. Removals, downgrades, changes to held packages and major-version upgrades are blocked. The helper does not edit repositories, force package repairs or reboot. Package updates may restart host services; plan updates accordingly. Update one host at a time.

## Progress and recovery

Accepted work runs as a host systemd job and continues if the browser or agent disconnects. Closing the page is not cancellation. Return through the node action or the configured-host list in Settings to read the saved status. An unavailable Proxmox API does not by itself make an admitted host task fail or succeed.

The interface reports bounded phase/package events and an explicit final result. Missing unit/boot evidence or partial package completion stays interrupted/failed and requires inspection; Proxmiu does not replay or repair it automatically. The host must be reachable again before unresolved work can be safely released. Reboot guidance is advisory; the absence of a reboot marker does not prove a reboot is unnecessary.

Raw package-script diagnostics are not automatically collected into the app or sent to Lynx. **Enrollment and manual recovery** provides a copyable journal command for the saved job's worker service events, and separate commands for package details. APT stdout/stderr are discarded by the helper; inspect the host’s `/var/log/apt/term.log`, `/var/log/apt/history.log` and `/var/log/dpkg.log` for available package details. These logs are host-wide and may include other maintenance. Keep sensitive repository credentials out of anything shared for support.

## Remove access

Forget updater access only after outstanding work is resolved. This erases the agent's local enrollment/key/configuration, but does not delete the authorization entry on the host. An administrator should revoke the exact dedicated key there if access is no longer wanted, preserving unrelated cluster/administrator keys. Rotating the ordinary guest SSH key does not revoke host-updater access.

This guide describes the release contract. Development verification uses synthetic APT/systemd/SSH/Proxmox fixtures; real-host enrollment and updates require separate operator validation.
