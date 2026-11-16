-- Per-entity payload validation for the tenant sync push RPC.
--
-- Before this migration `sync_push_tenant_records` only validated the *envelope*
-- (entityType / entityId / payload / updatedAtMs) and stored whatever JSON the
-- client sent. A malformed or hand-crafted payload therefore reached
-- `tenant_records` and was later merged into every member's local dataset.
--
-- `tenant_payload_error` is a pure, table-free schema check: required fields,
-- JSON types and closed value sets per entity type. It returns a readable error
-- or null. The push RPC rejects a record with code `INVALID_PAYLOAD` and leaves
-- the rest of the batch untouched.
--
-- The client mirrors the same rules in `src/lib/tenant/entity-payloads.ts` so a
-- bad local record is caught before upload instead of round-tripping.

-- >>> tenant-payload-validation:start
create or replace function public.tenant_payload_error(
  p_entity_type text,
  p_payload jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_rules jsonb;
  v_rule jsonb;
  v_field text;
  v_kind text;
  v_required boolean;
  v_value jsonb;
begin
  if p_entity_type is null or length(btrim(p_entity_type)) = 0 then
    return 'entityType is required';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return 'payload must be a JSON object';
  end if;

  v_rules := case p_entity_type
    when 'tx' then '[
      {"f":"id","k":"text"},
      {"f":"kind","k":"enum","a":["income","expense"]},
      {"f":"amount","k":"num"},
      {"f":"categoryId","k":"text"},
      {"f":"date","k":"text"},
      {"f":"note","k":"text","req":false},
      {"f":"currency","k":"enum","a":["EGP","SAR","AED","USD","EUR"],"req":false},
      {"f":"exchangeRate","k":"num","req":false},
      {"f":"baseAmount","k":"num","req":false},
      {"f":"personId","k":"text","req":false},
      {"f":"walletId","k":"text","req":false},
      {"f":"receiptId","k":"text","req":false},
      {"f":"source","k":"enum","a":["manual","recurring","debt","split"],"req":false},
      {"f":"reported","k":"bool","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'person' then '[
      {"f":"id","k":"text"},
      {"f":"name","k":"text"},
      {"f":"phone","k":"text","req":false},
      {"f":"note","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'debt' then '[
      {"f":"id","k":"text"},
      {"f":"personId","k":"text"},
      {"f":"direction","k":"enum","a":["receivable","payable"]},
      {"f":"title","k":"text"},
      {"f":"principal","k":"num"},
      {"f":"dueDate","k":"text"},
      {"f":"installments","k":"num","req":false},
      {"f":"cadence","k":"enum","a":["monthly","biweekly","weekly"],"req":false},
      {"f":"note","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'payment' then '[
      {"f":"id","k":"text"},
      {"f":"debtId","k":"text"},
      {"f":"amount","k":"num"},
      {"f":"date","k":"text"},
      {"f":"note","k":"text","req":false},
      {"f":"walletId","k":"text","req":false},
      {"f":"txId","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'wallet' then '[
      {"f":"id","k":"text"},
      {"f":"name","k":"text"},
      {"f":"kind","k":"enum","a":["cash","instapay","vodafone","bank","card","other"]},
      {"f":"opening","k":"num"},
      {"f":"cardDesign","k":"text","req":false},
      {"f":"last4","k":"text","req":false},
      {"f":"subtitle","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'transfer' then '[
      {"f":"id","k":"text"},
      {"f":"fromId","k":"text"},
      {"f":"toId","k":"text"},
      {"f":"amount","k":"num"},
      {"f":"date","k":"text"},
      {"f":"note","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'budget' then '[
      {"f":"categoryId","k":"text"},
      {"f":"limit","k":"num"}
    ]'::jsonb
    when 'goal' then '[
      {"f":"id","k":"text"},
      {"f":"name","k":"text"},
      {"f":"target","k":"num"},
      {"f":"deadline","k":"text"},
      {"f":"category","k":"enum","a":["general","travel","debt_payoff","device","emergency"],"req":false},
      {"f":"linkedDebtId","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'goalMove' then '[
      {"f":"id","k":"text"},
      {"f":"goalId","k":"text"},
      {"f":"walletId","k":"text"},
      {"f":"amount","k":"num"},
      {"f":"date","k":"text"},
      {"f":"note","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'recurring' then '[
      {"f":"id","k":"text"},
      {"f":"kind","k":"enum","a":["income","expense"]},
      {"f":"amount","k":"num"},
      {"f":"categoryId","k":"text"},
      {"f":"walletId","k":"text"},
      {"f":"day","k":"num"},
      {"f":"active","k":"bool"},
      {"f":"lastMonth","k":"text"},
      {"f":"note","k":"text","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'category' then '[
      {"f":"id","k":"text"},
      {"f":"name","k":"text"},
      {"f":"kind","k":"enum","a":["income","expense"]},
      {"f":"icon","k":"text"},
      {"f":"tone","k":"enum","a":["tint","green","red","orange","gray"]},
      {"f":"custom","k":"bool","req":false}
    ]'::jsonb
    when 'debtAudit' then '[
      {"f":"id","k":"text"},
      {"f":"debtId","k":"text"},
      {"f":"action","k":"enum","a":["created","debt-edited","payment-added","payment-edited","payment-deleted"]},
      {"f":"at","k":"num"},
      {"f":"summary","k":"text"},
      {"f":"beforeAmount","k":"num","req":false},
      {"f":"afterAmount","k":"num","req":false},
      {"f":"beforeDate","k":"text","req":false},
      {"f":"afterDate","k":"text","req":false}
    ]'::jsonb
    else null
  end;

  if v_rules is null then
    return format('unknown entity type "%s"', p_entity_type);
  end if;

  for v_rule in select * from jsonb_array_elements(v_rules)
  loop
    v_field := v_rule ->> 'f';
    v_kind := v_rule ->> 'k';
    v_required := coalesce((v_rule ->> 'req')::boolean, true);
    v_value := p_payload -> v_field;

    if v_value is null or jsonb_typeof(v_value) = 'null' then
      if v_required then
        return format('%s.%s is required', p_entity_type, v_field);
      end if;
      continue;
    end if;

    if v_kind = 'text' then
      if jsonb_typeof(v_value) <> 'string' or length(btrim(v_value #>> '{}')) = 0 then
        return format('%s.%s must be a non-empty string', p_entity_type, v_field);
      end if;
    elsif v_kind = 'num' then
      if jsonb_typeof(v_value) <> 'number' then
        return format('%s.%s must be a number', p_entity_type, v_field);
      end if;
    elsif v_kind = 'bool' then
      if jsonb_typeof(v_value) <> 'boolean' then
        return format('%s.%s must be a boolean', p_entity_type, v_field);
      end if;
    elsif v_kind = 'enum' then
      if jsonb_typeof(v_value) <> 'string'
        or not exists (
          select 1 from jsonb_array_elements_text(v_rule -> 'a') as allowed
          where allowed = v_value #>> '{}'
        )
      then
        return format('%s.%s has an unsupported value', p_entity_type, v_field);
      end if;
    else
      return format('%s.%s uses an unknown validation rule', p_entity_type, v_field);
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.tenant_payload_error(text, jsonb) from public;
grant execute on function public.tenant_payload_error(text, jsonb) to authenticated;
-- >>> tenant-payload-validation:end

-- Same RPC as 202611150001, plus a per-record payload schema check. A rejected
-- record is reported in the batch result (`code: INVALID_PAYLOAD`) and nothing
-- about it is written; tombstones (deleted_at_ms) keep the payload for audit and
-- are therefore not schema-checked.
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
