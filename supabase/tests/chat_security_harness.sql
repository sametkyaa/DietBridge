\set ON_ERROR_STOP on

\echo CHAT_SECURITY_HARNESS_START

begin;

create temporary table chat_test_context (
  run_id uuid not null,
  primary_dietitian_user_id uuid not null,
  active_client_user_id uuid not null,
  pending_client_user_id uuid not null,
  removed_client_user_id uuid not null,
  unrelated_user_id uuid not null,
  foreign_dietitian_user_id uuid not null,
  foreign_client_user_id uuid not null,
  direct_client_user_id uuid not null,
  active_relation_id uuid not null,
  pending_relation_id uuid not null,
  removed_relation_id uuid not null,
  foreign_active_relation_id uuid not null,
  direct_relation_id uuid not null,
  dietitian_client_message_id uuid not null,
  client_client_message_id uuid not null,
  long_client_message_id uuid not null,
  pending_client_message_id uuid not null,
  removed_client_message_id uuid not null,
  unrelated_client_message_id uuid not null,
  empty_client_message_id uuid not null,
  overlong_client_message_id uuid not null,
  foreign_client_message_id uuid not null,
  unknown_message_id uuid not null,
  active_conversation_id uuid,
  foreign_conversation_id uuid,
  dietitian_message_id uuid,
  client_message_id uuid,
  long_message_id uuid,
  foreign_message_id uuid,
  newest_message_id uuid,
  older_message_id uuid
) on commit drop;

grant select, update on table chat_test_context to authenticated;
grant select on table chat_test_context to anon;

insert into chat_test_context (
  run_id,
  primary_dietitian_user_id,
  active_client_user_id,
  pending_client_user_id,
  removed_client_user_id,
  unrelated_user_id,
  foreign_dietitian_user_id,
  foreign_client_user_id,
  direct_client_user_id,
  active_relation_id,
  pending_relation_id,
  removed_relation_id,
  foreign_active_relation_id,
  direct_relation_id,
  dietitian_client_message_id,
  client_client_message_id,
  long_client_message_id,
  pending_client_message_id,
  removed_client_message_id,
  unrelated_client_message_id,
  empty_client_message_id,
  overlong_client_message_id,
  foreign_client_message_id,
  unknown_message_id
)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid()
);

-- auth.users inserts invoke the production onboarding trigger. The trigger,
-- rather than this harness, creates every profile row.
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
select
  user_id,
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'chat-harness+' || context.run_id::text || '-' || fixture_role || '@example.invalid',
  '$2a$10$fixturefixturefixturefixturefixturefixturefixturefixture',
  now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('account_type', account_type, 'full_name', full_name),
  now(),
  now()
from chat_test_context as context
cross join lateral (
  values
    (context.primary_dietitian_user_id, 'primary-dietitian', 'dietitian', 'Chat Harness Primary Dietitian'),
    (context.active_client_user_id, 'active-client', 'client', 'Chat Harness Active Client'),
    (context.pending_client_user_id, 'pending-client', 'client', 'Chat Harness Pending Client'),
    (context.removed_client_user_id, 'removed-client', 'client', 'Chat Harness Removed Client'),
    (context.unrelated_user_id, 'unrelated', 'client', 'Chat Harness Unrelated'),
    (context.foreign_dietitian_user_id, 'foreign-dietitian', 'dietitian', 'Chat Harness Foreign Dietitian'),
    (context.foreign_client_user_id, 'foreign-client', 'client', 'Chat Harness Foreign Client'),
    (context.direct_client_user_id, 'direct-client', 'client', 'Chat Harness Direct Client')
) as fixture(user_id, fixture_role, account_type, full_name);

