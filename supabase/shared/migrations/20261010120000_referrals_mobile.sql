-- Referral programme for the mobile app: one code per person, one redemption
-- per account. Codes are read through `referral_code()` (created on first
-- call) and redeemed through `redeem_referral(code)`; both run as definer so
-- nobody can list other people's codes. Rewards are decided and granted
-- outside this table (App Store offer codes); the rows are the record.
create table if not exists gestion.referral_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists gestion.referral_uses (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now()
);
create index if not exists referral_uses_referrer_idx on gestion.referral_uses (referrer_user_id);

alter table gestion.referral_codes enable row level security;
alter table gestion.referral_uses enable row level security;

drop policy if exists referral_codes_own on gestion.referral_codes;
create policy referral_codes_own on gestion.referral_codes for select to authenticated using (user_id = auth.uid());

drop policy if exists referral_uses_mine on gestion.referral_uses;
create policy referral_uses_mine on gestion.referral_uses for select to authenticated using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

grant select on gestion.referral_codes, gestion.referral_uses to authenticated;

create or replace function gestion.referral_code() returns text
language plpgsql security definer set search_path = gestion, pg_temp as $$
declare
  uid uuid := auth.uid();
  existing text;
  candidate text;
  n int := 0;
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select code into existing from gestion.referral_codes where user_id = uid;
  if existing is not null then return existing; end if;
  loop
    candidate := 'MO-' || upper(substr(md5(uid::text || 'morada' || n::text), 1, 6));
    begin
      insert into gestion.referral_codes (user_id, code) values (uid, candidate);
      return candidate;
    exception when unique_violation then
      select code into existing from gestion.referral_codes where user_id = uid;
      if existing is not null then return existing; end if;
      n := n + 1;
      if n > 20 then raise; end if;
    end;
  end loop;
end $$;

create or replace function gestion.redeem_referral(p_code text) returns text
language plpgsql security definer set search_path = gestion, pg_temp as $$
declare
  uid uuid := auth.uid();
  owner uuid;
  clean text := upper(trim(coalesce(p_code, '')));
begin
  if uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if clean = '' then return 'invalid'; end if;
  if clean !~ '^MO-' then clean := 'MO-' || clean; end if;
  select user_id into owner from gestion.referral_codes where code = clean;
  if owner is null then return 'invalid'; end if;
  if owner = uid then return 'own'; end if;
  if exists (select 1 from gestion.referral_uses where referred_user_id = uid) then return 'already'; end if;
  insert into gestion.referral_uses (referred_user_id, referrer_user_id, code) values (uid, owner, clean);
  return 'ok';
end $$;

revoke all on function gestion.referral_code() from public;
revoke all on function gestion.redeem_referral(text) from public;
grant execute on function gestion.referral_code() to authenticated;
grant execute on function gestion.redeem_referral(text) to authenticated;
