# Reliable cloud-init VM cloning

Continue the delegated roadmap by exercising the existing QEMU clone path and correcting failures that could create a guest with the wrong placement or disk size. The controller selected this next item because local fixtures can prove app behavior without access to a real Proxmox host. Real-host validation remains open.

## Approach

Keep the existing Create form, authenticated job API, encrypted journal and SSH runner. A strict source/config preflight plus an end-to-end local HTTP/SSH protocol fixture is preferable to another permissive mock-only smoke test; building cloud images or contacting a live host is outside this iteration. No new dependency, agent privilege, provider sharing, automatic cleanup/retry or hosting project.

Before the clone write, refresh cluster resources and source config. Require a QEMU template on the explicitly selected node, a cloud-init drive and an unambiguous boot disk. A moved/missing source or unsuitable image ends the job with actionable diagnostics and no clone. Never silently change placement. After clone, configure and resize on that same node. Wait for asynchronous Proxmox configuration/resize tasks before dependent reads/start; HTTP acceptance alone is not completion. The Create form must show and load the default source template’s node as well as explicit source selections, including guest-kind and connection transitions. Missing/currently invalid sources must block submission, including direct form submission. Do not start the clone if configuration/required disk growth fails. Leave any partially created clone for manual inspection; retain its identity in the journal.

Resolve a boot disk from supported disk keys (`scsiN`, `virtioN`, `sataN`, `ideN`) using modern boot order, then legacy bootdisk; without explicit disk selection allow exactly one non-CD-ROM/non-cloud-init disk. Reject ambiguous/missing boot disks rather than guessing. Requested disk GiB is a minimum: preserve a larger/equal source disk without a shrink request, grow a smaller disk to the requested size, and surface growth failures. Read a fresh clone config to preserve its actual network model/MAC and other NIC options while deliberately replacing bridge/VLAN settings (including removing an inherited VLAN for an untagged request). Configure sockets=1 so requested cores stays the actual vCPU allocation. Keep SSH key double encoding and existing onboot/tags/cloud-init settings.

## Verification and limits

Tests exercise actual production startProvision through a local strict HTTPS Proxmox fixture and an authenticated SSH2 protocol fixture that consumes the generated script without executing it. Cover DHCP/static cloud-init, same-node writes, key encoding, CPU topology, NIC preservation, non-zero disk index, no-shrink, rejected source/preflight and configure/resize/clone-task/script failures. Signal termination or SSH closure without an explicit exit status must fail honestly; only an explicit zero confirms script success. No guest OS is installed, remote command executed or real cloud-init boot claimed. Windows/Linux Node 22 compatibility is required.

Keep existing LXC behavior, auth/origin protection, redaction and explicit user creation review unchanged. Documentation distinguishes this protocol verification from a real hypervisor test. No need to change the website unless its claims need correction.

API reference: public Proxmox `src/PVE/API2/Qemu.pm` (https://github.com/proxmox/qemu-server/blob/master/src/PVE/API2/Qemu.pm) declares POST config asynchronous (optional task string), PUT resize an asynchronous task string, and explicitly disallows shrinking. The dev mock previously returned null for these writes, masking ordering failures.
