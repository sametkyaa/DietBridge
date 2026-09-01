\set ON_ERROR_STOP on

begin;

create temp table client_account_deletion_context (
  dietitian_a uuid not null,
  client_a uuid not null,
  client_b uuid not null
) on commit preserve rows;

insert into client_account_deletion_context values (
  :'dietitian_a'::uuid,
  :'client_a'::uuid,
  :'client_b'::uuid
);
grant select on client_account_deletion_context to public;

create temp table client_account_deletion_profile_fk_allowlist (
  table_name text not null,
  column_names text[] not null,
  primary key (table_name, column_names)
) on commit preserve rows;

insert into client_account_deletion_profile_fk_allowlist (table_name, column_names) values
  ('public.appointments', array['client_id']),
  ('public.appointments', array['dietitian_id']),
  ('public.body_measurements', array['client_id']),
  ('public.chat_conversations', array['client_id']),
  ('public.chat_conversations', array['dietitian_id']),
  ('public.chat_messages', array['deleted_by']),
  ('public.chat_messages', array['receiver_id']),
  ('public.chat_messages', array['sender_id']),
  ('public.chat_read_states', array['user_id']),
  ('public.chat_upload_intents', array['created_by']),
  ('public.client_medical_conditions', array['client_id']),
  ('public.client_medications', array['client_id']),
  ('public.client_profiles', array['user_id']),
  ('public.daily_logs', array['client_id']),
  ('public.daily_tasks', array['client_id']),
  ('public.daily_tasks', array['dietitian_id']),
  ('public.dietitian_clients', array['client_id']),
  ('public.dietitian_clients', array['dietitian_id']),
  ('public.dietitian_notes', array['client_id']),
  ('public.dietitian_notes', array['dietitian_id']),
  ('public.dietitian_profiles', array['user_id']),
  ('public.dietitian_subscriptions', array['dietitian_id']),
  ('public.grocery_items', array['client_id']),
  ('public.meal_change_requests', array['client_id']),
  ('public.meal_change_requests', array['dietitian_id']),
  ('public.meal_plans', array['client_id']),
  ('public.meal_plans', array['dietitian_id']),
  ('public.measurements', array['client_id']),
  ('public.notifications', array['actor_id']),
  ('public.notifications', array['recipient_id']),
  ('public.recipes', array['dietitian_id']);

do $$
declare
  v_unexpected text;
  v_missing text;
begin
  with profile_fks as (
    select c.oid,
           n.nspname || '.' || r.relname as table_name,
           array_agg(a.attname::text order by key.ordinality) as column_names
      from pg_catalog.pg_constraint as c
      join pg_catalog.pg_class as r on r.oid = c.conrelid
      join pg_catalog.pg_namespace as n on n.oid = r.relnamespace
      cross join lateral unnest(c.conkey) with ordinality as key(attnum, ordinality)
      join pg_catalog.pg_attribute as a
        on a.attrelid = c.conrelid and a.attnum = key.attnum
     where c.contype = 'f'
       and c.confrelid = 'public.profiles'::regclass
     group by c.oid, n.nspname, r.relname
  )
  select string_agg(
           f.table_name || '(' || array_to_string(f.column_names, ',') || ')',
           ', ' order by f.table_name, f.column_names::text
         )
    into v_unexpected
    from profile_fks as f
   where not exists (
     select 1
       from client_account_deletion_profile_fk_allowlist as e
      where e.table_name = f.table_name
        and e.column_names = f.column_names
   );

  if v_unexpected is not null then
    raise exception 'FAIL: UNREVIEWED_PROFILES_FK_DEPENDENCY: %', v_unexpected;
  end if;

  with profile_fks as (
    select c.oid,
           n.nspname || '.' || r.relname as table_name,
           array_agg(a.attname::text order by key.ordinality) as column_names
      from pg_catalog.pg_constraint as c
      join pg_catalog.pg_class as r on r.oid = c.conrelid
      join pg_catalog.pg_namespace as n on n.oid = r.relnamespace
      cross join lateral unnest(c.conkey) with ordinality as key(attnum, ordinality)
      join pg_catalog.pg_attribute as a
        on a.attrelid = c.conrelid and a.attnum = key.attnum
     where c.contype = 'f'
       and c.confrelid = 'public.profiles'::regclass
     group by c.oid, n.nspname, r.relname
  )
  select string_agg(
           e.table_name || '(' || array_to_string(e.column_names, ',') || ')',
           ', ' order by e.table_name, e.column_names::text
         )
    into v_missing
    from client_account_deletion_profile_fk_allowlist as e
   where not exists (
     select 1
       from profile_fks as f
      where f.table_name = e.table_name
        and f.column_names = e.column_names
   );

  if v_missing is not null then
    raise exception 'FAIL: EXPECTED_PROFILES_FK_DEPENDENCY_MISSING: %', v_missing;
  end if;
end
$$;

\echo PASS: CLIENT_DELETE_PROFILES_FK_COVERAGE_AUDIT

do $$
begin
  if has_function_privilege('anon', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_client_account_data(uuid)', 'EXECUTE') then
    raise exception 'FAIL: CLIENT_DELETE_RPC_GRANTS';
  end if;
end
$$;
\echo PASS: CLIENT_DELETE_RPC_SERVICE_ONLY

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform public.delete_client_account_data((select client_a from client_account_deletion_context));
    raise exception 'FAIL: ANON_EXECUTION_ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;
reset role;
\echo PASS: CLIENT_DELETE_RPC_ANON_DENIED

set local role authenticated;
select set_config('request.jwt.claim.sub', (select client_a::text from client_account_deletion_context), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select client_a::text from client_account_deletion_context),
  'role', 'authenticated'
)::text, true);
do $$
begin
  begin
    perform public.delete_client_account_data((select client_a from client_account_deletion_context));
    raise exception 'FAIL: AUTHENTICATED_EXECUTION_ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;
