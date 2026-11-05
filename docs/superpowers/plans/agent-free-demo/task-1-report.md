# Task 1 implementation report

Completed app source, build wiring, CI compilation and focused browser verification on `feat/agent-free-demo`. No dependencies, commits, pushes, real infrastructure calls or website changes were made by this worker.

## Files and artifact contract

- `web/demo.html` is an independent module entry with no manifest or service worker. Its CSP sets `connect-src 'none'`, `form-action 'none'`, `worker-src 'none'`, self-hosted scripts/fonts and no external asset origins.
- `web/src/demo/main.tsx`, `data.ts` and `style.css` provide Overview, Guests, Templates, Activity, guest workspaces, template configuration and saved-run details. All sample hosts use documentation IPs/`.invalid` hostnames. The fixed snapshot is 4 Nov 2026 12:00 UTC; synthetic history covers 10:00–12:00 UTC, including deliberately missing samples.
- Navigation and detail routes use hashes. Unknown routes/IDs recover explicitly. Guest search/status/type filters, reset, shared chart metrics and keyboard inspection, template details, saved steps and plaintext logs work. Persistent notice, Exit demo and Install Proxmiu links remain visible. There are no connection/secret/terminal/AI/write controls or fake operational actions.
- The existing Geist fonts, theme tokens, Card/Badge/Button/Field/TemplateTile/Meter/Sparkline/ResourceHistory and formatting utilities are reused. Source runtime imports do not include App, Layout, agent, API, query, live pages or provider implementations. ResourceHistory's existing pure metric helper has only erased API type imports.
- `ResourceHistory.tsx` receives an optional `sourceLabel` presentation prop (default unchanged) plus a wrapping header so the demo honestly says `Synthetic samples · fixed snapshot` at narrow widths.
- `vite.config.ts` selects an isolated demo input only for mode `demo`, forces base `/demo/`, disables public directory copying and outputs to `dist/demo`. Its completed HTML is renamed to `index.html`. Normal app entry/output remain `web/index.html`/`dist/web`.
- `package.json` adds `npm run build:demo`; existing Linux/Windows Node22 CI compiles this artifact after the normal build. Output inspection confirmed only `index.html` and `assets/*` JS/CSS/PNG/WOFF2, without source maps, manifest, companion scripts or other normal public files.
- Only `proxmiu-demo-theme` persists. All exploration resets on reload; hash identity remains shareable.

## Actual verification evidence

Initial RED, before the demo implementation: `node web/test/demo.e2e.cjs` exited 1 with `AssertionError: build:demo must produce dist/demo/index.html`. This was an observed missing-feature failure, not an inferred or reconstructed result.

On 5 Nov after resuming saved source:

- `npm run build:demo && npm run typecheck` passed. The build completed and both server/web TypeScript checks exited 0.
- `SCREENSHOT_DIR=/tmp/proxmiu-demo node web/test/demo.e2e.cjs` passed all six 1440/900/390px × dark/light cases and captured the initial single screenshot batch.
- A strengthened no-screenshot `node web/test/demo.e2e.cjs` passed all six cases after adding actual scoped saved-view sentinels and chart-selection/gap assertions.
- Controller's visual pass identified a material Install CTA contrast defect: `.demo-links>a` overrode the shared primary button anchor with muted, underlined text. A new rendered text/background contrast assertion reproduced RED before the fix: 1.819:1, foreground `[192,178,162,255]`, background `[247,239,229,255]`, decoration `underline`.
- Narrowed that selector to the Exit link with `:first-child`. The final `npm run build:demo && npm run typecheck` passed. `SCREENSHOT_DIR=/tmp/proxmiu-demo-confirmation node web/test/demo.e2e.cjs` then passed all six cases, including actual CTA contrast ≥4.5:1 and no underline, and captured the one permitted confirmation batch. No further visual polishing was performed.
- `git diff --check` passed at handoff.

The focused fixture serves only local built files by default. `DEMO_BASE_URL=https://example.invalid/demo/ node web/test/demo.e2e.cjs` selects an existing static deployment instead, with the same interactions/isolation checks. Screenshot writes occur only when `SCREENSHOT_DIR` is supplied.

## Isolation and interaction evidence

Each fresh browser context preseeds a fake agent URL/token, fake SSH key, the actual agent-scoped `proxmiu-workspace-v1` saved-view key and normal theme preference. Probes instrument Storage get/set/remove/clear/key before demo modules run. Probe evidence lives outside the document, so reloads cannot erase earlier accesses. All observed demo accesses were to `proxmiu-demo-theme`; every normal sentinel remained unchanged.

Fetch, XMLHttpRequest, WebSocket, EventSource, workers, service-worker registration and sendBeacon are instrumented as forbidden transports. No construction/call occurred. Every browser resource request stayed under the static `/demo/` base, self-hosted fonts loaded, and page errors, failed requests and CSP violation console messages were empty.

The suite actually explores all primary sections, filters to empty and stopped/VM subsets, resets filters, confirms filter reload reset, opens/reloads a guest, switches every history metric, inspects with arrow keys and encounters the missing interval, opens a template configuration, selects interrupted saved steps and verifies script-looking logs remain plaintext. It checks unknown-route/guest recovery, saved-run reload, separate theme persistence and horizontal bounds on all detail/primary surfaces at all six viewport/theme combinations. Contexts request reduced motion.

## Screenshots and handoff limits

Controller-reviewed initial batch: `/tmp/proxmiu-demo/{overview,guest}-{dark,light}-{1440,900,390}.png`.

Final confirmation after the material correction: `/tmp/proxmiu-demo-confirmation/{overview,guest}-{dark,light}-{1440,900,390}.png` (12 images).

These checks use the existing local Chromium/Playwright installation and static fixture. This worker did not run real Proxmox/provider operations, other browser engines, remote deployment smoke tests, Windows execution or the full project test/normal-build suite. Controller owns final consolidated checks, fresh whole-branch review and publishing. Browser probes plus source import review establish the current boundary; the fixture does not claim to be a generic adversarial sandbox for future code that intentionally bypasses those probes.
