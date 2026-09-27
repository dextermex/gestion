# CRM frontend redesign · September 2026

The brief is an operational CRM with the clarity and depth of contemporary
fintech and Apple interfaces. The supplied competitor image informs disclosure
navigation and spacing; it is not a specification for new features or sample data.

## Audit and decisions

| Finding | Change |
|---|---|
| Section labels combined navigation with a separate, small disclosure target. Common destinations were hidden on arrival. | Make the entire parent row a disclosure button. Open Portfolio, Relations and Finances initially. Keep destinations as child links. |
| Repeated heavy outlines, colored boxes and display type competed with records. | Cool neutral canvas, white content surfaces, shallow elevation, system/Inter headings and fewer nested cards. Retain Morada teal and its wordmark. |
| Circular dashboard widgets made people interpret decoration before seeing amounts. | Lead with the amount, paid-rent count and occupancy. Use thin progress indicators and one direct action per metric. |
| The cashflow graphic scaled its labels down on phones and overlaid its series. | Use native-size labels and adjacent bars. Include both series in the visual scale, and expose exact values in a native disclosure table. |
| The onboarding overlay competed with navigation and page actions. | Start collapsed at the lower right, honoring an explicit stored preference. |
| Mobile drawer left keyboard focus on the page behind it. | Move focus into the drawer, wrap Tab and Shift-Tab around visible controls, close on Escape/outside pointer, restore focus and scroll on close. Close when switching to a desktop viewport. |
| A pinned drawer footer consumed the navigation area in landscape. | On short screens, make the whole drawer scroll and omit the redundant workspace tile. |
| Long German labels overflowed rents, settings and AML at 320px. | Allow button labels to wrap, stack definition labels on phones, and wrap AML metadata beneath the record name. |

## Material and hierarchy

Glass belongs to navigation. The floating sidebar uses a translucent white fill,
24px backdrop blur, a modest saturation increase and an inset edge highlight.
The toolbar uses a quieter variant. Financial tables, forms and reading surfaces
stay opaque. This is a browser approximation rather than Apple's native material
or a promise of optical refraction. There are no SVG displacement filters, looping
glare effects or new animation dependencies.

The design follows Apple's distinction between floating controls and content:
[Meet Liquid Glass, WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/).
The user-provided CSS-Tricks article and byq.supply endpoint returned HTTP 403 in
this environment. No byq assets or components were imported and no credentials
were written to the repository.

The requested apple-design, gpt-taste, design-taste-frontend and ui-ux-pro-max
skills informed the review. Marketing-specific hero layouts, random art direction,
stock imagery and scroll choreography do not fit a dense, multilingual CRM.

## Accessibility and responsive contract

- Native links and buttons, distinct focus outlines, semantic disclosure state and
  unique relationships for desktop and mobile navigation instances.
- Text, outlines and labels carry state alongside color. Existing financial status
  maps remain authoritative.
- Reduced motion preserves immediate feedback without spatial animation. Reduced
  transparency and increased contrast use solid navigation surfaces. Forced colors
  retains an explicit selected-destination outline.
- Phone fields use 16px text and at least 44px height. Shared buttons are at least
  44px on phones. Table overflow remains inside the table, with dates and amounts
  kept intact. Long labels can wrap.
- Calculated contrast: ink on white **14.67:1**; muted text on canvas **5.51:1**;
  muted text on white **5.92:1**; white on active teal **9.04:1**; muted text on the
  sample banner **5.21:1**; editable-field edges on white **3.14:1**. These checks
  cover the new tokens, not a claim of full-product accessibility certification.

## Scope and validation

Changes are frontend presentation, navigation behavior, localized chart copy,
component regression tests and design documentation. Domain engines, datasets,
database schema, authorization, persistence, document generation and API handlers
are unchanged. Monetary amounts still come from the existing integer-cent engines.
The sample/real distinction stays visible and uses the existing dataset control.

Browser checks use the local preview harness and the existing sample cabinet.
Checks include 320/375px phones, 768px tablet, 812×375 landscape, and 1024/1440px
desktop; English, French and longer German labels; 25 manager routes, including
property and tenancy details; disclosure toggles, drawer focus wrapping and return,
search results, unsubmitted contact forms, chart figures and empty-account Home.
The existing CI database-backed E2E suite remains the authority for authenticated
write flows; it is not replaced by these read-only visual checks.

The navigation tests cover full-row disclosure, correct current-location state,
unique IDs, focus wrapping, Escape, scroll restoration and returning focus to the
trigger. Typecheck, full lint and production build passed; Vitest passed **344 tests
across 39 files**. The responsive E2E button selector now uses the stable `.ui-button`
class instead of a corner-radius utility. The database-backed E2E suite was not run
locally. See [QUALITY.md](QUALITY.md) for its separate database setup.
