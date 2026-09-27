# Morada CRM experience redesign · September 2026

## Audience and direction

A property manager or tenant around 45, with little appetite for learning software,
should be able to identify the important amount, understand the next action, and
finish a form without hunting for labels. The second pass therefore changes the
flows behind the main screens, alongside their visual presentation.

Preserve Morada's teal identity, actual records, routes and permissions. Use cool
sky surfaces, restrained glass navigation, generous whitespace, and a custom glass
house illustration. The house is decorative vector artwork, never a property
photograph or a representation of a dataset record. There are no new dependencies.

## References inspected

- [Revolut balance overview](https://mobbin.com/screens/5be4e584-20cf-45a5-aade-d505997121b7):
  dominant balance, secondary context, consistent circular action symbols, separated
  content groups. Adapt those relationships to a desktop CRM rather than copying
  the mobile screen.
- [Revolut address, filled](https://mobbin.com/screens/e2edf931-36c7-4a5f-b719-f6f07f14652f)
  and [empty](https://mobbin.com/screens/256eb687-1020-473f-857b-66987e9eaba6):
  in-field labels, larger rounded controls, a separate continuation action.
- [Revolut adding a friend](https://mobbin.com/flows/3458e20d-ef6b-4d27-8978-17fdc032a90a):
  a short contact form with minimal required information.
- [Attio activity and record details](https://mobbin.com/screens/297adfeb-8312-496b-8acf-41839a6cf775):
  distinguish chronological activity from reference information. Morada uses more
  space and larger labels for its intended audience.
- Apple's HIG: Layout / Visual hierarchy; Typography / Ensuring legibility;
  Entering data / Best practices; Text fields / Best practices; Icons / Consistency;
  Charting data / Best practices. Read through the supplied apple-design references.

These are visual observations, not measured conversion claims. The 56px field
height is the user's requirement. The four supplied skills inform hierarchy,
progressive disclosure, accessibility and restrained motion. Their marketing-only
random layouts, scrolling choreography and stock imagery are inappropriate here.
The earlier CSS-Tricks and byq.supply requests returned HTTP 403; no byq assets or
credentials are included in the repository.

## What changed

| Previous issue | Current behavior |
|---|---|
| Property creation required eight or nine separate screens. | Three stages: type/name/address, optional additions, review. Surface, photos, lots and technical data remain available in independent disclosures. Back/edit retains the answers. |
| Small fields with external labels cluttered forms. | Shared native controls are at least 56px high, with semantic floating labels. Filled, focused, autofilled and date/select/file states retain context; helper text is connected with aria-describedby. |
| Demo contact creation differed from the real form. | Both use name, role and optional contact details. Only the submit behavior differs. |
| Quick lease creation was one long form. | Two screens, first the parties and tenancy details, then the money and guarantee. The same controls remain mounted and the same payload is submitted. |
| Dashboard figures competed equally. | A larger collected-rent figure leads. Arrears use explicit text and a restrained warning tone. Overdue work and deposit tasks appear before routine checks. |
| Recommended actions overwhelmed the page. | Three actions are initially visible; remaining actions stay in an explicit disclosure. Category, title and context have separate visual roles. |
| Recent activity combined dates, amounts and descriptions into crowded rows. | Consistent 44px icon wells, separate dates, spacious text blocks and standalone payment amounts. |
| Chart values required hover or a dense bar comparison. | A shared-baseline monthly line chart with solid/dashed series, keyboard/touch month selection, prominent exact values and an accessible table. |
| Tenant home retained the old styling and proportions. | The next amount due leads, arrears remain explicit, property context is separate, and labelled shortcuts lead to requests, lease and payments. Wider desktop layout and floating phone navigation use the same system. |
| Deeper operations looked unrelated. | Rental, departure, inspection, contact, payment and request forms share the larger controls and sheet treatments. The resumable nine-step rental workflow retains its persistence semantics and gains a named desktop roadmap. |

## Boundaries and validation

No datasets, domain calculations, authorization rules, schemas or API handlers are
changed. Amounts still come from the existing integer-cent engines. No production
records were created to test the design. Sample submissions stay visibly nonpersistent.
The existing rental draft/save/activation and departure/inventory sequence remains
intact; a shorter property journey does not change the meaning of those workflows.

Browser review covers manager Home, property creation through review, contact and
lease dialogs, tenant Home, payment details and request creation at desktop and phone
sizes, including 320px. Shared forms are checked for 56px height and 16px input text.
Reduced motion, reduced transparency, keyboard focus and native controls remain.

The property regression tests check essential validation, retained answers after
editing, the unchanged creation payload, no writes from samples, and semantic label
and help associations. The existing database E2E helpers now use the three-stage
property flow; responsive tests assert the new floating tenant-bar geometry while
retaining touch-target, overflow and footer-clearance checks.
