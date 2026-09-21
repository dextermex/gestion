-- Enable Supabase Realtime for the customer↔agency messaging tables.
-- Additive: only adds tables to the realtime publication + sets replica identity
-- so UPDATE/DELETE events carry key data. RLS still governs what each client
-- actually receives (realtime respects row-level security).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='customer_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.customer_messages';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='customer_conversations'
  ) then
    execute 'alter publication supabase_realtime add table public.customer_conversations';
  end if;
end $$;

alter table public.customer_messages replica identity full;
alter table public.customer_conversations replica identity full;
