\set ON_ERROR_STOP on

\echo GROCERY_ITEMS_CONTRACT_START

begin;

create temporary table grocery_test_context (
  client_a uuid not null,
  client_b uuid not null,
  dietitian_a uuid not null,
  own_item uuid not null,
  foreign_item uuid not null,
  duplicate_item uuid not null,
  added_item uuid not null
) on commit drop;

grant select on table grocery_test_context to authenticated, anon;

insert into grocery_test_context values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

-- The auth onboarding trigger creates the corresponding public.profiles rows.
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
  'grocery-harness+' || fixture.label || '-' || fixture.user_id::text || '@example.invalid',
  '$2a$10$fixturefixturefixturefixturefixturefixturefixturefixture',
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('account_type', fixture.account_type, 'full_name', fixture.label),
  now(),
  now()
from grocery_test_context as context
cross join lateral (
  values
    (context.client_a, 'client-a', 'client'),
    (context.client_b, 'client-b', 'client'),
    (context.dietitian_a, 'dietitian-a', 'dietitian')
) as fixture(user_id, label, account_type);

do $$
declare
  v_count integer;
begin
  if (select count(*) from public.profiles p
      where p.id in ((select client_a from grocery_test_context), (select client_b from grocery_test_context), (select dietitian_a from grocery_test_context))) <> 3
     or (select count(*) from public.profiles p
         where p.id in ((select client_a from grocery_test_context), (select client_b from grocery_test_context))
           and p.role = 'client'::public.user_role) <> 2
     or (select count(*) from public.profiles p
         where p.id = (select dietitian_a from grocery_test_context)
           and p.role = 'dietitian'::public.user_role) <> 1 then
    raise exception 'FAIL: GROCERY_AUTH_PROFILE_FIXTURES';
  end if;
end
$$;

insert into public.grocery_items (id, client_id, name, is_completed, created_at)
select own_item, client_a, 'Süt', false, '2026-09-01T08:00:00Z'::timestamptz
from grocery_test_context
union all
select foreign_item, client_b, 'Ekmek', false, '2026-09-01T08:01:00Z'::timestamptz
from grocery_test_context;

do $$
declare
  v_type text;
  v_default text;
  v_constraint text;