do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = (select primary_dietitian_user_id from chat_test_context)
      and role = 'dietitian'::public.user_role
  )
  or not exists (
    select 1 from public.profiles
    where id = (select active_client_user_id from chat_test_context)
      and role = 'client'::public.user_role
  )
  or not exists (
    select 1 from public.dietitian_profiles
    where user_id in (
      (select primary_dietitian_user_id from chat_test_context),
      (select foreign_dietitian_user_id from chat_test_context)
    )
    group by 1 having count(*) = 2
  )
  or not exists (
    select 1 from public.client_profiles
    where user_id in (
      (select active_client_user_id from chat_test_context),
      (select pending_client_user_id from chat_test_context),
      (select removed_client_user_id from chat_test_context),
      (select unrelated_user_id from chat_test_context),
      (select foreign_client_user_id from chat_test_context),
      (select direct_client_user_id from chat_test_context)
    )
    group by 1 having count(*) = 6
  ) then
    raise exception 'FAIL: FIXTURE_ONBOARDING_CONTRACT';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_index as i
    join pg_class as index_class on index_class.oid = i.indexrelid
    join pg_class as table_class on table_class.oid = i.indrelid
    join pg_namespace as table_namespace on table_namespace.oid = table_class.relnamespace
    where table_namespace.nspname = 'public'
      and table_class.relname = 'dietitian_clients'
      and index_class.relname = 'one_pending_or_active_dietitian_per_client'
      and i.indisunique
      and i.indpred is not null
      and i.indnkeyatts = 1
      and (
        select array_agg(attribute.attname::text order by key_column.ordinality)
        from unnest(i.indkey::smallint[]) with ordinality as key_column(attnum, ordinality)
        join pg_attribute as attribute
          on attribute.attrelid = i.indrelid
         and attribute.attnum = key_column.attnum
        where key_column.ordinality <= i.indnkeyatts
      ) = array['client_id']::text[]
      and pg_get_expr(i.indpred, i.indrelid) ~ 'status'
      and pg_get_expr(i.indpred, i.indrelid) ~ 'pending'
      and pg_get_expr(i.indpred, i.indrelid) ~ 'active'
  ) then
    raise exception 'FAIL: RELATIONSHIP_UNIQUE_CONTRACT_PRECONDITION';
  end if;
end
$$;

-- Lifecycle trigger accepts pending inserts only; transition fixture rows to
-- their required states inside this transaction.
insert into public.dietitian_clients (id, dietitian_id, client_id, status)
select active_relation_id, primary_dietitian_user_id, active_client_user_id, 'pending'::public.client_status
from chat_test_context
union all
select pending_relation_id, primary_dietitian_user_id, pending_client_user_id, 'pending'::public.client_status
from chat_test_context
union all
select removed_relation_id, primary_dietitian_user_id, removed_client_user_id, 'pending'::public.client_status
from chat_test_context
union all
select foreign_active_relation_id, foreign_dietitian_user_id, foreign_client_user_id, 'pending'::public.client_status
from chat_test_context
union all
select direct_relation_id, primary_dietitian_user_id, direct_client_user_id, 'pending'::public.client_status
from chat_test_context;

update public.dietitian_clients
set status = case
  when id in (
    (select active_relation_id from chat_test_context),
    (select foreign_active_relation_id from chat_test_context),
    (select direct_relation_id from chat_test_context)
  ) then 'active'::public.client_status
  when id = (select removed_relation_id from chat_test_context)
    then 'removed'::public.client_status
  else status
end
where id in (
  (select active_relation_id from chat_test_context),
  (select foreign_active_relation_id from chat_test_context),
  (select direct_relation_id from chat_test_context),
  (select removed_relation_id from chat_test_context)
);

do $$
begin
  if (select count(*)
      from public.dietitian_clients
      where id in (
        (select active_relation_id from chat_test_context),
        (select pending_relation_id from chat_test_context),
        (select removed_relation_id from chat_test_context),
        (select foreign_active_relation_id from chat_test_context),
        (select direct_relation_id from chat_test_context)
      )) <> 5
  or not exists (
    select 1 from public.dietitian_clients
    where id = (select active_relation_id from chat_test_context)
      and dietitian_id = (select primary_dietitian_user_id from chat_test_context)
      and client_id = (select active_client_user_id from chat_test_context)
      and status = 'active'::public.client_status
  )
  or not exists (
    select 1 from public.dietitian_clients
    where id = (select pending_relation_id from chat_test_context)
      and dietitian_id = (select primary_dietitian_user_id from chat_test_context)
      and client_id = (select pending_client_user_id from chat_test_context)
      and status = 'pending'::public.client_status
  )
  or not exists (
    select 1 from public.dietitian_clients
    where id = (select removed_relation_id from chat_test_context)
      and dietitian_id = (select primary_dietitian_user_id from chat_test_context)
      and client_id = (select removed_client_user_id from chat_test_context)
      and status = 'removed'::public.client_status
  )
  or not exists (
    select 1 from public.dietitian_clients
    where id = (select foreign_active_relation_id from chat_test_context)
      and dietitian_id = (select foreign_dietitian_user_id from chat_test_context)
      and client_id = (select foreign_client_user_id from chat_test_context)
      and status = 'active'::public.client_status
  )
  or not exists (
    select 1 from public.dietitian_clients
    where id = (select direct_relation_id from chat_test_context)
      and dietitian_id = (select primary_dietitian_user_id from chat_test_context)
      and client_id = (select direct_client_user_id from chat_test_context)
      and status = 'active'::public.client_status
  )
  or exists (
    select 1
    from public.dietitian_clients
    where id in (
      (select active_relation_id from chat_test_context),
      (select pending_relation_id from chat_test_context),
      (select removed_relation_id from chat_test_context),
      (select foreign_active_relation_id from chat_test_context),
      (select direct_relation_id from chat_test_context)
    )
      and (
        dietitian_id = (select unrelated_user_id from chat_test_context)
        or client_id = (select unrelated_user_id from chat_test_context)
      )
  )
  or exists (
    select 1
    from public.dietitian_clients as relationship
    where relationship.client_id in (
      (select active_client_user_id from chat_test_context),
      (select pending_client_user_id from chat_test_context),
      (select removed_client_user_id from chat_test_context),
      (select foreign_client_user_id from chat_test_context),
      (select direct_client_user_id from chat_test_context)
    )
      and relationship.status in ('pending'::public.client_status, 'active'::public.client_status)
    group by relationship.client_id
    having count(*) > 1
  ) then
    raise exception 'FAIL: RELATIONSHIP_FIXTURE_POSTCONDITION';
  end if;
