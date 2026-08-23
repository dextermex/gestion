# Morada Gestion — agent notes

Luxembourg property-management SaaS, sibling of Morada.lu. French-only app UI.

## Commands
- `npm run dev` / `npm run build` (51 static pages) / `npm test` (vitest, 113 tests) / `npm run lint`

## Non-negotiables
1. **Legal constants are data** — only `src/domain/legal/params.ts` (→ `legal_params`
   table) may hold a legal figure, with effective dates and a verified/uncertain flag.
   Never hard-code a statutory value in an engine or a page.
2. **Money is integer cents**; splits via `splitExact()`; paid-ness derived from
   allocations, never a boolean.
3. **Legal effect dates derive from AR dates** (registered letters), never click dates.
4. **Design fidelity to Morada.lu** — tokens/kit ported verbatim (see
   docs/DESIGN-SYSTEM.md). No new hues, no dark mode, `font-display font-bold` on every
   heading/number, house easing `cubic-bezier(0.22,1,0.36,1)`, reduced-motion escapes.
5. Badge colours come from the `*_META` maps in `src/lib/types.ts`
   (`bg-{c}-100 text-{c}-800` pairs). New status enums follow the same shape.
6. Pages compute through `src/domain/**` engines over `src/lib/demo/data.ts` — never
   hand-write a derived figure in JSX.

## Key references
- docs/STRATEGY.md — the product spec (authoritative on scope).
- docs/FISCAL-BRIEF.md — the Luxembourg legal brief + uncertainty register.
- docs/ARCHITECTURE.md — layer map, RLS model, CRM lift, production wiring.
- Reference codebase for design/idiom: dextermex/morada (`src/components/pro/ui.tsx`,
  `src/app/gestion/**`).
