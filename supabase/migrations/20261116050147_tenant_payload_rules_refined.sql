-- Tighten the payload rules to what is actually corruption.
--
-- The first pass required every "required" text field to be non-empty, but the
-- app legitimately stores `""` for empty free text: a person without a phone,
-- a transaction without a note, a debt without a due date. A live scan of
-- `tenant_records` showed 7 of 20 existing rows would have been rejected the
-- moment a user edited them.
--
-- New policy: only *identifier* fields (`id`, `categoryId`, `personId`, …) must
-- be non-empty, because they are join keys and an empty one is real corruption.
-- Free text only has to be a string. Optional closed-set fields ("currency",
-- "cadence", …) treat `""` as absent instead of as an invalid value.

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
      {"f":"id","k":"id"},
      {"f":"kind","k":"enum","a":["income","expense"]},
      {"f":"amount","k":"num"},
      {"f":"categoryId","k":"id"},
      {"f":"date","k":"str"},
      {"f":"note","k":"str","req":false},
      {"f":"currency","k":"enum","a":["EGP","SAR","AED","USD","EUR"],"req":false},
      {"f":"exchangeRate","k":"num","req":false},
      {"f":"baseAmount","k":"num","req":false},
      {"f":"personId","k":"id","req":false},
      {"f":"walletId","k":"id","req":false},
      {"f":"receiptId","k":"id","req":false},
      {"f":"source","k":"enum","a":["manual","recurring","debt","split"],"req":false},
      {"f":"reported","k":"bool","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'person' then '[
      {"f":"id","k":"id"},
      {"f":"name","k":"str"},
      {"f":"phone","k":"str","req":false},
      {"f":"note","k":"str","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'debt' then '[
      {"f":"id","k":"id"},
      {"f":"personId","k":"id"},
      {"f":"direction","k":"enum","a":["receivable","payable"]},
      {"f":"title","k":"str"},
      {"f":"principal","k":"num"},
      {"f":"dueDate","k":"str"},
      {"f":"installments","k":"num","req":false},
      {"f":"cadence","k":"enum","a":["monthly","biweekly","weekly"],"req":false},
      {"f":"note","k":"str","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'payment' then '[
      {"f":"id","k":"id"},
      {"f":"debtId","k":"id"},
      {"f":"amount","k":"num"},
      {"f":"date","k":"str"},
      {"f":"note","k":"str","req":false},
      {"f":"walletId","k":"id","req":false},
      {"f":"txId","k":"id","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'wallet' then '[
      {"f":"id","k":"id"},
      {"f":"name","k":"str"},
      {"f":"kind","k":"enum","a":["cash","instapay","vodafone","bank","card","other"]},
      {"f":"opening","k":"num"},
      {"f":"cardDesign","k":"str","req":false},
      {"f":"last4","k":"str","req":false},
      {"f":"subtitle","k":"str","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'transfer' then '[
      {"f":"id","k":"id"},
      {"f":"fromId","k":"id"},
      {"f":"toId","k":"id"},
      {"f":"amount","k":"num"},
      {"f":"date","k":"str"},
      {"f":"note","k":"str","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'budget' then '[
      {"f":"categoryId","k":"id"},
      {"f":"limit","k":"num"}
    ]'::jsonb
    when 'goal' then '[
      {"f":"id","k":"id"},
      {"f":"name","k":"str"},
      {"f":"target","k":"num"},
      {"f":"deadline","k":"str"},
      {"f":"category","k":"enum","a":["general","travel","debt_payoff","device","emergency"],"req":false},
      {"f":"linkedDebtId","k":"id","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'goalMove' then '[
      {"f":"id","k":"id"},
      {"f":"goalId","k":"id"},
      {"f":"walletId","k":"id"},
      {"f":"amount","k":"num"},
      {"f":"date","k":"str"},
      {"f":"note","k":"str","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'recurring' then '[
      {"f":"id","k":"id"},
      {"f":"kind","k":"enum","a":["income","expense"]},
      {"f":"amount","k":"num"},
      {"f":"categoryId","k":"id"},
      {"f":"walletId","k":"id"},
      {"f":"day","k":"num"},
      {"f":"active","k":"bool"},
      {"f":"lastMonth","k":"str"},
      {"f":"note","k":"str","req":false},
      {"f":"createdAt","k":"num","req":false}
    ]'::jsonb
    when 'category' then '[
      {"f":"id","k":"id"},
      {"f":"name","k":"str"},
      {"f":"kind","k":"enum","a":["income","expense"]},
      {"f":"icon","k":"str"},
      {"f":"tone","k":"enum","a":["tint","green","red","orange","gray"]},
      {"f":"custom","k":"bool","req":false}
    ]'::jsonb
    when 'debtAudit' then '[
      {"f":"id","k":"id"},
      {"f":"debtId","k":"id"},
      {"f":"action","k":"enum","a":["created","debt-edited","payment-added","payment-edited","payment-deleted"]},
      {"f":"at","k":"num"},
      {"f":"summary","k":"str"},
      {"f":"beforeAmount","k":"num","req":false},
      {"f":"afterAmount","k":"num","req":false},
      {"f":"beforeDate","k":"str","req":false},
      {"f":"afterDate","k":"str","req":false}
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

    if v_kind = 'id' then
      if jsonb_typeof(v_value) <> 'string' or length(btrim(v_value #>> '{}')) = 0 then
        return format('%s.%s must be a non-empty string', p_entity_type, v_field);
      end if;
    elsif v_kind = 'str' then
      if jsonb_typeof(v_value) <> 'string' then
        return format('%s.%s must be a string', p_entity_type, v_field);
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
      if jsonb_typeof(v_value) <> 'string' then
        return format('%s.%s must be a string', p_entity_type, v_field);
      end if;
      -- An optional closed-set field stored as "" means "not set".
      if not v_required and (v_value #>> '{}') = '' then
        continue;
      end if;
      if not exists (
        select 1 from jsonb_array_elements_text(v_rule -> 'a') as allowed
        where allowed = v_value #>> '{}'
      ) then
        return format('%s.%s has an unsupported value', p_entity_type, v_field);
      end if;
    else
      return format('%s.%s uses an unknown validation rule', p_entity_type, v_field);
    end if;
  end loop;

  return null;
end;
$$;

grant execute on function public.tenant_payload_error(text, jsonb) to public;
