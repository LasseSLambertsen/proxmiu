# Cloud-init VM clone reliability

The QEMU provisioning path checks the selected source template, node, cloud-init drive and boot disk before cloning. It keeps the requested CPU allocation, preserves unrelated NIC settings and treats disk size as a minimum rather than attempting to shrink a larger source.

Configuration and disk-growth tasks finish before the VM starts. Failures remain errors with the partial clone identity available in retained history for manual inspection. No automatic retry, deletion or recovery is introduced.

Verification uses strict local HTTPS Proxmox and authenticated SSH protocol fixtures. Generated setup scripts are captured without execution; no real hypervisor, guest OS, cloud-init boot or installation is claimed. Real-host testing and a cloud-image builder remain open roadmap items. Final test/review/publication evidence is recorded in the implementation plan.

Validation: typecheck, 130 tests and full production build pass. VM Create and existing Lynx handoff browser fixtures pass. Independent review approved the specification and quality after signal/missing SSH status and mode/connection source transitions were fixed. Exact-head Linux/Windows CI gates publication.

The shared script runner now requires an explicit exit status: signal termination or a closed SSH channel without status cannot become a successful setup. Create reconciles source/node across guest-kind and connection changes and refuses stale or missing source submissions, including direct form submissions.
