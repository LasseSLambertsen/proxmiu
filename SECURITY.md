# Security policy

## Supported versions

Only the latest `main` branch is supported. Fixes are released from there.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting:

**<https://github.com/LasseSLambertsen/proxmiu/security/advisories/new>**

Do not open a public issue, discussion or pull request for an unfixed
vulnerability. Include the affected version or commit, reproduction steps, and
the impact you believe it has. We will acknowledge the report and keep you
updated on the fix and disclosure timeline.

## Security model

The Proxmiu agent holds credentials that control a Proxmox VE host.

- The agent refuses to listen beyond loopback without `PROXMIU_PASSWORD`, and
  refuses `PROXMIU_ALLOWED_ORIGINS` without a password.
- `originAllowed()` runs on every `/api` request, including WebSocket upgrades.
  CORS alone does not protect WebSockets or simple requests.
- Without a password, only loopback `Host` headers are accepted (a DNS-rebinding
  guard).
- Credentials are encrypted at rest with AES-256-GCM. Secrets are redacted from
  provisioning job logs.
- Session tokens are stateless HMAC-signed bearer tokens. WebSockets send the
  token in the first `connect` message because browsers cannot set headers.
- The UI never talks to Proxmox directly. All traffic goes through the agent.

## Provisioning and third-party scripts

Provisioning runs install scripts inside the new guest as root. Built-in
templates are reviewed. Custom templates can fetch a script from GitHub or run a
[community-scripts.org](https://community-scripts.org) installer; those scripts
are third-party code. Review what you run before creating a guest from an
untrusted source.

## Out of scope

- Vulnerabilities in Proxmox VE, SSH, or third-party installers that are not
  caused by Proxmiu.
- Reports that require access to a host, agent data directory or password that
  the reporter should not have.
- Denial of service from an authenticated user with full control of the agent.
