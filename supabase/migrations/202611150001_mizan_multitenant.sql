-- Mizan Finance: Multi-Tenant Architecture, RBAC, Subscriptions, Invites, Audit & Entity-LWW Sync

create extension if not exists pgcrypto;

-- 1. Subscription Plans (No feature gating; symbolic Monthly & Yearly billing plans)
create table if not exists public.subscription_plans (
  code text primary key check (code in ('monthly', 'yearly')),
  name_ar text not null,
  name_en text not null,
  price_egp numeric(10, 2) not null check (price_egp >= 0),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  trial_days integer not null default 14 check (trial_days >= 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans (code, name_ar, name_en, price_egp, billing_interval, trial_days, is_active)
values
  ('monthly', 'الخطة الشهرية', 'Monthly Plan', 19.00, 'month', 14, true),
  ('yearly', 'الخطة السنوية', 'Yearly Plan', 149.00, 'year', 14, true)
on conflict (code) do nothing;

-- 2. Platform Super-Admins
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid()
  );
$$;

-- 3. User Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Tenants (Workspaces / Organizations / Personal Ledgers)
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  kind text not null default 'personal' check (kind in ('personal', 'family', 'business')),
  base_currency text not null default 'EGP' check (base_currency in ('EGP', 'SAR', 'AED', 'USD', 'EUR')),
  plan_code text not null default 'monthly' references public.subscription_plans(code),
  subscription_status text not null default 'trialing' check (subscription_status in ('trialing', 'active', 'past_due', 'suspended')),
  current_period_end timestamptz not null default (now() + interval '14 days'),
  owner_id uuid not null references auth.users(id),
  opening_balance numeric(14, 2) not null default 0,
  exchange_rates jsonb not null default '{"EGP":1,"SAR":13.3,"AED":13.6,"USD":50,"EUR":54}'::jsonb,
  phone_country_code text not null default '+20',
  goals_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists tenants_owner_idx on public.tenants (owner_id);
create index if not exists tenants_slug_idx on public.tenants (slug);

-- 5. Tenant Members (4-tier RBAC)
create table if not exists public.tenant_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  display_name text not null,
  email text,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_members_user_idx on public.tenant_members (user_id);

-- Helper role & write-guard functions (SECURITY DEFINER to avoid recursive RLS)
create or replace function public.tenant_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.tenant_members m
  where m.tenant_id = p_tenant_id
    and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and t.deleted_at is null
  );
$$;

create or replace function public.can_write_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin', 'member')
      and t.deleted_at is null
      and t.subscription_status <> 'suspended'
  );
$$;

create or replace function public.is_tenant_admin(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
      and t.deleted_at is null
  );
$$;

-- 6. Tenant Invites (Shareable links + APK invite codes)
create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invite_code text not null unique,
  email text,
  role text not null default 'member' check (role in ('admin', 'member', 'viewer')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 10 check (max_uses >= 1 and max_uses <= 100),
  uses_count integer not null default 0 check (uses_count >= 0),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tenant_invites_tenant_idx on public.tenant_invites (tenant_id);
create index if not exists tenant_invites_code_idx on public.tenant_invites (invite_code);

-- 7. Multi-Tenant Financial Records (Entity-level LWW + Soft Delete Tombstones + Attribution)
create table if not exists public.tenant_records (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'tx', 'person', 'debt', 'payment', 'wallet', 'transfer',
    'budget', 'goal', 'goalMove', 'recurring', 'category', 'debtAudit'
  )),
  entity_id text not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_at_ms bigint not null,
  deleted_at_ms bigint,
  created_by uuid references auth.users(id),
  created_by_name text,
  updated_by uuid references auth.users(id),
  updated_by_name text,
  server_updated_at timestamptz not null default now(),
  primary key (tenant_id, entity_type, entity_id)
);

create index if not exists tenant_records_sync_idx
  on public.tenant_records (tenant_id, server_updated_at);

create or replace function public.touch_tenant_record_server_ts()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_tenant_records_server_ts on public.tenant_records;
create trigger trg_tenant_records_server_ts
before insert or update on public.tenant_records
for each row execute function public.touch_tenant_record_server_ts();

