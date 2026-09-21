-- One identity, edited once: when a user updates their profile name/phone,
-- their CRM member rows follow. profiles is the single editor for personal
-- data; crm_members.display_name becomes a synced projection (still filled at
-- join time for users without a profile name).

create or replace function public.profiles_sync_member_identity()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_name text;
begin
  v_name := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
  if (new.first_name is distinct from old.first_name
      or new.last_name is distinct from old.last_name)
     and v_name <> '' then
    update public.crm_members set display_name = v_name where user_id = new.id;
  end if;
  if new.phone is distinct from old.phone and new.phone is not null then
    update public.crm_members set phone = new.phone where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_member_identity_trg on public.profiles;
create trigger profiles_sync_member_identity_trg
  after update on public.profiles
  for each row execute function public.profiles_sync_member_identity();

-- One-time alignment: members whose profile has a name keep them in sync now.
update public.crm_members m
   set display_name = btrim(p.first_name || ' ' || p.last_name)
  from public.profiles p
 where p.id = m.user_id
   and btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) <> ''
   and m.display_name is distinct from btrim(p.first_name || ' ' || p.last_name);
