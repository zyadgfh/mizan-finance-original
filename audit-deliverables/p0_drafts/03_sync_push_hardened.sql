-- DRAFT — NOT APPLIED.
-- Source: repo 202611160001_security_hardening.sql §4 (lines 363-661).
-- Hardened sync_push_tenant_records (revision + optimistic concurrency + server
-- clamp), soft_delete_tenant_record, purge_expired_tenant_records (service_role).
-- Compatible with the deployed client outbox contract
-- {entityType, entityId, payload, updatedAtMs, deletedAtMs} — no client change.
-- Preconditions: 02_sync_revision.sql.
create or replace function public.sync_push_tenant_records(
  p_tenant_id uuid,
  p_ops jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_name text;
  v_op jsonb;
  v_type text;
  v_id text;
  v_payload jsonb;
  v_updated_at bigint;
  v_deleted_at bigint;
  v_existing_ts bigint;
  v_revision bigint;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  -- A device clock may be ahead by at most this much before we clamp it.
  v_max_skew_ms constant bigint := 300000;
  v_max_payload_bytes constant integer := 262144;
  v_max_ops constant integer := 200;
  v_allowed_types constant text[] := array[
    'tx', 'person', 'debt', 'payment', 'wallet', 'transfer',
    'budget', 'goal', 'goalMove', 'recurring', 'category', 'debtAudit'
  ];
  v_applied jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_ops is null or jsonb_typeof(p_ops) is distinct from 'array' then
    raise exception 'صيغة عمليات المزامنة غير صالحة' using errcode = '22023';
  end if;

  if jsonb_array_length(p_ops) > v_max_ops then
    raise exception 'عدد العمليات في الدفعة يتجاوز الحد المسموح (%)', v_max_ops
      using errcode = '54000';
  end if;

  if not public.can_write_tenant(p_tenant_id) then
    raise exception 'لا تملك صلاحية الكتابة في هذه المساحة' using errcode = '42501';
  end if;

  select nullif(display_name, '') into v_actor_name from public.profiles where id = v_uid;
  v_actor_name := coalesce(v_actor_name, 'عضو');

  for v_op in select * from jsonb_array_elements(p_ops)
  loop
    v_type := nullif(v_op ->> 'entityType', '');
    v_id := nullif(v_op ->> 'entityId', '');
    v_payload := coalesce(v_op -> 'payload', '{}'::jsonb);
    v_updated_at := null;
    v_deleted_at := null;
    v_existing_ts := null;
    v_revision := null;

    -- ---- structural validation (no casts that can raise) -------------------
    if v_type is null or not (v_type = any(v_allowed_types)) then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', coalesce(v_type, ''),
        'entityId', coalesce(v_id, ''),
        'error', 'نوع السجل غير مدعوم',
        'code', 'ENTITY_TYPE_INVALID'
      );
      continue;
    end if;

    if v_id is null or char_length(v_id) < 1 or char_length(v_id) > 200 then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', coalesce(v_id, ''),
        'error', 'معرّف السجل غير صالح',
        'code', 'ENTITY_ID_INVALID'
      );
      continue;
    end if;

    if jsonb_typeof(v_payload) is distinct from 'object' then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'بيانات السجل يجب أن تكون كائن JSON',
        'code', 'PAYLOAD_INVALID'
      );
      continue;
    end if;

    if octet_length(v_payload::text) > v_max_payload_bytes then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'حجم بيانات السجل يتجاوز الحد المسموح',
        'code', 'PAYLOAD_TOO_LARGE'
      );
      continue;
    end if;

    -- ---- timestamp parsing without exceptions ------------------------------
    if v_op ->> 'updatedAtMs' is null or (v_op ->> 'updatedAtMs') = '' then
      v_updated_at := v_now_ms;
    elsif (v_op ->> 'updatedAtMs') ~ '^-?[0-9]{1,16}$' then
      v_updated_at := (v_op ->> 'updatedAtMs')::bigint;
    else
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'توقيت السجل غير صالح',
        'code', 'TIMESTAMP_INVALID'
      );
      continue;
    end if;

    if v_op ? 'deletedAtMs' and (v_op ->> 'deletedAtMs') is not null then
      if (v_op ->> 'deletedAtMs') ~ '^-?[0-9]{1,16}$' then
        v_deleted_at := (v_op ->> 'deletedAtMs')::bigint;
      else
        v_rejected := v_rejected || jsonb_build_object(
          'entityType', v_type,
          'entityId', v_id,
          'error', 'توقيت الحذف غير صالح',
          'code', 'TIMESTAMP_INVALID'
        );
        continue;
      end if;
    end if;

    if v_updated_at < 0 or (v_deleted_at is not null and v_deleted_at < 0) then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'توقيت السجل غير صالح',
        'code', 'TIMESTAMP_INVALID'
      );
      continue;
    end if;

    -- Clock-skew clamp: a client can never park a record in the far future.
    if v_updated_at > v_now_ms + v_max_skew_ms then
      v_updated_at := v_now_ms;
    end if;
    if v_deleted_at is not null and v_deleted_at > v_now_ms + v_max_skew_ms then
      v_deleted_at := v_now_ms;
    end if;

    -- ---- apply ------------------------------------------------------------
    begin
      select updated_at_ms, revision into v_existing_ts, v_revision
      from public.tenant_records
      where tenant_id = p_tenant_id and entity_type = v_type and entity_id = v_id;

      if v_existing_ts is not null and v_updated_at < v_existing_ts then
        v_stale := v_stale || jsonb_build_object(
          'entityType', v_type,
          'entityId', v_id,
          'serverUpdatedAtMs', v_existing_ts,
          'revision', v_revision
        );
      else
        insert into public.tenant_records (
          tenant_id, entity_type, entity_id, payload, updated_at_ms, deleted_at_ms,
          created_by, created_by_name, updated_by, updated_by_name
        )
        values (
          p_tenant_id, v_type, v_id, v_payload, v_updated_at, v_deleted_at,
          v_uid, v_actor_name, v_uid, v_actor_name
        )
        on conflict (tenant_id, entity_type, entity_id) do update
          set payload = excluded.payload,
              updated_at_ms = excluded.updated_at_ms,
              deleted_at_ms = excluded.deleted_at_ms,
              updated_by = v_uid,
              updated_by_name = v_actor_name
          where public.tenant_records.updated_at_ms <= excluded.updated_at_ms
        returning revision into v_revision;

        if v_revision is null then
          v_stale := v_stale || jsonb_build_object(
            'entityType', v_type,
            'entityId', v_id
          );
        else
          v_applied := v_applied || jsonb_build_object(
            'entityType', v_type,
            'entityId', v_id,
            'revision', v_revision
          );
        end if;
      end if;
    exception when others then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', SQLERRM,
        'code', SQLSTATE
      );
    end;
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'stale', v_stale,
    'rejected', v_rejected,
    'serverTime', now(),
    'serverNowMs', v_now_ms
  );