-- 8. Immutable Workspace Audit Log
create table if not exists public.tenant_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid references auth.users(id),
  actor_name text not null,
  action text not null,
  entity_type text,
  entity_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_audit_logs_tenant_idx
  on public.tenant_audit_logs (tenant_id, created_at desc);

-- 9. Protect billing/status fields on tenants from non-super-admin direct mutations
create or replace function public.guard_tenant_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    if new.subscription_status is distinct from old.subscription_status
      or new.current_period_end is distinct from old.current_period_end
      or new.owner_id is distinct from old.owner_id then
      raise exception 'Only platform super-admin or billing RPC can update tenant subscription status or owner'
        using errcode = '42501';
    end if;
    -- Tenant owner/admin may choose monthly/yearly plan cycle when active/trialing, not unsuspend.
    if new.plan_code is distinct from old.plan_code and old.subscription_status = 'suspended' then
      raise exception 'Suspended tenant cannot switch plan'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_tenant_columns on public.tenants;
create trigger trg_guard_tenant_columns
before update on public.tenants
for each row execute function public.guard_tenant_admin_columns();

-- 10. Auto-provision profile + bootstrap owner super-admin on signup
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_email text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'مستخدم ميزان'
  );

  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    v_email,
    v_name,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
        updated_at = now();

  -- Promote known owner email OR very first user if platform_admins is empty
  if v_email = 'zyadgamal796@gmail.com' or not exists (select 1 from public.platform_admins) then
    insert into public.platform_admins (user_id, email)
    values (new.id, v_email)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- 11. Enable Row Level Security on every table
alter table public.subscription_plans enable row level security;
alter table public.platform_admins enable row level security;
alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_invites enable row level security;
alter table public.tenant_records enable row level security;
alter table public.tenant_audit_logs enable row level security;

-- subscription_plans policies
drop policy if exists plans_read_all on public.subscription_plans;
create policy plans_read_all on public.subscription_plans
  for select using (true);

drop policy if exists plans_super_admin_write on public.subscription_plans;
create policy plans_super_admin_write on public.subscription_plans
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- platform_admins policies
drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins
  for select using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists platform_admins_manage on public.platform_admins;
create policy platform_admins_manage on public.platform_admins
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- profiles policies
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or public.is_super_admin()
    or exists (
      select 1
      from public.tenant_members m1
      join public.tenant_members m2 on m1.tenant_id = m2.tenant_id
      where m1.user_id = auth.uid() and m2.user_id = profiles.id
    )
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- tenants policies
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select using (public.is_tenant_member(id) or public.is_super_admin());

drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants
  for insert with check (auth.uid() = owner_id);

drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants
  for update using (public.is_tenant_admin(id) or public.is_super_admin())
  with check (public.is_tenant_admin(id) or public.is_super_admin());

drop policy if exists tenants_delete on public.tenants;
create policy tenants_delete on public.tenants
  for delete using (owner_id = auth.uid() or public.is_super_admin());

-- tenant_members policies
drop policy if exists tenant_members_select on public.tenant_members;
create policy tenant_members_select on public.tenant_members
  for select using (public.is_tenant_member(tenant_id) or public.is_super_admin());

drop policy if exists tenant_members_admin_insert on public.tenant_members;
create policy tenant_members_admin_insert on public.tenant_members
  for insert with check (
    public.is_super_admin()
    or (
      public.is_tenant_admin(tenant_id)
      and role <> 'owner'
    )
  );

drop policy if exists tenant_members_admin_update on public.tenant_members;
create policy tenant_members_admin_update on public.tenant_members
  for update using (
    public.is_super_admin()
    or (public.tenant_role(tenant_id) = 'owner' and role <> 'owner')
    or (public.is_tenant_admin(tenant_id) and role in ('member', 'viewer'))
  )
  with check (
    public.is_super_admin()
    or (public.tenant_role(tenant_id) = 'owner' and role in ('admin', 'member', 'viewer'))
    or (public.is_tenant_admin(tenant_id) and role in ('member', 'viewer'))
  );

drop policy if exists tenant_members_delete on public.tenant_members;
create policy tenant_members_delete on public.tenant_members
  for delete using (
    public.is_super_admin()
    or (user_id = auth.uid() and role <> 'owner')
    or (public.tenant_role(tenant_id) = 'owner' and role <> 'owner')
    or (public.is_tenant_admin(tenant_id) and role in ('member', 'viewer'))
  );

