-- DRAFT — NOT APPLIED.
-- Source: repo §5 (lines 664-752).
-- Removes client-writable INSERT on tenant_audit_logs (live policy
-- audit_logs_insert lets any tenant admin forge audit rows — F-24) and adds the
-- server-authored log_tenant_audit_event with a server-derived actor.
-- 5. FINDING 10 — audit logs are server-authored and immutable
-- -----------------------------------------------------------------------------
drop policy if exists audit_logs_insert on public.tenant_audit_logs;

revoke insert, update, delete, truncate on public.tenant_audit_logs from anon, authenticated;
grant select on public.tenant_audit_logs to authenticated;

create or replace function public.log_tenant_audit_event(
  p_tenant_id uuid,
  p_action text,
  p_summary text,
  p_entity_type text default null,
  p_entity_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_id uuid;
  v_allowed constant text[] := array[
    'tenant.created', 'tenant.updated', 'tenant.deleted', 'tenant.renamed',
    'member.invited', 'member.joined', 'member.removed', 'member.role_changed',
    'record.created', 'record.updated', 'record.deleted', 'record.restored',
    'sync.push', 'sync.conflict',
    'export.generated', 'import.completed',
    'goal.created', 'goal.updated', 'goal.completed',
    'budget.created', 'budget.updated',
    'security.pin_changed', 'security.pin_cleared',
    'billing.payment_submitted', 'billing.signup_submitted',
    'billing.payment_approved', 'billing.payment_rejected',
    'billing.updated', 'billing.auto_expired', 'billing.admin_adjusted',
    'tenant.provisioned_by_owner', 'member.added_by_owner'
  ];
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_action is null or not (p_action = any(v_allowed)) then
    raise exception 'نوع حدث التدقيق غير مسموح' using errcode = '22023';
  end if;

  if p_summary is null or char_length(btrim(p_summary)) not between 1 and 500 then
    raise exception 'وصف الحدث غير صالح' using errcode = '22023';
  end if;

  if p_entity_type is not null and char_length(p_entity_type) > 64 then
    raise exception 'نوع الكيان غير صالح' using errcode = '22023';
  end if;
  if p_entity_id is not null and char_length(p_entity_id) > 200 then
    raise exception 'معرّف الكيان غير صالح' using errcode = '22023';
  end if;

  if not (
    public.is_super_admin()
    or public.can_write_tenant(p_tenant_id)
    or public.is_tenant_member(p_tenant_id)
  ) then
    raise exception 'لا تملك صلاحية تسجيل حدث في هذه المساحة' using errcode = '42501';
  end if;

  -- Actor identity and display name always come from the server context.
  select nullif(display_name, '') into v_name from public.profiles where id = v_uid;

  insert into public.tenant_audit_logs (
    tenant_id, actor_id, actor_name, action, entity_type, entity_id, summary, metadata
  )
  values (
    p_tenant_id,
    v_uid,
    coalesce(v_name, 'عضو'),
    p_action,
    nullif(btrim(coalesce(p_entity_type, '')), ''),
    nullif(btrim(coalesce(p_entity_id, '')), ''),
    btrim(p_summary),
    '{}'::jsonb
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_tenant_audit_event(uuid, text, text, text, text) from public, anon;
grant execute on function public.log_tenant_audit_event(uuid, text, text, text, text) to authenticated;
