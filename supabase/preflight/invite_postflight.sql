-- P1 invite-only catalog verification. No recipe dependency, RPC invocation or customer rows.
-- Run after successful 20261005120859 SQL, before and after exact-version history repair.
-- PASS_WITH_HISTORY_PENDING allows repair only when every other check is PASS.
begin transaction read only;
with
baseline(version) as (values
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
  ('20260901165402'),('20260901193000'),('20260901200413')
),
rpc(signature) as (values
 ('public.get_my_invite_code()'),('public.rotate_my_invite_code()'),
 ('public.set_my_invite_code_open(boolean)'),('public.preview_dietitian_invite_code(text)'),
 ('public.redeem_dietitian_invite_code(text)'),('public.leave_my_dietitian()')
),
internal(signature) as (values
 ('private.normalize_invite_code(text)'),('private.generate_invite_code()'),
 ('private.require_invite_actor(text)'),('private.invite_rate_limited(uuid)'),
 ('private.guard_relationship_identity()'),('private.cleanup_invite_code_attempts()'),
 ('private.notify_dietitian_client_change()')
),
expected_bodies(signature,body_md5) as (values
 ('private.normalize_invite_code(text)','fb08daddd99d9402d9d4f75a22edafe8'),
 ('private.generate_invite_code()','7c33f4e7415627359e0963d67fb531c4'),
 ('private.require_invite_actor(text)','93cc9c9b8373ed74151499b8182eafd9'),
 ('public.get_my_invite_code()','79c5fda5fc48f5e3740dab51d2f5c98d'),
 ('public.rotate_my_invite_code()','89d90cce20b94058fa5d0410e5e06d98'),
 ('public.set_my_invite_code_open(boolean)','6b24f6671dae23cfd0fed6f2a07013d4'),
 ('private.invite_rate_limited(uuid)','d2f05cd26b25253950d40497affe66bb'),
 ('public.preview_dietitian_invite_code(text)','1dff3ea660206ccbe749c35b255d0ec7'),
 ('public.redeem_dietitian_invite_code(text)','b079114261580222db80e9a8d5b83711'),
 ('public.leave_my_dietitian()','5ef9711ab21a8443e05d39f9b1267dfe'),
 ('private.notify_dietitian_client_change()','5700193a898bd0a8a36c3065d848dc28'),
 ('private.guard_relationship_identity()','78658cf4fa0220034197469767732356'),
 ('private.cleanup_invite_code_attempts()','b36214b2015a39b3bec6ce19166031ae')
),
remote as (select version from supabase_migrations.schema_migrations),
checks(check_id,ok,detail) as (
 select '01_read_only',current_setting('transaction_read_only')='on','catalog only'
 union all select '02_history_exact',
  (select count(*) from remote) in (58,59)
  and not exists(select 1 from baseline b where not exists(select 1 from remote r where r.version=b.version))
  and not exists(select 1 from remote r where r.version<>'20261005120859' and not exists(select 1 from baseline b where b.version=r.version)),
  '58 baseline versions plus optional exact invite version; recipes remain absent'
 union all select '03_push_no_action',
  not exists(select 1 from remote where version='20260817120000')
  and to_regclass('private.push_installations') is null
  and to_regclass('private.push_occurrences') is null
  and to_regclass('private.push_deliveries') is null
  and to_regprocedure('public.register_push_installation(uuid,text,text,uuid,text,text)') is null,
  'deferred push history and objects absent'
 union all select '04_tables_rls',
  (select count(*) from pg_class where oid in (to_regclass('public.dietitian_invite_codes'),to_regclass('private.invite_code_attempts')) and relrowsecurity)=2,
  'both invite tables exist with RLS'
 union all select '05_columns',
  (select count(*) from information_schema.columns where (table_schema,table_name,column_name,data_type) in
   (('public','dietitian_invite_codes','dietitian_id','uuid'),('public','dietitian_invite_codes','code','text'),
    ('public','dietitian_invite_codes','normalized_code','text'),('public','dietitian_invite_codes','is_open','boolean'),
    ('public','dietitian_invite_codes','created_at','timestamp with time zone'),('public','dietitian_invite_codes','updated_at','timestamp with time zone'),
    ('public','dietitian_invite_codes','rotated_at','timestamp with time zone'),
    ('private','invite_code_attempts','id','bigint'),('private','invite_code_attempts','client_id','uuid'),
    ('private','invite_code_attempts','attempted_at','timestamp with time zone'),('private','invite_code_attempts','success','boolean')))=11
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.dietitian_invite_codes') and attname='normalized_code' and attgenerated='s')
  and exists(select 1 from pg_attribute where attrelid=to_regclass('private.invite_code_attempts') and attname='id' and attidentity='a'),
  '11 typed columns, generated normalized code, identity attempt id'
 union all select '06_constraints',
  (select count(*) from pg_constraint where conrelid=to_regclass('public.dietitian_invite_codes')
   and conname in ('dietitian_invite_codes_pkey','dietitian_invite_codes_code_key','dietitian_invite_codes_normalized_code_key','dietitian_invite_codes_dietitian_id_fkey','invite_code_format') and convalidated)=5
  and (select count(*) from pg_constraint where conrelid=to_regclass('private.invite_code_attempts') and contype in ('p','f') and convalidated)=2,
  'PKs, two unique codes, format check, cascading profile FKs'
 union all select '07_indexes',
  (select count(*) from pg_index where indexrelid in (to_regclass('public.dietitian_invite_codes_pkey'),to_regclass('public.dietitian_invite_codes_code_key'),to_regclass('public.dietitian_invite_codes_normalized_code_key'),to_regclass('private.invite_code_attempts_pkey'),to_regclass('private.invite_code_attempts_client_time')) and indisvalid and indisready)=5
  and exists(select 1 from pg_index where indexrelid=to_regclass('private.invite_code_attempts_client_time') and pg_get_expr(indpred,indrelid)='(NOT success)'),
  'five valid indexes including unsuccessful attempt predicate'
 union all select '08_owner_policy',
  (select count(*) from pg_policies where schemaname='public' and tablename='dietitian_invite_codes')=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='dietitian_invite_codes' and policyname='invite_codes_select_own'
   and cmd='SELECT' and roles=array['authenticated']::name[] and qual like '%dietitian_id%' and qual like '%auth.uid()%' and qual like '%is_current_user_dietitian()%')
  and not exists(select 1 from pg_policies where schemaname='private' and tablename='invite_code_attempts'),
  'approved owner SELECT only; no attempt policies'
 union all select '09_table_grants',
  coalesce(has_table_privilege('authenticated',to_regclass('public.dietitian_invite_codes'),'SELECT'),false)
  and not coalesce(has_table_privilege('authenticated',to_regclass('public.dietitian_invite_codes'),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
  and not coalesce(has_table_privilege('anon',to_regclass('public.dietitian_invite_codes'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
  and not coalesce(has_table_privilege('authenticated',to_regclass('private.invite_code_attempts'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
  and not coalesce(has_table_privilege('anon',to_regclass('private.invite_code_attempts'),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),true)
  and not coalesce(has_sequence_privilege('authenticated',to_regclass('private.invite_code_attempts_id_seq'),'USAGE,SELECT,UPDATE'),true)
  and not has_schema_privilege('authenticated','private','USAGE') and not has_schema_privilege('anon','private','USAGE'),
  'browser has owner SELECT only; private table/sequence/schema closed'
 union all select '10_rpc_grants',
  not exists(select 1 from rpc where to_regprocedure(signature) is null
   or not coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false)
   or coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true)),
  'all six RPCs authenticated only'
 union all select '11_internal_grants',
  not exists(select 1 from internal where to_regprocedure(signature) is null
   or coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),true)
   or coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),true)),
  'all seven internal functions closed to browser roles'
 union all select '12_function_bodies',
  not exists(select 1 from expected_bodies e left join pg_proc p on p.oid=to_regprocedure(e.signature) where p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n'))<>e.body_md5),
  '13 function bodies match the exact reviewed migration'
 union all select '13_security_definer',
  not exists(select 1 from rpc r left join pg_proc p on p.oid=to_regprocedure(r.signature)
   where p.oid is null or not p.prosecdef or not ('search_path=pg_catalog, public, private'=any(p.proconfig)))
  and not exists(select 1 from expected_bodies e left join pg_proc p on p.oid=to_regprocedure(e.signature) where p.oid is null or pg_get_userbyid(p.proowner)<>'postgres'),
  'RPC definer/search_path and all function owners'
 union all select '14_relationship_triggers',
  (select count(*) from pg_trigger where tgrelid='public.dietitian_clients'::regclass and not tgisinternal and tgenabled='O'
   and tgname in ('trg_enforce_dietitian_client_capacity','trg_enforce_dietitian_client_transition','trg_notify_dietitian_client_change','trg_guard_relationship_identity'))=4
  and exists(select 1 from pg_trigger where tgrelid='public.dietitian_clients'::regclass and tgname='trg_guard_relationship_identity'
   and tgfoid=to_regprocedure('private.guard_relationship_identity()') and tgtype=19),
  'capacity, transition, notification and BEFORE UPDATE row identity guard'
 union all select '15_relationship_identity_indexes',
  to_regclass('public.one_pending_or_active_dietitian_per_client') is not null
  and to_regclass('public.one_pending_or_active_relation_per_dietitian_client') is not null,
  'legacy uniqueness preserved'
 union all select '16_capacity_helpers',
  not has_function_privilege('authenticated','public.dietitian_effective_client_limit(uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.dietitian_active_client_usage(uuid)','EXECUTE')
  and coalesce((select prosrc like '%dietitian_client_capacity:%' from pg_proc where oid=to_regprocedure('public.enforce_dietitian_client_capacity()')),false),
  'existing helpers remain closed and share advisory lock namespace'
 union all select '17_legacy_compatibility',
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.request_client_connection_by_email(text)'),'EXECUTE'),false)
  and exists(select 1 from pg_policies where schemaname='public' and tablename='dietitian_clients' and cmd='UPDATE' and roles @> array['authenticated']::name[])
  and exists(select 1 from pg_trigger where tgrelid='public.dietitian_clients'::regclass and tgname='trg_enforce_dietitian_client_transition' and tgenabled='O'),
  'legacy email RPC and pending approve/reject policy/transition remain; runtime matrix reused'
 union all select '18_verification_no_action',
  exists(select 1 from pg_trigger where tgrelid='public.dietitian_profiles'::regclass and tgname='trg_sync_dietitian_verification_fields' and tgenabled='O')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='dietitian_profiles' and policyname='Dietitians can update own non-system profile fields' and with_check like '%user_id = auth.uid()%'),
  '20260713010300 NO_ACTION unchanged'
 union all select '19_invite_cleanup',
  (select count(*) from cron.job where jobname='cleanup-invite-code-attempts' and active and schedule='17 * * * *' and command='select private.cleanup_invite_code_attempts()')=1,
  'single active hourly attempt cleanup'
 union all select '20_recipe_not_started',
  to_regclass('public.recipe_import_jobs') is null and to_regclass('public.recipe_import_items') is null
  and not exists(select 1 from storage.buckets where id='recipe-imports')
  and not exists(select 1 from cron.job where jobname='recipe-import-cleanup'),
  'recipe tranche not entered'
)
select check_id,case when coalesce(ok,false) then 'PASS' else 'FAIL' end as status,detail from checks
union all
select '21_invite_history_receipt',
 case when exists(select 1 from remote where version='20261005120859') then 'PASS' else 'PASS_WITH_HISTORY_PENDING' end,
 'repair only 20261005120859 after successful SQL and all schema checks PASS; rerun receipt afterwards'
order by check_id;
rollback;

