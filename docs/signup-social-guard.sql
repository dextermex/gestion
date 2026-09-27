-- Staging setup, NOT applied by this branch or by existing migration runners.
-- Enable this as the shared project's Before User Created hook only after
-- coordinating with the other Morada applications. See SIGNUP-FUNNEL.md.
-- Auth invokes it only for NEW users; linking to an existing phone user and
-- returning-user OAuth login remain available. No table access is needed.
begin;
create or replace function public.morada_phone_signup_guard(event jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when event #>> '{user,app_metadata,provider}' in ('google', 'apple')
    then jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'morada_phone_signup_required'
    ))
    else '{}'::jsonb
  end;
$$;
revoke all on function public.morada_phone_signup_guard(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.morada_phone_signup_guard(jsonb) to supabase_auth_admin;
commit;
