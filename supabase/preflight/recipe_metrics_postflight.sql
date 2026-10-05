-- P2 METRICS only: exact reviewed combined schema before/after 20261005132107 receipt.
-- Run only after core schema + exact core history PASS. No Edge/secrets/Vault/cron/fixtures/flags.
-- Catalog-only READ ONLY; no customer rows, decrypted secrets or RPC invocation.
begin transaction read only;
with baseline(version) as (values
  ('20260713000000'),('20260713000001'),('20260713010000'),('20260713010100'),('20260713010200'),
  ('20260713010300'),('20260713010400'),('20260713010500'),('20260714010000'),('20260722131259'),
  ('20260723093230'),('20260723093510'),('20260723164416'),('20260723180039'),('20260724063211'),
  ('20260724071352'),('20260725125627'),('20260725133956'),('20260726090000'),('20260726090100'),
  ('20260726090200'),('20260726090300'),('20260727091215'),('20260727094415'),('20260727131340'),
  ('20260728103000'),('20260728160000'),('20260729090000'),('20260729090100'),('20260729090200'),
  ('20260729090300'),('20260729090400'),('20260730180636'),('20260730180641'),('20260801090000'),
  ('20260802090000'),('20260807115919'),('20260810055845'),('20260810074910'),('20260811103909'),
  ('20260812090000'),('20260813120000'),('20260814120000'),('20260814130000'),('20260814214101'),
  ('20260816101405'),('20260817084531'),('20260826133224'),('20260827084741'),('20260830060342'),
  ('20260830141202'),('20260830185101'),('20260831071948'),('20260831190352'),('20260901083212'),
  ('20260901165402'),('20260901193000'),('20260901200413'),('20261005120859'),('20261005124951')
), remote as (select version from supabase_migrations.schema_migrations),
expected_bodies(signature,body_md5) as (values
 ('public.recipe_import_limits()','28023fc198c8196c5b4e2221999d1c32'),
 ('private.require_recipe_import_actor()','437bace462f3dd8243483cbc05218325'),
 ('public.begin_recipe_import(uuid,text,text,integer)','99603a9abe9702c85cdfd4543a2d3e16'),
 ('public.claim_recipe_import(uuid,uuid)','32c128420da8cd81f423a0e352cf030f'),
 ('public.finish_recipe_import(uuid,uuid,jsonb,text,jsonb)','c52d276ef157d6737168aa961c12f9cf'),
 ('public.save_recipe_import(uuid,jsonb)','5d874ae8f03d39d54a64e419763c1d76'),
 ('public.cancel_recipe_import(uuid)','b7d8f09b0a01835efb8f7807738e60f5'),
 ('public.recipe_import_cleanup_candidates()','b65626b3af4899ec847b34c5ead0644c'),
 ('public.ack_recipe_import_cleanup(uuid)','ae167227eea36d3f0587b95bec4360e9'),
 ('private.dispatch_recipe_import_cleanup()','261c31bb49d7c8531a36cf45f90517de')
), tables(oid) as (values(to_regclass('public.recipe_import_jobs')),(to_regclass('public.recipe_import_items'))),
user_rpc(signature) as (values('public.begin_recipe_import(uuid,text,text,integer)'),('public.save_recipe_import(uuid,jsonb)'),('public.cancel_recipe_import(uuid)')),
service_rpc(signature) as (values('public.claim_recipe_import(uuid,uuid)'),('public.finish_recipe_import(uuid,uuid,jsonb,text,jsonb)'),('public.recipe_import_cleanup_candidates()'),('public.ack_recipe_import_cleanup(uuid)')),
expected_columns(table_name,column_name,type_name,required) as (values
 ('recipe_import_jobs','id','uuid',true),
 ('recipe_import_jobs','dietitian_id','uuid',true),
 ('recipe_import_jobs','request_id','uuid',true),
 ('recipe_import_jobs','status','text',true),
 ('recipe_import_jobs','source_file_name','text',true),
 ('recipe_import_jobs','source_mime_type','text',true),
 ('recipe_import_jobs','source_storage_path','text',true),
 ('recipe_import_jobs','file_size','integer',true),
 ('recipe_import_jobs','created_at','timestamp with time zone',true),
 ('recipe_import_jobs','completed_at','timestamp with time zone',false),
 ('recipe_import_jobs','expires_at','timestamp with time zone',true),
 ('recipe_import_jobs','error_code','text',false),
 ('recipe_import_jobs','ai_model','text',false),
 ('recipe_import_jobs','ai_input_tokens','integer',false),
 ('recipe_import_jobs','ai_output_tokens','integer',false),
 ('recipe_import_jobs','cleanup_pending','boolean',true),
 ('recipe_import_jobs','raw_deleted_at','timestamp with time zone',false),
 ('recipe_import_jobs','saved_recipe_ids','uuid[]',false),
 ('recipe_import_jobs','save_selection_hash','text',false),
 ('recipe_import_jobs','ai_attempt_count','integer',false),
 ('recipe_import_jobs','ai_duration_ms','integer',false),
 ('recipe_import_items','id','uuid',true),
 ('recipe_import_items','import_job_id','uuid',true),
 ('recipe_import_items','dietitian_id','uuid',true),
 ('recipe_import_items','recipe_draft','jsonb',true),
 ('recipe_import_items','source_reference','jsonb',true),
 ('recipe_import_items','validation_state','text',true),
 ('recipe_import_items','warnings','jsonb',true),
 ('recipe_import_items','saved_recipe_id','uuid',false),
 ('recipe_import_items','created_at','timestamp with time zone',true)
), checks(check_id,ok,detail) as (
 select '01_read_only',current_setting('transaction_read_only')='on','catalog only'
 union all select '02_history_boundary',
 (select count(*) from remote) in(60,61)
 and not exists(select 1 from baseline b where b.version not in(select version from remote))
 and not exists(select 1 from remote r where r.version<>'20261005132107' and r.version not in(select version from baseline)),
 'exact60 baseline plus optional metrics receipt; no push alias'
 union all select '03_push_no_action',
 not exists(select 1 from remote where version='20260817120000')
 and to_regclass('private.push_installations') is null and to_regclass('private.push_deliveries') is null,
 'excluded push history/objects remain absent'
 union all select '04_tables_rls',
 (select count(*) from pg_class where oid in(select oid from tables) and relrowsecurity)=2,
 'jobs/items exist and RLS enabled'
 union all select '05_core_columns',
 (select count(*) from information_schema.columns where table_schema='public' and table_name='recipe_import_jobs')=21
 and (select count(*) from information_schema.columns where table_schema='public' and table_name='recipe_import_items')=9
 and (select count(*) from information_schema.columns where table_schema='public' and table_name='recipe_import_jobs' and column_name in('ai_attempt_count','ai_duration_ms') and data_type='integer')=2
 and not exists(select 1 from expected_columns e left join pg_attribute a on a.attrelid=to_regclass('public.'||e.table_name) and a.attname=e.column_name and a.attnum>0 and not a.attisdropped where a.attname is null or format_type(a.atttypid,a.atttypmod)<>e.type_name or a.attnotnull<>e.required),
 '21 job and9 item columns; exact types/nullability; metrics present'
 union all select '06_constraints',
 (select count(*) from pg_constraint where conrelid in(select oid from tables) and convalidated)=21
 and (select count(*) from pg_constraint where conrelid in(select oid from tables) and contype='f' and confdeltype='c')=2
 and exists(select 1 from pg_constraint where conrelid=to_regclass('public.recipe_import_items') and contype='f' and confrelid='public.recipes'::regclass and confdeltype='n')
 and (select count(*) from pg_constraint where conrelid=to_regclass('public.recipe_import_jobs') and contype='u')=3,
 '21 validated constraints; cascading owner/composite FK; saved recipe SET NULL;3 unique keys'
 union all select '07_indexes',
 (select count(*) from pg_index where indexrelid in(to_regclass('public.recipe_import_jobs_owner_time'),to_regclass('public.recipe_import_jobs_cleanup'),to_regclass('public.recipe_import_items_job')) and indisvalid)=3,
 'owner/time, cleanup, item/job indexes'
 union all select '08_table_grants',
 (select bool_and(oid is not null and has_table_privilege('authenticated',oid,'SELECT') and not has_table_privilege('authenticated',oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and not has_table_privilege('anon',oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') and has_table_privilege('service_role',oid,'SELECT,INSERT,UPDATE,DELETE')) from tables),
 'browser SELECT only; anonymous denied; service CRUD'
 union all select '09_owner_policies',
 (select count(*) from pg_policies where schemaname='public' and tablename in('recipe_import_jobs','recipe_import_items'))=2
 and (select count(*) from pg_policies where schemaname='public' and (tablename,policyname) in(('recipe_import_jobs','recipe_import_jobs_read_own'),('recipe_import_items','recipe_import_items_read_own')) and cmd='SELECT' and roles=array['authenticated']::name[] and qual like '%dietitian_id%auth.uid()%' and qual like '%is_current_user_dietitian()%' and qual like '%approved%' and qual like '%is_verified%')=2,
 'exact2 authenticated approved-owner read policies'
 union all select '10_user_rpc_grants',
 (select bool_and(coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) and not coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true)) from user_rpc),
 'begin/save/cancel authenticated only'
 union all select '11_service_rpc_grants',
 (select bool_and(coalesce(has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE'),false) and not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),true) and not coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true)) from service_rpc),
 'worker and cleanup RPCs service_role only'
 union all select '12_function_bodies',
 (select count(*) from expected_bodies e join pg_proc p on p.oid=to_regprocedure(e.signature) where md5(replace(p.prosrc,E'\r\n',E'\n'))=e.body_md5)=10,
 '10 exact reviewed combined function bodies (line endings normalized)'
 union all select '13_definer_owner_path',
 (select count(*) from expected_bodies e join pg_proc p on p.oid=to_regprocedure(e.signature) join pg_roles r on r.oid=p.proowner where r.rolname='postgres' and (case when e.signature='public.recipe_import_limits()' then not p.prosecdef and p.proconfig @> array['search_path=pg_catalog'] else p.prosecdef and p.proconfig @> array['search_path=pg_catalog, public'] end))=10,
 'postgres owner, pinned search_path and intended definer status'
 union all select '14_private_closed',
 not has_schema_privilege('anon','private','USAGE') and not has_schema_privilege('authenticated','private','USAGE')
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('private.require_recipe_import_actor()'),'EXECUTE'),true)
 and not coalesce(has_function_privilege('anon',to_regprocedure('private.require_recipe_import_actor()'),'EXECUTE'),true)
 and not coalesce(has_function_privilege('authenticated',to_regprocedure('private.dispatch_recipe_import_cleanup()'),'EXECUTE'),true)
 and not coalesce(has_function_privilege('anon',to_regprocedure('private.dispatch_recipe_import_cleanup()'),'EXECUTE'),true),
 'private actor/dispatcher closed to browser roles'
 union all select '15_private_bucket',
 exists(select 1 from storage.buckets where id='recipe-imports' and name='recipe-imports' and not public and file_size_limit=5242880 and allowed_mime_types @> array['text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'] and cardinality(allowed_mime_types)=8),
 'private5 MiB bucket; exact8 supported MIME types'
 union all select '16_storage_policies',
 (select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in('recipe_import_upload_own','recipe_import_read_own') and roles=array['authenticated']::name[] and ((policyname='recipe_import_upload_own' and cmd='INSERT' and with_check like '%recipe-imports%' and with_check like '%auth.uid()%' and with_check like '%uploaded%' and with_check like '%expires_at%') or (policyname='recipe_import_read_own' and cmd='SELECT' and qual like '%recipe-imports%' and qual like '%auth.uid()%' and qual like '%expires_at%')))=2,
 'owned intent/path/expiry upload and read policies; no feature overwrite/delete policy'
 union all select '17_cron_not_enabled',
 not exists(select 1 from cron.job where jobname='recipe-import-cleanup'),
 'core does not enable cron; separate cleanup gate later'
 union all select '18_canonical_recipe_preserved',
 (select relrowsecurity from pg_class where oid='public.recipes'::regclass)
 and (select count(*) from pg_policies where schemaname='public' and tablename='recipes' and policyname in('recipes_select_own','recipes_insert_own','recipes_update_own','recipes_delete_own'))=4
 and (select count(*) from pg_constraint where conrelid='public.recipes'::regclass and conname in('recipes_calories_range_check','recipes_carbs_range_check','recipes_fat_range_check','recipes_protein_range_check','recipes_description_length_check','recipes_meal_type_check','recipes_name_length_check','recipes_name_not_blank_check','recipes_dietitian_id_fkey','recipes_pkey'))=10,
 'manual recipe model, constraints and owner policies remain'
 union all select '19_legacy_and_invite_preserved',
 to_regprocedure('public.request_client_connection_by_email(text)') is not null
 and to_regprocedure('public.redeem_dietitian_invite_code(text)') is not null
 and to_regclass('public.dietitian_invite_codes') is not null
 and exists(select 1 from cron.job where jobname='cleanup-invite-code-attempts' and active and schedule='17 * * * *'),
 'legacy email + live invite backend and attempt cron retained'
 union all select '21_metrics_bounds',
 (select count(*) from pg_constraint where conrelid='public.recipe_import_jobs'::regclass and contype='c' and convalidated and ((conname='recipe_import_jobs_ai_attempt_count_check' and pg_get_constraintdef(oid) like '%ai_attempt_count >= 0%' and pg_get_constraintdef(oid) like '%ai_attempt_count <= 4%') or (conname='recipe_import_jobs_ai_duration_ms_check' and pg_get_constraintdef(oid) like '%ai_duration_ms >= 0%')))=2,
 'attempt count0..4 and nonnegative duration validated CHECKs'
)
select check_id,case when coalesce(ok,false) then 'PASS' else 'FAIL' end as status,detail from checks
union all select '20_metrics_history_receipt',case when exists(select 1 from remote where version='20261005132107') then 'PASS' else 'PASS_WITH_HISTORY_PENDING' end,
 'repair only20261005132107 after successful SQL and every20 schema/boundary check PASS; rerun receipt'
order by check_id;
rollback;
