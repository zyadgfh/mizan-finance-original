-- =============================================================================
-- Mizan Finance — Security hardening migration
-- Remediation for the 2026-11-16 security audit (findings 01-13).
--
-- Design rules used throughout:
--   * Clients never write security-relevant columns directly (audit logs,
--     payment review fields, billing columns, profile email, hard deletes).
--   * Server timestamps / monotonic revisions decide sync order, never the
--     client clock.
--   * Every SECURITY DEFINER function re-checks privileges and pins search_path.
--   * Idempotent: safe to re-run on an already hardened database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Platform settings (single source of truth for the bootstrap owner email)
-- -----------------------------------------------------------------------------
create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  owner_email text not null default '',
  bootstrap_completed_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.platform_settings (id, owner_email)
values (1, 'zyadgamal796@gmail.com')
on conflict (id) do nothing;

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;

drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings
  for select to authenticated
  using (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 1. Server-side audit trail for security events + rate limiting primitives
--    (service_role only — no client can read, write or forge these)
-- -----------------------------------------------------------------------------
create table if not exists public.platform_security_log (
  id bigserial primary key,
  event text not null check (char_length(event) <= 80),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  actor_id uuid,
  actor_hint text,
  ip_hash text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_security_log_created_idx
  on public.platform_security_log (created_at desc);

alter table public.platform_security_log enable row level security;
revoke all on public.platform_security_log from anon, authenticated;
grant select, insert on public.platform_security_log to service_role;
grant usage, select on sequence public.platform_security_log_id_seq to service_role;

create table if not exists public.rate_limit_events (
  id bigserial primary key,
  scope text not null,
  bucket text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_events_lookup_idx
  on public.rate_limit_events (scope, bucket, created_at desc);

alter table public.rate_limit_events enable row level security;
revoke all on public.rate_limit_events from anon, authenticated;
grant select, insert, delete on public.rate_limit_events to service_role;
grant usage, select on sequence public.rate_limit_events_id_seq to service_role;

-- Allows the Edge Functions to keep raw IPs out of the database.
create or replace function public.hash_bucket(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(extensions.digest(coalesce(p_value, ''), 'sha256'), 'hex');
$$;

revoke all on function public.hash_bucket(text) from public, anon, authenticated;
grant execute on function public.hash_bucket(text) to service_role;

-- Fixed-window counter. Returns true when the call is allowed.
create or replace function public.check_rate_limit(
  p_scope text,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_scope is null or char_length(p_scope) < 1 or char_length(p_scope) > 64 then
    return false;
  end if;
  if p_bucket is null or char_length(p_bucket) < 1 or char_length(p_bucket) > 200 then
    return false;
  end if;
  if coalesce(p_limit, 0) <= 0 or coalesce(p_window_seconds, 0) <= 0 then
    return false;
  end if;

  -- Opportunistic retention: keep the table small without a cron dependency.
  delete from public.rate_limit_events where created_at < now() - interval '1 day';

  select count(*) into v_count
  from public.rate_limit_events
  where scope = p_scope
    and bucket = p_bucket
    and created_at > now() - make_interval(secs => p_window_seconds);

  if v_count >= p_limit then
    return false;
  end if;

  insert into public.rate_limit_events (scope, bucket) values (p_scope, p_bucket);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- 2. FINDING 03 — profiles.email can no longer diverge from the verified
--    auth.users.email identity (invites, ownership and audit all read auth).
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_identity_columns()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_auth_email text;
begin
  select lower(coalesce(u.email, '')) into v_auth_email
  from auth.users u
  where u.id = new.id;

  if v_auth_email is not null and v_auth_email <> '' then
    new.email := v_auth_email;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_identity on public.profiles;
create trigger trg_guard_profile_identity
before insert or update on public.profiles
for each row execute function public.guard_profile_identity_columns();

-- Defence in depth: clients may only update presentation columns; email is not
-- in the grant list at all, so a direct REST update of profiles.email is denied
-- before the trigger is even reached.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, phone, contact_display, updated_at)
  on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 3. FINDING 02/03 — invite redemption binds to the verified Auth identity
-- -----------------------------------------------------------------------------
create or replace function public.redeem_tenant_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_invite public.tenant_invites;
  v_tenant public.tenants;
  v_email text := '';
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Identity must be verified before it can consume an invitation.
  select lower(coalesce(u.email, '')), u.email_confirmed_at
  into v_email, v_confirmed
  from auth.users u
  where u.id = v_uid;

  if v_confirmed is null then
    raise exception 'يجب تأكيد البريد الإلكتروني قبل قبول الدعوة'
      using errcode = '42501';
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

  -- Compare against the verified Auth email, never the mutable profile copy.
  if v_invite.email is not null and lower(btrim(v_invite.email)) <> v_email then
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
      coalesce(nullif(v_profile.display_name, ''), 'عضو'),
      nullif(v_email, '')
    );

    update public.tenant_invites
    set uses_count = uses_count + 1
    where id = v_invite.id;

    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_tenant.id,
      v_uid,
      coalesce(nullif(v_profile.display_name, ''), 'عضو'),
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

revoke all on function public.redeem_tenant_invite(text) from public, anon;
grant execute on function public.redeem_tenant_invite(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. FINDINGS 04/05/09 — monotonic revisions, server-clamped timestamps,
--    payload limits and tombstone-only deletes
-- -----------------------------------------------------------------------------
create sequence if not exists public.tenant_records_revision_seq;

alter table public.tenant_records
  add column if not exists revision bigint;

update public.tenant_records
set revision = nextval('public.tenant_records_revision_seq')
where revision is null;

alter table public.tenant_records
  alter column revision set default nextval('public.tenant_records_revision_seq');
alter table public.tenant_records
  alter column revision set not null;

create unique index if not exists tenant_records_revision_key
  on public.tenant_records (revision);
create index if not exists tenant_records_tenant_revision_idx
  on public.tenant_records (tenant_id, revision);

-- Every write gets a fresh, server-assigned revision: sync order can no longer
-- be poisoned by a client clock, and ties inside one transaction disappear.
create or replace function public.touch_tenant_record_server_ts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.server_updated_at := clock_timestamp();
  new.revision := nextval('public.tenant_records_revision_seq');
  return new;
end;
$$;

drop trigger if exists trg_tenant_records_server_ts on public.tenant_records;
create trigger trg_tenant_records_server_ts
before insert or update on public.tenant_records
for each row execute function public.touch_tenant_record_server_ts();

create or replace function public.validate_tenant_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bytes integer;
begin
  if new.entity_id is null or char_length(new.entity_id) not between 1 and 200 then
    raise exception 'معرّف السجل غير صالح' using errcode = '22023';
  end if;
  if jsonb_typeof(new.payload) is distinct from 'object' then
    raise exception 'بيانات السجل يجب أن تكون كائن JSON' using errcode = '22023';
  end if;

  v_bytes := octet_length(new.payload::text);
  if v_bytes > 262144 then
    raise exception 'حجم بيانات السجل يتجاوز الحد المسموح (256KB)' using errcode = '54000';
  end if;

  if new.updated_at_ms is null or new.updated_at_ms < 0 then
    raise exception 'updated_at_ms غير صالح' using errcode = '22023';
  end if;
  if new.deleted_at_ms is not null and new.deleted_at_ms < 0 then
    raise exception 'deleted_at_ms غير صالح' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_tenant_record on public.tenant_records;
create trigger trg_validate_tenant_record
before insert or update on public.tenant_records
for each row execute function public.validate_tenant_record();

-- Hard deletes are removed from the client surface entirely: deletion is a
-- tombstone produced by the sync RPC (or by soft_delete_tenant_record).
drop policy if exists tenant_records_delete on public.tenant_records;
create policy tenant_records_delete on public.tenant_records
  for delete to authenticated
  using (false);

revoke delete on public.tenant_records from anon, authenticated;
revoke truncate on public.tenant_records from anon, authenticated;
grant select, insert, update on public.tenant_records to authenticated;

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
  v_revision bigint;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  -- A device clock may be ahead by at most this much before we clamp it.
  v_max_skew_ms constant bigint := 300000;
  v_max_payload_bytes constant integer := 262144;
  v_max_ops constant integer := 200;
  v_allowed_types constant text[] := array[
    'tx', 'person', 'debt', 'payment', 'wallet', 'transfer',
    'budget', 'goal', 'goalMove', 'recurring', 'category', 'debtAudit'
  ];
  v_applied jsonb := '[]'::jsonb;
  v_stale jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_ops is null or jsonb_typeof(p_ops) is distinct from 'array' then
    raise exception 'صيغة عمليات المزامنة غير صالحة' using errcode = '22023';
  end if;

  if jsonb_array_length(p_ops) > v_max_ops then
    raise exception 'عدد العمليات في الدفعة يتجاوز الحد المسموح (%)', v_max_ops
      using errcode = '54000';
  end if;

  if not public.can_write_tenant(p_tenant_id) then
    raise exception 'لا تملك صلاحية الكتابة في هذه المساحة' using errcode = '42501';
  end if;

  select nullif(display_name, '') into v_actor_name from public.profiles where id = v_uid;
  v_actor_name := coalesce(v_actor_name, 'عضو');

  for v_op in select * from jsonb_array_elements(p_ops)
  loop
    v_type := nullif(v_op ->> 'entityType', '');
    v_id := nullif(v_op ->> 'entityId', '');
    v_payload := coalesce(v_op -> 'payload', '{}'::jsonb);
    v_updated_at := null;
    v_deleted_at := null;
    v_existing_ts := null;
    v_revision := null;

    -- ---- structural validation (no casts that can raise) -------------------
    if v_type is null or not (v_type = any(v_allowed_types)) then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', coalesce(v_type, ''),
        'entityId', coalesce(v_id, ''),
        'error', 'نوع السجل غير مدعوم',
        'code', 'ENTITY_TYPE_INVALID'
      );
      continue;
    end if;

    if v_id is null or char_length(v_id) < 1 or char_length(v_id) > 200 then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', coalesce(v_id, ''),
        'error', 'معرّف السجل غير صالح',
        'code', 'ENTITY_ID_INVALID'
      );
      continue;
    end if;

    if jsonb_typeof(v_payload) is distinct from 'object' then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'بيانات السجل يجب أن تكون كائن JSON',
        'code', 'PAYLOAD_INVALID'
      );
      continue;
    end if;

    if octet_length(v_payload::text) > v_max_payload_bytes then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'حجم بيانات السجل يتجاوز الحد المسموح',
        'code', 'PAYLOAD_TOO_LARGE'
      );
      continue;
    end if;

    -- ---- timestamp parsing without exceptions ------------------------------
    if v_op ->> 'updatedAtMs' is null or (v_op ->> 'updatedAtMs') = '' then
      v_updated_at := v_now_ms;
    elsif (v_op ->> 'updatedAtMs') ~ '^-?[0-9]{1,16}$' then
      v_updated_at := (v_op ->> 'updatedAtMs')::bigint;
    else
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'توقيت السجل غير صالح',
        'code', 'TIMESTAMP_INVALID'
      );
      continue;
    end if;

    if v_op ? 'deletedAtMs' and (v_op ->> 'deletedAtMs') is not null then
      if (v_op ->> 'deletedAtMs') ~ '^-?[0-9]{1,16}$' then
        v_deleted_at := (v_op ->> 'deletedAtMs')::bigint;
      else
        v_rejected := v_rejected || jsonb_build_object(
          'entityType', v_type,
          'entityId', v_id,
          'error', 'توقيت الحذف غير صالح',
          'code', 'TIMESTAMP_INVALID'
        );
        continue;
      end if;
    end if;

    if v_updated_at < 0 or (v_deleted_at is not null and v_deleted_at < 0) then
      v_rejected := v_rejected || jsonb_build_object(
        'entityType', v_type,
        'entityId', v_id,
        'error', 'توقيت السجل غير صالح',
        'code', 'TIMESTAMP_INVALID'
      );
      continue;
    end if;

    -- Clock-skew clamp: a client can never park a record in the far future.
    if v_updated_at > v_now_ms + v_max_skew_ms then
      v_updated_at := v_now_ms;
    end if;
    if v_deleted_at is not null and v_deleted_at > v_now_ms + v_max_skew_ms then
      v_deleted_at := v_now_ms;
    end if;

    -- ---- apply ------------------------------------------------------------
    begin
      select updated_at_ms, revision into v_existing_ts, v_revision
      from public.tenant_records
      where tenant_id = p_tenant_id and entity_type = v_type and entity_id = v_id;

      if v_existing_ts is not null and v_updated_at < v_existing_ts then
        v_stale := v_stale || jsonb_build_object(
          'entityType', v_type,
          'entityId', v_id,
          'serverUpdatedAtMs', v_existing_ts,
          'revision', v_revision
        );
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
          where public.tenant_records.updated_at_ms <= excluded.updated_at_ms
        returning revision into v_revision;

        if v_revision is null then
          v_stale := v_stale || jsonb_build_object(
            'entityType', v_type,
            'entityId', v_id
          );
        else
          v_applied := v_applied || jsonb_build_object(
            'entityType', v_type,
            'entityId', v_id,
            'revision', v_revision
          );
        end if;
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
    'serverTime', now(),
    'serverNowMs', v_now_ms
  );
