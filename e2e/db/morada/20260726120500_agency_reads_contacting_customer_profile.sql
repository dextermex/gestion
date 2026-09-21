-- An agency may read the basic profile of a customer ONLY when that customer
-- has opened a conversation with one of the agency's workspaces. Scoped, not a
-- loosening: it is exactly the person who chose to contact them. Own-profile
-- access (profiles_select_own) is unaffected (RLS policies are OR'd).
drop policy if exists profiles_agency_contacted_read on public.profiles;
create policy profiles_agency_contacted_read on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.customer_conversations c
      where c.user_id = profiles.id
        and c.agency_id in (select public.crm_member_agencies())
    )
  );
