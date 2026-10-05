\set ON_ERROR_STOP on

\echo REALTIME_WEIGHT_CONTRACT_START

begin;

-- Realtime publication membership (20261005120000).
do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'meals',
    'meal_plans',
    'meal_change_requests',
    'daily_logs',
    'appointments'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table_name
    ) then
      raise exception 'FAIL: REALTIME_PUBLICATION_MEMBER public.%', v_table_name;
    end if;

    if not (select relrowsecurity from pg_class where oid = format('public.%I', v_table_name)::regclass) then
      raise exception 'FAIL: REALTIME_TABLE_RLS_ENABLED public.%', v_table_name;
    end if;

    -- Replica identity is intentionally left at the default (primary key).
    if (select relreplident from pg_class where oid = format('public.%I', v_table_name)::regclass) <> 'd' then
      raise exception 'FAIL: REALTIME_TABLE_REPLICA_IDENTITY_UNCHANGED public.%', v_table_name;
    end if;
  end loop;

  foreach v_table_name in array array[
    'chat_messages',
    'chat_conversations',
    'chat_read_states',
    'notifications'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table_name
    ) then
      raise exception 'FAIL: EXISTING_REALTIME_MEMBER_PRESERVED public.%', v_table_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'private'
  ) then
    raise exception 'FAIL: PRIVATE_SCHEMA_NOT_REALTIME_PUBLISHED';
  end if;
end
$$;
\echo PASS: REALTIME_FIVE_TABLES_PUBLISHED_WITH_RLS

-- save_active_client_weight catalog contract (20261005120100).
do $$
declare
  v_function regprocedure := to_regprocedure('public.save_active_client_weight(uuid,date,numeric,text)');
begin
  if v_function is null then
    raise exception 'FAIL: WEIGHT_RPC_EXISTS';
  end if;

  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'save_active_client_weight') <> 1 then
    raise exception 'FAIL: WEIGHT_RPC_SINGLE_SIGNATURE';
  end if;

  if pg_get_function_identity_arguments(v_function) <> 'p_client_id uuid, p_measured_at date, p_weight numeric, p_notes text'
     or pg_get_function_arguments(v_function) not like '%p_notes text DEFAULT NULL%'
     or (select prorettype from pg_proc where oid = v_function) <> 'public.measurements'::regtype
     or (select proretset from pg_proc where oid = v_function)
     or not (select prosecdef from pg_proc where oid = v_function)
     or not (select proconfig from pg_proc where oid = v_function)
       @> array['search_path=pg_catalog, public', 'TimeZone=Europe/Istanbul']::text[] then
    raise exception 'FAIL: WEIGHT_RPC_SIGNATURE_SECURITY_DEFINER_CONFIG';
  end if;

  if not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or exists (
       select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
       where p.oid = v_function and acl.grantee = 0
     ) then
    raise exception 'FAIL: WEIGHT_RPC_EXECUTE_GRANTS';
  end if;
end
$$;
\echo PASS: WEIGHT_RPC_CATALOG_CONTRACT

create temporary table weight_test_context (
  dietitian_a uuid not null,
  dietitian_b uuid not null,
  dietitian_pending uuid not null,
  client_a uuid not null,
  client_b uuid not null,
  client_c uuid not null,
  istanbul_today date not null,
  foreign_timezone text
) on commit drop;

grant select on table weight_test_context to authenticated, anon;

insert into weight_test_context
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  (now() at time zone 'Europe/Istanbul')::date,
  -- A session zone whose calendar date differs from Istanbul right now, so the
  -- weight sync trigger is exercised across a real date boundary.
  case
    when (now() at time zone 'Pacific/Kiritimati')::date <> (now() at time zone 'Europe/Istanbul')::date
      then 'Pacific/Kiritimati'
    when (now() at time zone 'Etc/GMT+12')::date <> (now() at time zone 'Europe/Istanbul')::date
      then 'Etc/GMT+12'
    else null
  end;

-- The auth onboarding trigger creates the corresponding profile rows.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select fixture.user_id,
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'weight-harness+' || fixture.label || '-' || fixture.user_id::text || '@example.invalid',
  '$2a$10$fixturefixturefixturefixturefixturefixturefixturefixture',
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('account_type', fixture.account_type, 'full_name', fixture.label),
  now(),
  now()
from weight_test_context as context
cross join lateral (
  values
    (context.dietitian_a, 'dietitian-a', 'dietitian'),
    (context.dietitian_b, 'dietitian-b', 'dietitian'),
    (context.dietitian_pending, 'dietitian-pending', 'dietitian'),
    (context.client_a, 'client-a', 'client'),
    (context.client_b, 'client-b', 'client'),
    (context.client_c, 'client-c', 'client')
) as fixture(user_id, label, account_type);

update public.dietitian_profiles as dp
set verification_status = fixture.status,
    is_verified = fixture.status = 'approved'
