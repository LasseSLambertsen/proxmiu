# Design

Proxmiu should feel like a calm, warm glass dashboard seen through dark glass: a floating dark-frosted sidebar, deep amber and teal ambient glows, translucent smoky cards, and a small set of confident accents. Dark is the primary experience; light mode keeps the same glass language on quiet warm paper with clearer white surfaces. The marketing hero uses a flat dark device frame with the same glass.

## Principles

1. **Warm glass by default.** Surfaces are translucent over a deep warm gradient, with a floating dark sidebar and layered smoky cards. Depth comes from blur, layered light and a hairline highlight, not heavy borders or skew.
2. **Information first.** Numbers use tabular figures; IDs and IPs use the mono font; secondary info is muted, not hidden. Glass must never get in the way of density.
3. **Colour as atmosphere.** Amber is the brand accent. Stat cards use soft warm, cool, blue and lilac tints. Status colours stay semantic: green, amber, red, teal.
4. **Fast paths.** The most common action on a row is a visible icon button; the rest live in a menu. Everything is reachable from ⌘K.
5. **Safe destruction.** Destructive actions are red, never primary, and need typed confirmation when they can't be undone.
6. **Works on a phone.** Every screen must be usable at 390px wide. The mobile tab bar is a floating dark glass dock.

## Tokens

Defined in `web/src/index.css` as CSS variables and exposed to Tailwind via `@theme inline`. Use the Tailwind names, never raw hex in components (exceptions: the terminal palette and the decorative stat tints).

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `background` | `#f7f5f0` | `#0b0d12` | Page; the body adds warm/cool radial glows |
| `sidebar` | dark glass | dark glass | Sidebar, mobile dock |
| `card` | white 78% | white 5% over navy | Cards, tables |
| `card-elevated` | warm white 97% | navy 92% | Dialogs, menus, palette |
| `hover` | 5.5% charcoal | 7% white | Hover and selected rows/items |
| `inset` | cool pale grey 62% | white 4.5% | Inputs, code blocks, dialog footers |
| `border` / `border-subtle` / `border-strong` | 16% / 9% / 28% charcoal | 10% / 6% / 18% white | Shared hairlines, including card boundaries |
| `foreground` | `#20252f` | `#f5f1e9` | Primary text |
| `muted` | `#505965` | `#aaa6b4` | Secondary text, labels |
| `faint` | `#626b77` | `#74707f` | Tertiary text, icons, placeholders |
| `primary` / `primary-foreground` | `#1b2030` / cream | `#f5f1e9` / navy | Primary button (dark glass CTA) |
| `brand` / `brand-soft` | `#9c5416` / 10% | `#f0a23a` / 16% | Accent: active nav icon, focus ring, switches, meters, sparklines |
| `success`, `warning`, `destructive`, `info` (+ `-soft`) | teal, amber, coral, steel blue | mint, amber, coral, sky | Status only |

Shadows: `--shadow-card` is a soft ambient shadow plus a 1px white inner highlight; `--shadow-float` is used for dialogs, menus and the mobile dock. The body gradient is warm at the top-left and cool at the top-right, with a faint grid. Paint ambient light on this shared canvas only; a main-column overlay creates a visible seam beside the sidebar. Light-mode text and semantic colors meet 4.5:1 on their card/soft surfaces. Browser chrome follows the active background token.

## Typography

- **Geist Variable** for UI and **Geist Mono Variable** for IDs, IPs, code and the terminal (self-hosted via `@fontsource-variable`).
- Base 14px / 1.5. Page title 28px semibold, tracking −0.03em. Card titles 13px semibold. Labels 12.5px medium `muted`. Help text 12px `faint`.
- Stat numbers: 30px semibold, tracking −0.035em, `tnum`.
- Use the `tnum` utility on any changing number; use `eyebrow` for small section labels.

## Shape and spacing

- Radius: controls 10px (`rounded-md`), cards and dialogs 22px (`rounded-xl`), badges full.
- Page padding 32px horizontal (16px on phones). Card padding 16px. Gaps: 16px between cards, 24px between sections.
- Controls are 32px (sm) or 36px (md) tall; large CTAs 40px. Table rows ~44px.

## Components

- **Card** (`ui/card.tsx`). Translucent glass, 22px radius, a shared `border` token for legible boundaries in both modes, with a 2xl backdrop blur.
- **Stat card** (`pages/Overview.tsx`). Optional decorative tints: `tint-warm`, `tint-cool`, `tint-blue`, `tint-lilac`. These are the only place multiple hues appear alongside template tiles.
- **Button** (`ui/button.tsx`). Variants:
  - `primary`: dark navy glass, the default main action
  - `brand`: amber, only for the single most important CTA on focused screens such as Connect
  - `outline`: glass with a hairline
  - `ghost`: toolbar and icon buttons
  - `destructive`: soft red that turns solid on hover

  Buttons scale to 0.98 on press, and icons are 16px.
