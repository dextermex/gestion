-- ===========================================================================
-- MORADA GESTION — PHASE 3a : RAPPROCHEMENT BANCAIRE
--
-- Import de relevés bancaires (CSV) et rapprochement des encaissements avec
-- les baux. Principes :
--   • Les lignes bancaires sont des FAITS : insérées une seule fois (clé de
--     déduplication), jamais modifiées librement, jamais supprimées.
--   • Un rapprochement crée un vrai g_payments via la même mécanique
--     d'allocation que la saisie manuelle (g_record_payment) — une seule
--     source de vérité pour les soldes.
--   • Toute transition d'état passe par une RPC SECURITY DEFINER qui vérifie
--     g_can(org, 'gestion.finance.edit') : l'invariant « matched ⇔ paiement
--     lié » ne peut pas être contourné par un UPDATE direct.
--   • Rapprochement réversible : g_unmatch_bank_transaction supprime le
--     paiement (les allocations suivent en cascade, g_alloc_sync recalcule
--     les soldes) et rouvre la ligne.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.g_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  label text not null,
  iban text not null default '',
  bic text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists g_bank_accounts_org_idx on public.g_bank_accounts(org_id);

create table if not exists public.g_bank_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  bank_account_id uuid not null references public.g_bank_accounts(id) on delete cascade,
  filename text not null default '',
  rows_total integer not null default 0,
  rows_new integer not null default 0,
  rows_duplicate integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists g_bank_imports_org_idx on public.g_bank_imports(org_id, created_at desc);

create table if not exists public.g_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.agencies(id) on delete cascade,
  bank_account_id uuid not null references public.g_bank_accounts(id) on delete cascade,
  import_id uuid references public.g_bank_imports(id) on delete set null,
  booked_on date not null,
  -- Signed cents: credits (encaissements) positive, debits negative.
  amount_cents integer not null check (amount_cents <> 0),
  counterparty text not null default '',
  reference text not null default '',
  -- md5(account|date|amount|counterparty|reference) + '#' + occurrence index,
  -- so re-importing an overlapping export never duplicates lines while two
  -- genuinely identical same-day transactions in one file both survive.
  dedup_key text not null,
  status text not null default 'new' check (status in ('new','matched','ignored')),
  payment_id uuid references public.g_payments(id) on delete set null,
  matched_by uuid references auth.users(id) on delete set null,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, dedup_key)
);
create index if not exists g_bank_tx_org_status_idx
  on public.g_bank_transactions(org_id, status, booked_on desc);
create index if not exists g_bank_tx_account_idx
  on public.g_bank_transactions(bank_account_id, booked_on desc);