from weight_test_context as context,
  lateral (values
    (context.dietitian_a, 'approved'),
    (context.dietitian_b, 'approved'),
    (context.dietitian_pending, 'pending')
  ) as fixture(user_id, status)
where dp.user_id = fixture.user_id;

-- Client capacity is enforced per dietitian subscription; give each fixture
-- dietitian the core plan before linking a client.
insert into public.dietitian_subscriptions (dietitian_id, plan_id, status, client_limit_override)
select fixture.user_id, 'core', 'active', null
from weight_test_context as context
cross join lateral (values (context.dietitian_a), (context.dietitian_b), (context.dietitian_pending)) as fixture(user_id)
on conflict (dietitian_id) do update
set plan_id = excluded.plan_id,
  status = excluded.status,
  client_limit_override = excluded.client_limit_override;

-- Lifecycle rules accept pending inserts only; activate inside this transaction.
insert into public.dietitian_clients (dietitian_id, client_id, status)
select dietitian_a, client_a, 'pending'::public.client_status from weight_test_context
union all
select dietitian_b, client_b, 'pending'::public.client_status from weight_test_context
union all
select dietitian_pending, client_c, 'pending'::public.client_status from weight_test_context;

update public.dietitian_clients
set status = 'active'::public.client_status,
  accepted_at = now(),
  updated_at = now()
where (dietitian_id, client_id) in (
  select dietitian_a, client_a from weight_test_context
  union all
  select dietitian_b, client_b from weight_test_context
  union all
  select dietitian_pending, client_c from weight_test_context
);

update public.client_profiles
set current_weight = null
where user_id = (select client_a from weight_test_context);
delete from public.measurements
where client_id = (select client_a from weight_test_context);

do $$
begin
  if (select count(*) from public.dietitian_profiles dp
      join weight_test_context c on dp.user_id in (c.dietitian_a, c.dietitian_b)
      where dp.verification_status = 'approved' and dp.is_verified) <> 2
     or (select count(*) from public.dietitian_clients dc
         join weight_test_context c on (dc.dietitian_id, dc.client_id) in ((c.dietitian_a, c.client_a), (c.dietitian_b, c.client_b), (c.dietitian_pending, c.client_c))
         where dc.status = 'active'::public.client_status) <> 3
     or (select count(*) from public.client_profiles cp
         join weight_test_context c on cp.user_id in (c.client_a, c.client_b, c.client_c)) <> 3 then
    raise exception 'FAIL: WEIGHT_FIXTURES';
  end if;
end
$$;
\echo PASS: WEIGHT_FIXTURES

-- Active approved dietitian saves today's weight. The session runs in a time
-- zone whose date differs from Istanbul so the sync trigger is checked too.
select set_config('TimeZone', coalesce(foreign_timezone, 'UTC'), true) from weight_test_context \gset
select set_config('request.jwt.claim.sub', dietitian_a::text, true) from weight_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', dietitian_a::text, 'role', 'authenticated')::text, true)
from weight_test_context \gset
set local role authenticated;

do $$
declare
  v_row public.measurements;
  v_context weight_test_context;
begin
  select * into v_context from weight_test_context;

  select * into v_row
  from public.save_active_client_weight(v_context.client_a, v_context.istanbul_today, 72.40, '  Sabah aç karnına  ');

  if v_row.id is null
     or v_row.client_id <> v_context.client_a
     or v_row.measured_at <> v_context.istanbul_today
     or v_row.weight <> 72.40
     or v_row.notes is distinct from 'Sabah aç karnına' then
    raise exception 'FAIL: ACTIVE_DIETITIAN_SAVES_TODAY_WEIGHT %', row_to_json(v_row);
  end if;
end
$$;
\echo PASS: ACTIVE_DIETITIAN_SAVES_TODAY_WEIGHT

reset role;
do $$
declare
  v_context weight_test_context;
begin
  select * into v_context from weight_test_context;

  if (select current_weight from public.client_profiles where user_id = v_context.client_a) is distinct from 72.40 then
    raise exception 'FAIL: ISTANBUL_TODAY_UPDATES_CURRENT_WEIGHT';
  end if;

  -- The client_profiles -> measurements sync trigger must land on the same
  -- Istanbul day, not on the session/UTC day.
  if (select count(*) from public.measurements where client_id = v_context.client_a) <> 1
     or not exists (
       select 1 from public.measurements
       where client_id = v_context.client_a
         and measured_at = v_context.istanbul_today
         and weight = 72.40
         and notes = 'Sabah aç karnına'
     ) then
    raise exception 'FAIL: WEIGHT_SYNC_TRIGGER_USES_ISTANBUL_DAY (foreign_timezone=%)', v_context.foreign_timezone;
  end if;
end
$$;
\echo PASS: ISTANBUL_TODAY_UPDATES_CURRENT_WEIGHT_AND_SINGLE_DAILY_ROW

-- Seed a same-day circumference value; the weight patch must preserve it and
-- keep the existing note when no new note is sent.
update public.measurements
set waist = 81.50
where client_id = (select client_a from weight_test_context)
  and measured_at = (select istanbul_today from weight_test_context);