end
$$;

-- Verify the installed auth.uid() implementation accepts the claim model used
-- below before any authorization assertion is trusted.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text,
  true
)
from chat_test_context \gset
do $$
begin
  if auth.uid() is distinct from (select primary_dietitian_user_id from chat_test_context) then
    raise exception 'FAIL: AUTH_UID_AUTHENTICATED_MAPPING';
  end if;
end
$$;
reset role;

set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'anon', true) \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true) \gset
do $$
begin
  if auth.uid() is not null then
    raise exception 'FAIL: AUTH_UID_ANON_MAPPING';
  end if;
end
$$;
reset role;

-- 1. send_chat_message rejects an authenticated database role without a user.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \gset
do $$
begin
  perform public.send_chat_message(
    (select active_relation_id from chat_test_context),
    (select unrelated_client_message_id from chat_test_context),
    'fixture'
  );
  raise exception 'FAIL: SEND_UNAUTHENTICATED_REJECTED';
exception when sqlstate '42501' then
  null;
end
$$;
reset role;
\echo PASS: SEND_UNAUTHENTICATED_REJECTED

-- 2. anon has no execute grant.
set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'anon', true) \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true) \gset
do $$
begin
  perform public.send_chat_message(
    (select active_relation_id from chat_test_context),
    (select unrelated_client_message_id from chat_test_context),
    'fixture'
  );
  raise exception 'FAIL: SEND_ANON_EXECUTE_REJECTED';
exception when sqlstate '42501' then
  null;
end
$$;
reset role;
\echo PASS: SEND_ANON_EXECUTE_REJECTED

-- 3. A valid but unrelated authenticated fixture cannot send.
set local role authenticated;
select set_config('request.jwt.claim.sub', unrelated_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', unrelated_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  perform public.send_chat_message(
    (select active_relation_id from chat_test_context),
    (select unrelated_client_message_id from chat_test_context),
    'fixture'
  );
  raise exception 'FAIL: SEND_UNRELATED_USER_REJECTED';
exception when sqlstate '42501' then
  null;
end
$$;
reset role;
\echo PASS: SEND_UNRELATED_USER_REJECTED

-- 4, 8, 12--15, and 19--20. The active dietitian creates the canonical row.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_message public.chat_messages%rowtype;
begin
  select *
    into v_message
    from public.send_chat_message(
      (select active_relation_id from chat_test_context),
      (select dietitian_client_message_id from chat_test_context),
      '  fixture initial body  '
    );

  update chat_test_context
  set dietitian_message_id = v_message.id,
      active_conversation_id = v_message.conversation_id;

  if v_message.body is distinct from 'fixture initial body'
     or v_message.sender_id is distinct from (select primary_dietitian_user_id from chat_test_context)
     or v_message.conversation_id is null
     or v_message.client_message_id is distinct from (select dietitian_client_message_id from chat_test_context)
     or v_message.created_at is null
     or v_message.message_text is not null then
    raise exception 'FAIL: SEND_ACTIVE_DIETITIAN_ALLOWED';
  end if;