drop trigger if exists g_bank_accounts_touch on public.g_bank_accounts;
create trigger g_bank_accounts_touch before update on public.g_bank_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RPC — import d'un relevé (batch atomique, dédupliqué)
--    p_rows: [{"booked_on":"2026-08-01","amount_cents":65000,
--              "counterparty":"MULLER JEAN","reference":"LOYER AOUT"}]
-- ---------------------------------------------------------------------------
create or replace function public.g_import_bank_rows(
  p_org uuid,
  p_account uuid,
  p_filename text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_import uuid;
  v_total integer;
  v_new integer := 0;
  r record;
  v_inserted uuid;
begin
  if not public.g_can(p_org, 'gestion.finance.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if not exists (select 1 from public.g_bank_accounts where id = p_account and org_id = p_org) then
    raise exception 'Compte bancaire introuvable dans cette organisation.';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Lignes invalides.';
  end if;
  v_total := jsonb_array_length(p_rows);
  if v_total = 0 then raise exception 'Aucune ligne à importer.'; end if;
  if v_total > 2000 then
    raise exception 'Import limité à 2000 lignes par fichier — découpez le relevé.';
  end if;

  insert into public.g_bank_imports (org_id, bank_account_id, filename, rows_total, created_by)
  values (p_org, p_account, coalesce(p_filename, ''), v_total, auth.uid())
  returning id into v_import;

  for r in
    select
      x.booked_on, x.amount_cents,
      coalesce(x.counterparty, '') as counterparty,
      coalesce(x.reference, '') as reference,
      md5(p_account::text || '|' || x.booked_on::text || '|' || x.amount_cents::text
          || '|' || coalesce(x.counterparty, '') || '|' || coalesce(x.reference, ''))
        || '#' ||
        row_number() over (
          partition by x.booked_on, x.amount_cents,
                       coalesce(x.counterparty, ''), coalesce(x.reference, '')
          order by x.ord
        )::text as dedup_key
    from (
      select
        (e.value ->> 'booked_on')::date as booked_on,
        (e.value ->> 'amount_cents')::integer as amount_cents,
        e.value ->> 'counterparty' as counterparty,
        e.value ->> 'reference' as reference,
        e.ordinality as ord
      from jsonb_array_elements(p_rows) with ordinality as e(value, ordinality)
    ) x
  loop
    if r.booked_on is null or r.amount_cents is null or r.amount_cents = 0 then
      raise exception 'Ligne invalide : date ou montant manquant.';
    end if;
    insert into public.g_bank_transactions
      (org_id, bank_account_id, import_id, booked_on, amount_cents,
       counterparty, reference, dedup_key)
    values
      (p_org, p_account, v_import, r.booked_on, r.amount_cents,
       left(r.counterparty, 200), left(r.reference, 400), r.dedup_key)
    on conflict (org_id, dedup_key) do nothing
    returning id into v_inserted;
    if v_inserted is not null then
      v_new := v_new + 1;
      v_inserted := null;
    end if;
  end loop;

  update public.g_bank_imports
  set rows_new = v_new, rows_duplicate = v_total - v_new
  where id = v_import;

  return jsonb_build_object(
    'import_id', v_import,
    'total', v_total,
    'new', v_new,
    'duplicates', v_total - v_new
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. RPC — rapprocher une ligne créditrice avec un bail
-- ---------------------------------------------------------------------------
create or replace function public.g_match_bank_transaction(
  p_tx uuid,
  p_lease uuid,
  p_allocations jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  t record;
  v_payment uuid;
begin
  select * into t from public.g_bank_transactions where id = p_tx for update;
  if not found then raise exception 'Transaction introuvable.'; end if;
  if not public.g_can(t.org_id, 'gestion.finance.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if t.status = 'matched' then
    raise exception 'Transaction déjà rapprochée.';
  end if;
  if t.amount_cents <= 0 then
    raise exception 'Seul un crédit (montant positif) peut être rapproché comme encaissement.';
  end if;

  v_payment := public.g_record_payment(
    t.org_id,
    p_lease,
    t.amount_cents,
    t.booked_on,
    'transfer',
    trim(both ' —' from left(t.counterparty || ' — ' || t.reference, 300)),
    'Rapprochement bancaire',
    p_allocations
  );

  update public.g_bank_transactions
  set status = 'matched',
      payment_id = v_payment,
      matched_by = auth.uid(),
      matched_at = now()
  where id = p_tx;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. RPC — annuler un rapprochement (supprime le paiement, rouvre la ligne)
-- ---------------------------------------------------------------------------
create or replace function public.g_unmatch_bank_transaction(p_tx uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  t record;
begin
  select * into t from public.g_bank_transactions where id = p_tx for update;
  if not found then raise exception 'Transaction introuvable.'; end if;
  if not public.g_can(t.org_id, 'gestion.finance.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if t.status <> 'matched' then
    raise exception 'Cette transaction n''est pas rapprochée.';
  end if;

  -- Allocations follow by cascade; g_alloc_sync recomputes period balances.
  delete from public.g_payments where id = t.payment_id;

  update public.g_bank_transactions
  set status = 'new', payment_id = null, matched_by = null, matched_at = null
  where id = p_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RPC — ignorer / rouvrir une ligne (jamais matched par ce chemin)
-- ---------------------------------------------------------------------------
create or replace function public.g_set_bank_tx_status(p_tx uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  t record;
begin
  if p_status not in ('new', 'ignored') then
    raise exception 'Statut invalide.';
  end if;
  select * into t from public.g_bank_transactions where id = p_tx for update;
  if not found then raise exception 'Transaction introuvable.'; end if;
  if not public.g_can(t.org_id, 'gestion.finance.edit') then
    raise exception 'Action non autorisée.';
  end if;
  if t.status = 'matched' then
    raise exception 'Annulez d''abord le rapprochement de cette transaction.';
  end if;
  update public.g_bank_transactions set status = p_status where id = p_tx;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. AUDIT — comptes intégralement ; transactions sur update uniquement
--    (l'import en masse est déjà journalisé par g_bank_imports).
-- ---------------------------------------------------------------------------
drop trigger if exists g_bank_accounts_audit on public.g_bank_accounts;
create trigger g_bank_accounts_audit after insert or update or delete on public.g_bank_accounts
  for each row execute function public.g_audit();
drop trigger if exists g_bank_tx_audit on public.g_bank_transactions;
create trigger g_bank_tx_audit after update on public.g_bank_transactions
  for each row execute function public.g_audit();

-- ---------------------------------------------------------------------------
-- 7. RLS — lecture pour finance.view ; écritures uniquement via RPC,
--    sauf la gestion des comptes eux-mêmes.
-- ---------------------------------------------------------------------------
alter table public.g_bank_accounts enable row level security;
alter table public.g_bank_imports enable row level security;
alter table public.g_bank_transactions enable row level security;

drop policy if exists g_bank_accounts_select on public.g_bank_accounts;
create policy g_bank_accounts_select on public.g_bank_accounts for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));
drop policy if exists g_bank_accounts_insert on public.g_bank_accounts;
create policy g_bank_accounts_insert on public.g_bank_accounts for insert to authenticated
  with check (g_can(org_id, 'gestion.finance.edit'));
drop policy if exists g_bank_accounts_update on public.g_bank_accounts;
create policy g_bank_accounts_update on public.g_bank_accounts for update to authenticated
  using (g_can(org_id, 'gestion.finance.edit'))
  with check (g_can(org_id, 'gestion.finance.edit'));
-- Deleting an account drops its imported history: only allowed while no line
-- has been matched (otherwise unmatch first — payments would be orphaned).
drop policy if exists g_bank_accounts_delete on public.g_bank_accounts;
create policy g_bank_accounts_delete on public.g_bank_accounts for delete to authenticated
  using (
    g_can(org_id, 'gestion.finance.edit')
    and not exists (
      select 1 from public.g_bank_transactions t
      where t.bank_account_id = g_bank_accounts.id and t.status = 'matched'
    )
  );

drop policy if exists g_bank_imports_select on public.g_bank_imports;
create policy g_bank_imports_select on public.g_bank_imports for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));

drop policy if exists g_bank_tx_select on public.g_bank_transactions;
create policy g_bank_tx_select on public.g_bank_transactions for select to authenticated
  using (g_can(org_id, 'gestion.finance.view'));
-- No insert/update/delete policies: bank lines are facts, managed by the RPCs.

-- ---------------------------------------------------------------------------
-- 8. GRANTS — defense in depth: bank RPCs are for signed-in members only
--    (g_can already rejects anonymous callers, this removes the surface).
-- ---------------------------------------------------------------------------
revoke execute on function public.g_import_bank_rows(uuid, uuid, text, jsonb) from anon, public;
revoke execute on function public.g_match_bank_transaction(uuid, uuid, jsonb) from anon, public;
revoke execute on function public.g_unmatch_bank_transaction(uuid) from anon, public;
revoke execute on function public.g_set_bank_tx_status(uuid, text) from anon, public;