- **Sidebar**. A straight floating dark glass rail inset from the top, bottom and left, with 26px corners and a soft float. It uses `.nav-glass` for light text and an amber active icon, with a subtle top sheen. The logo row has generous padding (`h-20 px-5`) so the mark is not crowded by the glass edge. The mobile tab bar reuses the glass variables and sheen as a horizontal dock. No skew.
- **Inputs/Select/Textarea**. Translucent glass with a brand focus border and a 3px `brand-soft` ring. Wrap every field in `Field` (label + help).
- **Badge**. 20px pill. `neutral` for tags, `brand` for Proxmiu-created guests, semantic tones for status.
- **StatusDot**. 8px dot; running/online pulses softly in green.
- **Meter**. 4px bar in amber, turning warning above 75% and destructive above 90%.
- **Sparkline**. Amber by default; CPU uses steel blue. A fading area sits behind the line.
- **Dialog / menu / palette**. Translucent elevated glass, 22px radius, 2xl blur, soft floating shadow. The outer border is the only outline; the float shadow adds no second ring. Footer uses `inset`.
- **Saved connection editing**. A row Edit action opens a focused dialog with a fixed destination, blank replacement secret, TLS choice, Test and primary Save changes. Errors retain the draft; stale edits require deliberate reload. Use the existing focus, loading and phone dialog behavior.
- **TemplateTile**. 40px gradient tile tinted per icon (sparkles orange, terminal emerald, bot violet, container sky, server zinc).
- **Terminal**. `#0b0b0d` background, Geist Mono 13px, brand cursor, Tailwind-400-family ANSI colours. The terminal toolbar adds copy, paste, select all, sticky Ctrl/Alt/Shift and special keys.

## Layout

- **Desktop (≥1024px):** 248px straight floating dark glass sidebar, logo, search button (⌘K), nav (active item gets a translucent light panel, amber icon) and a footer with agent status, theme and logout.
- **Tablet (640–1023px):** the sidebar collapses to a 72px dark icon rail.
- **Phone (<640px):** no sidebar.
  - A sticky blurred warm top bar holds the logo and search.
  - A floating dark glass dock holds Overview, Guests, Create, Activity and More; it respects `env(safe-area-inset-*)` and sits above the content with `112px` bottom clearance.
  - Tables become card lists, and page-header actions hide because the dock covers them.

## Motion

Subtle and quick: 150–200ms, ease-out or `cubic-bezier(0.16,1,0.3,1)`. Animate only opacity, transform, colour and width (meters). No bouncing, nothing longer than 700ms (meter width).

The visible lynx companion is an intentional exception: the companion button (or five quick logo clicks) reveals a small mascot with a swishing tail, blinking eyes and a pet interaction. It stays clear of the mobile dock, closes with Escape or its dismiss button, and disables its animations when reduced motion is requested. The app and presentation site share `lynx-easter-egg.js`; a mascot-led advisor and site story make it part of the product.

## Icons

Lucide only, 16px in UI (20–22px in the mobile dock), stroke 1.75–2. Icons in nav and menus are `faint` until active or hovered.

## Copy

- Sentence case everywhere.
- Buttons are verbs: "Create container", "Connect", "Delete permanently".
- Empty states say what will appear and offer the next step.
- Errors say what happened and what to do, e.g. "Start the agent with PROXMIU_TLS=1".

## Accessibility

- Visible focus: 2px amber outline, or the amber ring on fields.
- Text contrast: `muted` on `card` meets WCAG AA in both themes; `faint` is for non-essential text only.
- The dark glass sidebar always uses light text; the `.nav-glass` scope carries those overrides.
- Icon-only buttons have a `title`/`aria-label`. Dialogs come from Radix (focus trap, Esc to close).

## Don'ts

- No opaque white panels on the warm background; use the glass card.
- No heavy borders or pure-black shadows. Glass depth comes from blur and highlight.
- No nested outlines. Code blocks and help panels inside cards/dialogs are `inset` fills, not additional bordered boxes; selectable options get a single focus ring, not a border plus a ring.
- No extra accent colours outside status, stat tints, template tiles and the terminal.
- No company or third-party branding. The logo is `web/public/logo.png`: an amber robotic lynx on charcoal, with server cartridges in its visor and a teal status light. `logo.svg` and `favicon.svg` are simplified vector companions for small sizes. The maskable home-screen icon has dedicated safe-area padding.

## Guest workspaces and inventory

