# Premium guest workspaces

The user delegated product decisions and authorized incremental commits and pushes to Proxmiu and its presentation site. The goal is a product homelab users would value enough to support: fast everyday operations, useful depth, and careful handling of failures.

## Direction

Extend the existing warm glass, amber, Geist and lynx identity. Keep React/Vite, TanStack Query, Fastify and the LAN agent architecture. No new production dependencies, cloud accounts, invented capabilities, donation destinations, or additional Proxmox privileges.

Alternatives considered: a visual reskin alone would not add enough value; broad cluster administration conflicts with the product's purpose. A deeper everyday guest workspace adds substantial usefulness within the current architecture.

## Ship this release

1. Guest detail pages with current resources, real Proxmox RRD history (hour/day/week), network/disk configuration, SSH and existing safe power actions. Whitelist configuration fields and clearly represent unavailable history or partial permission failures.
2. Agent-persisted pins and plain-text notes, shared across browsers connected to the same agent. Metadata identity is cluster/type/vmid so migration between nodes preserves it. Notes are limited to 4,000 characters; partial updates merge without overwriting the other field.
3. Guest inventory with status/type/node filters, sorting, pinned-only mode, browser-persisted named views scoped to the current agent, and a CSV export of the visible inventory. CSV must neutralize spreadsheet formulas.
4. Selection and bulk start/shutdown/reboot through existing authenticated power endpoints. At most two requests at a time, explicit confirmation of selected targets, no bulk delete or force-stop, and per-guest success/error reports. "Sent" is not a claim of completed shutdown or reboot.
5. Overview health warnings from actual connection/node/resource state and fast access to pinned guests. Preserve a useful empty state.
6. Update the presentation site, app documentation and screenshots with shipped behavior.

## API contract

`GET /api/guest-metadata` returns `Record<string, GuestMetadata>`, keyed by `${clusterId}/${type}/${vmid}`.

`PUT /api/guest-metadata/:id/:type/:vmid` accepts a strict nonempty partial `{ favorite?: boolean, notes?: string }`. `GuestMetadata` is `{ favorite: boolean, notes: string, updatedAt: string }`. Validate the connection and numeric guest identity. Deleting a connection removes its metadata.

`GET /api/clusters/:id/guests/:node/:type/:vmid/insights?timeframe=hour|day|week` returns:

```ts
interface GuestInsights {
  config: {
    name?: string; description?: string; cores?: number; sockets?: number;
    memory?: number; ostype?: string; onboot?: boolean; unprivileged?: boolean;
    networks: { name: string; value: string }[];
    disks: { name: string; value: string }[];
  } | null
  metrics: {
    time: number; cpu?: number; mem?: number; maxmem?: number;
    netin?: number; netout?: number; diskread?: number; diskwrite?: number;
  }[]
  configError?: string
  metricsError?: string
}
```

Memory configuration uses MiB; metric memory uses bytes; time uses Unix seconds; CPU is a fraction. RRD uses AVERAGE. Never return arbitrary config fields, SSH keys, cloud-init passwords or other secrets. Validate route/query inputs. Partial upstream failures remain visible alongside the usable data.

## Product behavior and limits

- Guest links: `/guests/:clusterId/:node/:type/:vmid`. Keep browser back navigation and keyboard access.
- Persist saved views with validated, versioned local storage scoped to the agent; recover cleanly from corrupt or unavailable storage. Maximum 20 views, names up to 40 characters.
- Handle loading, offline agents, inaccessible guests, deleted favorites, empty filters, short/missing metric series, failed note saves and partially failed batches explicitly.
- Keep destructive safeguards, existing origin/auth checks and encrypted credential handling intact.
- Phone layouts remain usable at 390px; reduced-motion preferences apply. Public screenshots use the bundled mock API.

## Acceptance evidence

Meaningful unit tests cover metadata merge/persistence and cleanup, config redaction, metric normalization, validated filters/views, CSV injection, bounded bulk execution and individual failures. Browser checks exercise saving a note and favorite, guest navigation/history, saved views, selection/confirmation/results, keyboard controls and phone layouts. Run typecheck, tests and builds before each product checkpoint. A fresh final review covers security, failure behavior and desktop/mobile captures.
