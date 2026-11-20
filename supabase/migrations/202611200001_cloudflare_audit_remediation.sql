-- =============================================================================
-- Mizan Finance — Cloudflare Security Audit Remediation Migration
--
-- Remediates SQL / RLS / RPC findings verified in the PGlite security audit:
--   1. Restore paid plans to trial_days = 0 (manual payment approval gate) and
--      track one-time trial claims on public.profiles so workspace delete/recreate
--      cannot farm free trials even if a promotional trial plan is enabled later.
--   2. Revoke direct PostgREST INSERT/UPDATE on public.tenant_records so all
--      ledger mutations pass through public.sync_push_tenant_records (SECURITY
--      DEFINER) with server-clamped LWW timestamps, monotonic revisions, and
--      authenticated actor attribution.
--   3. Guard public.tenants.deleted_at inside public.guard_tenant_admin_columns()
--      so delegated non-owner workspace admins cannot soft-delete a workspace
--      and lock out its owner.
--   4. Restrict public.profiles SELECT RLS to self or platform super-admin, and
--      provide a read-only rate-limited public.preview_tenant_invite(text) RPC
--      for explicit user confirmation prior to redeeming an invitation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Paid subscription plans require manual payment approval (trial_days = 0)
--    + one-time trial tracking on profiles
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists has_claimed_trial boolean not null default false;

update public.subscription_plans
set trial_days = 0,
    updated_at = now()
where code in ('monthly', 'quarterly', 'semiannual', 'yearly');

create or replace function public.create_tenant_workspace(
  p_name text,
  p_slug text default null,
  p_kind text default 'personal',
  p_base_currency text default 'EGP',
  p_plan_code text default 'monthly'
)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_plan public.subscription_plans;
  v_slug text;
  v_tenant public.tenants;
  v_owned integer;
  v_any_prior_owned boolean := false;
  v_grant_trial boolean := false;
  v_confirmed timestamptz;
  v_max_workspaces constant integer := 5;
  v_period_end timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select u.email_confirmed_at into v_confirmed from auth.users u where u.id = v_uid;
  if v_confirmed is null then
    raise exception 'يجب تأكيد البريد الإلكتروني قبل إنشاء مساحة عمل' using errcode = '42501';
  end if;

  select * into v_plan
  from public.subscription_plans
  where code = coalesce(nullif(trim(p_plan_code), ''), 'monthly');

  if not found or v_plan.is_active is not true then
    raise exception 'الباقة المطلوبة غير متاحة' using errcode = '22023';
  end if;

  select count(*) into v_owned
  from public.tenants
  where owner_id = v_uid and deleted_at is null;

  if v_owned >= v_max_workspaces then
    raise exception 'تم بلوغ الحد الأقصى لعدد المساحات لكل حساب (%)', v_max_workspaces
      using errcode = '54000';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    insert into public.profiles (id, email, display_name)
    select u.id, lower(coalesce(u.email, '')), coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'مستخدم ميزان')
    from auth.users u where u.id = v_uid
    on conflict (id) do nothing;
    select * into v_profile from public.profiles where id = v_uid;
  end if;

  select exists (
    select 1 from public.tenants where owner_id = v_uid
  ) into v_any_prior_owned;

  v_grant_trial := coalesce(v_plan.trial_days, 0) > 0
    and not coalesce(v_profile.has_claimed_trial, false)
    and not v_any_prior_owned;

  v_slug := lower(regexp_replace(coalesce(nullif(trim(p_slug), ''), trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) < 3 then
    v_slug := 'mizan-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  v_period_end := case
    when v_grant_trial then now() + make_interval(days => greatest(coalesce(v_plan.trial_days, 0), 0))
    else now()
  end;

  insert into public.tenants (
    slug, name, kind, base_currency, plan_code, subscription_status, current_period_end, owner_id
  )
  values (
    v_slug,
    trim(p_name),
    coalesce(nullif(p_kind, ''), 'personal'),
    coalesce(nullif(p_base_currency, ''), 'EGP'),
    v_plan.code,
    case when v_grant_trial then 'trialing' else 'pending_approval' end,
    v_period_end,
    v_uid
  )
  returning * into v_tenant;

  if v_grant_trial then
    update public.profiles
    set has_claimed_trial = true,
        updated_at = now()
    where id = v_uid;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, display_name, email)
  values (v_tenant.id, v_uid, 'owner', coalesce(v_profile.display_name, 'المالك'), v_profile.email);

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (v_tenant.id, v_uid, coalesce(v_profile.display_name, 'المالك'), 'tenant.created', 'إنشاء مساحة العمل: ' || v_tenant.name);

  return v_tenant;
end;
$$;

revoke all on function public.create_tenant_workspace(text, text, text, text, text) from public, anon;
grant execute on function public.create_tenant_workspace(text, text, text, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Enforce RPC-only writes on public.tenant_records
-- -----------------------------------------------------------------------------
drop policy if exists tenant_records_insert on public.tenant_records;
drop policy if exists tenant_records_update on public.tenant_records;
drop policy if exists tenant_records_delete on public.tenant_records;

revoke insert, update, delete, truncate on public.tenant_records from anon, authenticated;
grant select on public.tenant_records to authenticated;

alter function public.sync_push_tenant_records(uuid, jsonb)
  security definer
  set search_path = public;

revoke all on function public.sync_push_tenant_records(uuid, jsonb) from public, anon;
grant execute on function public.sync_push_tenant_records(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Prevent delegated non-owner workspace admins from soft-deleting workspaces
-- -----------------------------------------------------------------------------
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
    if new.deleted_at is distinct from old.deleted_at
      and old.owner_id is distinct from auth.uid() then
      raise exception 'Only the workspace owner or platform super-admin can delete or restore a workspace'
        using errcode = '42501';
    end if;
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

-- -----------------------------------------------------------------------------
-- 4. Restrict cross-member PII visibility on public.profiles + read-only invite
--    preview RPC for explicit consent before joining a workspace
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin()
  );

create or replace function public.preview_tenant_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite public.tenant_invites;
  v_tenant public.tenants;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.check_rate_limit('preview_invite', v_uid::text, 20, 300) then
    raise exception 'عدد المحاولات كبير جداً، يرجى المحاولة لاحقاً'
      using errcode = '54000';
  end if;

  select * into v_invite
  from public.tenant_invites
  where upper(invite_code) = upper(trim(coalesce(p_code, '')));

  if not found then
    raise exception 'رمز الدعوة غير صالح' using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'تم إلغاء هذه الدعوة' using errcode = 'P0001';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'انتهت صلاحية الدعوة' using errcode = 'P0001';
  end if;
  if v_invite.uses_count >= v_invite.max_uses then
    raise exception 'تم استهلاك الحد الأقصى لهذه الدعوة' using errcode = 'P0001';
  end if;

  select * into v_tenant
  from public.tenants
  where id = v_invite.tenant_id and deleted_at is null;

  if not found then
    raise exception 'مساحة العمل غير موجودة' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'tenant_id', v_tenant.id,
    'name', v_tenant.name,
    'kind', v_tenant.kind,
    'role', v_invite.role,
    'expires_at', v_invite.expires_at
  );
end;
$$;

revoke all on function public.preview_tenant_invite(text) from public, anon;
grant execute on function public.preview_tenant_invite(text) to authenticated, service_role;
