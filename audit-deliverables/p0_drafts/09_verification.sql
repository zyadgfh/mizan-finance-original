-- DRAFT — VERIFICATION. Read-only except the two safe limiter probes.
-- Green run = meaningful: DO blocks raise on failure.

-- V1 revision present, not null, indexed
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='tenant_records'
                   and column_name='revision' and is_nullable='NO') then
    raise exception 'V1 FAILED: revision missing or nullable';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                 and indexname='tenant_records_tenant_revision_idx') then
    raise exception 'V1 FAILED: (tenant_id, revision) index missing';
  end if;
  raise notice 'V1 OK';
end $$;

-- V2 backfill complete; sequence ahead of max(revision)
select count(*) as rows_missing_revision from public.tenant_records where revision is null;
select last_value as revision_seq_last from public.tenant_records_revision_seq;

-- V3 tombstone-only deletes
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public'
             and tablename='tenant_records' and policyname='tenant_records_delete') then
    raise exception 'V3 FAILED: tenant_records_delete policy still present';
  end if;
  if has_table_privilege('anon','public.tenant_records','DELETE')
     or has_table_privilege('authenticated','public.tenant_records','DELETE') then
    raise exception 'V3 FAILED: DELETE still granted on tenant_records';
  end if;
  raise notice 'V3 OK';
end $$;

-- V4 no hardcoded owner mailbox left in any public function
do $$
declare v_hits integer;
begin
  select count(*) into v_hits
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and coalesce(p.prosrc,'') ilike '%zyadgamal796%';
  if v_hits > 0 then
    raise exception 'V4 FAILED: % function(s) still contain the hardcoded owner email', v_hits;
  end if;
  raise notice 'V4 OK';
end $$;

-- V5/V6 limiter: first true, second false
select public.check_rate_limit('verify_probe','probe',1,60) as first_should_be_true;
select public.check_rate_limit('verify_probe','probe',1,60) as second_should_be_false;

-- V7 push round-trip (STAGING ONLY — writes one record, then tombstone it)
--   select public.sync_push_tenant_records('<tenant_uuid>',
--     '[{"entityType":"tx","entityId":"verify-1",
--        "payload":{"id":"verify-1","kind":"expense","amount":1,"categoryId":"c","date":"2026-11-16"},
--        "updatedAtMs":0,"deletedAtMs":null}]'::jsonb);
-- expect applied + fresh revision + clamped timestamps

-- V8 fresh rebuild produces an empty diff (external):
--   supabase db reset && pg_dump --schema-only --schema=public <fresh> > /tmp/fresh.sql
--   pg_dump --schema-only --schema=public "$SUPABASE_DB_URL" > /tmp/prod.sql
--   diff -u /tmp/fresh.sql /tmp/prod.sql     -- empty closes F-02

-- V9 owner bootstrap objects; admin count unchanged (expect 1)
select (select count(*) from public.platform_admins) as platform_admins_rows,
       (select owner_email from public.platform_settings where id=1) as configured_owner_email,
       (select bootstrap_completed_at from public.platform_settings where id=1) as bootstrap_completed_at;

-- V10 privilege matrix
do $$
declare v_bad text[] := array[]::text[];
begin
  if has_table_privilege('anon','public.tenants','TRUNCATE') then v_bad := v_bad || 'anon TRUNCATE tenants'; end if;
  if has_table_privilege('authenticated','public.tenants','TRUNCATE') then v_bad := v_bad || 'auth TRUNCATE tenants'; end if;
  if has_table_privilege('anon','public.profiles','TRIGGER') then v_bad := v_bad || 'anon TRIGGER profiles'; end if;
  if has_table_privilege('authenticated','public.platform_admins','INSERT') then v_bad := v_bad || 'auth INSERT platform_admins'; end if;
  if has_table_privilege('authenticated','public.subscription_plans','UPDATE') then v_bad := v_bad || 'auth UPDATE plans'; end if;
  if not has_table_privilege('authenticated','public.profiles','UPDATE') then v_bad := v_bad || 'auth lost profiles UPDATE'; end if;
  if array_length(v_bad,1) > 0 then raise exception 'V10 FAILED: %', array_to_string(v_bad,'; '); end if;
  raise notice 'V10 OK';
end $$;

-- V11 anon cannot execute action RPCs
do $$
declare v_bad text[] := array[]::text[];
begin
  if has_function_privilege('anon','public.sync_push_tenant_records(uuid,jsonb)','EXECUTE') then v_bad := v_bad || 'sync_push'; end if;
  if has_function_privilege('anon','public.create_tenant_workspace(text,text,text,text,text)','EXECUTE') then v_bad := v_bad || 'create_workspace'; end if;
  if has_function_privilege('anon','public.submit_payment_request(uuid,text,text,text,text,text,text)','EXECUTE') then v_bad := v_bad || 'submit_payment'; end if;
  if has_function_privilege('anon','public.enforce_expired_subscriptions()','EXECUTE') then v_bad := v_bad || 'enforce_expired'; end if;
  if array_length(v_bad,1) > 0 then raise exception 'V11 FAILED: anon can execute: %', array_to_string(v_bad,'; '); end if;
  raise notice 'V11 OK';
end $$;

-- V12 audit rows cannot be forged
do $$
begin
  if exists (select 1 from pg_policies where schemaname='public'
             and tablename='tenant_audit_logs' and cmd='INSERT') then
    raise exception 'V12 FAILED: INSERT policy still exists on tenant_audit_logs';
  end if;
  if has_table_privilege('authenticated','public.tenant_audit_logs','INSERT') then
    raise exception 'V12 FAILED: authenticated can still INSERT audit rows';
  end if;
  raise notice 'V12 OK';
end $$;

-- V13 security log service-role only
select (select count(*) from public.platform_security_log) as security_events,
       has_table_privilege('anon','public.platform_security_log','SELECT') as anon_can_read,
       has_table_privilege('authenticated','public.platform_security_log','SELECT') as auth_can_read;

-- V14 bookkeeping adopted
select version, name, source from public._mizan_schema_migrations order by version;

-- V15 application smoke (manual)
--  1. two members, two browsers: edit offline on both, reconnect A then B → converge, one stale, no lost edit
--  2. delete → tombstone on both devices (deleted_at_ms not null), row still present
--  3. hammer signup >5×/min → 429 and one security-log row
--  4. non-owner account never becomes platform admin; operator bootstrap succeeds exactly once
--  5. sign-in, workspace switch, add/edit/delete, CSV import, export, receipt upload, report, invite still work
