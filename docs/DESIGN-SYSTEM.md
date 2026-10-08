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

## Phones

The same components take the phone's shape below `sm` (40rem); the desktop keeps its
layout. The rules live in the shared layer (`globals.css`, `pro/ui.tsx`, the shell):

- **Safe areas.** `viewport-fit=cover`; the insets are `--safe-top/right/bottom/left`, the
  bar is `--bar-h`. The CRM lift rules outrank utilities, so the insets are written into the
  rules themselves (`max(2rem, var(--safe-left))`), never only as a utility class.
- **Fields are 16px by width and by touch** (`max-sm:text-base pointer-coarse:text-base`):
  a phone held sideways is wider than `sm`. Safari never zooms into a field.
- **Hover is for a mouse.** `hover:` is `(hover: hover) and (pointer: fine)`; a tapped card
  never stays lifted. Every tap answers: controls without a press of their own dim to 60%
  while pressed (components layer), and never select their label on a long press.
- **No bounce, no reload under a thumb**: `overscroll-behavior-y: none` on the root for
  touch screens; inner scrollers carry `overscroll-contain`.
- **Sheets and drawers let go like a phone's.** The Modal's sheet (pulled by its header),
  the drawer (pulled left) and the meter sheet (pulled right) follow the finger and close on
  a flick or past halfway: `useDragToDismiss` in `src/lib/gesture.ts` on `springSheet`.
- **Keyboard up**: the `typing:` variant hides what is fixed at the foot of the screen.
- **Installable.** `src/app/manifest.ts`, icons drawn from the logo by
  `scripts/app-icons.mjs`, white `theme-color` (the bars), `color-scheme: only light`.

## Preservation

FR/EN/DE/LU dictionaries remain mandatory. Domain calculations, integer cents,
status maps, permissions, routes and persistence semantics are unchanged. Keep the
sample/real distinction visible. Do not fill an empty account with invented metrics.
