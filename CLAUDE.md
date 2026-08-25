# Morada Gestion — agent notes

Luxembourg property-management SaaS, sibling of Morada.lu. App UI in four languages —
FR (default) / EN / DE / LU — switched by the `morada_locale` cookie.

## Commands
- `npm run dev` / `npm run build` / `npm test` (vitest, 116 tests) / `npm run lint`

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
5. Badge colours come from the colour maps + meta factories in `src/lib/types.ts`
   (`rentStatusMeta(d)` etc. — `bg-{c}-100 text-{c}-800` pairs, labels from the active
   dictionary). New status enums follow the same shape.
6. Pages compute through `src/domain/**` engines over the ACTIVE demo dataset — never
   hand-write a derived figure in JSX. Pages read data via `await getDemo()` from
   `src/lib/demo` (cookie `morada_dataset`), NEVER by importing a dataset module
   directly. Two datasets exist: `data.ts` (Cabinet Reuter, French records — the
   reference) and `data-lu.ts` (Cabinet Majerus, Lëtzebuergesch records — a per-id
   string overlay with IDENTICAL ids/figures/dates/enums, parity compile-checked in
   `src/lib/demo/index.ts`). Dict strings must not embed entity names — pass
   `{unit}/{property}/{owner}` params from the dataset instead.
7. **i18n** — every UI string comes from the typed dictionaries in `src/lib/i18n/`
   (`fr.ts` is the reference; `Dict = typeof fr` makes a missing EN/DE/LU key a compile
   error). Server components call `getI18n()`; formatters (`euros`, `formatDate`,
   `formatPct`…) take the locale. Engine outputs are translated from STABLE CODES
   (issue codes, deduction statuses, regime reasons, deadline kinds) via
   `src/lib/i18n/engine.ts` — never by parsing an engine's English `note`/`message`.
   Legal terms of art stay French in all four languages (bail, décompte, EDL, mise en
   demeure). Demo records stay in the cabinet's working language: French in `data.ts`,
   Lëtzebuergesch in `data-lu.ts` (legal terms still French). Pages that read the
   locale or dataset cookie must NOT use `generateStaticParams`.
8. **Copy style** — NO em dashes and no "→" in UI strings or demo records (they read
   as machine-written); use periods, commas, colons or parentheses. Entity labels join
   with a middot ("Apt 3B · Résidence Beaulieu"). The lone "—" placeholder in table
   cells (`common.none`) is the one exception.

## Key references
- docs/STRATEGY.md — the product spec (authoritative on scope).
- docs/FISCAL-BRIEF.md — the Luxembourg legal brief + uncertainty register.
- docs/ARCHITECTURE.md — layer map, RLS model, CRM lift, production wiring.
- Reference codebase for design/idiom: dextermex/morada (`src/components/pro/ui.tsx`,
  `src/app/gestion/**`).
