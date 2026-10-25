# Design

Proxmiu should feel like a modern developer tool, in the family of Linear, Vercel and Raycast: calm, dense where it matters, fast, and confident about one accent colour. Dark mode is the primary experience; light mode is fully supported.

## Principles

1. **Quiet by default.** Neutral surfaces, hairline borders, one accent. Colour carries meaning (status, focus, selection), not decoration.
2. **Information first.** Numbers use tabular figures; IDs and IPs use the mono font; secondary info is muted, not hidden.
3. **Fast paths.** The most common action on a row is a visible icon button; the rest live in a menu. Everything is reachable from ⌘K.
4. **Safe destruction.** Destructive actions are red, never primary, and need typed confirmation when they can't be undone.
5. **Works on a phone.** Every screen must be usable at 390px wide.

## Tokens

Defined in `web/src/index.css` as CSS variables and exposed to Tailwind via `@theme inline`. Use the Tailwind names, never raw hex in components (exception: the terminal palette).

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `background` | `#fafafa` | `#09090b` | Page |
| `sidebar` | `#f4f4f5` | `#0c0c0e` | Sidebar, mobile tab bar |
| `card` | `#ffffff` | `#111113` | Cards, tables |
| `card-elevated` | `#ffffff` | `#18181b` | Dialogs, menus, palette |
| `hover` | 4.5% black | 5% white | Hover and selected rows/items |
| `inset` | 2.5% black | 2.5% white | Inputs, code blocks, dialog footers |
| `border` / `border-subtle` / `border-strong` | 9% / 5% / 16% black | 8% / 4.5% / 15% white | Hairlines |
| `foreground` | `#18181b` | `#ededef` | Primary text |
| `muted` | `#52525b` | `#a1a1aa` | Secondary text, labels |
| `faint` | `#a1a1aa` | `#6b6b74` | Tertiary text, icons, placeholders |
| `primary` / `primary-foreground` | `#18181b` / white | `#ededef` / `#09090b` | Primary button (inverts per theme) |
| `brand` / `brand-soft` | `#6e56f5` / 10% | `#8b7bff` / 14% | Accent: active nav icon, focus ring, switches, meters, sparklines, brand button |
| `success`, `warning`, `destructive`, `info` (+ `-soft`) | green-600, amber-600, red-600, blue-600 | `#3ecf8e`, `#f5a524`, `#f87171`, `#60a5fa` | Status only |

Shadows: `--shadow-card` (barely there), `--shadow-float` (dialogs, menus). Dark cards use a 1px top inner highlight instead of a drop shadow. `--glow` is a faint brand-tinted radial gradient at the top of the main area.

## Typography

- **Geist Variable** for UI and **Geist Mono Variable** for IDs, IPs, code and the terminal (self-hosted via `@fontsource-variable`).
- Base 14px / 1.5. Page title 24px semibold, tracking −0.025em. Card titles 13px semibold. Labels 12.5px medium `muted`. Help text 12px `faint`.
- Stat numbers: 30px semibold, tracking −0.035em, `tnum`.
- Use the `tnum` utility on any changing number; use `eyebrow` for small section labels.

## Shape and spacing

- Radius: controls 8px (`rounded-md`), cards 12px (`rounded-xl`), dialogs 12px, badges full.
- Page padding 32px horizontal (16px on phones). Card padding 16px. Gaps: 16px between cards, 24px between sections.
- Controls are 32px (sm) or 36px (md) tall; large CTAs 40px. Table rows ~44px.

## Components

- **Button** (`ui/button.tsx`). Variants:
  - `primary`: inverted neutral, the default main action
  - `brand`: violet, only for the single most important CTA on focused screens such as Connect
  - `outline`: secondary
  - `ghost`: toolbar and icon buttons
  - `destructive`: soft red that turns solid on hover

  Buttons scale to 0.98 on press, and icons are 16px.
- **Card**: hairline border, `card` background; `CardHeader` uses `border-subtle`.
- **Inputs/Select/Textarea**: `inset` background with a brand focus border and a 3px `brand-soft` ring. Wrap every field in `Field` (label + help).
- **Badge**: 20px pill. `neutral` for tags, `brand` for Proxmiu-created guests, semantic tones for status.
- **StatusDot**: 8px dot; running/online pulses softly in green.
- **Meter**: 4px bar in brand, turning warning above 75% and destructive above 90%.
- **Sparkline**: brand line with a fading area, used at the bottom of stat cards.
- **Dialog**: blurred overlay; the content pops in (scale 0.98 → 1, 180ms). Footer uses the `inset` background. Confirmations use `ConfirmDialog`.
- **Command palette** (cmdk): centred at 18vh, groups Create / Guests / Go to.
- **TemplateTile**: 40px gradient tile tinted per icon (sparkles orange, terminal emerald, bot violet, container sky, server zinc). This is the only place multiple hues appear.
- **Terminal**: `#0b0b0d` background, Geist Mono 13px, brand cursor, Tailwind-400-family ANSI colours.

## Layout

- **Desktop (≥1024px):** 232px sidebar with logo, search button (⌘K), nav (active item gets `hover` bg and a brand icon), and a footer with agent status, theme and logout.
- **Tablet (640–1023px):** the sidebar collapses to a 60px icon rail.
- **Phone (<640px):** no sidebar.
  - A sticky blurred top bar holds the logo and search.
  - A fixed bottom tab bar holds Overview, Guests, Create, Activity and More; it respects `env(safe-area-inset-*)`.
  - Tables become card lists, and page-header actions hide because the tab bar covers them.

## Motion

Subtle and quick: 150–200ms, ease-out or `cubic-bezier(0.16,1,0.3,1)`. Animate only opacity, transform, colour and width (meters). No bouncing, nothing longer than 700ms (meter width).

## Icons

Lucide only, 16px in UI (20–22px in the mobile tab bar), stroke 1.75–2. Icons in nav and menus are `faint` until active or hovered.

## Copy

- Sentence case everywhere.
- Buttons are verbs: "Create container", "Connect", "Delete permanently".
- Empty states say what will appear and offer the next step.
- Errors say what happened and what to do, e.g. "Start the agent with PROXMIU_TLS=1".

## Accessibility

- Visible focus: 2px brand outline, or the brand ring on fields.
- Text contrast: `muted` on `card` meets WCAG AA in both themes; `faint` is for non-essential text only.
- Icon-only buttons have a `title`/`aria-label`. Dialogs come from Radix (focus trap, Esc to close).

## Don'ts

- No extra accent colours outside status, template tiles and the terminal.
- No shadows on regular cards. Floating layers only.
- No company or third-party branding. The logo is `web/public/logo.svg` (violet tile with three server bars).
