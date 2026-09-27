# Morada financing workspace handover

Date: 27 September 2026

## Delivered locally

The financing workspace now includes:

- Mortgage overview at `/app/emprunts`.
- Acquisition pipeline at `/app/acquisitions`.
- Luxembourg lender references and the purchase simulator at `/app/financement/simulateur`.
- Persistent API routes for mortgages and acquisition projects.
- Optimistic concurrency protection for edits.
- Workspace-scoped Supabase tables with RLS and finance permissions.
- Read-only sample records when the `fr` or `lu` sample cabinet is selected.
- Normal live workspace behavior when the `real` dataset is selected.

The UI keeps the existing Morada design system: generous spacing, floating-label 56px controls, high-opacity glass panels, clear financial hierarchy, accessible progress indicators, and explicit empty states. Mortgage balances are treated as financing data, not proof of payments. Profitability is shown as a projection and excludes tenant charges and deposits.

## Files added or changed

- `src/components/gestion/investment/InvestmentWorkspace.tsx`
- `src/lib/gestion/investment.ts`
- `src/app/api/gestion/investment/[kind]/route.ts`
- `src/app/api/gestion/investment/[kind]/[id]/route.ts`
- `supabase/applied/0024_investment_workspace.sql`
- `src/app/app/emprunts/page.tsx`
- `src/app/app/acquisitions/page.tsx`
- `src/components/gestion/Shell.tsx`

## Database migration

Apply `supabase/applied/0024_investment_workspace.sql` to the production Supabase project `lgmoocvumiuqjcqnrlej` before enabling the live pages.

It creates:

- `gestion.investment_loans`
- `gestion.acquisition_projects`

Both tables have workspace ownership, RLS, explicit authenticated grants, finance view/edit policies, and an `updated_at` trigger. Anonymous access and delete access are not granted.

## Sample data

Select `FR` or `LU` in the existing dataset switcher. The financing pages then show a clearly labelled read-only example mortgage and acquisition project. Sample saves are rejected by the API with `403 sample_read_only`; no sample record is written to Supabase.

Select `Real` to use the authenticated workspace. New records are saved through the API and scoped to the active workspace.

## Verification

- 163 focused investment tests passed.
- Next production build passed.
- TypeScript validation passed.
- Build output includes both financing routes and both investment API routes.

## Git publication state

The local implementation is committed as:

`f50706a feat(finance): persist mortgage and acquisition workspaces`

A GitHub object was also prepared as commit `352d803d38b2566d69cca6ed137f53577a66917b` from the existing financing branch.

At handover time, the GitHub branch ref update was blocked by the Codex platform usage-limit reviewer. Confirm the branch points to the new commit before merging or deploying. The Supabase migration likewise still needs to be applied if it has not been run separately.

## Deployment sequence

1. Apply migration `0024_investment_workspace` to the production Supabase project.
2. Confirm the new tables, policies, grants, and triggers with the Supabase catalog and security advisor.
3. Move `codex/mortgages-acquisitions` to the intended GitHub ref or merge PR #6.
4. Wait for the existing CI checks and Vercel deployment.
5. Verify `/api/banking/health` reports the deployed commit.
6. Open `/app/emprunts` and `/app/acquisitions` in both `Real` and `FR`/`LU` dataset modes.

## Known limitation

The sample mortgage and acquisition records are intentionally client-side demonstration data. They are not connected to a bank, lender quote, notary, credit decision, or financial advice workflow. The simulator remains an indicative cash-target calculation using the user’s own assumptions.
