-- DRAFT — READ-ONLY PREFLIGHT. Writes nothing. Run and archive before any change:
-- its output is the only reliable source for rolling back grants and function bodies.
select now() as db_now, clock_timestamp() as wall_clock;

-- no long transactions holding locks
select pid, state, now() - query_start as duration, left(query, 80) as query
from pg_stat_activity
where state <> 'idle' and now() - query_start > interval '30 seconds';

-- expected: 0 (revision absent)
select count(*) as revision_column_present from information_schema.columns
where table_schema='public' and table_name='tenant_records' and column_name='revision';

-- expected: all 0 (objects this plan creates are absent)
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
       ('check_rate_limit','hash_bucket','claim_platform_owner','log_tenant_audit_event',
        'purge_expired_tenant_records','soft_delete_tenant_record','validate_tenant_record',
        'admin_enforce_expired_subscriptions')) as missing_functions_present,
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname in
       ('platform_settings','platform_security_log','rate_limit_events','_mizan_schema_migrations'))
     as missing_tables_present,
  (select count(*) from pg_trigger where tgname in
       ('trg_validate_tenant_record','on_auth_user_verified')) as missing_triggers_present;

-- expected: 36 records, 12 tombstones, 2 tenants
select count(*) as records, count(*) filter (where deleted_at_ms is not null) as tombstones,
       count(distinct tenant_id) as tenants
from public.tenant_records;

-- expected: pgcrypto in `extensions` (this is why the repo migration fails)
select e.extname, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1;

-- SNAPSHOT FOR ROLLBACK — grants
select c.relname as object, tp.grantee,
       string_agg(distinct tp.privilege_type, ',' order by tp.privilege_type) as privs
from information_schema.table_privileges tp
join pg_class c on c.relname=tp.table_name
join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
where tp.table_schema='public' and tp.grantee in ('anon','authenticated')
group by 1,2 order by 1,2;

-- SNAPSHOT FOR ROLLBACK — policies being dropped
select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies
where schemaname='public'
  and policyname in ('audit_logs_insert','tenant_records_delete','billing_info_select');

-- SNAPSHOT FOR ROLLBACK — function bodies being replaced
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('sync_push_tenant_records','bootstrap_first_super_admin','handle_new_auth_user',
                    'enforce_expired_subscriptions','tenant_payload_error');
