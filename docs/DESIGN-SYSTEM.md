# Morada Gestion — Design System

The canonical reference is the Morada.lu codebase; this app ports it verbatim. Every rule
below is enforced in `src/app/globals.css` (tokens) and `src/components/pro/ui.tsx` (kit).

## Design read

- **Artifact**: dense B2B admin portal (SaaS) for property managers — plus a marketing-free,
  French-only app surface.
- **Visual language**: Morada's warm editorial identity — teal brand, terracotta accent,
  sand neutrals, ink text. Quiet-luxury real estate, not fintech-blue.
- **Dials**: variance 3 (Morada fidelity beats novelty) · motion 4 (micro-interactions,
  one house easing) · density 7 (admin tables at `text-sm`) · asset-dependence 2
  (inline SVG glyph, no imagery) · brand fidelity 10.

## Tokens (verbatim from Morada)

| Token | Value | Use |
|---|---|---|
| `brand-500/600/700/800` | `#1f7c8e` `#14636f` `#10505c` `#0e414c` | Primary actions, logo, wordmark |
| `brand-50/100` | `#eef7f8` `#d5ebee` | Tints, active nav, icon tiles |
| `accent-500/600` | `#e8613c` `#d43e1c` | Logo dot, alerts, danger buttons, errors |
| `sand-50/100/200/300` | `#faf7f2` `#f3ede2` `#e5d9c4` `#d4c0a0` | Page bg, hovers, borders, scrollbars |
| `ink` / `ink-soft` | `#14232a` `#4a5b63` | Text — never pure black |
| `--shadow-card/-hover/-pop` | ink-tinted soft shadows | Marketing cards / overlays |

Light-only. **No dark mode** (Morada has none — do not introduce it unilaterally).

## Type

- Body: **Inter Variable** at `text-sm` (14px — the app body size). Meta: `text-xs`,
  micro `text-[11px]`.
- Display: **Bricolage Grotesque Variable** — every heading and KPI number gets
  `font-display font-bold`. Page H1 `text-2xl`, card titles `text-lg`.
- Micro-labels: `text-[11px] font-semibold uppercase tracking-wide text-ink-soft/70`.
- Numbers in columns: always `tabular-nums`. Money: `fr-LU` — `1 850,00 €`.
  Percentages: space before `%`.

## Components

- **Card**: `rounded-2xl border border-sand-200 bg-white shadow-sm`, caller adds padding.
- **Buttons**: app = `rounded-xl bg-brand-600 → hover:bg-brand-700` with
  `active:scale-[0.97]` + `motion-reduce` escape; marketing = pill `bg-brand-700 → 600`.
- **Badges**: `rounded-full px-2.5 py-0.5 text-xs font-semibold`, colour pairs
  `bg-{c}-100 text-{c}-800` (red → `text-red-700`, neutral → `bg-neutral-200 text-neutral-600`)
  from the `*_META` maps in `src/lib/types.ts`. Semantics: emerald=success, red=error/late,
  amber=warning/draft, sky=info, violet=special, orange=transitional, neutral=terminal,
  brand=in-progress, sand=neutral.
- **Tables**: header `bg-sand-50/60` + `border-sand-100`, rows `border-sand-50`
  `hover:bg-sand-50/50`, money right-aligned tabular, primary cell is a Link
  `hover:text-brand-700`.
- **Inputs**: `rounded-xl border-sand-200`, focus `border-brand-400 ring-2 ring-brand-100`.
- **Focus**: global `:focus-visible` 2px brand-600 outline.

## Motion

One house easing: `cubic-bezier(0.22, 1, 0.36, 1)` (EASE_OUT). Durations 0.18/0.28/0.5/0.7s.
Springs for modals `{stiffness: 380, damping: 32}`. CSS-only `.stagger-rise` for
server-rendered grids, `.tactile` press. Everything has a `prefers-reduced-motion` escape
(global kill switch in globals.css).

## Layout

App shell: fixed `w-60` white sidebar (`border-sand-100`), sticky `h-14` header
`bg-white/90 backdrop-blur`, main `max-w-6xl px-4 py-6 sm:px-6`. Mobile: `w-72` drawer over
`bg-ink/40`. Z ladder: 30 header / 40 sidebar+menus / 50 drawer+modals / 70 palette.

## Language

The Gestion app UI is **French-only** (deliberate, matching Morada gestion). Legal terms
stay French (bail, décompte, état des lieux, mise en demeure). Tone: calm, precise,
concrete — the em-dash clause adds the consequence ("Les impayés sont détectés et les
rappels préparés — plus rien ne passe entre les mailles.").

## Hard rules

1. No colour outside brand/accent/sand/ink + the seven approved status hues.
2. Every heading/number `font-display font-bold`; all else Inter `text-sm`.
3. Every animation uses the house easing and has a reduced-motion escape.
4. No emoji as icons; inline SVG at `strokeWidth 1.8`, `aria-hidden` when decorative.
5. Wordmark lowercase: `morada gestion` — qualifier in `text-brand-500`.
