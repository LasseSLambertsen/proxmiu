# Contributing to Proxmiu

Thanks for helping make Proxmiu better. Bug reports, design feedback, docs and
code are all welcome.

## Read this first

- [`project.md`](project.md) — what the product is, who it is for, and its non-goals.
- [`design.md`](design.md) — UI principles and visual language. Read it before changing UI.
- [`CLAUDE.md`](CLAUDE.md) — architecture rules, security invariants and known gotchas.
- [`SECURITY.md`](SECURITY.md) — how to report a vulnerability. Do not open a public issue for one.

## Setup

You need Node.js 22 and npm. Bash is needed for the shell-script tests; on
Windows those tests are skipped automatically.

```bash
npm install
npm run mock   # fake Proxmox API on https://127.0.0.1:8006
npm run dev    # agent on :8787, Vite on :5173 with hot reload
```

The mock token is `root@pam!proxmiu` and the secret is `mock`. For a full
provisioning test, set `MOCK_GUEST_IP` and follow the notes in `CLAUDE.md`.

## Checks

Run all three before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

The build works on Linux, macOS and Windows. CI runs the same commands on
Ubuntu and Windows.

## Architecture rules

- The UI never talks to Proxmox directly. Every call goes through the agent
  using `api`, `agentFetch` or `agentWsUrl` from `web/src/lib`.
- Auth uses stateless bearer tokens, not cookies. The terminal WebSocket sends
  its token in the first `connect` message.
- Provisioning runs over SSH with the app key that Proxmox injects. Template
  scripts must be idempotent, because **Update…** on a guest re-runs them without
  the base setup. Community Scripts guests use their upstream `/usr/bin/update`
  entrypoint instead.
- Do not weaken the checks in [`CLAUDE.md`](CLAUDE.md#security-invariants-do-not-weaken):
  password/origin gating, loopback host checks, encrypted secrets and log
  redaction are all required.

## Adding or changing a template

Templates live in `server/src/templates.ts` (built-ins) or in the Templates page
(custom). A template is a resource preset plus one of:

- **Inline bash** — stored in `script`, run after Proxmiu's base setup.
- **GitHub** — a `source` pointing at `owner/repository`, a ref and a file path.
  The file is fetched at creation time from `raw.githubusercontent.com`.
- **Community Scripts** — a `source` with a [community-scripts.org](https://community-scripts.org)
  slug. Proxmiu fetches the matching installer and runs it inside the guest.

Useful script helpers: `log`, `retry`, `apt_install`, `as_user`, `as_user_sh`,
`persist_env`, `install_node`. Options reach the script as `OPT_<KEY>`; Community
Scripts options keep their upstream `var_*` names.

Keep secrets out of scripts and repositories. Enter them as template options;
Proxmiu encrypts them at rest and redacts them from job logs.

## Pull requests

- Keep changes focused and explain the problem they solve.
- Add or update tests when behaviour changes.
- Update docs when user-facing behaviour changes.
- Screenshots are welcome for UI changes; keep them in `docs/screenshots/`.
- Do not commit `.env`, `data/`, generated `dist/` output, credentials or logs.

By contributing you agree that your contribution is licensed under the
project's [MIT license](LICENSE).
