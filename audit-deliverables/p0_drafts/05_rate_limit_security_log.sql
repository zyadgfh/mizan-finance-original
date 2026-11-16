-- DRAFT — NOT APPLIED.
-- Source: repo §1 (lines 37-133) with ONE CORRECTION.
-- DEFECT IN SOURCE: hash_bucket() is language sql, search_path=public, calling
-- digest() unqualified — but pgcrypto lives in the `extensions` schema here
-- (verified), so the statement fails at CREATE time and aborts the migration.
-- This is why the hardening never reached production (finding F-25).
-- Fix applied: extensions.digest(...).
-- Creates: platform_security_log, rate_limit_events, hash_bucket, check_rate_limit (F-03).
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


-- verify: select public.check_rate_limit('probe','probe',1,60); -- true
--         select public.check_rate_limit('probe','probe',1,60); -- false
