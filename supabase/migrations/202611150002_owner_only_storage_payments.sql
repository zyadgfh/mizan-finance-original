-- Mizan Finance: Owner-Only Provisioning Guard, Manual Payment Confirmation & Cloud Receipt Storage

-- 1. Public check for whether the initial platform owner has been provisioned
create or replace function public.has_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins);
$$;

grant execute on function public.has_platform_owner() to anon, authenticated;

-- 2. Platform Billing Receiver Info (InstaPay / Vodafone Cash / Bank instructions)
create table if not exists public.platform_billing_info (
  id integer primary key default 1 check (id = 1),
  instapay_handle text not null default '',
  vodafone_cash_number text not null default '',
  bank_details text not null default '',
  instructions_ar text not null default 'حوّل قيمة الباقة عبر إنستاباي أو فودافون كاش ثم أدخل رقم العملية المرجعي ليعتمدها مالك المنصة.',
  instructions_en text not null default 'Transfer the plan amount via InstaPay or Vodafone Cash, then submit the reference code for owner approval.',
  updated_at timestamptz not null default now()
);

insert into public.platform_billing_info (id)
values (1)
on conflict (id) do nothing;

alter table public.platform_billing_info enable row level security;

drop policy if exists billing_info_select on public.platform_billing_info;
create policy billing_info_select on public.platform_billing_info
  for select to authenticated
  using (true);

drop policy if exists billing_info_admin_write on public.platform_billing_info;
create policy billing_info_admin_write on public.platform_billing_info
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- 3. Manual Payment Confirmation Requests
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_name text not null,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  submitter_email text not null,
  plan_code text not null references public.subscription_plans(code),
  amount_egp numeric(10, 2) not null check (amount_egp >= 0),
  payment_method text not null check (payment_method in ('instapay', 'vodafone_cash', 'bank_transfer', 'other')),
  reference_code text not null check (char_length(trim(reference_code)) between 2 and 120),
  sender_handle text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now()
);

create index if not exists payment_requests_tenant_idx on public.payment_requests (tenant_id, created_at desc);
create index if not exists payment_requests_status_idx on public.payment_requests (status, created_at desc);

alter table public.payment_requests enable row level security;

drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select on public.payment_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or public.tenant_role(tenant_id) in ('owner', 'admin')
  );

drop policy if exists payment_requests_insert on public.payment_requests;
create policy payment_requests_insert on public.payment_requests
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and (public.is_super_admin() or public.tenant_role(tenant_id) in ('owner', 'admin'))
  );

