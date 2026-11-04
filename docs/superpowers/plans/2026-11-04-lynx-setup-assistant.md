# Lynx setup assistance

The user wants Lynx to help with their actual setup, with a professional, perceptive fox/lynx voice. Extend configured-key chat with opt-in selected-guest evidence and reviewed CPU, memory and boot proposals. Preserve ordinary chat, all three providers, Settings' anonymous review and the no-key companion.

## Global constraints

- Only the agent reads Proxmox and holds provider secrets. UI requests use api/agentFetch. Keep bearer, origin and DNS-rebinding protections.
- Sharing requires preview and affirmative consent. Send only the exact server-built preview; exclude notes, descriptions, addresses, disks/network configuration, logs and credentials.
- Model text never controls connection/node/guest identifiers, digest, URL or arbitrary actions. Proposed writes cover only cores, memoryMiB and onboot through the existing resource-settings endpoint after human review and confirmation.
- Existing digest, stopped-state, pending-change and supported-topology checks remain authoritative. Never automatically stop guests or execute shell commands.
- Provider/model, guest/source changes, clear and removed key must invalidate old evidence/proposals and ignore late responses. Expired previews require refresh and renewed consent.
- Replies stay plain text and within existing chat bounds. Unavailable history is explicit. No claim of applying anything until the actual write succeeds.
- Voice: composed, concise, observant, lightly cunning; occasional subtle lynx/fox imagery, no roleplay spam, emojis or clever wording that obscures technical meaning. Advice states evidence and uncertainty.
- No live infrastructure or paid-provider calls in tests.

## Work

1. Implement the coherent feature across backend, frontend and meaningful fixture tests (brief in lynx-setup-assistant/task-1-brief.md). One implementation agent owns code/test files; controller owns docs and website.
2. Fresh review against brief and global constraints, fix material issues, then typecheck, full tests, production build and browser fixtures.
3. Update app documentation and public website to match optional context and confirmed actions. Publish app/site PRs through a publishing subagent; wait exact-head CI, squash merge and verify Netlify production.

## Ledger

- Task 1: pending; base 475436234d9e7790d552560be871794657cc82e4.
