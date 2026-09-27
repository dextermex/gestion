# Morada Gestion — Design System

The shared kit began with Morada.lu. The September 2026 CRM redesign deliberately
adapts it for daily operations: clearer hierarchy, cool surfaces, accessible
navigation and fewer nested boxes. See [the audit and implementation notes](UI-REDESIGN.md).
The manager overrides live under `.crm-shell` in `src/app/globals.css`; portalled
kit dialogs receive the same tokens while that shell is present. The tenant portal
retains its own palette and navigation, using the shared button/form improvements.

## Design read

- Dense property-management software in FR/EN/DE/LU, with actual records and actions.
- Preserve Morada's teal brand and Bricolage wordmark. Use system/Inter typography
  for managerial headings and figures; hierarchy comes from size, weight and space.
- Floating, translucent navigation; opaque white data surfaces. Subtle highlights
  and shallow shadows convey depth without animated glare or distortion.
- Keep the existing icon vocabulary, route structure, status semantics and motion
  library. No additional component or animation dependency is needed.

## Tokens

| Token | Manager value | Use |
|---|---|---|
| `brand-500/600/700/800` | `#1f7c8e` `#14636f` `#10505c` `#0e414c` | Existing primary actions, logo, active navigation |
| `brand-50/100` | `#eef7f8` `#d5ebee` | Quiet tints, selected destinations |
| `accent-500/600` | `#e8613c` `#d43e1c` | Existing logo dot, errors and danger actions |
| `sand-50/100/200/300` | `#f5f7f8` `#edf1f3` `#e0e6e9` `#abb9c0` | Manager canvas, subtle surfaces and edges |
| `ink` / `ink-soft` | `#172b34` / `#536771` | Primary and secondary text |
| Field edge | `#82949e` | At least 3:1 against white for editable fields |
| `--crm-radius` | `1.5rem` | Main content surfaces |

The base tokens outside the manager shell remain those of Morada.lu. Light theme;
do not add automatic dark mode without designing and validating it as a whole.

## Type and components

- Body: Inter Variable, 14px; secondary labels 12px, chart ticks 11px. Phone fields
  are 16px to avoid Safari zoom. Operational headings use system/Inter at weight
  650; metrics use 600 and tabular figures. The logo alone keeps Bricolage.
- Main H1 scales from 26 to 32px; 28px on phones. Panel headings are 16px.
- `Card`: white, a faint edge, 24px corners and a shallow shadow. Group related
  figures with dividers instead of nesting a colored card around every number.
- `Button`: pill, minimum 40px tall (44px on phones). Long translated labels can
  wrap within their parent. Loading, disabled, focus and reduced-motion states remain.
- `Badge`: existing status maps from `src/lib/types.ts`, medium-weight labels.
  Color supplements the status name; financial semantics remain unchanged.
- `table-scroll`: keep dates and tabular amounts on one line; overflow stays inside
  the table. Sentence-case headers and generous row separation improve scanning.
- `Input`/`Select`/`Textarea`: 44px minimum, sentence-case field labels, distinct
  border and brand-colored focus ring. Never replace a label with a placeholder.
- `EmptyState`: explain the next useful action. An empty Home offers the existing
  add-property flow, never fabricated metrics or showcase records.

## Navigation and layout

Desktop has a 248px floating sidebar, 16px exterior gutter and 72px toolbar. At
1024–1279px the sidebar is 232px with a 12px gutter. Below 1024px it becomes a
keyboard-contained drawer. Main content uses 32px gutters on large screens, 20px
on laptops and 16px on mobile, respecting device safe areas.

Portfolio, Relations and Finances are open initially. A whole parent row is a
button with `aria-expanded` and `aria-controls`; children are separate links.
Opening a new destination reveals its group. Manual toggles last for the visit.
Only the actual destination receives `aria-current="page"`. Each rendered nav has
unique disclosure IDs. The role switch moves to the sidebar below 1280px.

The dashboard leads with collection, paid rents and occupancy, then recommended
actions, cashflow, workflows, activity and watchlist. At large widths the first
three operational panels share two columns; below 1280px their DOM and visual
order agree. The chart has adjacent expected/collected series and a native details
table of exact amounts. Onboarding starts as a compact bottom-right control.

Glass is a CSS approximation: translucent fill, blur, saturation and edge light on
navigation only. `prefers-reduced-transparency` and `prefers-contrast: more` select
solid surfaces. Forced colors retains an explicit current-location outline.

## Motion

Retain the house easing `cubic-bezier(0.22,1,0.36,1)` and existing Motion dependency.
Hover/focus transitions take 140–180ms; disclosures rotate over 180ms. The drawer
uses the existing spring (stiffness 380, damping 32), with opacity only under reduced
motion. Do not animate financial figures or use pointer-following effects.
Z ladder: toolbar 30, desktop sidebar 40, drawer/dialog 50, palette 70, skip link 80.

## Language

The Gestion app UI ships in **four languages — français (default), English, Deutsch,
Lëtzebuergesch** — switched via the globe menu (cookie `morada_locale`, shared with the
Morada ecosystem; `lu` renders as `lang="lb"`). Implementation rules:

- One typed dictionary per locale in `src/lib/i18n/` — `fr.ts` is the reference and
  `Dict = typeof fr` makes any missing key in EN/DE/LU a **compile error**.
- Status labels come from the meta factories in `src/lib/types.ts`
  (`rentStatusMeta(d)`…); money/dates/percentages through the locale-aware formatters
  (`fr-LU`, `en-GB`, `de-LU`, `lb-LU` number formats; FR keeps the space before %).
