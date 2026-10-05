-- Recipe core production preflight after Invite DB/Edge PASS.
-- Mobile signing/link/cutover readiness is intentionally independent.
-- Read-only catalog + bucket metadata; no customer rows or RPC invocation.
begin transaction read only;
with expected_remote(version) as (values
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
  ('20260901165402'),('20260901193000'),('20260901200413'),('20261005120859')
),remote as (select version from supabase_migrations.schema_migrations),
checks(check_id,area,ok,blocked,detail) as (
 select '01_read_only','safety',current_setting('transaction_read_only')='on',false,'catalog only'
 union all select '02_history_exact_59','history',
 (select count(*) from remote)=59
 and not exists(select 1 from expected_remote e where e.version not in(select version from remote))
 and not exists(select 1 from remote r where r.version not in(select version from expected_remote)),false,'58 baseline plus applied invite; recipe core/metrics not yet applied'
 union all select '03_push_no_action','history',
 not exists(select 1 from remote where version='20260817120000')
 and to_regclass('private.push_installations') is null and to_regclass('private.push_deliveries') is null
 and to_regprocedure('public.register_push_installation(uuid,text,text,uuid,text,text)') is null,false,'excluded push stays absent'
 union all select '04_core_objects_absent','recipe',
 to_regclass('public.recipe_import_jobs') is null and to_regclass('public.recipe_import_items') is null
 and to_regprocedure('public.recipe_import_limits()') is null
 and to_regprocedure('public.begin_recipe_import(uuid,text,text,integer)') is null
 and to_regprocedure('private.dispatch_recipe_import_cleanup()') is null,false,'no partial recipe rollout'
 union all select '05_approved_dietitian_prerequisite','recipe',
 to_regprocedure('public.is_current_user_dietitian()') is not null
 and exists(select 1 from pg_trigger where tgrelid='public.dietitian_profiles'::regclass and tgname='trg_sync_dietitian_verification_fields' and tgenabled='O')
 and not has_schema_privilege('anon','private','USAGE') and not has_schema_privilege('authenticated','private','USAGE'),false,'existing approved-role guard and private schema closed'
 union all
  select '20_recipe_columns','recipe',
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'recipes'
            and column_name in ('id','dietitian_id','name','description','meal_type','calories','protein','carbs','fat','image_path','created_at','updated_at')) = 12,
         false, 'canonical recipe columns'
  union all
  select '21_recipe_constraints','recipe',
         (select count(*) from pg_constraint where conrelid = 'public.recipes'::regclass and conname in (
            'recipes_calories_range_check','recipes_carbs_range_check','recipes_fat_range_check','recipes_protein_range_check',
            'recipes_description_length_check','recipes_meal_type_check','recipes_name_length_check','recipes_name_not_blank_check',
            'recipes_dietitian_id_fkey','recipes_pkey')) = 10,
         false, 'nutrition ranges, meal type, text bounds, owner FK'
  union all
  select '22_recipe_rls_owner','recipe',
         (select relrowsecurity from pg_class where oid = 'public.recipes'::regclass)
         and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'recipes'
                and policyname in ('recipes_select_own','recipes_insert_own','recipes_update_own','recipes_delete_own')) = 4,
         false, 'RLS enabled with approved-owner CRUD policies'
  union all
  select '23_recipe_storage_model','recipe',
         exists (select 1 from storage.buckets where id = 'recipe-images' and public = false)
         and not exists (select 1 from storage.buckets where id = 'recipe-imports')
         and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('recipe_import_upload_own','recipe_import_read_own')),
         exists (select 1 from storage.buckets where id = 'recipe-imports')
         and not exists (select 1 from remote where version = '20261005124951'),
         'recipe-images private; recipe-imports bucket/policies not yet created (migration creates them)'
  union all
  select '24_recipe_digest_available','recipe',
         to_regprocedure('extensions.digest(text,text)') is not null,
         false, 'save receipt hash uses extensions.digest'
  union all
  select '30_extensions','infra',
         (select count(*) from pg_extension where extname in ('pgcrypto','pg_cron','pg_net','supabase_vault')) = 4,
         false, coalesce((select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension where extname in ('pgcrypto','pg_cron','pg_net','supabase_vault')), 'none')
  union all
  select '31_cleanup_dispatch_dependencies','infra',
         to_regprocedure('cron.schedule(text,text,text)') is not null
         and to_regprocedure('cron.unschedule(bigint)') is not null
         and to_regclass('vault.decrypted_secrets') is not null
         and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post'),
         false, 'cron.schedule/unschedule, vault.decrypted_secrets, net.http_post'
  union all
  select '32_feature_cron_absent','infra',
         not exists (select 1 from cron.job where jobname='recipe-import-cleanup'),
         false, 'recipe cron remains absent until separately approved activation; existing invite cron preserved'
)
select check_id,area,case when blocked then 'BLOCKED' when coalesce(ok,false) then 'PASS' else 'FAIL' end as status,detail from checks order by check_id;
rollback;
