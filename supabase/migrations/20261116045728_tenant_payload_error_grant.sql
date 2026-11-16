-- tenant_payload_error is a pure, table-free validator called by
-- `sync_push_tenant_records`, which is SECURITY INVOKER: it therefore runs with
-- the caller's privileges. Revoking PUBLIC made every push fail with
-- "permission denied for function tenant_payload_error" (42501) instead of
-- returning a validation result, so the helper must stay executable by public.
grant execute on function public.tenant_payload_error(text, jsonb) to public;