begin
  if to_regclass('public.grocery_items') is null then
    raise exception 'FAIL: GROCERY_TABLE_EXISTS';
  end if;

  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'grocery_items'
        and column_name in ('id', 'client_id', 'name', 'is_completed', 'created_at')) <> 5 then
    raise exception 'FAIL: GROCERY_COLUMNS_PRESENT';
  end if;

  select data_type, column_default into v_type, v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'grocery_items' and column_name = 'id';
  if v_type <> 'uuid' or v_default is null or v_default not like '%gen_random_uuid%' then
    raise exception 'FAIL: GROCERY_ID_CONTRACT';
  end if;

  select column_default into v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'grocery_items' and column_name = 'is_completed';
  if v_default is null or v_default not like '%false%' then
    raise exception 'FAIL: GROCERY_COMPLETION_DEFAULT';
  end if;

  select pg_get_constraintdef(oid) into v_constraint
  from pg_constraint
  where conrelid = 'public.grocery_items'::regclass
    and conname = 'grocery_items_name_length_check';
  if v_constraint is null
     or lower(v_constraint) not like '%char_length%'
     or lower(v_constraint) not like '%btrim%'
     or lower(v_constraint) not like '%1%'
     or lower(v_constraint) not like '%120%' then
    raise exception 'FAIL: GROCERY_NAME_CHECK';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.grocery_items'::regclass)
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'grocery_items') <> 4 then
    raise exception 'FAIL: GROCERY_RLS_POLICY_COUNT';
  end if;

  if not has_table_privilege('authenticated', 'public.grocery_items', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.grocery_items', 'select')
     or has_table_privilege('anon', 'public.grocery_items', 'insert')
     or has_table_privilege('anon', 'public.grocery_items', 'update')
     or has_table_privilege('anon', 'public.grocery_items', 'delete') then
    raise exception 'FAIL: GROCERY_GRANTS';
  end if;
end
$$;
\echo PASS: GROCERY_SCHEMA_RLS_GRANTS

select set_config('request.jwt.claim.sub', client_a::text, true)
from grocery_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', client_a::text, 'role', 'authenticated')::text, true)
from grocery_test_context \gset
set local role authenticated;

do $$
declare
  v_count integer;
begin
  if (select count(*) from public.grocery_items) <> 1
     or not exists (select 1 from public.grocery_items where id = (select own_item from grocery_test_context))
     or exists (select 1 from public.grocery_items where id = (select foreign_item from grocery_test_context)) then
    raise exception 'FAIL: GROCERY_OWN_SELECT_CROSS_CLIENT_HIDDEN';
  end if;

  insert into public.grocery_items (id, client_id, name)
  select added_item, client_a, 'Yoğurt' from grocery_test_context;
  if not exists (select 1 from public.grocery_items where id = (select added_item from grocery_test_context) and is_completed is false) then
    raise exception 'FAIL: GROCERY_OWN_INSERT';
  end if;

  update public.grocery_items
  set is_completed = true
  where id = (select added_item from grocery_test_context);
  get diagnostics v_count = row_count;
  if v_count <> 1 or not exists (select 1 from public.grocery_items where id = (select added_item from grocery_test_context) and is_completed) then
    raise exception 'FAIL: GROCERY_OWN_UPDATE';
  end if;

  begin
    insert into public.grocery_items (client_id, name)
    select client_b, 'Spoofed insert' from grocery_test_context;
    get diagnostics v_count = row_count;
    if v_count <> 0 then
      raise exception 'FAIL: GROCERY_SPOOFED_INSERT_ALLOWED';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end
$$;
\echo PASS: GROCERY_OWN_SELECT_INSERT_UPDATE_SPOOF_DENIED

do $$
begin
  begin
    update public.grocery_items
    set is_completed = true
    where id = (select foreign_item from grocery_test_context);
    if found then raise exception 'FAIL: GROCERY_CROSS_CLIENT_UPDATE_ALLOWED'; end if;
  end;

  begin
    delete from public.grocery_items
    where id = (select foreign_item from grocery_test_context);
    if found then raise exception 'FAIL: GROCERY_CROSS_CLIENT_DELETE_ALLOWED'; end if;
  end;
end
$$;
\echo PASS: GROCERY_CROSS_CLIENT_UPDATE_DELETE_DENIED

do $$
declare
  v_count integer;
begin
  begin
    update public.grocery_items
    set client_id = (select client_b from grocery_test_context)
    where id = (select own_item from grocery_test_context);
    if found then raise exception 'FAIL: GROCERY_OWNERSHIP_TRANSFER_ALLOWED'; end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.grocery_items (client_id, name)
    select client_a, '   ' from grocery_test_context;
    raise exception 'FAIL: GROCERY_BLANK_NAME_ALLOWED';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.grocery_items (client_id, name)
    select client_a, repeat('x', 121) from grocery_test_context;
    raise exception 'FAIL: GROCERY_OVERLONG_NAME_ALLOWED';
  exception when check_violation then
    null;
  end;

  insert into public.grocery_items (client_id, name)
  select client_a, 'Süt' from grocery_test_context;

  delete from public.grocery_items
  where id = (select added_item from grocery_test_context);
  get diagnostics v_count = row_count;
  if v_count <> 1
     or exists (select 1 from public.grocery_items where id = (select added_item from grocery_test_context)) then
    raise exception 'FAIL: GROCERY_OWN_DELETE';
  end if;
end
$$;
\echo PASS: GROCERY_OWNERSHIP_NAME_CHECK_DUPLICATE_OWN_DELETE

reset role;
do $$
begin
  if (select count(*) from public.grocery_items where id = (select foreign_item from grocery_test_context)) <> 1
     or (select client_id from public.grocery_items where id = (select own_item from grocery_test_context)) <> (select client_a from grocery_test_context)
     or (select count(*) from public.grocery_items where client_id = (select client_a from grocery_test_context) and name = 'Süt') <> 2
     or exists (select 1 from public.grocery_items where id = (select added_item from grocery_test_context)) then
    raise exception 'FAIL: GROCERY_POST_MUTATION_RUNTIME_STATE';
  end if;
end
$$;

set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'anon', true) \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true) \gset
do $$
begin
  begin
    perform count(*) from public.grocery_items;
    raise exception 'FAIL: GROCERY_ANON_SELECT_ALLOWED';
  exception when insufficient_privilege then
    null;
  end;
end
$$;
\echo PASS: GROCERY_ANON_DENIED

reset role;
select set_config('request.jwt.claim.sub', dietitian_a::text, true)
from grocery_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', dietitian_a::text, 'role', 'authenticated')::text, true)
from grocery_test_context \gset
set local role authenticated;
do $$
begin
  if exists (select 1 from public.grocery_items) then
    raise exception 'FAIL: GROCERY_DIETITIAN_SELECT_ALLOWED';
  end if;

  begin
    begin
      insert into public.grocery_items (client_id, name)
      select dietitian_a, 'Dietitian access' from grocery_test_context;
      if found then raise exception 'FAIL: GROCERY_DIETITIAN_INSERT_ALLOWED'; end if;
    exception when insufficient_privilege then
      null;
    end;
  end;
end
$$;
\echo PASS: GROCERY_DIETITIAN_DENIED

rollback;
\echo GROCERY_ITEMS_CONTRACT_PASS
