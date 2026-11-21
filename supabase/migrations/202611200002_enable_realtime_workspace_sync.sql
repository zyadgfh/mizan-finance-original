-- Phase 3: Enable Supabase Realtime CDC on tenant_records and tenants
-- Protected by existing Row-Level Security (is_tenant_member).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tenant_records'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_records;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tenants'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tenants;
    END IF;
  END IF;
END
$$;
