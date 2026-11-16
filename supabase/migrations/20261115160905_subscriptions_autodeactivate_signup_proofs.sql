-- Mizan Finance v2.1: 4 Affordable Subscription Packages, Auto-Expiration Account Deactivation,
-- Email/Phone Identity Support & Payment Transfer Screenshot Proofs

-- 1. Upgrade subscription_plans to support 1 Month, 3 Months, 6 Months, and 1 Year
alter table public.subscription_plans
  drop constraint if exists subscription_plans_code_check;

alter table public.subscription_plans
  drop constraint if exists subscription_plans_billing_interval_check;

alter table public.subscription_plans
  add column if not exists duration_days integer not null default 30 check (duration_days >= 1),
  add column if not exists sort_order integer not null default 1;

alter table public.subscription_plans
  add constraint subscription_plans_code_check
  check (code in ('monthly', 'quarterly', 'semiannual', 'yearly'));

alter table public.subscription_plans
  add constraint subscription_plans_billing_interval_check
  check (billing_interval in ('month', 'quarter', 'semiannual', 'year'));

-- Affordable default pricing suitable for any financial situation (editable anytime by Super-Admin)
insert into public.subscription_plans (code, name_ar, name_en, price_egp, billing_interval, duration_days, trial_days, sort_order, is_active, updated_at)
values
  ('monthly',    'باقة شهر واحد',  '1 Month Plan',   29.00,  'month',      30,  0, 1, true, now()),
  ('quarterly',  'باقة 3 أشهر',    '3 Months Plan',  75.00,  'quarter',    90,  0, 2, true, now()),
  ('semiannual', 'باقة 6 أشهر',    '6 Months Plan',  135.00, 'semiannual', 180, 0, 3, true, now()),
  ('yearly',     'باقة سنة كاملة', '1 Year Plan',    240.00, 'year',       365, 0, 4, true, now())
on conflict (code) do update
set name_ar = excluded.name_ar,
    name_en = excluded.name_en,
    price_egp = excluded.price_egp,
    billing_interval = excluded.billing_interval,
    duration_days = excluded.duration_days,
    trial_days = 0,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

-- Allow both anon (new subscriber registration screen) and authenticated users to read plans & receiver billing info
drop policy if exists plans_read_all on public.subscription_plans;
create policy plans_read_all on public.subscription_plans
  for select to anon, authenticated
  using (true);

drop policy if exists billing_info_select on public.platform_billing_info;
create policy billing_info_select on public.platform_billing_info
  for select to anon, authenticated
  using (true);

-- 2. Enhance profiles with phone & clean contact_display (supports Email OR Phone registration)
alter table public.profiles
  add column if not exists phone text,
  add column if not exists contact_display text;

update public.profiles
set contact_display = coalesce(nullif(contact_display, ''), nullif(phone, ''), email)
where contact_display is null or contact_display = '';

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_email text;
  v_phone text;
  v_contact text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_phone := nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  v_contact := coalesce(
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'contact_display', '')), ''),
    v_phone,
    v_email
  );
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    v_phone,
    nullif(split_part(v_email, '@', 1), ''),
    'مشترك ميزان'
  );

  insert into public.profiles (id, email, phone, contact_display, display_name, avatar_url)
  values (
    new.id,
    v_email,
    v_phone,
    v_contact,
    v_name,
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        phone = coalesce(excluded.phone, public.profiles.phone),
        contact_display = coalesce(nullif(excluded.contact_display, ''), public.profiles.contact_display),
        display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
        updated_at = now();

  -- Strictly promote ONLY the designated platform owner email
  if v_email = 'zyadgamal796@gmail.com' then
    insert into public.platform_admins (user_id, email)
    values (new.id, v_email)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- 3. Expand tenant subscription_status for pending_approval & automatic expired deactivation
alter table public.tenants
  drop constraint if exists tenants_subscription_status_check;

alter table public.tenants
  add column if not exists auto_deactivated_at timestamptz;

alter table public.tenants
  add constraint tenants_subscription_status_check
  check (subscription_status in ('pending_approval', 'trialing', 'active', 'past_due', 'expired', 'suspended'));

-- 4. Automatic Subscription Expiration Sweep Function
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

grant execute on function public.enforce_expired_subscriptions() to authenticated;

-- Optional pg_cron schedule if pg_cron extension is installed on the project
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'mizan-enforce-expired-subscriptions',
      '*/5 * * * *',
      'select public.enforce_expired_subscriptions();'
    );
  end if;