- Guest names and command-palette results open `/guests/:clusterId/:node/:type/:vmid`. Detail pages keep power actions, SSH, configuration, real RRD history and notes together. History gaps are gaps; missing data is never drawn as zero usage. Charts support pointer inspection and left/right keyboard navigation.
- Pins belong to the agent, keyed by connection/type/vmid. Notes use the existing Proxmox description and configuration digest, with an explicit save action. Failed or stale saves preserve drafts; older agent notes are recoverable by deliberate user action.
- Inventory filters are independent, with browser-local saved views scoped to the agent. Advanced filters collapse on phones so the guest list remains useful. Export includes visible inventory fields and neutralizes spreadsheet formulas.
- Multi-select operations review a fixed target list and report each outcome. At most 50 guests and two concurrent requests; queued requests stop if the page is left or the agent becomes unavailable. Bulk operations use the existing authenticated power routes.
- Overview health warnings use the latest actual connection/node state and a 90% resource threshold. They do not imply sustained monitoring or background notification delivery.

- Advanced operations live together in the guest workspace. Rollback and snapshot deletion require typed guest-name confirmation. Accepted tasks show their actual running/stopped status and exit result; partial permission errors remain explicit.
- The optional AI advisor lives in Settings with the lynx mark. Provider credentials are password inputs and never reappear after save. Show the exact anonymous numeric preview before consent, render advice as plain text, and avoid implying a point-in-time reading proves sustained use.

- Resource edits are a focused form in the guest workspace: label cores per socket and memory in MiB, retain the socket count, review old and new values before save, and explain stopped/pending/unsupported states. Conflicts preserve drafts and require deliberate reload.
- Backup inventories identify the selected storage and distinguish permission/read failures from a verified empty list. Tracked task logs use the original task node, render plain text and bound both paging and total display.

- Activity separates Proxmox-retained task history from the agent's retained provisioning/update journal. Native history initializes a source once and retains it, its last-known node, selection and loaded logs during offline overviews that omit nodes. It never silently switches connections. Source/filter changes deliberately reset list and selection; late responses cannot replace the new source.
- Native task outcomes distinguish running, success, warnings, failure and unknown. Unknown Proxmox terminal markers remain unknown. Native logs may be reopened after agent restart by refreshing history and selecting the task; permissions and retention stay authoritative.

- With a configured AI key the lynx wake controls open a branded conversational dialog; without one they retain the companion. Chat exposes the provider/model and intentional message-sharing boundary, uses plain text, preserves failed drafts, and clears on provider change, key removal or agent switch. The dialog fits390px and restores keyboard focus.

- Setup help inside chat starts with an explicit guest choice, exact read-only preview and affirmative consent. Keep the trusted guest identity distinct from anonymous data sent to the provider. Proposals show cores per socket/socket count, MiB and boot behavior before and after, with an explicit apply confirmation and real success/failure state. Unsupported or running guests stay read-only. Lynx's voice is professional and observant with restrained fox/lynx flair; never trade precise consent or technical meaning for a joke.

- Creation planning is a separate explicit chat mode. Draft cards identify the built-in template and resource units and hand off through “Review in Create.” Keep the existing form's layout; show the suggested values and a review acknowledgment beside Create. Replacing an open form is deliberate, failed template checks preserve it, and no draft enters URLs or persistent browser storage. No placement, networking or secret fields come from the model.

- Provisioning history survives agent restarts with an explicit interrupted state, saved diagnostic tails and intended guest identity. Show persistence health and truncation near the history controls, and distinguish unavailable history from an empty list. Interrupted work never spins as running or appears successful. Historical success and SSH details describe that run's saved outcome, with current-state verification left to the user. Recovery guidance is precise and manual; no automatic retry/resume controls.

## Agent-free sample tour

The separate `/demo/` tour extends the existing warm-glass app world using the same pure cards, badges, fields, resource-history chart and fonts. Desktop/tablet rails and the phone dock keep the app’s proportions. A persistent sample-data banner, fixed snapshot labels and read-only details distinguish exploration from an operational session. All controls either navigate, filter or inspect sample content; the install/exit links return to the presentation site. Theme preference uses its own namespace and the demo cannot reach agent/provider/terminal transports. No new visual identity or global token changes are introduced.

## Guest native console

Guest workspaces keep separate SSH terminal and Console choices. The native console can open without a guest IP, identifies its exact guest/node and asks for an explicit Connect before mounting the shared terminal. Reconnect/disconnect are deliberate, supported/stopped/offline/permission states stay clear, and a stale target closes rather than silently switching. Use existing dialog, terminal, focus and mobile key controls; no new visual system. Console credentials remain server-side and output is transient. The sample tour never gains an operational console control.

## Reviewed host updates

A node’s Updates menu opens a dedicated page in the existing warm-glass shell. Enrollment explains the dedicated public key, administrator command and trusted fingerprint. Check and install are separate actions: show the entire package/version list, additions, expiry and service-restart impact before typed node confirmation. Saved targets in Settings keep recovery reachable during inventory outages. Accepted work continues after leaving; unknown status blocks another install, and failed/interrupted states lead to local inspection. Manual reboot advice stays separate. Review cards stack at 390px, long names and versions wrap, and no package data enters persistent browser storage or the public demo.