end;
$$;

revoke all on function public.sync_push_tenant_records(uuid, jsonb) from public, anon;


-- Explicit, auditable soft delete (client never issues a DELETE anymore).
create or replace function public.soft_delete_tenant_record(
  p_tenant_id uuid,
  p_entity_type text,
  p_entity_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_name text;
  v_found boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_write_tenant(p_tenant_id) then
    raise exception 'لا تملك صلاحية الحذف في هذه المساحة' using errcode = '42501';
  end if;

  select nullif(display_name, '') into v_name from public.profiles where id = v_uid;

  update public.tenant_records
  set deleted_at_ms = v_now_ms,
      updated_at_ms = greatest(updated_at_ms, v_now_ms),
      updated_by = v_uid,
      updated_by_name = coalesce(v_name, 'عضو')
  where tenant_id = p_tenant_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and deleted_at_ms is null;

  v_found := found;

  if v_found then
    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, entity_type, entity_id, summary)
    values (
      p_tenant_id, v_uid, coalesce(v_name, 'عضو'), 'record.deleted', p_entity_type, p_entity_id,
      'حذف سجل (' || p_entity_type || ')'
    );
  end if;

  return v_found;
end;
$$;

revoke all on function public.soft_delete_tenant_record(uuid, text, text) from public, anon;
grant execute on function public.soft_delete_tenant_record(uuid, text, text) to authenticated;

-- Deferred physical purge — service_role / scheduled jobs only.
create or replace function public.purge_expired_tenant_records(p_retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if coalesce(p_retention_days, 0) < 7 then
    raise exception 'Retention window must be at least 7 days' using errcode = '22023';
  end if;

  with purged as (
    delete from public.tenant_records
    where deleted_at_ms is not null
      and to_timestamp(deleted_at_ms / 1000.0) < now() - make_interval(days => p_retention_days)
    returning 1
  )
  select count(*) into v_count from purged;

  return v_count;
end;
$$;

revoke all on function public.purge_expired_tenant_records(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_tenant_records(integer) to service_role;
