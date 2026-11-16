-- =============================================================================
-- NOTE (history): on the live project this file's content was applied in two
-- steps — `20261115162811 auto_expire_trigger_bypass`, then a follow-up that
-- aligned the `tenant_audit_logs` columns used by `enforce_expired_subscriptions`
-- (tracked remotely as `20261115172425 fix_enforce_expired_audit_columns`). The
-- final, corrected statements live here, so replaying this file from scratch
-- reaches the same end state; there is no separate fix file.
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
  v_rec record;
  v_count integer := 0;
begin
  perform set_config('mizan.internal_billing_op', '1', true);

  for v_rec in
    select t.id, t.name
    from public.tenants t
    where t.deleted_at is null
      and t.subscription_status in ('active', 'trialing', 'past_due')
      and t.current_period_end <= now()
      and not exists (
        select 1 from public.platform_admins pa where pa.user_id = t.owner_id
      )
    for update skip locked
  loop
    update public.tenants
    set subscription_status = 'expired',
        auto_deactivated_at = now(),
        updated_at = now()
    where id = v_rec.id;

    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_rec.id,
      null,
      'System',
      'billing.auto_expired',
      'انتهت مدة الاشتراك وتم تعطيل حساب المشترك تلقائياً'
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.enforce_expired_subscriptions() to anon, authenticated;
