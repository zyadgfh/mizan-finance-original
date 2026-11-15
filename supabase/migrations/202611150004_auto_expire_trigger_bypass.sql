-- =============================================================================
-- Mizan Finance — Allow internal security-definer billing RPCs (such as
-- enforce_expired_subscriptions) to update subscription_status -> 'expired'
-- even when invoked during a regular subscriber's session, while blocking all
-- direct non-admin client updates to tenant billing columns.
-- =============================================================================

create or replace function public.guard_tenant_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('mizan.internal_billing_op', true), '') <> '1'
     and auth.uid() is not null
     and not public.is_super_admin() then
    if new.subscription_status is distinct from old.subscription_status
      or new.current_period_end is distinct from old.current_period_end
      or new.owner_id is distinct from old.owner_id then
      raise exception 'Only platform super-admin or billing RPC can update tenant subscription status or owner'
        using errcode = '42501';
    end if;
    if new.plan_code is distinct from old.plan_code
      and old.subscription_status in ('suspended', 'expired', 'pending_approval') then
      raise exception 'Inactive tenant cannot switch plan directly'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  perform set_config('mizan.internal_billing_op', '1', true);

  with expired_rows as (
    update public.tenants t
    set subscription_status = 'expired',
        updated_at = now()
    where t.subscription_status in ('active', 'trialing')
      and t.current_period_end <= now()
      and not exists (
        select 1 from public.platform_admins pa where pa.user_id = t.owner_id
      )
    returning t.id, t.owner_id, t.plan_code, t.current_period_end
  ),
  logged as (
    insert into public.tenant_audit_logs (tenant_id, actor_id, action, entity_type, details)
    select
      er.id,
      null,
      'subscription.auto_expired',
      'subscription',
      jsonb_build_object(
        'plan_code', er.plan_code,
        'expired_at', er.current_period_end
      )
    from expired_rows er
    returning 1
  )
  select count(*)::integer into v_count from expired_rows;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.enforce_expired_subscriptions() to anon, authenticated;
