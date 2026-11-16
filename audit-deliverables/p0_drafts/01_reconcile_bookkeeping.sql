-- DRAFT — NOT APPLIED. Metadata only; changes no business data or existing object.
-- Adopts the LIVE migration lineage as baseline (F-02/F-26).
-- Five live versions have no file in `main`: fix_enforce_expired_audit_columns,
-- tenant_payload_validation, tenant_payload_error_grant,
-- tenant_payload_rules_refined, tenant_record_id_integrity.

create table if not exists public._mizan_schema_migrations (
  version    text primary key,
  name       text not null,
  checksum   text not null,
  source     text not null default 'adopted_from_live',
  applied_at timestamptz not null default now(),
  note       text
);

alter table public._mizan_schema_migrations enable row level security;
revoke all on public._mizan_schema_migrations from anon, authenticated, public;
grant select on public._mizan_schema_migrations to service_role;

insert into public._mizan_schema_migrations (version, name, checksum, note) values
  ('20261115141539','mizan_multitenant','adopted:live','repo 202611150001 in intent, not byte-identical'),
  ('20261115150151','owner_only_storage_payments','adopted:live','repo 202611150002 in intent'),
  ('20261115160905','subscriptions_autodeactivate_signup_proofs','adopted:live','repo seeds different plan prices (29/75/135/240 vs live 49/99/135/399)'),
  ('20261115162811','auto_expire_trigger_bypass','adopted:live','repo 202611150004 intent'),
  ('20261115172425','fix_enforce_expired_audit_columns','adopted:live','NO repo file'),
  ('20261116045649','tenant_payload_validation','adopted:live','NO repo file'),
  ('20261116045728','tenant_payload_error_grant','adopted:live','NO repo file'),
  ('20261116050147','tenant_payload_rules_refined','adopted:live','NO repo file'),
  ('20261116051240','tenant_record_id_integrity','adopted:live','NO repo file (entityId/payload id integrity)')
on conflict (version) do nothing;

-- FOLLOW-UP (separate, requires approval): generate the rebuildable baseline so a
-- fresh environment matches production, then commit it to the repo:
--   pg_dump --schema-only --schema=public --no-owner --no-privileges \
--     "$SUPABASE_DB_URL" > supabase/migrations/0001_baseline_live.sql
-- Until that file exists and a fresh rebuild produces an empty diff,
-- F-02 stays OPEN regardless of what the repository claims.