-- tenant_invites policies
drop policy if exists tenant_invites_select on public.tenant_invites;
create policy tenant_invites_select on public.tenant_invites
  for select using (public.is_tenant_admin(tenant_id) or public.is_super_admin());

drop policy if exists tenant_invites_insert on public.tenant_invites;
create policy tenant_invites_insert on public.tenant_invites
  for insert with check (
    (public.is_tenant_admin(tenant_id) and role in ('admin', 'member', 'viewer') and created_by = auth.uid())
    or public.is_super_admin()
  );

drop policy if exists tenant_invites_update on public.tenant_invites;
create policy tenant_invites_update on public.tenant_invites
  for update using (public.is_tenant_admin(tenant_id) or public.is_super_admin())
  with check (public.is_tenant_admin(tenant_id) or public.is_super_admin());

drop policy if exists tenant_invites_delete on public.tenant_invites;
create policy tenant_invites_delete on public.tenant_invites
  for delete using (public.is_tenant_admin(tenant_id) or public.is_super_admin());

-- tenant_records policies
drop policy if exists tenant_records_select on public.tenant_records;
create policy tenant_records_select on public.tenant_records
  for select using (public.is_tenant_member(tenant_id) or public.is_super_admin());

drop policy if exists tenant_records_insert on public.tenant_records;
create policy tenant_records_insert on public.tenant_records
  for insert with check (public.can_write_tenant(tenant_id));

drop policy if exists tenant_records_update on public.tenant_records;
create policy tenant_records_update on public.tenant_records
  for update using (public.can_write_tenant(tenant_id))
  with check (public.can_write_tenant(tenant_id));

drop policy if exists tenant_records_delete on public.tenant_records;
create policy tenant_records_delete on public.tenant_records
  for delete using (public.can_write_tenant(tenant_id));

-- tenant_audit_logs policies
drop policy if exists audit_logs_select on public.tenant_audit_logs;
create policy audit_logs_select on public.tenant_audit_logs
  for select using (public.is_tenant_member(tenant_id) or public.is_super_admin());

drop policy if exists audit_logs_insert on public.tenant_audit_logs;
create policy audit_logs_insert on public.tenant_audit_logs
  for insert with check (
    (public.can_write_tenant(tenant_id) and actor_id = auth.uid())
    or public.is_super_admin()
  );

-- 12. Atomic RPCs (workspace creation, invite redemption, billing switch, entity LWW sync, super-admin controls)

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
  v_slug text;
  v_tenant public.tenants;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Ensure profile exists even for users created prior to trigger
  select * into v_profile from public.profiles where id = v_uid;
  if not found then
    insert into public.profiles (id, email, display_name)
    select u.id, lower(coalesce(u.email, '')), coalesce(nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'مستخدم ميزان')
    from auth.users u where u.id = v_uid
    on conflict (id) do nothing;
    select * into v_profile from public.profiles where id = v_uid;
  end if;

  v_slug := lower(regexp_replace(coalesce(nullif(trim(p_slug), ''), trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) < 3 then
    v_slug := 'mizan-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.tenants (slug, name, kind, base_currency, plan_code, subscription_status, current_period_end, owner_id)
  values (
    v_slug,
    trim(p_name),
    coalesce(nullif(p_kind, ''), 'personal'),
    coalesce(nullif(p_base_currency, ''), 'EGP'),
    coalesce(nullif(p_plan_code, ''), 'monthly'),
    'trialing',
    now() + interval '14 days',
    v_uid
  )
  returning * into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role, display_name, email)
  values (v_tenant.id, v_uid, 'owner', coalesce(v_profile.display_name, 'المالك'), v_profile.email);

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (v_tenant.id, v_uid, coalesce(v_profile.display_name, 'المالك'), 'tenant.created', 'إنشاء مساحة العمل: ' || v_tenant.name);

  return v_tenant;
end;
$$;

create or replace function public.redeem_tenant_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_invite public.tenant_invites;
  v_tenant public.tenants;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  select * into v_invite
  from public.tenant_invites
  where upper(invite_code) = upper(trim(p_code))
  for update;

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
  if v_invite.email is not null and lower(v_invite.email) <> lower(coalesce(v_profile.email, '')) then
    raise exception 'هذه الدعوة مخصصة لبريد إلكتروني آخر' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = v_invite.tenant_id and deleted_at is null;
  if not found then
    raise exception 'مساحة العمل غير موجودة' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.tenant_members where tenant_id = v_tenant.id and user_id = v_uid
  ) then
    insert into public.tenant_members (tenant_id, user_id, role, display_name, email)
    values (
      v_tenant.id,
      v_uid,
      v_invite.role,
      coalesce(v_profile.display_name, 'عضو'),
      v_profile.email
    );

    update public.tenant_invites
    set uses_count = uses_count + 1
    where id = v_invite.id;

    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_tenant.id,
      v_uid,
      coalesce(v_profile.display_name, 'عضو'),
      'member.joined',
      'انضم العضو بدور ' || v_invite.role
    );
  end if;

  return jsonb_build_object(
    'tenant_id', v_tenant.id,
    'slug', v_tenant.slug,
    'name', v_tenant.name,
    'role', v_invite.role
  );
