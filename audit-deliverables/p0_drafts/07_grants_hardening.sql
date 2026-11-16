-- DRAFT — NOT APPLIED.
-- Removes surplus privileges (F-05/F-28/F-11). Apply AFTER 02 and 08 so failures
-- are attributable. Re-verify the client's direct table writes before applying:
--   grep -rho 'from("[a-z_]*")' --include=*.ts --include=*.tsx src | sort | uniq -c
-- Live state: anon+authenticated hold DELETE,INSERT,REFERENCES,SELECT,TRIGGER,
-- TRUNCATE,UPDATE on all 10 tables, plus column UPDATE on profiles and tenants.

begin;

-- 1. Dangerous residuals first
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- 2. Sequences (the revision default/trigger runs as the definer owner)
revoke all on all sequences in schema public from anon, authenticated, public;
grant usage, select on sequence public.tenant_records_revision_seq to authenticated;

-- 3. Tables clients must not write directly
revoke insert, update, delete on public.platform_admins       from anon, authenticated;
revoke insert, update, delete on public.platform_billing_info from anon, authenticated;
revoke insert, update, delete on public.subscription_plans    from anon, authenticated;
revoke insert, update, delete on public.payment_requests      from anon, authenticated;
grant  select on public.subscription_plans    to anon, authenticated;
grant  select on public.platform_billing_info to anon, authenticated;  -- F-06 is a separate product decision
grant  select, update on public.payment_requests to authenticated;

-- 4. Identity columns are no longer client-writable
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, phone, contact_display, updated_at)
  on public.profiles to authenticated;

-- 5. Subscription/billing columns move behind RPCs (trigger guard stays as belt-and-braces)
revoke update on public.tenants from anon, authenticated;
grant update (name, slug, kind, base_currency, opening_balance, exchange_rates,
              phone_country_code, goals_hidden, updated_at, deleted_at)
  on public.tenants to authenticated;

-- 6. No hard delete on records (also enforced in 02)
revoke delete on public.tenant_records from anon, authenticated;

-- 7. Audit rows server-authored only (also enforced in 08)
revoke insert, update, delete on public.tenant_audit_logs from anon, authenticated;
grant select on public.tenant_audit_logs to authenticated;

-- 8. Functions: default-deny, then allowlist.
--    Policy helpers keep EXECUTE for anon because RLS expressions are evaluated
--    with the INVOKING role's privileges — revoking them turns clean denials into
--    "permission denied for function" errors.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_super_admin()       to anon, authenticated;
grant execute on function public.is_tenant_member(uuid) to anon, authenticated;
grant execute on function public.is_tenant_admin(uuid)  to anon, authenticated;
grant execute on function public.can_write_tenant(uuid) to anon, authenticated;
grant execute on function public.tenant_role(uuid)      to anon, authenticated;
grant execute on function public.has_platform_owner()   to anon, authenticated;

grant execute on function public.bootstrap_first_super_admin()                                   to authenticated;
grant execute on function public.create_tenant_workspace(text, text, text, text, text)           to authenticated;
grant execute on function public.redeem_tenant_invite(text)                                      to authenticated;
grant execute on function public.submit_payment_request(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.sync_push_tenant_records(uuid, jsonb)                           to authenticated;
grant execute on function public.soft_delete_tenant_record(uuid, text, text)                     to authenticated;
grant execute on function public.log_tenant_audit_event(uuid, text, text, text, text)            to authenticated;
grant execute on function public.admin_enforce_expired_subscriptions()                           to authenticated;
grant execute on function public.admin_list_tenants()                                            to authenticated;
grant execute on function public.admin_review_payment_request(uuid, text, text)                   to authenticated;
grant execute on function public.admin_update_tenant_subscription(uuid, text, text, integer, timestamptz) to authenticated;
grant execute on function public.activate_tenant_subscription(uuid, text)                         to authenticated;

revoke all on function public.enforce_expired_subscriptions()                 from anon, authenticated;
revoke all on function public.purge_expired_tenant_records(integer)           from anon, authenticated;
revoke all on function public.claim_platform_owner(uuid, text)                from anon, authenticated;
revoke all on function public.check_rate_limit(text, text, integer, integer)  from anon, authenticated;
revoke all on function public.hash_bucket(text)                               from anon, authenticated;
grant execute on function public.enforce_expired_subscriptions()              to service_role;
grant execute on function public.purge_expired_tenant_records(integer)        to service_role;
grant execute on function public.claim_platform_owner(uuid, text)             to service_role;
grant execute on function public.check_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.hash_bucket(text)                            to service_role;

notify pgrst, 'reload schema';
commit;

-- verify with 09_verification V10-V12