reset role;
\echo PASS: CLIENT_DELETE_RPC_AUTHENTICATED_DENIED

set local role authenticated;
select set_config('request.jwt.claim.sub', (select dietitian_a::text from client_account_deletion_context), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select dietitian_a::text from client_account_deletion_context),
  'role', 'authenticated'
)::text, true);
do $$
begin
  begin
    perform public.delete_client_account_data((select client_a from client_account_deletion_context));
    raise exception 'FAIL: DIETITIAN_DIRECT_EXECUTION_ALLOWED';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;
reset role;
\echo PASS: CLIENT_DELETE_RPC_DIETITIAN_DIRECT_DENIED

set local role service_role;
select set_config('request.jwt.claim.sub', (select dietitian_a::text from client_account_deletion_context), true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', jsonb_build_object(
  'sub', (select dietitian_a::text from client_account_deletion_context),
  'role', 'service_role'
)::text, true);
do $$
begin
  begin
    perform public.delete_client_account_data((select dietitian_a from client_account_deletion_context));
    raise exception 'FAIL: DIETITIAN_TARGET_DELETED';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;
do $$
begin
  begin
    perform public.delete_client_account_data((select client_b from client_account_deletion_context));
    raise exception 'FAIL: PLATFORM_ADMIN_TARGET_DELETED';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;
select public.delete_client_account_data((select client_a from client_account_deletion_context));
select public.delete_client_account_data((select client_a from client_account_deletion_context));
reset role;

do $$
declare
  v_dietitian uuid := (select dietitian_a from client_account_deletion_context);
  v_client_a uuid := (select client_a from client_account_deletion_context);
  v_client_b uuid := (select client_b from client_account_deletion_context);
begin
  if not exists (select 1 from public.profiles where id = v_client_a and role = 'client'::public.user_role)
     or not exists (select 1 from public.profiles where id = v_dietitian and role = 'dietitian'::public.user_role)
     or not exists (select 1 from public.profiles where id = v_client_b and role = 'client'::public.user_role) then
    raise exception 'FAIL: PROFILE_FIXTURE_OR_AUTH_CASCADE_STATE';
  end if;

  if exists (select 1 from public.client_profiles where user_id = v_client_a)
     or exists (select 1 from public.dietitian_clients where client_id = v_client_a)
     or exists (select 1 from public.appointments where client_id = v_client_a)
     or exists (select 1 from public.daily_tasks where client_id = v_client_a)
     or exists (select 1 from public.dietitian_notes where client_id = v_client_a)
     or exists (select 1 from public.grocery_items where client_id = v_client_a)
     or exists (select 1 from public.daily_logs where client_id = v_client_a)
     or exists (select 1 from public.measurements where client_id = v_client_a)
     or exists (select 1 from public.body_measurements where client_id = v_client_a)
     or exists (select 1 from public.client_medical_conditions where client_id = v_client_a)
     or exists (select 1 from public.client_medications where client_id = v_client_a)
     or exists (select 1 from public.meal_plans where client_id = v_client_a)
     or exists (select 1 from public.meals as m join public.meal_plans as mp on mp.id = m.plan_id where mp.client_id = v_client_a)
     or exists (select 1 from public.chat_conversations where client_id = v_client_a)
     or exists (select 1 from public.chat_read_states where user_id = v_client_a)
     or exists (select 1 from public.chat_upload_intents where created_by = v_client_a)
     or exists (select 1 from public.chat_attachments as a join public.chat_upload_intents as i on i.id = a.intent_id where i.created_by = v_client_a)
     or exists (select 1 from public.chat_image_cleanup_queue as q join public.chat_upload_intents as i on i.id = q.intent_id where i.created_by = v_client_a)
     or exists (select 1 from public.meal_completion_photo_cleanup_queue where client_id = v_client_a)
     or exists (select 1 from public.notifications where recipient_id = v_client_a or actor_id = v_client_a) then
    raise exception 'FAIL: CLIENT_A_RELATIONAL_RESIDUE';
  end if;

  if not exists (select 1 from public.dietitian_profiles where user_id = v_dietitian)
     or not exists (select 1 from public.recipes where dietitian_id = v_dietitian)
     or not exists (select 1 from public.medical_conditions where name like 'Client deletion fixture condition %')
     or not exists (select 1 from public.medications_catalog where name like 'Client deletion fixture medication %') then
    raise exception 'FAIL: DIETITIAN_OR_GLOBAL_DATA_DAMAGED';
  end if;

  if not exists (select 1 from public.grocery_items where client_id = v_client_b)
     or not exists (select 1 from public.daily_logs where client_id = v_client_b)
     or not exists (select 1 from public.dietitian_clients where client_id = v_client_b) then
    raise exception 'FAIL: CLIENT_B_DATA_DAMAGED';
  end if;

  -- Deleting a client meal plan intentionally leaves dietitian-owned meal
  -- photo cleanup queued for the existing worker; the account primitive never
  -- deletes or broad-purges the dietitian's meal-photo object.
  if not exists (
    select 1
      from public.meal_photo_cleanup_queue
     where client_id = v_client_a
       and dietitian_id = v_dietitian
  ) then
    raise exception 'FAIL: DIETITIAN_MEAL_PHOTO_CLEANUP_QUEUE_NOT_PRESERVED';
  end if;
end
$$;
\echo PASS: CLIENT_A_RELATIONAL_CLEANUP_AND_TENANT_ISOLATION
\echo PASS: DIETITIAN_MEAL_PHOTO_QUEUE_PRESERVED_FOR_EXISTING_WORKER

commit;
