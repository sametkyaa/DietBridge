-- Prepared only. Requires separately authorized deployment before execution.
-- Reuse invite_recipe_preflight.sql for columns/constraints/indexes/RLS/ACLs.
begin transaction read only;
select version from supabase_migrations.schema_migrations
where version in ('20261005120859','20261005124951','20261005132107') order by version;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='recipe-imports';
select public.recipe_import_limits() as limits; -- Pure configuration RPC, no writes.
select jobname,schedule,active from cron.job where jobname in ('recipe-import-cleanup','cleanup-invite-code-attempts');
-- Operational aggregate only; no raw files/content/tokens/codes.
select status,count(*) as jobs,count(*) filter(where cleanup_pending) as awaiting_cleanup,
 count(*) filter(where cleanup_pending and expires_at<now()) as overdue_cleanup,
 max(extract(epoch from now()-created_at)) filter(where cleanup_pending) as oldest_pending_seconds
from public.recipe_import_jobs group by status order by status;
-- Inspect HTTP success/failures and Vault-secret presence in operator tooling;
-- do not export bearer headers or decrypted secret values.
rollback;
