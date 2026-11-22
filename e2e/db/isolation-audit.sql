-- ===========================================================================
-- Isolation audit: what the database itself refuses and keeps, whoever writes.
--
-- rls-audit.sql proves structure (RLS on, policies present, nothing for
-- anon). This file proves meaning: a row of one workspace cannot point at a
-- record of another, a tenant's writes carry the database's own clock, the
-- lots of a property follow it into the archive and back, and every link
-- between two workspace tables has its guard.
--
-- It creates two workspaces with one tenancy each, runs its checks, and
-- leaves nothing behind: everything it wrote is undone at the end. Any check
-- that fails raises and stops the run. Safe to run on any database.
-- ===========================================================================

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  prop_a uuid; unit_a uuid; lease_a uuid; contact_a uuid; pay_a uuid;
  prop_b uuid; unit_b uuid; lease_b uuid; contact_b uuid; period_b uuid; conv_b uuid;
  free_prop uuid; free_unit uuid;
  charge_b uuid; act_a uuid;
  n int; m int;
  ts timestamptz;
  missing text;
begin
  begin
    -- Two workspaces, one tenancy in force in each.
    insert into public.agencies (id, slug, name) values (a, 'isolation-a-' || left(a::text, 8), 'Isolation A'), (b, 'isolation-b-' || left(b::text, 8), 'Isolation B');
    insert into gestion.properties (org_id, name) values (a, 'A') returning id into prop_a;
    insert into gestion.properties (org_id, name) values (b, 'B') returning id into prop_b;
    insert into gestion.units (org_id, property_id, label) values (a, prop_a, 'A1') returning id into unit_a;
    insert into gestion.units (org_id, property_id, label) values (b, prop_b, 'B1') returning id into unit_b;
    insert into gestion.leases (org_id, unit_id, start_date, rent_cents, status) values (a, unit_a, current_date - 40, 100000, 'active') returning id into lease_a;
    insert into gestion.leases (org_id, unit_id, start_date, rent_cents, status) values (b, unit_b, current_date - 40, 100000, 'active') returning id into lease_b;
    insert into gestion.contacts (org_id, first_name) values (a, 'Alice') returning id into contact_a;
    insert into gestion.contacts (org_id, first_name) values (b, 'Bruno') returning id into contact_b;
    insert into gestion.rent_periods (org_id, lease_id, period, due_date, rent_cents)
      values (b, lease_b, date_trunc('month', current_date)::date, current_date, 100000) returning id into period_b;
    insert into gestion.conversations (org_id, scope_type, scope_id, subject) values (b, 'lease', lease_b, 'Bail') returning id into conv_b;
    insert into gestion.payments (org_id, lease_id, received_on, amount_cents) values (a, lease_a, current_date, 1000) returning id into pay_a;

    -- 1. A row of workspace A never points at a record of workspace B.
    begin
      insert into gestion.rent_periods (org_id, lease_id, period, due_date, rent_cents) values (a, lease_b, date '2031-01-01', date '2031-01-05', 1);
      raise exception 'ACCEPTED: a rent period on another workspace''s lease';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.lease_parties (org_id, lease_id, contact_id, role) values (a, lease_b, contact_a, 'tenant');
      raise exception 'ACCEPTED: a party on another workspace''s lease';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.lease_parties (org_id, lease_id, contact_id, role) values (b, lease_b, contact_a, 'tenant');
      raise exception 'ACCEPTED: another workspace''s contact as a party';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.leases (org_id, unit_id, start_date, rent_cents) values (a, unit_b, current_date, 1);
      raise exception 'ACCEPTED: a lease on another workspace''s lot';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.messages (org_id, conversation_id, sender_kind, body) values (a, conv_b, 'manager', 'x');
      raise exception 'ACCEPTED: a message in another workspace''s conversation';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.conversations (org_id, scope_type, scope_id, subject) values (a, 'lease', lease_b, 'x');
      raise exception 'ACCEPTED: a conversation on another workspace''s lease';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.documents (org_id, class, name, storage_path, related_type, related_id)
        values (a, 'other', 'x.pdf', a::text || '/documents/' || gen_random_uuid()::text || '.pdf', 'lease', lease_b);
      raise exception 'ACCEPTED: a document attached to another workspace''s lease';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.documents (org_id, class, name, storage_path)
        values (a, 'other', 'x.pdf', b::text || '/documents/' || gen_random_uuid()::text || '.pdf');
      raise exception 'ACCEPTED: a document naming a file of another workspace';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.payment_allocations (org_id, payment_id, rent_period_id, amount_cents) values (a, pay_a, period_b, 1);
      raise exception 'ACCEPTED: an allocation on another workspace''s rent period';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.deposits (org_id, lease_id, form, amount_cents) values (a, lease_b, 'bank_guarantee', 1);
      raise exception 'ACCEPTED: a deposit on another workspace''s lease';
    exception when insufficient_privilege then null; end;
    -- Moving an existing row across is refused too.
    begin
      update gestion.rent_periods set org_id = a where id = period_b;
      raise exception 'ACCEPTED: a rent period moved to another workspace';
    exception when insufficient_privilege then null; end;

    -- 2. What a tenant writes carries the database's clock, and the conversation follows.
    insert into gestion.messages (org_id, conversation_id, sender_kind, body, sent_at, read_at)
      values (b, conv_b, 'tenant', 'isolation audit', timestamptz '2020-01-01', now());
    select sent_at into ts from gestion.messages where conversation_id = conv_b and body = 'isolation audit';
    if ts < now() - interval '5 minutes' then raise exception 'a tenant''s message kept the caller''s clock'; end if;
    if exists (select 1 from gestion.messages where conversation_id = conv_b and body = 'isolation audit' and read_at is not null) then
      raise exception 'a tenant''s message arrived already read';
    end if;
    if (select last_message_at from gestion.conversations where id = conv_b) is distinct from ts then
      raise exception 'the conversation''s clock did not follow its last message';
    end if;
    begin
      insert into gestion.messages (org_id, conversation_id, sender_kind, body) values (b, conv_b, 'manager', repeat('x', 4001));
      raise exception 'ACCEPTED: a message longer than 4000 characters';
    exception when check_violation then null; end;

    -- 3. Archiving: the lots follow the property and come back with it; a let property stays.
    insert into gestion.properties (org_id, name) values (a, 'Free') returning id into free_prop;
    insert into gestion.units (org_id, property_id, label) values (a, free_prop, 'F1') returning id into free_unit;
    update gestion.properties set archived_at = now() where id = free_prop;
    if exists (select 1 from gestion.units where property_id = free_prop and archived_at is null) then
      raise exception 'a lot stayed live after its property was archived';
    end if;
    update gestion.properties set archived_at = null where id = free_prop;
    if exists (select 1 from gestion.units where property_id = free_prop and archived_at is not null) then
      raise exception 'a lot stayed archived after its property was restored';
    end if;
    begin
      update gestion.properties set archived_at = now() where id = prop_b;
      raise exception 'ACCEPTED: archiving a property with a tenancy in force';
    exception when check_violation then null; end;

    -- 3b. An issued charge statement keeps what it said (0035): through the API
    -- its figures, dates and lines no longer change, it is not deleted and it
    -- does not go back to draft; only its status moves on.
    insert into gestion.charge_periods (org_id, lease_id, year, regime, status, advances_billed_cents, actual_cents)
      values (b, lease_b, 2030, 'advances', 'draft', 1000, 1500) returning id into charge_b;
    insert into gestion.charge_lines (org_id, charge_period_id, source, label, category, lot_share_cents, tenant_share_cents)
      values (b, charge_b, 'estimate', 'Eau', 'water', 1500, 1500);
    perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    update gestion.charge_periods set status = 'issued', issued_on = current_date, due_on = current_date + 30 where id = charge_b;
    begin
      update gestion.charge_periods set actual_cents = 1 where id = charge_b;
      raise exception 'ACCEPTED: an issued charge statement rewritten';
    exception when insufficient_privilege then null; end;
    begin
      update gestion.charge_periods set status = 'draft' where id = charge_b;
      raise exception 'ACCEPTED: an issued charge statement taken back to draft';
    exception when insufficient_privilege then null; end;
    begin
      delete from gestion.charge_periods where id = charge_b;
      raise exception 'ACCEPTED: an issued charge statement deleted';
    exception when insufficient_privilege then null; end;
    begin
      insert into gestion.charge_lines (org_id, charge_period_id, source, label, category, lot_share_cents, tenant_share_cents)
        values (b, charge_b, 'estimate', 'Chauffage', 'heating', 1, 1);
      raise exception 'ACCEPTED: a line added to an issued charge statement';
    exception when insufficient_privilege then null; end;
    begin
      update gestion.charge_lines set tenant_share_cents = 1 where charge_period_id = charge_b;
      raise exception 'ACCEPTED: a line of an issued charge statement rewritten';
    exception when insufficient_privilege then null; end;
    update gestion.charge_periods set status = 'settled' where id = charge_b;
    perform set_config('request.jwt.claims', '', true);

    -- 3c. A line of the activity journal stays in its workspace (0035).
    insert into gestion.activity (org_id, type, subject) values (a, 'note', 'isolation audit') returning id into act_a;
    begin
      update gestion.activity set org_id = b where id = act_a;
      raise exception 'ACCEPTED: an activity line moved to another workspace';
    exception when insufficient_privilege then null; end;

    raise exception 'isolation_audit_undo';
  exception when others then
    if sqlerrm <> 'isolation_audit_undo' then raise; end if;
  end;

  -- 4. Every simple key between two workspace tables has its guard.
  select string_agg(c.relname || '.' || att.attname, ', ' order by c.relname, att.attname) into missing
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid join pg_namespace cn on cn.oid = c.relnamespace
    join pg_class p on p.oid = con.confrelid join pg_namespace pn on pn.oid = p.relnamespace
    join pg_attribute att on att.attrelid = c.oid and att.attnum = con.conkey[1]
    join pg_attribute pa on pa.attrelid = p.oid and pa.attnum = con.confkey[1]
   where con.contype = 'f' and cn.nspname = 'gestion' and pn.nspname = 'gestion'
     and array_length(con.conkey, 1) = 1 and pa.attname = 'id'
     and exists (select 1 from pg_attribute x where x.attrelid = c.oid and x.attname = 'org_id' and not x.attisdropped)
     and exists (select 1 from pg_attribute x where x.attrelid = p.oid and x.attname = 'org_id' and not x.attisdropped)
     and not exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
                      where t.tgrelid = c.oid and f.proname = 'guard_parent_org' and t.tgname = 'guard_org_' || att.attname);
  if missing is not null then
    raise exception 'links without a workspace guard (call gestion.install_org_guards() at the end of the migration that created them): %', missing;
  end if;
  select count(*) into n from pg_trigger t join pg_proc f on f.oid = t.tgfoid where f.proname = 'guard_parent_org' and not t.tgisinternal;

  -- 5. Nothing was left behind.
  if exists (select 1 from public.agencies where id in (a, b)) then
    raise exception 'the audit left its fixtures behind';
  end if;

  raise notice 'isolation audit: cross-workspace writes refused, tenant clock, archive cascade, issued statements kept, % link guards in place', n;
end $$;
