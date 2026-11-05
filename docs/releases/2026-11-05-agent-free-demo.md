# Agent-free sample tour

Visitors can explore an isolated read-only sample lab: overview, searchable/filterable guests, guest allocation/notes and metric inspection, template configurations, and saved success/error/interrupted setup history. Hash links survive reload, unknown links recover clearly and filters reset without changing real app settings.

The demo shares the app’s pure components, fonts and light/dark visual system. Fixed sample labels and documentation addresses make its status explicit. There is no agent connection, provider chat, terminal, credentials form, infrastructure action or simulated successful write. Network connections are blocked by CSP; only the separate demo theme preference persists.

The existing presentation website serves `/demo/` from a pinned merged app source revision, with public build provenance. Its build publishes allowlisted marketing assets and the static demo only. Source, dependencies, manifests, environment files and maps remain outside the publish output. No new site, domain or visitor-access change is needed. Exact final verification and publication evidence are recorded in the implementation plan.
