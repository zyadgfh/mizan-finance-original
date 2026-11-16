-- DRAFT — ROLLBACK, reverse order. Only if a step must be reversed.
-- WARNING: rolling 02/03 back AFTER clients have written revisions loses the
-- monotonic cursor. Prefer rolling the CLIENT back (Vercel instant rollback) and
-- keeping the DB forward: the old client tolerates extra columns; the new one
-- cannot tolerate missing ones.

-- R9/R8 owner bootstrap + audit integrity
--   Restore previous definitions from the 00_preflight capture if a true
--   behavioural rollback is required. Do NOT re-introduce the hardcoded
--   promotion; provision platform_admins explicitly instead.
drop function if exists public.claim_platform_owner(uuid, text);

-- R7 grants (Postgres cannot remember grants — restore from the P6 snapshot)
-- Minimum to unbreak a client if step 8 over-revoked:
--   grant execute on all functions in schema public to public;
--   grant insert, update, delete on all tables in schema public to authenticated;
--   grant select on all tables in schema public to anon;
--   grant update on public.profiles to authenticated;
--   grant update on public.tenants  to authenticated;
-- (This restores the audited pre-state INCLUDING its weaknesses.)

-- R5 rate limiting / security log (new tables only; export evidence first)
--   copy (select * from public.platform_security_log) to stdout with csv header;
drop function if exists public.check_rate_limit(text, text, integer, integer);
drop function if exists public.hash_bucket(text);
drop table if exists public.rate_limit_events;
drop table if exists public.platform_security_log;

-- R3 hardened push / soft delete / purge
--   Restore the previous sync_push_tenant_records body from the preflight capture.
drop function if exists public.purge_expired_tenant_records(integer);
drop function if exists public.soft_delete_tenant_record(uuid, text, text);

-- R2 revision / validation trigger / tombstone policy
drop trigger if exists trg_validate_tenant_record on public.tenant_records;
drop function if exists public.validate_tenant_record();
-- Restoring hard DELETE is a security regression — only on a full revert:
-- create policy tenant_records_delete on public.tenant_records
--   for delete to public using (public.can_write_tenant(tenant_id));
-- grant delete on public.tenant_records to authenticated;

-- The revision column is additive; keep it unless doing a full revert:
-- drop trigger if exists trg_tenant_records_server_ts on public.tenant_records;
-- alter table public.tenant_records drop column if exists revision;
-- drop sequence if exists public.tenant_records_revision_seq;

-- R1 bookkeeping: KEEP `_mizan_schema_migrations` even on rollback — it is the
-- only record of what production was adopted from.
