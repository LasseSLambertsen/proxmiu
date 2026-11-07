# Community Scripts container feature permission fix

The reported iSponsorBlockTV creation failed before the container was created: Proxmiu automatically sent `keyctl=1` for every unprivileged Community Scripts template. For unprivileged containers, Proxmox's `check_ct_modify_config_perm` permits non-root callers to set nesting alone and rejects other feature flags with the exact reported error. Privileged container feature changes have a separate root-only restriction, which this fix does not change.

Creation now sends only `nesting=1` when the selected template requests it, or omits features otherwise. It preserves the unprivileged setting, credentials, role and ordinary template behavior. There is no root fallback, automatic retry or change to an existing guest. Applications that actually need extra features still require deliberate administrator setup.

A local HTTPS fixture drives the real provisioning runner with a limited token and the relevant Proxmox permission rule. Both Community Scripts cases fail before the fix; after it, nesting on/off and ordinary templates pass creation. The fixture deliberately stops before guest start, networking, script downloads or SSH, so it proves the create-request fix without claiming a real installation.

Verification:155/155 tests, server/web typechecks, normal app/server build, isolated demo build and whitespace checks pass. Independent spec/quality review passes with no material blocker. Its wording caveat was addressed by distinguishing unprivileged and privileged container restrictions. The role, dependencies, installer and UI are untouched. Exact-head Ubuntu/Windows CI gates publication; external merge/CI evidence is recorded at `/tmp/lxc-features-publication.md`. Real-host installation confirmation remains open.