end
$$;
reset role;
\echo PASS: SEND_ACTIVE_DIETITIAN_ALLOWED
\echo PASS: SEND_BODY_TRIMMED
\echo PASS: SEND_SENDER_DERIVED_FROM_AUTH_UID
\echo PASS: SEND_RELATION_ID_PRESERVED
\echo PASS: SEND_CANONICAL_COLUMNS_POPULATED
\echo PASS: SEND_LEGACY_COLUMNS_NOT_USED

do $$
begin
  if (select count(*) from public.chat_conversations
      where dietitian_client_id = (select active_relation_id from chat_test_context)) <> 1 then
    raise exception 'FAIL: SEND_CONVERSATION_CREATED_ONCE';
  end if;

  if not exists (
    select 1
    from public.chat_conversations as c
    where c.id = (select active_conversation_id from chat_test_context)
      and c.dietitian_id = (select primary_dietitian_user_id from chat_test_context)
      and c.client_id = (select active_client_user_id from chat_test_context)
  ) then
    raise exception 'FAIL: SEND_RECEIVER_DERIVED_FROM_RELATION';
  end if;
end
$$;
\echo PASS: SEND_RECEIVER_DERIVED_FROM_RELATION
\echo PASS: SEND_CONVERSATION_CREATED_ONCE

-- 5 and 18. Same client_message_id is valid for a different sender.
set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_message public.chat_messages%rowtype;
begin
  select *
    into v_message
    from public.send_chat_message(
      (select active_relation_id from chat_test_context),
      (select dietitian_client_message_id from chat_test_context),
      'fixture client reply'
    );

  update chat_test_context set client_message_id = v_message.id;

  if v_message.sender_id is distinct from (select active_client_user_id from chat_test_context)
     or v_message.conversation_id is distinct from (select active_conversation_id from chat_test_context) then
    raise exception 'FAIL: SEND_ACTIVE_CLIENT_ALLOWED';
  end if;
end
$$;
reset role;
\echo PASS: SEND_ACTIVE_CLIENT_ALLOWED
\echo PASS: SEND_CLIENT_MESSAGE_ID_SCOPE_VALID

-- 6. A pending relationship is a valid FK context but cannot send.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  perform public.send_chat_message(
    (select pending_relation_id from chat_test_context),
    (select pending_client_message_id from chat_test_context),
    'fixture'
  );
  raise exception 'FAIL: SEND_PENDING_RELATION_REJECTED';
exception when sqlstate '42501' then
  if exists (
    select 1 from public.chat_messages
    where sender_id = (select primary_dietitian_user_id from chat_test_context)
      and client_message_id = (select pending_client_message_id from chat_test_context)
  ) then
    raise exception 'FAIL: SEND_PENDING_RELATION_REJECTED';
  end if;
end
$$;
reset role;
\echo PASS: SEND_PENDING_RELATION_REJECTED

-- 7. A removed relationship is also a valid FK context but cannot send.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  perform public.send_chat_message(
    (select removed_relation_id from chat_test_context),
    (select removed_client_message_id from chat_test_context),
    'fixture'
  );
  raise exception 'FAIL: SEND_REMOVED_RELATION_REJECTED';
exception when sqlstate '42501' then
  if exists (
    select 1 from public.chat_messages
    where sender_id = (select primary_dietitian_user_id from chat_test_context)
      and client_message_id = (select removed_client_message_id from chat_test_context)
  ) then
    raise exception 'FAIL: SEND_REMOVED_RELATION_REJECTED';
  end if;
end
$$;
reset role;
\echo PASS: SEND_REMOVED_RELATION_REJECTED

-- 9--11. Body validation is evaluated before the write.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_message public.chat_messages%rowtype;
begin
  begin
    perform public.send_chat_message(
      (select active_relation_id from chat_test_context),
      (select empty_client_message_id from chat_test_context),
      '   '
    );
    raise exception 'FAIL: SEND_EMPTY_BODY_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;

  select *
    into v_message
    from public.send_chat_message(
      (select active_relation_id from chat_test_context),
      (select long_client_message_id from chat_test_context),
      repeat('x', 4000)
    );
  update chat_test_context set long_message_id = v_message.id;

  if char_length(v_message.body) <> 4000 then
    raise exception 'FAIL: SEND_4000_CHARACTERS_ALLOWED';
  end if;

  begin
    perform public.send_chat_message(
      (select active_relation_id from chat_test_context),
      (select overlong_client_message_id from chat_test_context),
      repeat('x', 4001)
    );
    raise exception 'FAIL: SEND_4001_CHARACTERS_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;
