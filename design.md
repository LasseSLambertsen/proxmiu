# Design

Proxmiu should feel like a calm, warm glass dashboard: a floating, skewed dark-frosted sidebar, a soft cream-to-blue atmosphere, translucent cards, and a small set of confident accents. Light is the primary experience; dark mode carries the same glass language into low light.

## Principles

1. **Warm glass by default.** Surfaces are translucent over a soft warm gradient, with a floating skewed sidebar and layered cards. Depth comes from blur, a slight perspective skew, layered light and a hairline highlight, not heavy borders.
2. **Information first.** Numbers use tabular figures; IDs and IPs use the mono font; secondary info is muted, not hidden. Glass must never get in the way of density.
3. **Colour as atmosphere.** Amber is the brand accent. Stat cards use soft warm, cool, blue and lilac tints. Status colours stay semantic: green, amber, red, teal.
4. **Fast paths.** The most common action on a row is a visible icon button; the rest live in a menu. Everything is reachable from ⌘K.
5. **Safe destruction.** Destructive actions are red, never primary, and need typed confirmation when they can't be undone.
6. **Works on a phone.** Every screen must be usable at 390px wide. The mobile tab bar is a floating dark glass dock.

## Tokens

Defined in `web/src/index.css` as CSS variables and exposed to Tailwind via `@theme inline`. Use the Tailwind names, never raw hex in components (exceptions: the terminal palette and the decorative stat tints).

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `background` | `#f6f0e7` | `#0b0d12` | Page; the body adds warm/cool radial glows |
| `sidebar` | dark glass | dark glass | Sidebar, mobile dock |
| `card` | white 55% | white 5% over navy | Cards, tables |
| `card-elevated` | white 86% | navy 92% | Dialogs, menus, palette |
| `hover` | 6% navy | 7% white | Hover and selected rows/items |
| `inset` | white 45% | white 4.5% | Inputs, code blocks, dialog footers |
| `border` / `border-subtle` / `border-strong` | 13% / 8% / 22% navy | 10% / 6% / 18% white | Hairlines; cards also use a white glass edge |
| `foreground` | `#1b2030` | `#f5f1e9` | Primary text |
| `muted` | `#4e5563` | `#aaa6b4` | Secondary text, labels |
| `faint` | `#7c8290` | `#74707f` | Tertiary text, icons, placeholders |
| `primary` / `primary-foreground` | `#1b2030` / cream | `#f5f1e9` / navy | Primary button (dark glass CTA) |
| `brand` / `brand-soft` | `#e28a2f` / 14% | `#f0a23a` / 16% | Accent: active nav icon, focus ring, switches, meters, sparklines |
| `success`, `warning`, `destructive`, `info` (+ `-soft`) | teal, amber, coral, steel blue | mint, amber, coral, sky | Status only |

Shadows: `--shadow-card` is a soft ambient shadow plus a 1px white inner highlight; `--shadow-float` is used for dialogs, menus and the mobile dock. The body gradient is warm at the top-left and cool at the top-right, with a faint grid.

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

- **Card** (`ui/card.tsx`). Translucent glass, 22px radius, white glass edge in light mode and a white/10 hairline in dark mode, with a 2xl backdrop blur.
- **Stat card** (`pages/Overview.tsx`). Optional decorative tints: `tint-warm`, `tint-cool`, `tint-blue`, `tint-lilac`. These are the only place multiple hues appear alongside template tiles.
- **Button** (`ui/button.tsx`). Variants:
  - `primary`: dark navy glass, the default main action
  - `brand`: amber, only for the single most important CTA on focused screens such as Connect
  - `outline`: glass with a hairline
  - `ghost`: toolbar and icon buttons
  - `destructive`: soft red that turns solid on hover

  Buttons scale to 0.98 on press, and icons are 16px.
- **Sidebar**. A floating dark glass slab inset from the top, bottom and left, with a `skewY(-1.2deg)` edge (`.sidebar-slab`) while the content stays upright. It uses `.nav-glass` for light text and an amber active icon, a subtle top sheen, 26px corners and a soft float. The mobile tab bar reuses the glass variables and sheen as a horizontal dock.
- **Inputs/Select/Textarea**. Translucent glass with a brand focus border and a 3px `brand-soft` ring. Wrap every field in `Field` (label + help).
- **Badge**. 20px pill. `neutral` for tags, `brand` for Proxmiu-created guests, semantic tones for status.
- **StatusDot**. 8px dot; running/online pulses softly in green.
- **Meter**. 4px bar in amber, turning warning above 75% and destructive above 90%.
- **Sparkline**. Amber by default; CPU uses steel blue. A fading area sits behind the line.
- **Dialog / menu / palette**. Translucent elevated glass, 22px radius, 2xl blur, soft floating shadow. Footer uses `inset`.
- **TemplateTile**. 40px gradient tile tinted per icon (sparkles orange, terminal emerald, bot violet, container sky, server zinc).
- **Terminal**. `#0b0b0d` background, Geist Mono 13px, brand cursor, Tailwind-400-family ANSI colours. The terminal toolbar adds copy, paste, select all, sticky Ctrl/Alt/Shift and special keys.

## Layout

- **Desktop (≥1024px):** 248px floating dark glass sidebar with a skewed slab, logo, search button (⌘K), nav (active item gets a translucent white panel, amber icon) and a footer with agent status, theme and logout.
- **Tablet (640–1023px):** the sidebar collapses to a 72px dark icon rail, still as a skewed slab.
- **Phone (<640px):** no sidebar.
  - A sticky blurred warm top bar holds the logo and search.
  - A floating dark glass dock holds Overview, Guests, Create, Activity and More; it respects `env(safe-area-inset-*)` and sits above the content with `92px` bottom clearance.
  - Tables become card lists, and page-header actions hide because the dock covers them.

## Motion

Subtle and quick: 150–200ms, ease-out or `cubic-bezier(0.16,1,0.3,1)`. Animate only opacity, transform, colour and width (meters). No bouncing, nothing longer than 700ms (meter width).

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
- No extra accent colours outside status, stat tints, template tiles and the terminal.
- No company or third-party branding. The logo is `web/public/logo.svg` (violet tile with three server bars).
