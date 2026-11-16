-- =============================================================================
-- p0_11 — database-level throttling for client-reachable RPC paths
--
-- Why this exists
--   The Edge Function throttles signup and renewal (10/h per IP, 3/h per
--   identity, 6/h per user) through check_rate_limit. But the RPCs below are
--   also callable *directly* by an authenticated client over PostgREST, which
--   bypasses that layer entirely:
--     * submit_payment_request -> unbounded payment_requests rows + proof files
--     * create_tenant_workspace -> unbounded tenants (the 5-workspace quota only
--       counts live rows, so delete-then-create loops around it)
--
--   Rather than re-typing two long function bodies (and risking a transcription
--   error in money/audit logic), the limit is enforced by a BEFORE INSERT trigger
--   driven by tg_argv. Existing function bodies are untouched.
--
-- Behaviour
--   * auth.uid() is null (service_role, edge functions, admin tooling, migrations)
--     -> never throttled. The owner's own signup flow keeps working.
--   * a real end user -> fixed-window counter in rate_limit_events.
--   * Fail-closed by design: if the counter is unavailable the insert is refused
--     rather than silently allowed (check_rate_limit returns false on bad input,
--     and raises propagate).
-- =============================================================================

create or replace function public.limit_user_row_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_scope text;
  v_limit integer;
  v_window integer;
begin
  -- System writes (service_role / scheduled work / migrations) are never throttled.
  if v_uid is null then
    return new;
  end if;

  v_scope := coalesce(nullif(tg_argv[0], ''), 'row_insert');
  v_limit := coalesce(nullif(tg_argv[1], '')::integer, 10);
  v_window := coalesce(nullif(tg_argv[2], '')::integer, 3600);

  if not public.check_rate_limit(v_scope, v_uid::text, v_limit, v_window) then
    raise exception 'عدد المحاولات كبير جداً، يرجى المحاولة لاحقاً'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

revoke all on function public.limit_user_row_insert() from public, anon, authenticated;

-- 5 payment requests per user per hour. A real user submits at most a couple.
drop trigger if exists trg_limit_payment_request_rate on public.payment_requests;
create trigger trg_limit_payment_request_rate
before insert on public.payment_requests
for each row execute function public.limit_user_row_insert('payment_request_submit', '5', '3600');

-- 3 new workspaces per user per hour. First workspace is unaffected.
drop trigger if exists trg_limit_tenant_create_rate on public.tenants;
create trigger trg_limit_tenant_create_rate
before insert on public.tenants
for each row execute function public.limit_user_row_insert('tenant_create', '3', '3600');
