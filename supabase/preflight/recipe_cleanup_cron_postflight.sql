-- Read-only operational checks AFTER the separately approved cron gate.
-- Returns booleans/status labels, never Vault values or request headers.
-- Edge/Vault token equality is separately verified by the protected gate client.
with checks(check_id,passed,detail) as (
 values
 ('01_enabled_unique', (select count(*)=1 and bool_and(active) from cron.job where jobname='recipe-import-cleanup'), 'exactly one active Recipe cleanup job'),
 ('02_schedule', (select count(*)=1 and bool_and(schedule='*/15 * * * *') from cron.job where jobname='recipe-import-cleanup'), '15-minute contract'),
 ('03_dispatch_command', (select count(*)=1 and bool_and(command='select private.dispatch_recipe_import_cleanup();' and username='postgres' and database='postgres') from cron.job where jobname='recipe-import-cleanup'), 'reviewed private dispatcher as postgres'),
 ('04_vault_endpoint', (select count(*)=1 and bool_and(decrypted_secret='https://kagvxhyvxxypspdxcuxz.supabase.co/functions/v1/cleanup-recipe-imports') from vault.decrypted_secrets where name='recipe_import_cleanup_url'), 'production endpoint equality only'),
 ('05_vault_token_use', (select count(*)=1 and bool_and(nullif(btrim(decrypted_secret),'') is not null) from vault.decrypted_secrets where name='recipe_import_cleanup_token') and exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='dispatch_recipe_import_cleanup' and p.prosrc like '%recipe_import_cleanup_token%' and p.prosrc like '%''Bearer ''||v_token%' and p.prosrc like '%net.http_post%'), 'unique token and reviewed Vault-backed Authorization; Edge equality checked separately'),
 ('06_cleanup_observability', (select count(*)=3 from information_schema.columns where table_schema='public' and table_name='recipe_import_jobs' and column_name in ('cleanup_pending','expires_at','raw_deleted_at')), 'pending/overdue/ack columns present'),
 ('07_cron_execution_observability', coalesce(current_setting('cron.log_run',true),'')='on' and to_regclass('cron.job_run_details') is not null, 'cron execution records enabled'),
 ('08_http_observability', to_regclass('net._http_response') is not null and to_regclass('net.http_request_queue') is not null, 'pg_net HTTP result and pending queue available')
)
select check_id,case when passed then 'PASS' else 'FAIL' end as status,detail from checks order by check_id;
