// Deliberately fixed, synthetic inventory. No agent, wall-clock polling or persistent exploration.
export const snapshot = '4 Nov 2026 · 12:00 UTC'
export const guests = [
  { id: '101', name: 'dev-lynx', type: 'lxc', status: 'running', node: 'pve-amber', ip: '192.0.2.101', cores: 4, memory: 8, disk: 32, cpu: 18, used: 2.4, uptime: '3d 4h', template: 'Codex server', notes: 'A quiet workspace for the next useful idea. tmux keeps the sample session in view; nothing here connects to a machine.' },
  { id: '102', name: 'docker-den', type: 'lxc', status: 'running', node: 'pve-amber', ip: '192.0.2.102', cores: 2, memory: 4, disk: 24, cpu: 7, used: 1.1, uptime: '8d 2h', template: 'Docker host', notes: 'Sample home for a small application stack. Network addresses are reserved for documentation.' },
  { id: '201', name: 'papertrail', type: 'qemu', status: 'running', node: 'pve-teal', ip: '192.0.2.201', cores: 4, memory: 8, disk: 64, cpu: 32, used: 5.6, uptime: '1d 6h', template: 'Plain server', notes: 'Synthetic VM with a busier memory profile. A snapshot tells you where to look; a history tells you whether to worry.' },
  { id: '202', name: 'archive-vm', type: 'qemu', status: 'stopped', node: 'pve-teal', ip: '192.0.2.202', cores: 2, memory: 4, disk: 48, cpu: 0, used: 0, uptime: '—', template: 'Plain server', notes: 'Sample interrupted setup retained for inspection. Stopped does not imply that installation completed.' },
] as const
export type SampleGuest = typeof guests[number]
export const templates = [
  { id: 'codex', name: 'Codex server', icon: 'terminal', description: 'A focused remote development workspace.', cores: 4, memory: 8, disk: 32, packages: 'Node.js LTS, Codex CLI, tmux, Git', detail: 'Debian 12 LXC · unprivileged · SSH key access', options: 'Persistent tmux session, GitHub CLI and optional repository clone.' },
  { id: 'docker', name: 'Docker host', icon: 'container', description: 'A small home for your application stack.', cores: 2, memory: 4, disk: 24, packages: 'Docker Engine, Compose plugin, Git', detail: 'Debian 12 LXC · unprivileged · nesting enabled', options: 'Docker service enabled at boot. Configuration shown for exploration only.' },
  { id: 'plain', name: 'Plain server', icon: 'server', description: 'A clean starting point with room to grow.', cores: 2, memory: 4, disk: 32, packages: 'OpenSSH server, curl, Git', detail: 'Debian 12 · LXC or cloud-init VM', options: 'Base packages and SSH access. A real installation requires your own agent.' },
] as const
export const runs = [
  { id: 'complete', guest: 'docker-den', status: 'Success', date: '11:42 UTC', description: 'Sample container setup completed.', steps: ['Prepare container', 'Install packages', 'Verify setup'], logs: ['[sample] Container 102 prepared on pve-amber.', '[sample] Docker Engine and Compose packages installed.', '[sample] Saved verification: setup completed. No operation ran in this demo.'] },
  { id: 'failed', guest: 'papertrail', status: 'Error', date: '10:20 UTC', description: 'Sample package mirror unavailable.', steps: ['Prepare VM', 'Install packages', 'Review failure'], logs: ['[sample] VM 201 retained for inspection.', '[sample] packages.example.invalid unavailable. Installation stopped.', '[sample] Check network and mirror configuration in the real workspace. No automatic retry.'] },
  { id: 'interrupted', guest: 'archive-vm', status: 'Interrupted', date: '09:15 UTC', description: 'Sample agent restart interrupted setup.', steps: ['Prepare VM', 'Install packages', 'Inspect retained guest'], logs: ['[sample] VM 202 prepared. Intended guest: archive-vm.', '[sample] Last saved output: <script>sample only</script>\n[sample] Agent restarted before installation result was saved.', '[sample] Outcome unknown. Inspect the retained guest before retrying. No automatic continuation.'] },
] as const

export function metricsFor(guest: SampleGuest) {
  return Array.from({ length: 25 }, (_, index) => ({
    time: 1793786400 + index * 300,
    // A deliberate missing interval demonstrates the shared chart's honest gaps.
    ...(index === 11 || index === 12 ? {} : { cpu: Math.max(0, guest.cpu / 100 + Math.sin(index * .7) * .045), mem: (guest.used + Math.sin(index * .4) * .12) * 1024 ** 3, maxmem: guest.memory * 1024 ** 3, netin: 15000 + index * 1100, netout: 8000 + Math.sin(index) * 3000, diskread: 4200 + index * 120, diskwrite: 8000 + Math.sin(index * .8) * 2500 }),
  }))
}
