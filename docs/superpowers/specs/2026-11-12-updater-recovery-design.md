# Host updater recovery guidance

Complete the existing updater recovery flow after the first-node debugging session: enrolled nodes need a findable helper-refresh command, and service events must be distinguished from detailed APT/dpkg logs. This is a small refinement of the approved host-updater design, under the user's continuing implementation instructions.

Keep recovery in the node page's existing disclosure. The agent already returns the public setup command for the existing dedicated key, so this needs no new API or host operation. A separate maintenance page would split the current recovery context; remote helper installation would change the established administrator-run enrollment boundary. The inline approach is the implementer's choice within the existing flow.

For configured targets, show a copyable refresh command and explain same-key reuse, root execution on the named node, and refreshing status afterward. If work is active or unresolved, explain that helper refresh must wait. Show the dedicated public key with a named copy control. Do not rotate keys, execute the command, or automatically update hosts.

Show a copyable journal command only for a real saved job ID. Label it worker service events. Separately show fixed commands for host-wide APT terminal/history and dpkg logs, explaining that these contain package details and stay on the host. Do not collect output into Proxmiu or Lynx.

Preserve warm glass, Geist, existing controls and the 390px layout in both themes. Extract a focused recovery component instead of extending the already dense page. Verify copied text, keyboard activation, no mutation from copy controls, no fabricated job placeholders, active/failed states, target changes and desktop/mobile overflow. The pinned demo remains unchanged.