reset role;
\echo PASS: SEND_EMPTY_BODY_REJECTED
\echo PASS: SEND_4000_CHARACTERS_ALLOWED
\echo PASS: SEND_4001_CHARACTERS_REJECTED

-- 16--17. Retry returns exactly the original row and cannot create a second.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_retry public.chat_messages%rowtype;
begin
  select *
    into v_retry
    from public.send_chat_message(
      (select active_relation_id from chat_test_context),
      (select dietitian_client_message_id from chat_test_context),
      'fixture initial body'
    );

  if v_retry.id is distinct from (select dietitian_message_id from chat_test_context)
     or (select count(*) from public.chat_messages
         where sender_id = (select primary_dietitian_user_id from chat_test_context)
           and client_message_id = (select dietitian_client_message_id from chat_test_context)) <> 1 then
    raise exception 'FAIL: SEND_IDEMPOTENT_RETRY_RETURNS_SAME_MESSAGE';
  end if;
end
$$;
reset role;
\echo PASS: SEND_IDEMPOTENT_RETRY_RETURNS_SAME_MESSAGE
\echo PASS: SEND_IDEMPOTENT_RETRY_CREATES_ONE_ROW

do $$
begin
  if not exists (
    select 1
    from public.chat_conversations as c
    join public.chat_messages as m on m.id = c.last_message_id
    where c.id = (select active_conversation_id from chat_test_context)
      and c.last_message_id = (select long_message_id from chat_test_context)
      and c.last_message_at = m.created_at
  ) then
    raise exception 'FAIL: SEND_CONVERSATION_LAST_MESSAGE_POINTER_UPDATED';
  end if;
end
$$;
\echo PASS: SEND_CONVERSATION_LAST_MESSAGE_POINTER_UPDATED
\echo PASS: SEND_CONVERSATION_LAST_MESSAGE_TIME_UPDATED

-- Create a separate fixture conversation for foreign-pointer checks.
set local role authenticated;
select set_config('request.jwt.claim.sub', foreign_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', foreign_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_message public.chat_messages%rowtype;
begin
  select *
    into v_message
    from public.send_chat_message(
      (select foreign_active_relation_id from chat_test_context),
      (select foreign_client_message_id from chat_test_context),
      'fixture foreign body'
    );
  update chat_test_context
  set foreign_message_id = v_message.id,
      foreign_conversation_id = v_message.conversation_id;
end
$$;
reset role;

-- Establish the real cursor order (created_at asc, id asc) from fixture rows.
do $$
begin
  update chat_test_context
  set older_message_id = (
        select m.id
        from public.chat_messages as m
        where m.conversation_id = chat_test_context.active_conversation_id
        order by m.created_at asc, m.id asc
        limit 1
      ),
      newest_message_id = (
        select m.id
        from public.chat_messages as m
        where m.conversation_id = chat_test_context.active_conversation_id
        order by m.created_at desc, m.id desc
        limit 1
      );

  if (select older_message_id from chat_test_context) is null
     or (select newest_message_id from chat_test_context) is null
     or (select older_message_id from chat_test_context)
        = (select newest_message_id from chat_test_context) then
    raise exception 'FAIL: CURSOR_FIXTURE_ORDER';
  end if;
end
$$;

-- 23. Authenticated role without a subject is rejected.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', '{"role":"authenticated"}', true) \gset
do $$
begin
  perform public.mark_chat_conversation_read(
    (select active_conversation_id from chat_test_context),
    (select newest_message_id from chat_test_context)
  );
  raise exception 'FAIL: READ_UNAUTHENTICATED_REJECTED';
exception when sqlstate '42501' then
  null;
end
$$;
reset role;
\echo PASS: READ_UNAUTHENTICATED_REJECTED

-- 24. anon has no execute grant.
set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
select set_config('request.jwt.claim.role', 'anon', true) \gset
select set_config('request.jwt.claims', '{"role":"anon"}', true) \gset
do $$
begin
  perform public.mark_chat_conversation_read(
    (select active_conversation_id from chat_test_context),
    (select newest_message_id from chat_test_context)
  );
  raise exception 'FAIL: READ_ANON_EXECUTE_REJECTED';
exception when sqlstate '42501' then
  null;
end
$$;
reset role;
\echo PASS: READ_ANON_EXECUTE_REJECTED

-- 25. A real but unrelated fixture cannot advance the active conversation.
set local role authenticated;
select set_config('request.jwt.claim.sub', unrelated_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', unrelated_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  perform public.mark_chat_conversation_read(
    (select active_conversation_id from chat_test_context),
    (select newest_message_id from chat_test_context)
  );
  raise exception 'FAIL: READ_UNRELATED_USER_REJECTED';
exception when sqlstate '42501' then
  null;
end
$$;
reset role;
\echo PASS: READ_UNRELATED_USER_REJECTED

-- 26, 29, 32, and 34. The participant can create only their own read-state.
set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_result public.chat_read_states%rowtype;
  v_persisted public.chat_read_states%rowtype;
begin
  select *
    into v_result
    from public.mark_chat_conversation_read(
      (select active_conversation_id from chat_test_context),
      (select newest_message_id from chat_test_context)
    );

  select *
    into v_persisted
    from public.chat_read_states
    where conversation_id = (select active_conversation_id from chat_test_context)
      and user_id = (select active_client_user_id from chat_test_context);

  if v_result.last_read_message_id is distinct from (select newest_message_id from chat_test_context)
     or v_persisted.last_read_message_id is distinct from v_result.last_read_message_id
     or v_persisted.user_id is distinct from (select active_client_user_id from chat_test_context) then
    raise exception 'FAIL: READ_PARTICIPANT_ALLOWED';
  end if;
end
$$;
reset role;
\echo PASS: READ_PARTICIPANT_ALLOWED
\echo PASS: READ_CURSOR_ADVANCES
\echo PASS: READ_WRITES_CALLER_STATE_ONLY
\echo PASS: READ_RPC_RESULT_MATCHES_PERSISTED_STATE

-- 27--28. Foreign and unknown IDs are distinct valid UUIDs with the expected
-- invalid-pointer SQLSTATE.
set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  begin
    perform public.mark_chat_conversation_read(
      (select active_conversation_id from chat_test_context),
      (select foreign_message_id from chat_test_context)
    );
    raise exception 'FAIL: READ_FOREIGN_CONVERSATION_MESSAGE_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.mark_chat_conversation_read(
      (select active_conversation_id from chat_test_context),
      (select unknown_message_id from chat_test_context)
    );
    raise exception 'FAIL: READ_UNKNOWN_MESSAGE_REJECTED';
  exception when sqlstate '22023' then
    null;
  end;
