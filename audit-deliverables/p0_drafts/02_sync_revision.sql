-- DRAFT — NOT APPLIED. Requires explicit approval.
-- Source: repo 202611160001_security_hardening.sql §4 (lines 273-361), verbatim.
-- Adds tenant_records.revision + sequence + indexes + server-clamped timestamps
-- + payload-validation trigger; makes DELETE tombstone-only (F-01/F-09/F-10).
-- Trigger drops added for re-runnability (source omits them).
-- Preconditions: 01_reconcile_bookkeeping.sql; verified backup.
drop trigger if exists trg_validate_tenant_record on public.tenant_records;
drop trigger if exists trg_tenant_records_server_ts on public.tenant_records;
-- 4. FINDINGS 04/05/09 — monotonic revisions, server-clamped timestamps,
--    payload limits and tombstone-only deletes
-- -----------------------------------------------------------------------------
create sequence if not exists public.tenant_records_revision_seq;

alter table public.tenant_records
  add column if not exists revision bigint;

update public.tenant_records
set revision = nextval('public.tenant_records_revision_seq')
where revision is null;

alter table public.tenant_records
  alter column revision set default nextval('public.tenant_records_revision_seq');
alter table public.tenant_records
  alter column revision set not null;

create unique index if not exists tenant_records_revision_key
  on public.tenant_records (revision);
create index if not exists tenant_records_tenant_revision_idx
  on public.tenant_records (tenant_id, revision);

-- Every write gets a fresh, server-assigned revision: sync order can no longer
-- be poisoned by a client clock, and ties inside one transaction disappear.
create or replace function public.touch_tenant_record_server_ts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.server_updated_at := clock_timestamp();
  new.revision := nextval('public.tenant_records_revision_seq');
  return new;
end;
$$;

drop trigger if exists trg_tenant_records_server_ts on public.tenant_records;
create trigger trg_tenant_records_server_ts
before insert or update on public.tenant_records
for each row execute function public.touch_tenant_record_server_ts();

create or replace function public.validate_tenant_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bytes integer;
begin
  if new.entity_id is null or char_length(new.entity_id) not between 1 and 200 then
    raise exception 'معرّف السجل غير صالح' using errcode = '22023';
  end if;
  if jsonb_typeof(new.payload) is distinct from 'object' then
    raise exception 'بيانات السجل يجب أن تكون كائن JSON' using errcode = '22023';
  end if;

  v_bytes := octet_length(new.payload::text);
  if v_bytes > 262144 then
    raise exception 'حجم بيانات السجل يتجاوز الحد المسموح (256KB)' using errcode = '54000';
  end if;

  if new.updated_at_ms is null or new.updated_at_ms < 0 then
    raise exception 'updated_at_ms غير صالح' using errcode = '22023';
  end if;
  if new.deleted_at_ms is not null and new.deleted_at_ms < 0 then
    raise exception 'deleted_at_ms غير صالح' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_tenant_record on public.tenant_records;
create trigger trg_validate_tenant_record
before insert or update on public.tenant_records
for each row execute function public.validate_tenant_record();

-- Hard deletes are removed from the client surface entirely: deletion is a
-- tombstone produced by the sync RPC (or by soft_delete_tenant_record).
drop policy if exists tenant_records_delete on public.tenant_records;
create policy tenant_records_delete on public.tenant_records
  for delete to authenticated
  using (false);

revoke delete on public.tenant_records from anon, authenticated;
revoke truncate on public.tenant_records from anon, authenticated;
grant select, insert, update on public.tenant_records to authenticated;
