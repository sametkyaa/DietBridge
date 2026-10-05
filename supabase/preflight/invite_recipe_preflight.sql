-- Prepared only. Read-only catalog inspection; no customer rows or secret values.
-- First verify project identity in the dashboard/CLI: kagvxhyvxxypspdxcuxz.
begin transaction read only;
select current_database(), current_user, version();
select version from supabase_migrations.schema_migrations order by version;
-- Compare the complete history with approved canonical history, not just count.
-- Audit observed 58 remote entries through 20260901200413; repo had 59.
-- Existing deferred push migration must not be silently applied/repaired.
select v.version, exists(select 1 from supabase_migrations.schema_migrations m where m.version=v.version) as applied
from (values ('20261005120859'),('20261005124951'),('20261005132107')) v(version);
select table_schema,table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in ('profiles','dietitian_profiles','dietitian_clients','recipes','dietitian_subscriptions','subscription_plans','dietitian_invite_codes','recipe_import_jobs','recipe_import_items')
order by table_name,ordinal_position;
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','private') and c.relname in ('dietitian_clients','recipes','dietitian_invite_codes','invite_code_attempts','recipe_import_jobs','recipe_import_items');
select conrelid::regclass as relation,conname,contype,pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in (to_regclass('public.dietitian_clients'),to_regclass('public.recipes'),to_regclass('public.recipe_import_jobs'),to_regclass('public.recipe_import_items')) order by 1,2;
select schemaname,tablename,indexname,indexdef from pg_indexes
where schemaname in ('public','private') and tablename in ('dietitian_clients','recipes','dietitian_invite_codes','invite_code_attempts','recipe_import_jobs','recipe_import_items') order by 1,2,3;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies
where (schemaname='public' and tablename in ('dietitian_clients','recipes','dietitian_invite_codes','recipe_import_jobs','recipe_import_items')) or (schemaname='storage' and tablename='objects') order by 1,2,3;
select t.tgrelid::regclass as relation,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t where not t.tgisinternal and t.tgrelid in (to_regclass('public.dietitian_clients'),to_regclass('public.recipes')) order by 1,2;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'execute') as anon_execute,
 has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','private') and (p.proname in ('request_client_connection_by_email','dietitian_effective_client_limit','enforce_dietitian_client_capacity','notify_dietitian_client_change','guard_relationship_identity','get_my_invite_code','rotate_my_invite_code','set_my_invite_code_open','preview_dietitian_invite_code','redeem_dietitian_invite_code','leave_my_dietitian') or p.proname like '%recipe_import%') order by 1,2,3;
select typname,enumlabel,enumsortorder from pg_enum join pg_type on pg_type.oid=enumtypid where typname in ('client_status','user_role') order by 1,3;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('avatars','recipe-images','recipe-imports') order by id;
select extname,extversion from pg_extension where extname in ('pgcrypto','pg_cron','pg_net','supabase_vault');
select jobname,schedule,active from cron.job where jobname in ('recipe-import-cleanup','cleanup-invite-code-attempts');
-- Do not call get_my_invite_code/preview/redeem/begin/cleanup here: they write.
-- Do not SELECT vault.decrypted_secrets, auth.users, Storage object paths or recipe bodies.
rollback;