end;
$$;

revoke all on function public.sync_push_tenant_records(uuid, jsonb) from public, anon;
grant execute on function public.sync_push_tenant_records(uuid, jsonb) to authenticated;

-- Explicit, auditable soft delete (client never issues a DELETE anymore).
create or replace function public.soft_delete_tenant_record(
  p_tenant_id uuid,
  p_entity_type text,
  p_entity_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_name text;
  v_found boolean := false;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.can_write_tenant(p_tenant_id) then
    raise exception 'لا تملك صلاحية الحذف في هذه المساحة' using errcode = '42501';
  end if;

  select nullif(display_name, '') into v_name from public.profiles where id = v_uid;

  update public.tenant_records
  set deleted_at_ms = v_now_ms,
      updated_at_ms = greatest(updated_at_ms, v_now_ms),
      updated_by = v_uid,
      updated_by_name = coalesce(v_name, 'عضو')
  where tenant_id = p_tenant_id
    and entity_type = p_entity_type
    and entity_id = p_entity_id
    and deleted_at_ms is null;

  v_found := found;

  if v_found then
    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, entity_type, entity_id, summary)
    values (
      p_tenant_id, v_uid, coalesce(v_name, 'عضو'), 'record.deleted', p_entity_type, p_entity_id,
      'حذف سجل (' || p_entity_type || ')'
    );
  end if;

  return v_found;
