# Financing workspace

## Status: frontend implementation, persistence awaiting scope confirmation

The user requested mortgage tracking, prospective-property acquisitions and an
investment scenario calculator, with specialist finance, real-estate and design
agents. The earlier instruction prohibited backend/data changes. A clarification
is pending before adding saved records. No production schema, existing dataset,
rent ledger, tax calculation or bank reconciliation has been changed.

The development-only `/app/financement/apercu` harness exercises the new loan and
acquisition components. Its records live in React memory and disappear on refresh.
It is not a saved CRM. `/app/financement/simulateur` contains the working pure
calculator. Do not release these routes as a completed saved feature until the
persistence boundary below is implemented and verified.

## Product and calculation decisions

- New Finances destinations: Crédits immobiliers (`/app/emprunts`) and Projets
  d’achat (`/app/acquisitions`). The calculator is a secondary action on each,
  rather than a third permanent sidebar entry.
- Mortgage records describe the balance on a dated bank statement. A projected
  amortisation schedule never marks a banking transaction paid. No recorded loan
  means financing is unknown, not that the property is paid off.
- Fixed and variable tranches are separate records. The calculator assumes a
  monthly amortising loan at an unchanged nominal rate, not APR/TAEG. It does not
  model balloon, deferred or interest-only repayment, refinancing charges or a
  future change in rates. The stress scenario is an explicit rate change.
- Capital progress is `(original principal - statement balance) / original
  principal`. An increased balance is flagged. It is not a property valuation,
  equity estimate or evidence of release of the bank’s security.
- All monetary inputs and schedule outputs use integer cents. The final payment
  clears rounding residue. Input bounds prevent nonfinite or unsafe arithmetic.
- Rental cash flow uses current, dated leases, excluding tenant charges and
  deposits. Principal, interest and insurance are outgoing cash; principal never
  becomes tax-deductible interest. Operating yield is independent of financing.
  Unknown owner expenses do not produce an unqualified net yield.
- Property totals aggregate all linked loans. Unit projections use only directly
  linked unit loans and stop when a shared building loan has no allocation.
- The next-purchase result is a cash-target horizon: purchase price minus proposed
  borrowing, plus fees, works and retained reserve, minus available savings,
  divided by monthly savings after existing commitments. Nonpositive savings
  cannot close a positive gap. Reaching the target does not imply bank approval.
- Rates, purchase costs and reserves are user-entered. No current rate, statutory
  lending limit or tax relief is hardcoded. The household debt ratio is descriptive;
  it is not a pass/fail credit decision.

## Acquisition workflow

Stages are research, viewings, offer, compromis signed, deed preparation, deed
signed, keys handed over, paused and archived. Financing has its own status.
Planned notary appointments, actual deed signatures, contractual transfer dates
and key handovers are independent fields. Moving a project never fabricates an
event date, sends an offer or executes an agreement. Signed stages require their
actual event date. Adding a prospect does not create an owned property or lease.

The overview uses a searchable vertical list sorted by the next dated action.
The next notary appointment is highlighted separately. Bank and notary choices
remain free text with official reference links, not endorsements or integrations.

## Persistence boundary to approve and implement

Add only two isolated record types, mortgage loans and acquisition projects.
The existing `gestion.property_acquisitions` table holds historical fiscal facts
for owned properties and must not be repurposed as a prospect pipeline.

Use the existing caller-JWT `withOrg` API spine, scoped to the active organisation.
Loan property/unit references must be checked against that organisation and each
other. Apply finance-role row-level permissions, with no tenant or anonymous read
policy and no service-role key. Validate every write against the shared schemas;
keep existing rows, ledgers and allocation logic untouched. Updates need conflict
handling so one operator cannot silently overwrite a newer edit.

The sidebar entries and individual loan/acquisition routes are development-only
while this decision is pending. Remove those guards only with verified persistence.

Persistence tests must cover create/update/reload, another organisation, tenant
access, invalid property/unit pairs and malformed amounts. Only after these checks
should the sidebar destinations be enabled, the preview harness removed, and the
feature pushed and deployed under the user’s existing release authorisation.

## Research checked 27 September 2026

- [CSSF mortgage agreements](https://www.cssf.lu/en/mortgage-credit-agreements/):
  nominal fixed/variable structures, lender assessment, personalised ESIS offers,
  financial-plan costs and contract-sensitive early repayment.
- [CSSF technical FAQ](https://www.cssf.lu/wp-content/uploads/Technical_FAQ_on_Regulation_CSSF_No_20-08.pdf):
  lending categories depend on purpose and borrower status. No universal approval
  threshold is embedded in this product.
- [atHome Finance simulator](https://www.athome.lu/en/finance/mortgage/simulation-result):
  reference for separating budget, capacity and repayment. Published rates are
  not copied or represented as customer offers.
- [Guichet acquisition costs](https://guichet.public.lu/en/citoyens/fiscalite/immobilier/achat-vente-donation/credit-impot-actes-notaries.html):
  relief depends on eligibility; the calculator does not deduct it automatically.
- [Guichet compromis](https://guichet.public.lu/fr/citoyens/logement/acquisition/aspects-contractuels/compromis-vente.html)
  and [Chambre des notaires](https://www.notariat.lu/actes-notaries): compromis can
  bind the parties; contractual ownership timing and handover need separate facts.
- [Official notary directory](https://www.notariat.lu/trouver-notaire).
- Official bank product pages are defined in `src/lib/investment/loans.ts`,
  alphabetically, with free entry for other lenders. No rates are preselected.

## Design rationale

Keep Morada’s existing sky/teal system: high-opacity financial records, restrained
glass framing, 28px corners, 56px labeled fields, 44px links and readable system
type. Primary amounts lead; status, dates and supporting explanations follow.
Forms have three named steps and optional disclosures. Charts use a zero baseline
and exact-value tables. Mobile rows stack instead of squeezing columns.

Reviewed Revolut references:
[monthly analytics](https://mobbin.com/screens/00858497-3c29-4b4c-a931-2ce62727360f),
[cumulative analytics](https://mobbin.com/screens/691ffd53-5aba-4a39-bfa6-6064a299bdcd),
[setting a spending limit](https://mobbin.com/flows/3fe53f0a-c4a4-45c7-8707-173689b1bdb0).
These support amount hierarchy and focused entry, not claims about a Revolut
mortgage application or measured conversion improvement.

Apple Design references used by the design agent include `layout.md` (Visual
hierarchy), `text-fields.md` (Best practices), `charts.md` (Best practices), and
`liquid-glass.md` (The two layers). UI/UX Pro Max’s marketing-oriented search
output was checked and rejected in favour of the existing CRM design system.
GPT Taste contributes restraint and readable spacing; its randomised marketing
heroes and scroll choreography do not fit the requested operational workspace.

## Verification for the frontend checkpoint

Production build, typecheck and targeted lint pass. The existing full suite plus
the first investment tests passed (512 tests); the subsequently added acquisition
and portfolio suites also pass. There are 163 new investment tests in total.
Browser checks covered calculator steps/results, loan create/review/detail,
acquisition create/review/detail and 320px overflow/input sizing. These checks do
not validate persistence, cross-workspace RLS or live bank integration.
