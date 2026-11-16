-- DRAFT — NOT APPLIED.
-- Removes the hardcoded personal mailbox as the platform-owner trust anchor
-- (F-04/F-27) and restores a working, verified bootstrap path.
--
-- Live problems addressed:
--   * bootstrap_first_super_admin() promotes 'zyadgamal796@gmail.com' and is
--     called on EVERY app load (src/lib/tenant/api.ts:405-415); it also runs the
--     global expiry sweep inside that user-facing read path.
--   * handle_new_auth_user() promotes the same address on signup.
--   * setup_owner needs platform_settings + claim_platform_owner; neither exists.
--
-- Design: no email compiled into any function; platform_settings is seeded EMPTY
-- and set deliberately by the operator (a data write, requiring its own approval);
-- claim requires no existing admin, exact email match, a VERIFIED email, and an
-- advisory lock. The sweep call is kept for now to avoid silently disabling
-- subscription expiry (moving it to a scheduler is P1-13; note: pg_cron is NOT
-- installed here — use Supabase scheduled functions or an external scheduler).

create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  owner_email text not null default '',
  bootstrap_completed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id, owner_email) values (1, '') on conflict (id) do nothing;
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated, public;
grant select on public.platform_settings to service_role;
drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings
  for select to authenticated using (public.is_super_admin());

-- 1. No implicit promotion.
create or replace function public.bootstrap_first_super_admin()
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  perform public.enforce_expired_subscriptions();
  if v_uid is null then return false; end if;
  return public.is_super_admin();
end;
$$;
revoke all on function public.bootstrap_first_super_admin() from public, anon, authenticated;
grant execute on function public.bootstrap_first_super_admin() to authenticated;

-- 2. Signup trigger: profile seeding only (live definition minus promotion).
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_email text; v_phone text; v_contact text;
begin
  v_email := lower(coalesce(new.email, ''));
  v_phone := nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');
  v_contact := coalesce(nullif(trim(coalesce(new.raw_user_meta_data ->> 'contact_display', '')), ''), v_phone, v_email);
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    v_phone, nullif(split_part(v_email, '@', 1), ''), 'مشترك ميزان');

  insert into public.profiles (id, email, phone, contact_display, display_name, avatar_url)
  values (new.id, v_email, v_phone, v_contact, v_name, new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do update
    set email = excluded.email,
        phone = coalesce(excluded.phone, public.profiles.phone),
        contact_display = coalesce(nullif(excluded.contact_display, ''), public.profiles.contact_display),
        display_name = coalesce(nullif(public.profiles.display_name, ''), excluded.display_name),
        updated_at = now();
  -- no platform_admins insert here: promotion must be explicit
  return new;
end;
$$;

-- 3. Explicit, verified, one-time claim (called by the edge function as service_role).
create or replace function public.claim_platform_owner(p_user_id uuid, p_email text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner_email text; v_confirmed timestamptz;
begin
  if p_user_id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('mizan.platform_owner_bootstrap'));
  if exists (select 1 from public.platform_admins) then return false; end if;

  select lower(btrim(coalesce(owner_email, ''))) into v_owner_email
  from public.platform_settings where id = 1;
  if v_owner_email is null or v_owner_email = '' then return false; end if;
  if lower(btrim(coalesce(p_email, ''))) <> v_owner_email then return false; end if;

  select email_confirmed_at into v_confirmed from auth.users where id = p_user_id;
  if v_confirmed is null then return false; end if;  -- mailbox ownership must be proven

  insert into public.platform_admins (user_id, email)
  values (p_user_id, v_owner_email) on conflict (user_id) do nothing;
  update public.platform_settings set bootstrap_completed_at = now(), updated_at = now() where id = 1;
  return true;
end;
$$;
revoke all on function public.claim_platform_owner(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_platform_owner(uuid, text) to service_role;

-- 4. OPERATOR ACTION (separate approval — writes a row):
--   update public.platform_settings
--      set owner_email = lower('<OWNER_EMAIL>'), updated_at = now() where id = 1;
-- Then complete setup_owner once from the app; verify with 09_verification V9.
-- The existing platform_admins row stays valid, so the current owner is not locked out.