end;
$$;

revoke all on function public.soft_delete_tenant_record(uuid, text, text) from public, anon;
grant execute on function public.soft_delete_tenant_record(uuid, text, text) to authenticated;

-- Deferred physical purge — service_role / scheduled jobs only.
create or replace function public.purge_expired_tenant_records(p_retention_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if coalesce(p_retention_days, 0) < 7 then
    raise exception 'Retention window must be at least 7 days' using errcode = '22023';
  end if;

  with purged as (
    delete from public.tenant_records
    where deleted_at_ms is not null
      and to_timestamp(deleted_at_ms / 1000.0) < now() - make_interval(days => p_retention_days)
    returning 1
  )
  select count(*) into v_count from purged;

  return v_count;
end;
$$;

revoke all on function public.purge_expired_tenant_records(integer) from public, anon, authenticated;
grant execute on function public.purge_expired_tenant_records(integer) to service_role;

-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 6. FINDING 06 — trials come from the plan; workspace creation is quota-limited
-- -----------------------------------------------------------------------------
-- Behaviour preservation: the legacy implementation hardcoded a 14-day trial
-- while the plan rows carried trial_days = 0. Make the data match the observed
-- behaviour first, otherwise every new signup lands on a zero-length period.
update public.subscription_plans
set trial_days = 14, updated_at = now()
where coalesce(trial_days, 0) = 0;

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
  v_confirmed timestamptz;
  v_max_workspaces constant integer := 5;
  v_trial_end timestamptz;
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

  v_slug := lower(regexp_replace(coalesce(nullif(trim(p_slug), ''), trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  v_slug := trim(both '-' from v_slug);
  if char_length(v_slug) < 3 then
    v_slug := 'mizan-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;
  if exists (select 1 from public.tenants where slug = v_slug) then
    v_slug := left(v_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  -- Trial length is owned by the plan row, never duplicated as a literal.
  v_trial_end := now() + make_interval(days => greatest(coalesce(v_plan.trial_days, 0), 0));

  insert into public.tenants (
    slug, name, kind, base_currency, plan_code, subscription_status, current_period_end, owner_id
  )
  values (
    v_slug,
    trim(p_name),
    coalesce(nullif(p_kind, ''), 'personal'),
    coalesce(nullif(p_base_currency, ''), 'EGP'),
    v_plan.code,
    case when coalesce(v_plan.trial_days, 0) > 0 then 'trialing' else 'pending_approval' end,
    v_trial_end,
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

revoke all on function public.create_tenant_workspace(text, text, text, text, text) from public, anon;
grant execute on function public.create_tenant_workspace(text, text, text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. FINDING 07 — payment amounts/durations are plan-derived and review-only
--    fields are not client-writable
-- -----------------------------------------------------------------------------
drop policy if exists payment_requests_insert on public.payment_requests;
revoke insert, delete, truncate on public.payment_requests from anon, authenticated;
grant select, update on public.payment_requests to authenticated;

alter table public.payment_requests
  drop constraint if exists payment_requests_duration_days_check;
alter table public.payment_requests
  add constraint payment_requests_duration_days_check
  check (duration_days between 1 and 800);

alter table public.payment_requests
  drop constraint if exists payment_requests_amount_egp_check;
alter table public.payment_requests
  add constraint payment_requests_amount_egp_check
  check (amount_egp >= 0 and amount_egp <= 100000);

create or replace function public.guard_payment_request_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.subscription_plans;
begin
  if tg_op = 'INSERT' then
    select * into v_plan from public.subscription_plans where code = new.plan_code;
    if found then
      new.amount_egp := v_plan.price_egp;
      new.duration_days := coalesce(nullif(v_plan.duration_days, 0), 30);
    end if;

    if auth.uid() is not null and not public.is_super_admin() then
      new.status := 'pending';
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.admin_note := null;
    end if;

    return new;
  end if;

  if auth.uid() is not null and not public.is_super_admin() then
    if new.status is distinct from old.status
      or new.reviewed_by is distinct from old.reviewed_by
      or new.reviewed_at is distinct from old.reviewed_at
      or new.admin_note is distinct from old.admin_note
      or new.plan_code is distinct from old.plan_code
      or new.tenant_id is distinct from old.tenant_id then
      raise exception 'لا يمكن تعديل حقول المراجعة أو الباقة في طلب الدفع'
        using errcode = '42501';
    end if;
  end if;

  -- Money and duration are immutable once recorded.
  new.amount_egp := old.amount_egp;
  new.duration_days := old.duration_days;
  return new;
end;
$$;

drop trigger if exists trg_guard_payment_request_fields on public.payment_requests;
create trigger trg_guard_payment_request_fields
before insert or update on public.payment_requests
for each row execute function public.guard_payment_request_fields();

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

  select * into v_plan from public.subscription_plans where code = v_req.plan_code;
  if not found then
    raise exception 'باقة الطلب لم تعد موجودة' using errcode = 'P0002';
  end if;

  -- Duration is recalculated from the plan at approval time; the value stored
  -- on the request is never trusted.
  v_days := coalesce(nullif(v_plan.duration_days, 0), 30);

  update public.payment_requests
  set status = p_decision,
      reviewed_by = v_uid,
      reviewed_at = now(),
      admin_note = nullif(trim(coalesce(p_admin_note, '')), '')
  where id = p_request_id
  returning * into v_req;

  if p_decision = 'approved' then
    update public.tenants
    set plan_code = v_plan.code,
        subscription_status = 'active',
        auto_deactivated_at = null,
        current_period_end = greatest(now(), coalesce(current_period_end, now()))
          + make_interval(days => v_days),
        updated_at = now()
    where id = v_req.tenant_id;

    insert into public.tenant_audit_logs (tenant_id, actor_id, actor_name, action, summary)
    values (
      v_req.tenant_id,
      v_uid,
      'Super-Admin',
      'billing.payment_approved',
      'تأكيد التحويل وتفعيل اشتراك المشترك (' || v_plan.name_ar || ' لمدة ' || v_days || ' يوم)'
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

revoke all on function public.admin_review_payment_request(uuid, text, text) from public, anon;
grant execute on function public.admin_review_payment_request(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. FINDING 08 — expiration sweep is a system job, not a public endpoint
-- -----------------------------------------------------------------------------
revoke all on function public.enforce_expired_subscriptions() from public, anon, authenticated;
grant execute on function public.enforce_expired_subscriptions() to service_role;

create or replace function public.admin_enforce_expired_subscriptions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super-admin access required' using errcode = '42501';
  end if;

  return public.enforce_expired_subscriptions();
end;
$$;

revoke all on function public.admin_enforce_expired_subscriptions() from public, anon;
grant execute on function public.admin_enforce_expired_subscriptions() to authenticated;

-- bootstrap_first_super_admin no longer promotes anybody implicitly, and only
-- runs the sweep for an authenticated platform admin.
create or replace function public.bootstrap_first_super_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  if public.is_super_admin() then
    perform public.enforce_expired_subscriptions();
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.bootstrap_first_super_admin() from public, anon;
grant execute on function public.bootstrap_first_super_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 9. FINDING 01 — no implicit owner promotion on signup; promotion requires a
--    verified email matching the configured owner identity
-- -----------------------------------------------------------------------------
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

  -- No platform_admins writes here: an unverified signup must never be able to
  -- claim the platform owner identity (Finding 01).
  return new;
end;
$$;

create or replace function public.promote_verified_platform_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_email text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  select lower(btrim(owner_email)) into v_owner_email
  from public.platform_settings
  where id = 1;

  if v_owner_email is null or v_owner_email = '' then
    return new;
  end if;

  if lower(coalesce(new.email, '')) <> v_owner_email then
    return new;
  end if;

  if exists (select 1 from public.platform_admins) then
    return new;
  end if;

  insert into public.platform_admins (user_id, email)
  values (new.id, v_owner_email)
  on conflict (user_id) do nothing;

  update public.platform_settings
  set bootstrap_completed_at = coalesce(bootstrap_completed_at, now()),
      updated_at = now()
  where id = 1;

  insert into public.platform_security_log (event, severity, actor_id, detail)
  values (
    'platform.owner_promoted_on_verification',
    'critical',
    new.id,
    jsonb_build_object('email', v_owner_email)
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_verified on auth.users;
create trigger on_auth_user_verified
after update of email_confirmed_at on auth.users
for each row execute function public.promote_verified_platform_owner();

-- Atomic, single-use, service_role-only owner claim. The Edge Function calls
-- this instead of ever touching auth passwords of an existing account.
create or replace function public.claim_platform_owner(p_user_id uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_email text;
begin
  perform pg_advisory_xact_lock(hashtext('mizan.platform_owner_bootstrap'));

  if exists (select 1 from public.platform_admins) then
    return false;
  end if;

  select lower(btrim(owner_email)) into v_owner_email
  from public.platform_settings
  where id = 1;

  if v_owner_email is null or v_owner_email = '' then
    return false;
  end if;

  if lower(btrim(coalesce(p_email, ''))) <> v_owner_email then
    return false;
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and lower(coalesce(u.email, '')) = v_owner_email
  ) then
    return false;
  end if;

  insert into public.platform_admins (user_id, email) values (p_user_id, v_owner_email);

  update public.platform_settings
  set bootstrap_completed_at = now(), updated_at = now()
  where id = 1;

  insert into public.platform_security_log (event, severity, actor_id, detail)
  values (
    'platform.owner_bootstrapped',
    'critical',
    p_user_id,
    jsonb_build_object('email', v_owner_email)
  );

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

revoke all on function public.claim_platform_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_platform_owner(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- 10. FINDING 13 — referential integrity for user deletion
-- -----------------------------------------------------------------------------
alter table public.tenant_invites
  drop constraint if exists tenant_invites_created_by_fkey;
alter table public.tenant_invites
  add constraint tenant_invites_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete cascade;

alter table public.tenant_records
  drop constraint if exists tenant_records_created_by_fkey;
alter table public.tenant_records
  add constraint tenant_records_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table public.tenant_records
  drop constraint if exists tenant_records_updated_by_fkey;
alter table public.tenant_records
  add constraint tenant_records_updated_by_fkey
  foreign key (updated_by) references auth.users(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 11. Explicit EXECUTE grants for the remaining helper / admin RPCs
-- -----------------------------------------------------------------------------
revoke all on function public.is_super_admin() from public, anon;
revoke all on function public.tenant_role(uuid) from public, anon;
revoke all on function public.is_tenant_member(uuid) from public, anon;
revoke all on function public.can_write_tenant(uuid) from public, anon;
revoke all on function public.is_tenant_admin(uuid) from public, anon;
revoke all on function public.has_platform_owner() from public;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.tenant_role(uuid) to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.can_write_tenant(uuid) to authenticated;
grant execute on function public.is_tenant_admin(uuid) to authenticated;
grant execute on function public.has_platform_owner() to anon, authenticated;

-- service_role must keep explicit access to the helpers it calls from Edge
-- Functions and scheduled jobs (PUBLIC execute was revoked above).
grant execute on function public.is_super_admin() to service_role;
grant execute on function public.tenant_role(uuid) to service_role;
grant execute on function public.is_tenant_member(uuid) to service_role;
grant execute on function public.can_write_tenant(uuid) to service_role;
grant execute on function public.is_tenant_admin(uuid) to service_role;
grant execute on function public.has_platform_owner() to service_role;
grant execute on function public.redeem_tenant_invite(text) to service_role;
grant execute on function public.create_tenant_workspace(text, text, text, text, text) to service_role;
grant execute on function public.soft_delete_tenant_record(uuid, text, text) to service_role;
grant execute on function public.log_tenant_audit_event(uuid, text, text, text, text) to service_role;
grant execute on function public.sync_push_tenant_records(uuid, jsonb) to service_role;
grant execute on function public.admin_review_payment_request(uuid, text, text) to service_role;
grant execute on function public.admin_list_tenants() to service_role;
grant execute on function public.admin_update_tenant_subscription(uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.activate_tenant_subscription(uuid, text) to service_role;
grant execute on function public.submit_payment_request(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_enforce_expired_subscriptions() to service_role;
grant execute on function public.bootstrap_first_super_admin() to service_role;

revoke all on function public.admin_list_tenants() from public, anon;
revoke all on function public.admin_update_tenant_subscription(uuid, text, text, integer, timestamptz) from public, anon;
revoke all on function public.activate_tenant_subscription(uuid, text) from public, anon;
revoke all on function public.submit_payment_request(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_list_tenants() to authenticated;
grant execute on function public.admin_update_tenant_subscription(uuid, text, text, integer, timestamptz) to authenticated;
grant execute on function public.activate_tenant_subscription(uuid, text) to authenticated;
grant execute on function public.submit_payment_request(uuid, text, text, text, text, text, text) to authenticated;

-- anon parity: several RLS policies are declared `to public`, so the anon role
-- evaluates these predicates. Revoking EXECUTE from anon converts an empty result
-- set into a hard 42501 error during pre-auth page loads. Grant it back
-- explicitly (for anon every predicate resolves to false) while PUBLIC stays
-- revoked.
grant execute on function public.is_super_admin() to anon;
grant execute on function public.tenant_role(uuid) to anon;
grant execute on function public.is_tenant_member(uuid) to anon;
grant execute on function public.can_write_tenant(uuid) to anon;
grant execute on function public.is_tenant_admin(uuid) to anon;
