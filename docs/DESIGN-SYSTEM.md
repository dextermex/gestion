# Morada Gestion design system

See [the experience audit](UI-REDESIGN.md) for inspected references and flow decisions.
This system applies to the manager, tenant space and portalled forms. It extends
the existing Tailwind kit and Motion components without another UI dependency.

## Hierarchy

Lead with the amount or task that matters now. Keep dates, record context and
explanations visually secondary. Use text and semantic status alongside color.
Preserve the teal Morada identity and Bricolage wordmark. All other headings use
the existing system/Inter stack; monetary figures use tabular numerals.

## Tokens and spacing

| Purpose | Value |
|---|---|
| Canvas | #f3f7fa with a quiet sky wash |
| Quiet surface / divider | #eaf1f6 / #dce6ed |
| Primary / secondary text | #192e3c / #506576 |
| Editable field border | #7b909e |
| Existing primary teal | #10505c |
| Card corners | 28px |
| Field corners / minimum height | 16px / 56px |
| Icon container | 44px with a 22px symbol |
| Primary form action | 56px |
| Standard button | at least 46px |
| Main panel padding | 28px desktop, 24px phone |
| Panel gap | 24px desktop, 20px phone |

Use an 8px rhythm for related groups. Main content gutters scale from 16px on
phones to 56px on wide desktops. Text-heavy groups need 24–32px separation, not
just larger outer margins. Main text is 15–16px, supporting text 13–14px. Inputs
stay 16px even inside smaller-text containers to prevent Safari zoom. H1 scales
from about 30 to 40px; primary financial figures can reach 60px.

## Materials and icons

Navigation may use backdrop blur, translucent white and inset highlights.
Record surfaces use high-opacity white; overview panels use a sky tint. Neither
financial values nor charts use optical distortion. The glass house is lightweight
vector artwork with dimensional planes and reflections. It is not a record image.
Reduced-transparency and high-contrast modes replace translucent surfaces with
solid fills and stronger edges. Reduced motion removes spatial transitions.

Keep the existing Icon family. Labels accompany destination icons; icons alone
are reserved for familiar small controls with accessible names. Use a consistent
44px symbol well for actions and activity; severity comes from text and state,
not a different icon style on every card.

## Forms and journeys

Field remains a semantic label. The floating text moves on focus, content or
autofill; date, month, select and file controls keep it raised. Complex hints remain
below the control and are connected with aria-describedby. Do not use placeholder
text as the sole label. Preserve native validation, keyboards and autocomplete.

Property: essentials, optional details, review. Optional sections open on demand;
returning to essentials retains entered values. Quick lease: parties, then money.
Contact: a short single form. Existing rental drafts retain their saved nine-step
sequence and explicit activation; show a roadmap rather than inventing completion.
Dialogs trap focus among visible enabled controls and restore focus on dismissal.

## Navigation and data

The 248px floating manager sidebar opens Portfolio, Relations and Finances by
default; every section header toggles its entire group. On a phone use the existing
keyboard-contained drawer. Tenant desktop navigation has icons and labels; mobile
uses a floating bottom bar with 12px side gutters and 8px/safe-area bottom clearance.

Show three recommended actions before a labelled disclosure. Recent activity uses
separate dates, event titles, context and amounts. Preserve all facts and links.
Charts plot actual monthly values against a shared zero baseline; selected-month
controls work by touch and keyboard, and exact values remain in a native table.
Tables scroll within their own containers and keep currency/date strings intact.

## Preservation

FR/EN/DE/LU dictionaries remain mandatory. Domain calculations, integer cents,
status maps, permissions, routes and persistence semantics are unchanged. Keep the
sample/real distinction visible. Do not fill an empty account with invented metrics.

## Human Interface layer (September 2026, second pass)

`src/app/hig.css` loads after `globals.css` and has the last word on visual
grammar. It translates Apple's Human Interface Guidelines to the web within
the rules above; it changes no figure, route, label or behaviour.

| Area | Rule |
|---|---|
| Typeface | `--font-sans` is the system stack first (San Francisco on Apple devices), Inter elsewhere. No Apple font or symbol file is shipped: Apple licenses SF Pro and SF Symbols for Apple-platform software, not for a website. The Bricolage wordmark keeps its own face everywhere (`.gestion-logo`). |
| Tracking | Size-specific: large title -0.024em, section titles -0.016em, body -0.006em, captions slightly open. The earlier -0.045em to -0.055em collided letters in SF Display. |
| Weight | Large titles bold (700), section titles and figures semibold (600). Hierarchy comes from weight with size, not size alone. |
| Status colours | The `red`, `emerald`, `amber`, `orange`, `sky`, `violet` and `neutral` shades used by the badge maps are Apple's accessible system colours (light appearance). Every text shade holds 4.5:1 or more on white and on its own 100 tint. The maps in `src/lib/types.ts` are unchanged. |
| Separators | Hairlines (0.5px on 2x screens) in a translucent separator colour, not drawn borders. Table headers sit on the card, not on a grey band. |
| Materials | One glass recipe (`--hig-glass`, `blur(28px) saturate(180%)`, specular top edge) for the sidebar, toolbars, menus and the tenant tab bar. Records stay opaque. Toolbars have no rule: a soft scroll-edge fade appears once content passes under them (`is-scrolled`). |
| Corners | Concentric: an inner radius is the outer radius minus the padding between them. Sidebar 28px with 12px inset gives 16px destinations; capsule tracks hold capsule thumbs. |
| Buttons | Capsules in the components layer (callers' utilities still win): filled primary (`brand-700`), tinted secondary (accent at 9% opacity, no border), plain ghost, destructive. Regular 46px, compact 36px under a pointer, 44px minimum on touch. A link that reads as a button uses `.hig-tinted`. |
| Symbols | The house icon set follows the SF Symbols idiom: `weight` (light, regular, medium, semibold) matches adjacent text, and stroke width is optically compensated by size (`strokeFor`) so a 14px symbol does not look heavy nor a 44px one hairline. |
| Focus | A 3px keyboard ring in the accent at 55%, 2px off the edge. |
| Motion | Sheets use a critically damped spring (no overshoot, 0.32s visual duration), entering and leaving along one path. The house easing and every reduced-motion escape remain. |
| Accessibility | Reduced transparency and increased contrast turn every glass surface solid and remove the scroll-edge fade; increased contrast strengthens separators and outlines the tinted button; forced colours draws borders on tinted and plain buttons. |