- Engine outputs render from **stable codes** (lease-issue codes, settlement line
  statuses, amortisation reasons, deadline kinds) via `src/lib/i18n/engine.ts` — the
  engines' English `note` strings are internals and never shown.
- **Legal terms of art stay French in every language** (bail, décompte, état des lieux,
  mise en demeure, garantie, CPE) — they are the words of the statutes and of daily
  Luxembourg practice; EN/DE/LU copy carries them as proper nouns.
- Demo data (addresses, remittance lines, stored notes) represents records of a
  French-speaking cabinet and deliberately stays French in all languages.

Tone in all four languages: calm, precise and concrete. Follow CLAUDE.md's copy
rules: use short sentences, commas or parentheses rather than em-dash clauses.

## Hard rules

1. Use the tokens above and the existing approved status hues.
2. Operational headings follow the manager typography above; numbers are tabular.
3. Every animation uses the house easing or existing spring and has a reduced-motion escape.
4. No emoji as icons; inline SVG at `strokeWidth 1.8`, `aria-hidden` when decorative.
5. Wordmark lowercase: `morada gestion` — qualifier in `text-brand-500`.
6. **No opacity-modified text tokens** (`text-ink-soft/70`, `text-red-700/80`…) — they
   fail WCAG contrast on sand backgrounds. Use the full token; hierarchy comes from
   size and weight, not extra transparency.
7. Responsive grids declare their `grid-cols-1` base explicitly; stat rows step
   `grid-cols-1 → sm:grid-cols-2/3 → lg:grid-cols-4`; wide tables live inside
   `table-scroll` (see Phones below).

## Phones

One codebase, one set of screens: below `sm` (40rem) the same components take the
phone's shape, and the desktop keeps its layout untouched. The rules, all in the shared
layer (`globals.css`, `pro/ui.tsx`, the shell):

- **Safe areas.** The root layout declares `viewport-fit=cover`; `globals.css` exposes the
  insets as `--safe-top/right/bottom/left` and the bar height as `--bar-h` (3.75rem on manager phones plus
  the notch). Chrome and pages pad with `px-safe-4` / `px-safe-6` (the gutter, or the
  inset when wider); anything fixed at the bottom uses `max(…, var(--safe-bottom))`.
- **Form controls are 16px on phones** (`fieldClass` adds `max-sm:text-base`): iOS
  Safari zooms the page into any smaller field the moment it gets the caret. Raw
  `<input>`/`<select>` elements outside the kit carry the same class.
- **Targets a thumb can hit.** The kit's `Button` is at least 44px tall on phones, fields 44px; chips, tabs and nav rows carry `max-sm:min-h-10/11`.
- **Wide tables: `table-scroll`.** The wrapper of every data table. On a phone the
  columns keep their natural width, the table scrolls sideways inside its card, the
  first column (what the row is about) stays put with a 9rem minimum, and a shadow at
  the right edge says more columns follow. On manager desktop screens the first column keeps a 12rem minimum; numeric
  columns stay on one line. Tables may scroll on laptops too.
- **Chip rows and tab strips: `scroll-x`.** Scrolls sideways without a scrollbar; on a
  phone the right edge fades, so what continues past the screen reads as such.
- **Rows with badges** cap the badge group at 42% of the row on phones and wrap it, so
  the name keeps the larger share (`max-sm:max-w-[42%] flex-wrap`).
- **Dialogs** are sheets from the bottom on phones (`Modal`), clear of the home
  indicator; the command palette and the drawer keep the same width rules.
- **Messages** is one pane at a time on a phone, the way a messaging app reads: the
  list alone (most recent first), then the tapped conversation as the whole screen, then
  back. While a conversation is open the component sets `html[data-phone-chat]`, and
  every piece of chrome reads it below `lg` and steps aside (the bar, the sample line,
  the tenant bottom bar and foot, the getting-started card, the page's gutter and width
  limit): the card is `100dvh`, keeps the safe areas itself, and carries only the way
  back, the name and the composer. `MessagesCenter` on the desk, `TenantMessages` (over
  `TenantChat`) in the tenant space; a laptop keeps both panes side by side, or the
  title, the chips and the card, exactly as before.
- **The tenant space navigates from a bottom bar on phones** (`TenantBottomNav`, below
  `lg`): Accueil · Bail · Paiements · Messages · Plus, fixed at the foot of the screen,
  clear of the home indicator, packed flat when the phone is held sideways
  (`short-landscape` variant); "Plus" is a sheet with the requests, the owner's space when
  the account has one, and signing out. The tabs under the logo stay above `lg`. Pages
  keep their foot clear through `--nav-b` (the bar's height below `lg`, zero above). The
  manager sidebar carries the Propriétaire / Locataire switch below `xl`, where the
  toolbar has less room. The drawer traps focus, closes on Escape and returns focus
  to its trigger; collapsed descendants are excluded from its tab sequence.
- **Long strings** (an IBAN, an e-mail, a reference) break rather than widen their box:
  `overflow-wrap: break-word` on `body`.

`e2e/tests/responsive.spec.ts` walks every critical screen at 390px and 320px (WebKit
in CI, Chromium's emulation elsewhere) and fails on anything wider than the screen, a
field under 16px or 40px, a kit button under 40px, or a bar covering the title; it also
opens the tenant's Messages from the list in portrait and landscape and checks the
conversation has the screen whole (no bars, the way back at the top, the composer at the
foot, nothing scrolling but the messages). `messages-phone.spec.ts` does the same for the
desk. Their screenshots go to the Playwright report as the regression record.