end
$$;
reset role;
\echo PASS: READ_FOREIGN_CONVERSATION_MESSAGE_REJECTED
\echo PASS: READ_UNKNOWN_MESSAGE_REJECTED

-- 30--31 and 33. Equal and older cursors cannot create or regress state.
set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
declare
  v_same public.chat_read_states%rowtype;
  v_older public.chat_read_states%rowtype;
begin
  select *
    into v_same
    from public.mark_chat_conversation_read(
      (select active_conversation_id from chat_test_context),
      (select newest_message_id from chat_test_context)
    );

  select *
    into v_older
    from public.mark_chat_conversation_read(
      (select active_conversation_id from chat_test_context),
      (select older_message_id from chat_test_context)
    );

  if v_same.last_read_message_id is distinct from (select newest_message_id from chat_test_context)
     or v_older.last_read_message_id is distinct from (select newest_message_id from chat_test_context)
     or (select count(*) from public.chat_read_states
         where conversation_id = (select active_conversation_id from chat_test_context)
           and user_id = (select active_client_user_id from chat_test_context)) <> 1
     or exists (
       select 1 from public.chat_read_states
       where conversation_id = (select active_conversation_id from chat_test_context)
         and user_id = (select primary_dietitian_user_id from chat_test_context)
     ) then
    raise exception 'FAIL: READ_SAME_CURSOR_IDEMPOTENT';
  end if;
end
$$;
reset role;
\echo PASS: READ_SAME_CURSOR_IDEMPOTENT
\echo PASS: READ_OLDER_CURSOR_DOES_NOT_REGRESS
\echo PASS: READ_OTHER_PARTICIPANT_STATE_UNCHANGED

