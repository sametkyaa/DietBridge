\set ON_ERROR_STOP on

begin read only;

with checks as (
  select 'BUCKET-01 private bounded contract'::text as check_name,
    exists (
      select 1 from storage.buckets as b
       where b.id = 'meal-photos' and b.name = 'meal-photos' and b.public is false
         and b.file_size_limit = 5242880
         and (select array_agg(m order by m) from unnest(b.allowed_mime_types) as m)
           = array['image/jpeg', 'image/png', 'image/webp']::text[]
    ) as passed
  union all
  select 'POLICY-01 exact user policy surface',
    2 = (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%')
    and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'meal_photo_objects_insert_active_approved_dietitian'
      and cmd = 'INSERT' and roles = array['authenticated']::name[])
    and exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'meal_photo_objects_select_referenced_linked_actor'
      and cmd = 'SELECT' and roles = array['authenticated']::name[])
    and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'Give users access to own folder 1o5iea3_%')
  union all
  select 'POLICY-02 no browser delete or update',
    not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%'
      and cmd in ('DELETE', 'UPDATE'))
  union all
  select 'POLICY-03 real Storage INSERT contract',
    exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'meal_photo_objects_insert_active_approved_dietitian'
      and cmd = 'INSERT' and roles = array['authenticated']::name[]
      and with_check ilike '%is_current_user_dietitian%'
      and with_check ilike '%dietitian_clients%'
      and with_check ilike '%^meal-plans/%'
      and with_check ilike '%(jpe?g|png|webp)$%'
      and with_check ilike '%split_part(name, ''/''::text, 3)%'
      and with_check ilike '%auth.uid()%'
      and with_check ilike '%split_part(%''/''::text, 2)%'
      and with_check not ilike '%metadata%')
  union all
  select 'QUEUE-01 RLS and indexes',
    to_regclass('public.meal_photo_cleanup_queue') is not null
    and (select relrowsecurity from pg_class where oid = 'public.meal_photo_cleanup_queue'::regclass)
    and exists (select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'meal_photo_cleanup_queue_one_pending_path_idx')
    and exists (select 1 from pg_indexes where schemaname = 'public'
      and indexname = 'meal_photo_cleanup_queue_available_idx')
  union all
  select 'QUEUE-02 app roles have no direct DML',
    not has_table_privilege('anon', 'public.meal_photo_cleanup_queue', 'SELECT')
    and not has_table_privilege('authenticated', 'public.meal_photo_cleanup_queue', 'SELECT')
    and not has_table_privilege('authenticated', 'public.meal_photo_cleanup_queue', 'INSERT')
    and not has_table_privilege('authenticated', 'public.meal_photo_cleanup_queue', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.meal_photo_cleanup_queue', 'DELETE')
  union all
  select 'TRIGGER-01 canonical-only queue trigger',
    exists (select 1 from pg_trigger where tgrelid = 'public.meals'::regclass
      and tgname = 'meals_queue_replaced_photo' and not tgisinternal)
    and pg_get_functiondef('private.queue_replaced_meal_photo()'::regprocedure) like '%^meal-plans/%'
    and pg_get_functiondef('private.queue_replaced_meal_photo()'::regprocedure) not like '%^recipes/%'
  union all
  select 'RPC-01 browser enqueue/status only',
    has_function_privilege('authenticated', 'public.enqueue_my_unreferenced_meal_photo_cleanup(text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_my_meal_photo_cleanup_status()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.enqueue_my_unreferenced_meal_photo_cleanup(text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_my_meal_photo_cleanup_status()', 'EXECUTE')
    and pg_get_functiondef('public.enqueue_my_unreferenced_meal_photo_cleanup(text)'::regprocedure)
      ilike '%p.role = ''dietitian''::public.user_role%'
    and pg_get_functiondef('public.enqueue_my_unreferenced_meal_photo_cleanup(text)'::regprocedure)
      ilike '%o.owner_id = v_actor_id::text%'
    and pg_get_functiondef('public.enqueue_my_unreferenced_meal_photo_cleanup(text)'::regprocedure)
      not ilike '%is_current_user_dietitian%'
    and pg_get_functiondef('public.enqueue_my_unreferenced_meal_photo_cleanup(text)'::regprocedure)
      not ilike '%dietitian_clients%'
    and pg_get_functiondef('public.get_my_meal_photo_cleanup_status()'::regprocedure)
      ilike '%p.role = ''dietitian''::public.user_role%'
    and pg_get_functiondef('public.get_my_meal_photo_cleanup_status()'::regprocedure)
      not ilike '%is_current_user_dietitian%'
  union all
  select 'RPC-02 worker service-role only',
    has_function_privilege('service_role', 'public.claim_meal_photo_cleanup_batch(integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.complete_meal_photo_cleanup(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_meal_photo_cleanup_batch(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.complete_meal_photo_cleanup(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.claim_meal_photo_cleanup_batch(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_meal_photo_cleanup(uuid)', 'EXECUTE')
  union all
  select 'RPC-03 fixed owner/search path',
    not exists (
      select 1 from unnest(array[
        'private.enqueue_meal_photo_cleanup(text,text)'::regprocedure,
        'private.queue_replaced_meal_photo()'::regprocedure,
        'public.enqueue_my_unreferenced_meal_photo_cleanup(text)'::regprocedure,
        'public.get_my_meal_photo_cleanup_status()'::regprocedure,
        'public.claim_meal_photo_cleanup_batch(integer)'::regprocedure,
        'public.complete_meal_photo_cleanup(uuid)'::regprocedure
      ]) as expected(oid)
      join pg_proc as p on p.oid = expected.oid
      where not p.prosecdef or pg_get_userbyid(p.proowner) <> 'postgres'
         or not (p.proconfig @> array['search_path=pg_catalog, public']::text[])
    )
  union all
  select 'RPC-04 completion requires absent object and reference',
    pg_get_functiondef('public.complete_meal_photo_cleanup(uuid)'::regprocedure) ilike '%not exists (select 1 from public.meals%'
    and pg_get_functiondef('public.complete_meal_photo_cleanup(uuid)'::regprocedure) ilike '%not exists (%from storage.objects%'
  union all
  select 'RPC-05 worker internal service-role authorization',
    pg_get_functiondef('public.claim_meal_photo_cleanup_batch(integer)'::regprocedure)
      ilike '%auth.jwt() ->> ''role''%is distinct from ''service_role''%42501%'
    and pg_get_functiondef('public.complete_meal_photo_cleanup(uuid)'::regprocedure)
      ilike '%auth.jwt() ->> ''role''%is distinct from ''service_role''%42501%'
)
select check_name, passed from checks order by check_name;

rollback;