set local role authenticated;
do $$
declare
  v_row public.measurements;
  v_context weight_test_context;
begin
  select * into v_context from weight_test_context;

  select * into v_row
  from public.save_active_client_weight(v_context.client_a, v_context.istanbul_today, 72.10, null);
  if v_row.weight <> 72.10
     or v_row.waist is distinct from 81.50
     or v_row.notes is distinct from 'Sabah aç karnına' then
    raise exception 'FAIL: SAME_DAY_WEIGHT_PATCH_PRESERVES_OTHER_FIELDS %', row_to_json(v_row);
  end if;

  select * into v_row
  from public.save_active_client_weight(v_context.client_a, v_context.istanbul_today - 3, 74.00);
  if v_row.measured_at <> v_context.istanbul_today - 3
     or v_row.weight <> 74.00
     or v_row.notes is not null then
    raise exception 'FAIL: PAST_DATE_WEIGHT_SAVED %', row_to_json(v_row);
  end if;

  begin
    perform public.save_active_client_weight(v_context.client_a, v_context.istanbul_today + 1, 72.00, null);
    raise exception 'FAIL: FUTURE_ISTANBUL_DATE_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.save_active_client_weight(v_context.client_a, v_context.istanbul_today, 19.99, null);
    raise exception 'FAIL: WEIGHT_RANGE_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.save_active_client_weight(v_context.client_a, v_context.istanbul_today, 72.00, repeat('x', 1001));
    raise exception 'FAIL: OVERLONG_NOTE_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;
\echo PASS: PATCH_PAST_DATE_FUTURE_RANGE_NOTE_RULES

reset role;
do $$
begin
  -- A past-date save never moves the profile's current weight.
  if (select current_weight from public.client_profiles where user_id = (select client_a from weight_test_context)) is distinct from 72.10 then
    raise exception 'FAIL: PAST_DATE_DOES_NOT_UPDATE_CURRENT_WEIGHT';
  end if;
end
$$;
\echo PASS: PAST_DATE_DOES_NOT_UPDATE_CURRENT_WEIGHT

-- Another approved dietitian (active with a different client) is rejected.
select set_config('request.jwt.claim.sub', dietitian_b::text, true) from weight_test_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', dietitian_b::text, 'role', 'authenticated')::text, true)
from weight_test_context \gset
set local role authenticated;
do $$
begin
  begin
    perform public.save_active_client_weight((select client_a from weight_test_context), (select istanbul_today from weight_test_context), 90.00, null);
    raise exception 'FAIL: FOREIGN_DIETITIAN_REJECTED';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
\echo PASS: FOREIGN_DIETITIAN_REJECTED

-- An unapproved dietitian with an active relationship is rejected.
reset role;
select set_config('request.jwt.claim.sub', dietitian_pending::text, true) from weight_test_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', dietitian_pending::text, 'role', 'authenticated')::text, true)
from weight_test_context \gset
set local role authenticated;
do $$
begin
  begin
    perform public.save_active_client_weight((select client_c from weight_test_context), (select istanbul_today from weight_test_context), 90.00, null);
    raise exception 'FAIL: UNAPPROVED_DIETITIAN_REJECTED';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
\echo PASS: UNAPPROVED_DIETITIAN_REJECTED

-- The client cannot use the dietitian RPC for their own row.
reset role;
select set_config('request.jwt.claim.sub', client_a::text, true) from weight_test_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', client_a::text, 'role', 'authenticated')::text, true)
from weight_test_context \gset
set local role authenticated;
do $$
begin
  begin
    perform public.save_active_client_weight((select client_a from weight_test_context), (select istanbul_today from weight_test_context), 90.00, null);
    raise exception 'FAIL: CLIENT_SELF_CALL_REJECTED';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
\echo PASS: CLIENT_SELF_CALL_REJECTED

-- Anonymous callers have no execute privilege at all.
reset role;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'anon', true) \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true) \gset
set local role anon;
do $$
begin
  begin
    perform public.save_active_client_weight((select client_a from weight_test_context), (select istanbul_today from weight_test_context), 90.00, null);
    raise exception 'FAIL: ANON_REJECTED';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
\echo PASS: ANON_REJECTED

reset role;
do $$
declare
  v_context weight_test_context;
begin
  select * into v_context from weight_test_context;

  if (select current_weight from public.client_profiles where user_id = v_context.client_a) is distinct from 72.10
     or (select count(*) from public.measurements where client_id = v_context.client_a) <> 2
     or exists (select 1 from public.measurements where client_id in (v_context.client_b, v_context.client_c))
     or exists (select 1 from public.measurements where client_id = v_context.client_a and weight = 90.00) then
    raise exception 'FAIL: REJECTED_CALLS_LEFT_NO_WRITES';
  end if;
end
$$;
\echo PASS: REJECTED_CALLS_LEFT_NO_WRITES

rollback;
\echo REALTIME_WEIGHT_CONTRACT_PASS