-- 35--38. These statements use valid fixture FKs; insufficient privilege must
-- occur before any data mutation and each test verifies that postcondition.
set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  begin
    insert into public.chat_conversations (dietitian_client_id, dietitian_id, client_id)
    values (
      (select direct_relation_id from chat_test_context),
      (select primary_dietitian_user_id from chat_test_context),
      (select direct_client_user_id from chat_test_context)
    );
    raise exception 'FAIL: TABLE_DIRECT_INSERT_REJECTED';
  exception when sqlstate '42501' then
    if exists (
      select 1 from public.chat_conversations
      where dietitian_client_id = (select direct_relation_id from chat_test_context)
    ) then
      raise exception 'FAIL: TABLE_DIRECT_INSERT_REJECTED';
    end if;
  end;

  begin
    update public.chat_messages
    set body = body
    where id = (select dietitian_message_id from chat_test_context);
    raise exception 'FAIL: TABLE_DIRECT_UPDATE_REJECTED';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    delete from public.chat_messages
    where id = (select dietitian_message_id from chat_test_context);
    raise exception 'FAIL: TABLE_DIRECT_DELETE_REJECTED';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    truncate table public.chat_messages;
    raise exception 'FAIL: TABLE_DIRECT_TRUNCATE_REJECTED';
  exception when sqlstate '42501' then
    null;
  end;

  if not exists (
    select 1 from public.chat_messages
    where id = (select dietitian_message_id from chat_test_context)
      and body = 'fixture initial body'
  )
  or (select count(*) from public.chat_messages
      where conversation_id = (select active_conversation_id from chat_test_context)) < 3 then
    raise exception 'FAIL: TABLE_DIRECT_DML_POSTCONDITION';
  end if;
end
$$;
reset role;
\echo PASS: TABLE_DIRECT_INSERT_REJECTED
\echo PASS: TABLE_DIRECT_UPDATE_REJECTED
\echo PASS: TABLE_DIRECT_DELETE_REJECTED
\echo PASS: TABLE_DIRECT_TRUNCATE_REJECTED

-- 39--41. RLS hides every unrelated conversation/message/read-state row and
-- exposes a participant only to their own read-state.
set local role authenticated;
select set_config('request.jwt.claim.sub', unrelated_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', unrelated_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  if exists (
    select 1 from public.chat_conversations
    where id = (select active_conversation_id from chat_test_context)
  ) then
    raise exception 'FAIL: RLS_UNRELATED_CONVERSATION_HIDDEN';
  end if;

  if exists (
    select 1 from public.chat_messages
    where conversation_id = (select active_conversation_id from chat_test_context)
  ) then
    raise exception 'FAIL: RLS_UNRELATED_MESSAGE_HIDDEN';
  end if;

  if exists (
    select 1 from public.chat_read_states
    where conversation_id = (select active_conversation_id from chat_test_context)
  ) then
    raise exception 'FAIL: RLS_READ_STATE_OWN_ONLY';
  end if;
end
$$;
reset role;
\echo PASS: RLS_UNRELATED_CONVERSATION_HIDDEN
\echo PASS: RLS_UNRELATED_MESSAGE_HIDDEN

set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  if (select count(*) from public.chat_read_states
      where conversation_id = (select active_conversation_id from chat_test_context)) <> 1
     or exists (
       select 1 from public.chat_read_states
       where conversation_id = (select active_conversation_id from chat_test_context)
         and user_id = (select primary_dietitian_user_id from chat_test_context)
     ) then
    raise exception 'FAIL: RLS_READ_STATE_OWN_ONLY';
  end if;
end
$$;
reset role;
\echo PASS: RLS_READ_STATE_OWN_ONLY

-- 42. Both participants can read their fixture-scoped conversation and rows.
set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  if (select count(*) from public.chat_conversations
      where id = (select active_conversation_id from chat_test_context)) <> 1
     or (select count(*) from public.chat_messages
         where conversation_id = (select active_conversation_id from chat_test_context)) < 3 then
    raise exception 'FAIL: RLS_PARTICIPANT_CONVERSATION_AND_MESSAGES_VISIBLE';
  end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true)
from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true)
from chat_test_context \gset
do $$
begin
  if (select count(*) from public.chat_conversations
      where id = (select active_conversation_id from chat_test_context)) <> 1
     or (select count(*) from public.chat_messages
         where conversation_id = (select active_conversation_id from chat_test_context)) < 3 then
    raise exception 'FAIL: RLS_PARTICIPANT_CONVERSATION_AND_MESSAGES_VISIBLE';
  end if;
end
$$;
reset role;
\echo PASS: RLS_PARTICIPANT_CONVERSATION_AND_MESSAGES_VISIBLE

-- Delete and delivery/read receipt contract. These checks intentionally run
-- last because the soft delete mutates a fixture message.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'deleted_by'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chat_read_states' and column_name = 'last_delivered_message_id'
  ) or not has_function_privilege('authenticated', 'public.delete_chat_message(uuid)', 'EXECUTE')
  or not has_function_privilege('authenticated', 'public.mark_chat_conversation_delivered(uuid,uuid)', 'EXECUTE')
  or has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE')
  or has_table_privilege('authenticated', 'public.chat_read_states', 'UPDATE') then
    raise exception 'FAIL: DELETE_RECEIPT_SCHEMA_AND_GRANTS';
  end if;