end;
$$;

-- Entity-Level LWW Push RPC (SECURITY INVOKER so Postgres RLS is strictly enforced!)
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
        'code', SQLSTATE
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

-- Tenant self-service billing activation (mock/direct symbolic subscription switch when not suspended)
create or replace function public.activate_tenant_subscription(
  p_tenant_id uuid,
  p_plan_code text
)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.subscription_plans;
  v_tenant public.tenants;
begin
  if v_uid is null or not public.is_tenant_admin(p_tenant_id) then
    raise exception 'Admin permission required' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where code = p_plan_code and is_active = true;
  if not found then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if v_tenant.subscription_status = 'suspended' then
    raise exception 'Suspended tenant must be restored by platform admin' using errcode = '42501';
  end if;

  update public.tenants
  set plan_code = v_plan.code,
      subscription_status = 'active',
      current_period_end = greatest(now(), current_period_end) + (case when v_plan.billing_interval = 'year' then interval '1 year' else interval '1 month' end),
      updated_at = now()
  where id = p_tenant_id
  returning * into v_tenant;

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (p_tenant_id, v_uid, 'Admin', 'billing.updated', 'تحديث الخطة إلى ' || v_plan.name_ar);

  return v_tenant;
end;
$$;

-- Super-Admin Overview & Controls
create or replace function public.admin_list_tenants()
returns table (
  id uuid,
  slug text,
  name text,
  kind text,
  base_currency text,
  plan_code text,
  subscription_status text,
  current_period_end timestamptz,
  owner_email text,
  member_count bigint,
  record_count bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super-admin access required' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.slug,
    t.name,
    t.kind,
    t.base_currency,
    t.plan_code,
    t.subscription_status,
    t.current_period_end,
    coalesce(p.email, '') as owner_email,
    (select count(*) from public.tenant_members m where m.tenant_id = t.id) as member_count,
    (select count(*) from public.tenant_records r where r.tenant_id = t.id and r.deleted_at_ms is null) as record_count,
    t.created_at
  from public.tenants t
  left join public.profiles p on p.id = t.owner_id
  where t.deleted_at is null
  order by t.created_at desc;
end;
$$;

create or replace function public.admin_update_tenant_subscription(
  p_tenant_id uuid,
  p_plan_code text,
  p_status text,
  p_extend_days integer default 0
)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
begin
  if not public.is_super_admin() then
    raise exception 'Super-admin access required' using errcode = '42501';
  end if;

  update public.tenants
  set plan_code = coalesce(nullif(p_plan_code, ''), plan_code),
      subscription_status = coalesce(nullif(p_status, ''), subscription_status),
      current_period_end = current_period_end + (coalesce(p_extend_days, 0) || ' days')::interval,
      updated_at = now()
  where id = p_tenant_id
  returning * into v_tenant;

  return v_tenant;
end;
$$;

create or replace function public.bootstrap_first_super_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return false;
  end if;
  lock table public.platform_admins in exclusive mode;
  select lower(coalesce(email, '')) into v_email from auth.users where id = v_uid;
  if v_email = 'zyadgamal796@gmail.com' or not exists (select 1 from public.platform_admins) then
    insert into public.platform_admins (user_id, email)
    values (v_uid, v_email)
    on conflict (user_id) do nothing;
    return true;
  end if;
  return public.is_super_admin();
end;
$$;