exception when others then
  null;
end;
$$;

-- 5. Tighten can_write_tenant so expired / pending_approval / suspended accounts cannot write
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
      and (
        public.is_super_admin()
        or (
          t.subscription_status in ('active', 'trialing')
          and t.current_period_end > now()
        )
      )
  );
$$;

-- Run auto-expiration check on every session bootstrap AND enforce owner-only super-admin
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
  perform public.enforce_expired_subscriptions();

  if v_uid is null then
    return false;
  end if;

  select lower(coalesce(email, '')) into v_email from auth.users where id = v_uid;
  if v_email = 'zyadgamal796@gmail.com' then
    insert into public.platform_admins (user_id, email)
    values (v_uid, v_email)
    on conflict (user_id) do nothing;
    return true;
  end if;

  return public.is_super_admin();
end;
$$;

-- 6. Upgrade payment_requests with proof_path, request_type, duration_days, and submitter_contact
alter table public.payment_requests
  add column if not exists request_type text not null default 'renewal' check (request_type in ('new_registration', 'renewal')),
  add column if not exists duration_days integer not null default 30,
  add column if not exists proof_path text,
  add column if not exists submitter_contact text;

update public.payment_requests
set submitter_contact = coalesce(nullif(submitter_contact, ''), submitter_email)
where submitter_contact is null or submitter_contact = '';

-- Private Storage Bucket for Payment Transfer Screenshots (mizan-payment-proofs)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mizan-payment-proofs',
  'mizan-payment-proofs',
  false,
  6291456,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 6291456,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists mizan_payment_proofs_select on storage.objects;
create policy mizan_payment_proofs_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'mizan-payment-proofs'
    and (
      public.is_super_admin()
      or public.tenant_role(public.receipt_object_tenant_id(name)) in ('owner', 'admin')
    )
  );

drop policy if exists mizan_payment_proofs_insert on storage.objects;
create policy mizan_payment_proofs_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mizan-payment-proofs'
    and (
      public.is_super_admin()
      or public.tenant_role(public.receipt_object_tenant_id(name)) in ('owner', 'admin')
    )
  );

-- Upgraded submit_payment_request (supports sender handle / InstaPay username + proof_path)
drop function if exists public.submit_payment_request(uuid, text, text, text, text, text);