end
$$;
\echo PASS: DELETE_RECEIPT_SCHEMA_AND_GRANTS

set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true) from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true) from chat_test_context \gset
do $$
declare
  v_delivered public.chat_read_states%rowtype;
  v_same public.chat_read_states%rowtype;
  v_older public.chat_read_states%rowtype;
begin
  select * into v_delivered from public.mark_chat_conversation_delivered(
    (select active_conversation_id from chat_test_context),
    (select newest_message_id from chat_test_context)
  );
  select * into v_same from public.mark_chat_conversation_delivered(
    (select active_conversation_id from chat_test_context),
    (select newest_message_id from chat_test_context)
  );
  select * into v_older from public.mark_chat_conversation_delivered(
    (select active_conversation_id from chat_test_context),
    (select older_message_id from chat_test_context)
  );
  if v_delivered.user_id is distinct from (select active_client_user_id from chat_test_context)
     or v_delivered.last_delivered_message_id is distinct from (select newest_message_id from chat_test_context)
     or v_same.last_delivered_message_id is distinct from v_delivered.last_delivered_message_id
     or v_older.last_delivered_message_id is distinct from v_delivered.last_delivered_message_id
     or (v_delivered.last_read_message_id is not null and (v_delivered.last_delivered_at, v_delivered.last_delivered_message_id) < (v_delivered.last_read_at, v_delivered.last_read_message_id)) then
    raise exception 'FAIL: DELIVERY_CURSOR_MONOTONIC';
  end if;
  begin
    update public.chat_read_states set last_read_message_id = null
    where conversation_id = (select active_conversation_id from chat_test_context)
      and user_id = (select active_client_user_id from chat_test_context);
    raise exception 'FAIL: READ_STATE_DIRECT_UPDATE_REJECTED';
  exception when sqlstate '42501' then null;
  end;
end
$$;
reset role;
\echo PASS: DELIVERY_CURSOR_MONOTONIC
\echo PASS: READ_STATE_DIRECT_UPDATE_REJECTED

set local role authenticated;
select set_config('request.jwt.claim.sub', active_client_user_id::text, true) from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', active_client_user_id::text, 'role', 'authenticated')::text, true) from chat_test_context \gset
do $$
begin
  begin
    perform public.delete_chat_message((select dietitian_message_id from chat_test_context));
    raise exception 'FAIL: DELETE_OTHER_SENDER_REJECTED';
  exception when sqlstate '42501' then null;
  end;
end
$$;
reset role;
\echo PASS: DELETE_OTHER_SENDER_REJECTED

set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true) from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true) from chat_test_context \gset
do $$
declare
  v_deleted public.chat_messages%rowtype;
  v_repeat public.chat_messages%rowtype;
begin
  select * into v_deleted from public.delete_chat_message((select dietitian_message_id from chat_test_context));
  select * into v_repeat from public.delete_chat_message((select dietitian_message_id from chat_test_context));
  if v_deleted.body is not null or v_deleted.deleted_at is null
     or v_deleted.deleted_by is distinct from (select primary_dietitian_user_id from chat_test_context)
     or v_repeat.id is distinct from v_deleted.id or v_repeat.body is not null then
    raise exception 'FAIL: DELETE_SENDER_ONLY_IDEMPOTENT';
  end if;
end
$$;
reset role;
\echo PASS: DELETE_SENDER_ONLY_IDEMPOTENT

set local role authenticated;
select set_config('request.jwt.claim.sub', primary_dietitian_user_id::text, true) from chat_test_context \gset
select set_config('request.jwt.claim.role', 'authenticated', true) \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', primary_dietitian_user_id::text, 'role', 'authenticated')::text, true) from chat_test_context \gset
do $$
begin
  if not exists (
    select 1 from public.chat_read_states
    where conversation_id = (select active_conversation_id from chat_test_context)
      and user_id = (select active_client_user_id from chat_test_context)
  ) then
    raise exception 'FAIL: RLS_PARTICIPANT_PEER_RECEIPT_VISIBLE';
  end if;
end
$$;
reset role;
\echo PASS: RLS_PARTICIPANT_PEER_RECEIPT_VISIBLE

rollback;

\echo CHAT_SECURITY_HARNESS_PASS