drop policy if exists payment_requests_admin_update on public.payment_requests;
create policy payment_requests_admin_update on public.payment_requests
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create or replace function public.submit_payment_request(
  p_tenant_id uuid,
  p_plan_code text,
  p_payment_method text,
  p_reference_code text,
  p_sender_handle text default null,
  p_notes text default null
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
  v_email text;
  v_req public.payment_requests;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  v_role := public.tenant_role(p_tenant_id);
  if v_role not in ('owner', 'admin') and not public.is_super_admin() then
    raise exception 'صلاحية مالك أو مدير المساحة مطلوبة لإرسال طلب التفعيل' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id and deleted_at is null;
  if not found then
    raise exception 'المساحة غير موجودة' using errcode = 'P0002';
  end if;

  select * into v_plan from public.subscription_plans where code = p_plan_code;
  if not found then
    raise exception 'الخطة غير صالحة' using errcode = '22023';
  end if;

  if trim(coalesce(p_reference_code, '')) = '' or char_length(trim(p_reference_code)) < 2 then
    raise exception 'أدخل رقم العملية المرجعي' using errcode = '22023';
  end if;

  select coalesce(email, '') into v_email from auth.users where id = v_uid;

  insert into public.payment_requests (
    tenant_id,
    tenant_name,
    submitted_by,
    submitter_email,
    plan_code,
    amount_egp,
    payment_method,
    reference_code,
    sender_handle,
    notes,
    status
  )
  values (
    p_tenant_id,
    v_tenant.name,
    v_uid,
    v_email,
    v_plan.code,
    v_plan.price_egp,
    case when p_payment_method in ('instapay', 'vodafone_cash', 'bank_transfer', 'other') then p_payment_method else 'instapay' end,
    trim(p_reference_code),
    nullif(trim(coalesce(p_sender_handle, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'pending'
  )
  returning * into v_req;

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (
    p_tenant_id,
    v_uid,
    coalesce(nullif(v_email, ''), 'Admin'),
    'billing.payment_submitted',
    'إرسال طلب تأكيد دفع (' || v_plan.name_ar || ') مرجع #' || trim(p_reference_code)
  );

  return v_req;
end;
$$;

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
begin
  if not public.is_super_admin() then
    raise exception 'Super-admin access required' using errcode = '42501';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
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

    update public.tenants
    set plan_code = v_req.plan_code,
        subscription_status = 'active',
        current_period_end = greatest(now(), current_period_end)
          + (case when v_plan.billing_interval = 'year' then interval '1 year' else interval '1 month' end),
        updated_at = now()
    where id = v_req.tenant_id;

    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_req.tenant_id,
      v_uid,
      'Super-Admin',
      'billing.payment_approved',
      'اعتماد الدفع وتفعيل ' || coalesce(v_plan.name_ar, v_req.plan_code) || ' (مرجع #' || v_req.reference_code || ')'
    );
  else
    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_req.tenant_id,
      v_uid,
      'Super-Admin',
      'billing.payment_rejected',
      'رفض طلب الدفع مرجع #' || v_req.reference_code
    );
  end if;

  return v_req;
end;
$$;

-- Restrict direct self-activation to Super-Admin only (tenants submit payment confirmation requests)
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
    raise exception 'التفعيل المباشر متاح لمالك المنصة فقط؛ أرسل طلب تأكيد الدفع من تبويب الاشتراك' using errcode = '42501';
  end if;

  select * into v_plan from public.subscription_plans where code = p_plan_code;
  if not found then
    raise exception 'Invalid plan code' using errcode = '22023';
  end if;

  update public.tenants
  set plan_code = v_plan.code,
      subscription_status = 'active',
      current_period_end = greatest(now(), current_period_end)
        + (case when v_plan.billing_interval = 'year' then interval '1 year' else interval '1 month' end),
      updated_at = now()
  where id = p_tenant_id
  returning * into v_tenant;

  insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
  values (p_tenant_id, v_uid, 'Super-Admin', 'billing.updated', 'تفعيل مباشر للخطة: ' || v_plan.name_ar);

  return v_tenant;
end;
$$;

-- 4. Supabase Storage Bucket & Tenant-Isolated RLS for Receipt Sync
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mizan-receipts',
  'mizan-receipts',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create or replace function public.receipt_object_tenant_id(p_name text)
returns uuid
language plpgsql
immutable
security definer
set search_path = public
as $$
declare
  v_seg text;
begin
  v_seg := split_part(coalesce(p_name, ''), '/', 1);
  if v_seg = '' then
    return null;
  end if;
  return v_seg::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists mizan_receipts_select on storage.objects;
create policy mizan_receipts_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'mizan-receipts'
    and public.is_tenant_member(public.receipt_object_tenant_id(name))
  );

drop policy if exists mizan_receipts_insert on storage.objects;
create policy mizan_receipts_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mizan-receipts'
    and public.can_write_tenant(public.receipt_object_tenant_id(name))
  );

drop policy if exists mizan_receipts_update on storage.objects;
create policy mizan_receipts_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'mizan-receipts'
    and public.can_write_tenant(public.receipt_object_tenant_id(name))
  )
  with check (
    bucket_id = 'mizan-receipts'
    and public.can_write_tenant(public.receipt_object_tenant_id(name))
  );

drop policy if exists mizan_receipts_delete on storage.objects;
create policy mizan_receipts_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'mizan-receipts'
    and public.can_write_tenant(public.receipt_object_tenant_id(name))
  );
