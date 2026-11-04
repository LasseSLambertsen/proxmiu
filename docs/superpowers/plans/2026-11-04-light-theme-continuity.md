# Light theme refinement and continuous shell background

The user supplied a Connections screenshot, requested a refined light mode and identified a hard background change beside the sidebar in both modes. This steers the current work without discarding the verified durable-history feature.

The body already paints a shared warm/cool ambient background, while Layout adds a second amber radial gradient clipped to the main column. Remove that column-specific paint so the background remains continuous across the sidebar gutter. Preserve the floating dark navigation surface, layout, typography and dark palette.

Refine light tokens toward cleaner warm paper: quieter low-chroma ambient glows, more legible foreground/secondary/semantic text, clearer white card/input separation and restrained neutral shadows. Keep amber/teal identity and existing semantic color meanings. Browser chrome theme color must follow the active background token.

- [x] Capture incumbent light/dark Connections views and measure adjacent gutter pixels across desktop/tablet sidebar boundaries; observe the seam regression before the fix.
- [x] Adjust shared light tokens and remove main-column glow; check readable text/semantic contrast on light surfaces and theme-toggle/meta persistence.
- [x] One batched visual pass at desktop/tablet/390px in both modes, fix material issues together, then one confirmation if needed. Preserve focus, dialogs, overflow and existing app flows.
- [ ] Run required typecheck/tests/build and relevant fixtures. Include this final scope in the reviewed/published app PR; site publication still describes durable setup history.

No new dependencies, infrastructure behavior, auth changes or provider sharing. The prior journal review continues independently; UI styles are a separate review scope.

Rendered baseline showed an RGB step of up to 8 at the main-column boundary; after the fix adjacent samples differ by at most 2 in both themes at desktop/tablet widths. Light text/semantic contrast ranges from 4.85:1 to 15.08:1 on tested surfaces. Theme toggles, persistence, browser chrome and desktop dialogs pass.

The single visual pass found pre-existing Connections clipping at 390px despite root overflow being hidden. A control-bounds assertion failed before the fix (Scan began at x388); `grid-cols-1` constrains the implicit grid track. The confirmation captures show Scan, input and Remove within the phone viewport. Both-mode desktop/tablet/phone checks pass. No further visual changes are needed.

Required final typecheck, 107 tests, full build and retained/native history browser fixtures pass. Independent theme review approved specification and quality with no material defects; source, assertions and final captures reviewed. Publication remains to be recorded.
