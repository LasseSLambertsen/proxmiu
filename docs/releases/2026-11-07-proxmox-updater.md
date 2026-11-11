# Reviewed Proxmox host updates

The requested updater checks a selected host, presents its complete package plan and installs only after explicit node-name confirmation. A dedicated per-node SSH key reaches a root-owned, node-bound forced-command helper; ordinary Proxmox permissions and guest SSH access stay unchanged. One-time administrator enrollment pins the host key and verifies the helper identity.

Same-major updates are guarded against changed package/repository/hold/configuration state and unreviewed dependency actions. The helper blocks removals, downgrades, held-package overrides, major upgrades, unsupported sources/hooks and automatic repair. Host jobs persist across browser/agent disconnects, with honest failure/interruption and advisory manual reboot information. No repositories or guests are changed automatically and no reboot is initiated.

Verification covers synthetic APT/systemd/SSH/Proxmox behavior, a real agent restart with an encrypted enrollment and lost admission reply, and Chromium enrollment/review/confirmation/recovery at desktop and phone widths in both themes. Read-only APT and OpenSSH consumers and a controlled Perl cluster-file consumer exercise parser/atomic-write boundaries. Independent reviews checked the package, enrollment and admission safeguards. Exact-head CI results are recorded on the release pull request.

Real-host enrollment, pmxcfs integration, durable systemd behavior and actual package installation still require operator validation. Development tools performed no real host key installation or package updates. The public sample tour remains read-only and pinned to its existing source. Detailed APT errors require local host logs; the managed interface retains bounded phase events.