create or replace function public.submit_payment_request(
  p_tenant_id uuid,
  p_plan_code text,
  p_payment_method text,
  p_reference_code text,
  p_sender_handle text default null,
  p_notes text default null,
  p_proof_path text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_tenant public.tenants;
  v_plan public.subscription_plans;
  v_profile public.profiles;
  v_email text;
  v_contact text;
  v_sender text;
  v_ref text;
  v_req public.payment_requests;
begin
  if v_uid is null then
    raise exception 'يجب تسجيل الدخول أولاً' using errcode = '42501';
  end if;

  v_role := public.tenant_role(p_tenant_id);
  if v_role not in ('owner', 'admin') and not public.is_super_admin() then
    raise exception 'صلاحية مالك المساحة مطلوبة لإرسال طلب الاشتراك' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id and deleted_at is null;
  if not found then
    raise exception 'المساحة غير موجودة' using errcode = 'P0002';
  end if;

  select * into v_plan from public.subscription_plans where code = p_plan_code;
  if not found then
    raise exception 'الباقة المختارة غير صالحة' using errcode = '22023';
  end if;

  v_sender := coalesce(nullif(trim(coalesce(p_sender_handle, '')), ''), nullif(trim(coalesce(p_reference_code, '')), ''));
  if v_sender is null or char_length(v_sender) < 2 then
    raise exception 'أدخل الرقم الذي تم منه التحويل أو اسم مستخدم إنستا باي' using errcode = '22023';
  end if;

  v_ref := coalesce(nullif(trim(coalesce(p_reference_code, '')), ''), v_sender);

  select * into v_profile from public.profiles where id = v_uid;
  select coalesce(email, '') into v_email from auth.users where id = v_uid;
  v_contact := coalesce(nullif(v_profile.contact_display, ''), nullif(v_profile.phone, ''), v_email);

  insert into public.payment_requests (
    tenant_id,
    tenant_name,
    submitted_by,
    submitter_email,
    submitter_contact,
    request_type,
    plan_code,
    duration_days,
    amount_egp,
    payment_method,
    reference_code,
    sender_handle,
    proof_path,
    notes,
    status
  )
  values (
    p_tenant_id,
    v_tenant.name,
    v_uid,
    v_contact,
    v_contact,
    case when v_tenant.subscription_status = 'pending_approval' then 'new_registration' else 'renewal' end,
    v_plan.code,
    v_plan.duration_days,
    v_plan.price_egp,
    case when p_payment_method in ('instapay', 'vodafone_cash', 'bank_transfer', 'other') then p_payment_method else 'instapay' end,
    v_ref,
    v_sender,
    nullif(trim(coalesce(p_proof_path, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'pending'
  )
  returning * into v_req;

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (
    p_tenant_id,
    v_uid,
    coalesce(nullif(v_profile.display_name, ''), v_contact, 'مشترك'),
    'billing.payment_submitted',
    'إرسال إيصال دفع (' || v_plan.name_ar || ' - ' || v_plan.price_egp || ' ج.م) من: ' || v_sender
  );

  return v_req;
end;
$$;

-- 7. Upgraded admin_review_payment_request (activates account for exact package duration_days)
create or replace function public.admin_review_payment_request(
  p_request_id uuid,
  p_decision text,
  p_admin_note text default null
)
returns public.payment_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.payment_requests;
  v_plan public.subscription_plans;
  v_days integer;
begin
  if not public.is_super_admin() then
    raise exception 'صلاحية مالك المنصة مطلوبة' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'القرار يجب أن يكون قبول أو رفض' using errcode = '22023';
  end if;

  select * into v_req from public.payment_requests where id = p_request_id for update;
  if not found then
    raise exception 'طلب الدفع غير موجود' using errcode = 'P0002';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'تمت مراجعة هذا الطلب مسبقاً' using errcode = '22023';
  end if;

  update public.payment_requests
  set status = p_decision,
      reviewed_by = v_uid,
      reviewed_at = now(),
      admin_note = nullif(trim(coalesce(p_admin_note, '')), '')
  where id = p_request_id
  returning * into v_req;

  if p_decision = 'approved' then
    select * into v_plan from public.subscription_plans where code = v_req.plan_code;
    v_days := coalesce(nullif(v_req.duration_days, 0), v_plan.duration_days, 30);

    update public.tenants
    set plan_code = v_req.plan_code,
        subscription_status = 'active',
        auto_deactivated_at = null,
        current_period_end = greatest(now(), coalesce(current_period_end, now())) + (v_days || ' days')::interval,
        updated_at = now()
    where id = v_req.tenant_id;

    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_req.tenant_id,
      v_uid,
      'Super-Admin',
      'billing.payment_approved',
      'تأكيد التحويل وتفعيل اشتراك المشترك (' || coalesce(v_plan.name_ar, v_req.plan_code) || ' لمدة ' || v_days || ' يوم)'
    );
  else
    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_req.tenant_id,
      v_uid,
      'Super-Admin',
      'billing.payment_rejected',
      'رفض طلب الدفع' || case when v_req.admin_note is not null then ': ' || v_req.admin_note else '' end
    );
  end if;

  return v_req;
end;
$$;

-- 8. Upgraded Super-Admin Tenant Subscription Controls & Real-Time Overview
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
  if not public.is_super_admin() then
    raise exception 'التفعيل المباشر متاح لمالك المنصة فقط؛ أرسل إيصال الدفع من شاشة الاشتراك' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where code = p_plan_code;
  if not found then
    raise exception 'الباقة غير صالحة' using errcode = '22023';
  end if;

  update public.tenants
  set plan_code = v_plan.code,
      subscription_status = 'active',
      auto_deactivated_at = null,
      current_period_end = greatest(now(), coalesce(current_period_end, now())) + (v_plan.duration_days || ' days')::interval,
      updated_at = now()
  where id = p_tenant_id
  returning * into v_tenant;

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (p_tenant_id, v_uid, 'Super-Admin', 'billing.updated', 'تفعيل مباشر للباقة: ' || v_plan.name_ar);

  return v_tenant;
end;
$$;

drop function if exists public.admin_list_tenants();

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
  auto_deactivated_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_email text,
  owner_phone text,
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

  perform public.enforce_expired_subscriptions();

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
    t.auto_deactivated_at,
    t.owner_id,
    coalesce(p.display_name, 'مشترك') as owner_name,
    coalesce(nullif(p.contact_display, ''), p.email, '') as owner_email,
    coalesce(p.phone, '') as owner_phone,
    (select count(*) from public.tenant_members m where m.tenant_id = t.id) as member_count,
    (select count(*) from public.tenant_records r where r.tenant_id = t.id and r.deleted_at_ms is null) as record_count,
    t.created_at
  from public.tenants t
  left join public.profiles p on p.id = t.owner_id
  where t.deleted_at is null
  order by t.created_at desc;
end;
$$;

drop function if exists public.admin_update_tenant_subscription(uuid, text, text, integer);

create or replace function public.admin_update_tenant_subscription(
  p_tenant_id uuid,
  p_plan_code text default null,
  p_status text default null,
  p_extend_days integer default 0,
  p_exact_period_end timestamptz default null
)
returns public.tenants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant public.tenants;
  v_next_end timestamptz;
  v_next_status text;
begin
  if not public.is_super_admin() then
    raise exception 'Super-admin access required' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'المساحة غير موجودة' using errcode = 'P0002';
  end if;

  if p_exact_period_end is not null then
    v_next_end := p_exact_period_end;
  elsif coalesce(p_extend_days, 0) > 0 then
    v_next_end := greatest(now(), coalesce(v_tenant.current_period_end, now())) + (p_extend_days || ' days')::interval;
  elsif coalesce(p_extend_days, 0) < 0 then
    v_next_end := coalesce(v_tenant.current_period_end, now()) + (p_extend_days || ' days')::interval;
  else
    v_next_end := v_tenant.current_period_end;
  end if;

  v_next_status := coalesce(nullif(p_status, ''), v_tenant.subscription_status);

  -- If owner sets a past expiration date while status is active, automatically mark expired
  if v_next_status in ('active', 'trialing') and v_next_end <= now() then
    if p_exact_period_end is not null or coalesce(p_extend_days, 0) < 0 then
      v_next_status := 'expired';
    else
      -- Owner clicked Restore/Activate on an expired tenant without specifying days -> grant plan's default duration
      v_next_end := now() + interval '30 days';
    end if;
  end if;

  update public.tenants
  set plan_code = coalesce(nullif(p_plan_code, ''), plan_code),
      subscription_status = v_next_status,
      auto_deactivated_at = case
        when v_next_status = 'expired' then coalesce(auto_deactivated_at, now())
        when v_next_status in ('active', 'trialing') then null
        else auto_deactivated_at
      end,
      current_period_end = v_next_end,
      updated_at = now()
  where id = p_tenant_id
  returning * into v_tenant;

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (
    p_tenant_id,
    v_uid,
    'Super-Admin',
    'billing.admin_adjusted',
    'تحديث الاشتراك بواسطة المالك — الحالة: ' || v_tenant.subscription_status || ' حتى ' || to_char(v_tenant.current_period_end at time zone 'UTC', 'YYYY-MM-DD')
  );

  return v_tenant;
end;
$$;
