-- Reject records filed under a key that disagrees with their own identifier.
--
-- `sync_push_tenant_records` keys a record by the `entityId` in the envelope and
-- stores the client `payload` beside it. Nothing tied the two together, so a
-- client could store a `tx` whose `payload.id` is "A" under `entityId` "B". Every
-- member then pulls a record whose identity contradicts its storage key, and the
-- next local edit is diffed onto the wrong entity.
--
-- A live scan of `tenant_records` showed no such rows, so enforcement starts
-- from a clean state. Budgets are keyed by `categoryId` and carry no `id`.

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
  v_payload_error text;
  v_payload_id text;
  v_applied jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select display_name into v_actor_name from public.profiles where id = v_uid;
  v_actor_name := coalesce(nullif(v_actor_name, ''), 'عضو');

  for v_op in select * from jsonb_array_elements(coalesce(p_ops, '[]'::jsonb))
  loop
    v_type := v_op ->> 'entityType';
    v_id := v_op ->> 'entityId';
    v_payload := coalesce(v_op -> 'payload', '{}'::jsonb);
    v_updated_at := coalesce((v_op ->> 'updatedAtMs')::bigint, (extract(epoch from now()) * 1000)::bigint);
    v_deleted_at := case when (v_op ? 'deletedAtMs') and (v_op ->> 'deletedAtMs') is not null
      then (v_op ->> 'deletedAtMs')::bigint else null end;

    begin
      if v_id is null or length(btrim(v_id)) = 0 then
        raise exception 'entityId is required' using errcode = 'P0001';
      end if;

      if v_deleted_at is null then
        v_payload_error := public.tenant_payload_error(v_type, v_payload);
        if v_payload_error is not null then
          raise exception '%', v_payload_error using errcode = 'P0001';
        end if;

        v_payload_id := case
          when v_type = 'budget' then v_payload ->> 'categoryId'
          else v_payload ->> 'id'
        end;
        if v_payload_id is distinct from v_id then
          raise exception 'entityId does not match the payload identifier' using errcode = 'P0001';
        end if;
      end if;

      select updated_at_ms into v_existing_ts
      from public.tenant_records
      where tenant_id = p_tenant_id and entity_type = v_type and entity_id = v_id;

      if v_existing_ts is not null and v_updated_at < v_existing_ts then
        v_stale := v_stale || jsonb_build_object('entityType', v_type, 'entityId', v_id, 'serverUpdatedAtMs', v_existing_ts);
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
          where public.tenant_records.updated_at_ms <= excluded.updated_at_ms;

        v_applied := v_applied || jsonb_build_object('entityType', v_type, 'entityId', v_id);
      end if;
    exception when others then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', SQLERRM,
        'code', case when SQLSTATE = 'P0001' then 'INVALID_PAYLOAD' else SQLSTATE end
      );
    end;
  end loop;

  return jsonb_build_object(
    'applied', v_applied,
    'stale', v_stale,
    'rejected', v_rejected,
    'serverTime', now()
  );
end;
$$;
