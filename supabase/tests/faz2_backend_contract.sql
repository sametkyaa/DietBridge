\set ON_ERROR_STOP on

-- Faz 2 backend contract matrix. Runs inside one transaction and rolls back.
-- Covers: meal change request security, unread counts, nutrition targets,
-- legal acceptance, dietitian activity notifications, gated plan-updated
-- notification, meal slot labels and the application result e-mail outbox.

\echo FAZ2_BACKEND_CONTRACT_START

begin;

create schema faz2_test;
grant usage on schema faz2_test to authenticated, anon, service_role;

create table faz2_test.ctx (
  dietitian_a uuid not null,
  dietitian_b uuid not null,
  dietitian_pending uuid not null,
  client_a uuid not null,
  client_b uuid not null,
  client_x uuid not null,
  client_legacy uuid not null,
  relation_a uuid,
  relation_b uuid,
  today date not null
);
grant select on faz2_test.ctx to authenticated, anon, service_role;

insert into faz2_test.ctx (dietitian_a, dietitian_b, dietitian_pending, client_a, client_b, client_x, client_legacy, today)
values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        gen_random_uuid(), gen_random_uuid(), (now() at time zone 'Europe/Istanbul')::date);

create function faz2_test.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end $$;

create function faz2_test.act_as_role(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', p_role)::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', p_role, true);
  execute format('set local role %I', p_role);
end $$;

create function faz2_test.reset_actor() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

-- Executes p_sql and asserts it fails with one of the expected SQLSTATEs.
create function faz2_test.expect_error(p_sql text, p_states text[], p_label text) returns void language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state is null then
    raise exception 'FAIL: % (statement succeeded)', p_label;
  end if;
  if not (v_state = any(p_states)) then
    raise exception 'FAIL: % (sqlstate % not in %)', p_label, v_state, p_states;
  end if;
  raise notice 'PASS: %', p_label;
end $$;

grant execute on all functions in schema faz2_test to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures (auth trigger creates profiles)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select f.user_id, gen_random_uuid(), 'authenticated', 'authenticated',
  'faz2+' || f.label || '-' || f.user_id::text || '@example.invalid',
  '$2a$10$fixturefixturefixturefixturefixturefixturefixturefixture', now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  f.meta, now(), now()
from faz2_test.ctx as c
cross join lateral (values
  (c.dietitian_a, 'dietitian-a', jsonb_build_object('account_type', 'dietitian', 'full_name', 'Dyt A', 'terms_accepted', true, 'kvkk_accepted', true)),
  (c.dietitian_b, 'dietitian-b', jsonb_build_object('account_type', 'dietitian', 'full_name', 'Dyt B')),
  (c.dietitian_pending, 'dietitian-p', jsonb_build_object('account_type', 'dietitian', 'full_name', 'Dyt P')),
  (c.client_a, 'client-a', jsonb_build_object('account_type', 'client', 'full_name', 'Client A', 'terms_accepted', 'true', 'kvkk_accepted', 'true')),
  (c.client_b, 'client-b', jsonb_build_object('account_type', 'client', 'full_name', 'Client B')),
  (c.client_x, 'client-x', jsonb_build_object('account_type', 'client', 'full_name', 'Client X')),
  (c.client_legacy, 'client-legacy', jsonb_build_object('account_type', 'client', 'full_name', 'Legacy Store Build'))
) as f(user_id, label, meta);

update public.dietitian_profiles as dp
   set verification_status = f.status, is_verified = f.status = 'approved'
  from faz2_test.ctx as c,
       lateral (values (c.dietitian_a, 'approved'), (c.dietitian_b, 'approved'), (c.dietitian_pending, 'pending')) as f(user_id, status)
 where dp.user_id = f.user_id;

insert into public.dietitian_subscriptions (dietitian_id, plan_id, status, client_limit_override)
select f.user_id, 'core', 'active', null
  from faz2_test.ctx as c
  cross join lateral (values (c.dietitian_a), (c.dietitian_b), (c.dietitian_pending)) as f(user_id)
on conflict (dietitian_id) do update set plan_id = excluded.plan_id, status = excluded.status;

insert into public.dietitian_clients (dietitian_id, client_id, status)
select dietitian_a, client_a, 'pending'::public.client_status from faz2_test.ctx
union all select dietitian_b, client_b, 'pending'::public.client_status from faz2_test.ctx
union all select dietitian_a, client_x, 'pending'::public.client_status from faz2_test.ctx;

update public.dietitian_clients
   set status = 'active'::public.client_status, accepted_at = now() - interval '10 days', updated_at = now()
 where (dietitian_id, client_id) in (
   select dietitian_a, client_a from faz2_test.ctx
   union all select dietitian_b, client_b from faz2_test.ctx);

-- The lifecycle trigger stamps accepted_at = now(); backdate it for the
-- inactivity window without firing triggers.
set local session_replication_role = replica;
update public.dietitian_clients set accepted_at = now() - interval '10 days'
 where (dietitian_id, client_id) in (
   select dietitian_a, client_a from faz2_test.ctx
   union all select dietitian_b, client_b from faz2_test.ctx);
set local session_replication_role = origin;

update faz2_test.ctx set
  relation_a = (select dc.id from public.dietitian_clients dc, faz2_test.ctx c where dc.dietitian_id = c.dietitian_a and dc.client_id = c.client_a),
  relation_b = (select dc.id from public.dietitian_clients dc, faz2_test.ctx c where dc.dietitian_id = c.dietitian_b and dc.client_id = c.client_b);

\echo PASS: FAZ2_FIXTURES

-- ===========================================================================
-- 1. Meal change request security
-- ===========================================================================
do $$
declare
  c faz2_test.ctx;
  v_request public.meal_change_requests;
  v_updated integer;
begin
  select * into c from faz2_test.ctx;

  -- Client inserts the exact shape the store mobile build sends.
  perform faz2_test.act_as(c.client_a);
  insert into public.meal_change_requests (client_id, dietitian_id, plan_date, meal_slot, requested_meals, notes, status)
  values (c.client_a, c.dietitian_a, c.today, 'lunch', '{"alternatives":["lunch"]}', 'Öğle değişsin', 'pending')
  returning * into v_request;
  if v_request.id is null or v_request.status <> 'pending' then
    raise exception 'FAIL: MCR_CLIENT_INSERT_TO_ACTIVE_DIETITIAN';
  end if;
  raise notice 'PASS: MCR_CLIENT_INSERT_TO_ACTIVE_DIETITIAN';

  perform faz2_test.expect_error(format(
    $q$insert into public.meal_change_requests (client_id, dietitian_id, plan_date, meal_slot, status)
       values (%L, %L, %L, 'lunch', 'pending')$q$, c.client_a, c.dietitian_b, c.today),
    array['42501'], 'MCR_CLIENT_CANNOT_TARGET_FOREIGN_DIETITIAN');
  perform faz2_test.expect_error(format(
    $q$insert into public.meal_change_requests (client_id, dietitian_id, plan_date, meal_slot, status)
       values (%L, %L, %L, 'lunch', 'approved')$q$, c.client_a, c.dietitian_a, c.today),
    array['42501'], 'MCR_CLIENT_CANNOT_INSERT_DECIDED_STATUS');
  perform faz2_test.expect_error(format(
    $q$insert into public.meal_change_requests (client_id, dietitian_id, plan_date, meal_slot, status, reviewed_at)
       values (%L, %L, %L, 'lunch', 'pending', now())$q$, c.client_a, c.dietitian_a, c.today),
    array['42501', '23514'], 'MCR_CLIENT_CANNOT_INSERT_REVIEW_METADATA');
  perform faz2_test.expect_error(format(
    $q$insert into public.meal_change_requests (client_id, dietitian_id, plan_date, meal_slot, status)
       values (%L, %L, %L, 'lunch', 'pending')$q$, c.client_b, c.dietitian_b, c.today),
    array['42501'], 'MCR_CLIENT_CANNOT_IMPERSONATE_OTHER_CLIENT');
  perform faz2_test.expect_error(format(
    $q$update public.meal_change_requests set status = 'approved' where id = %L$q$, v_request.id),
    array['42501'], 'MCR_CLIENT_CANNOT_UPDATE_STATUS');
  perform faz2_test.expect_error(format(
    $q$delete from public.meal_change_requests where id = %L$q$, v_request.id),
    array['42501'], 'MCR_CLIENT_CANNOT_DELETE');
  perform faz2_test.expect_error(format(
    $q$select public.review_meal_change_request(%L, 'approved')$q$, v_request.id),
    array['42501'], 'MCR_CLIENT_CANNOT_REVIEW_OWN_REQUEST');
  perform faz2_test.reset_actor();

  -- Client X has only a pending relationship with dietitian A.
  perform faz2_test.act_as(c.client_x);
  perform faz2_test.expect_error(format(
    $q$insert into public.meal_change_requests (client_id, dietitian_id, plan_date, meal_slot, status)
       values (%L, %L, %L, 'lunch', 'pending')$q$, c.client_x, c.dietitian_a, c.today),
    array['42501'], 'MCR_PENDING_RELATION_CANNOT_REQUEST');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_b);
  perform faz2_test.expect_error(format(
    $q$select public.review_meal_change_request(%L, 'approved')$q$, v_request.id),
    array['42501'], 'MCR_FOREIGN_DIETITIAN_CANNOT_REVIEW');
  if exists (select 1 from public.meal_change_requests where id = v_request.id) then
    raise exception 'FAIL: MCR_FOREIGN_DIETITIAN_CANNOT_READ';
  end if;
  raise notice 'PASS: MCR_FOREIGN_DIETITIAN_CANNOT_READ';
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_pending);
  perform faz2_test.expect_error(format(
    $q$select public.review_meal_change_request(%L, 'approved')$q$, v_request.id),
    array['42501'], 'MCR_UNAPPROVED_DIETITIAN_CANNOT_REVIEW');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as_role('anon');
  perform faz2_test.expect_error(format(
    $q$select public.review_meal_change_request(%L, 'approved')$q$, v_request.id),
    array['42501'], 'MCR_ANON_CANNOT_REVIEW');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_a);
  perform faz2_test.expect_error(format(
    $q$select public.review_meal_change_request(%L, 'cancelled')$q$, v_request.id),
    array['22023'], 'MCR_REVIEW_DECISION_VALIDATED');
  perform faz2_test.expect_error(format(
    $q$update public.meal_change_requests set status = 'approved' where id = %L$q$, v_request.id),
    array['42501'], 'MCR_DIETITIAN_CANNOT_UPDATE_DIRECTLY');

  select * into v_request from public.review_meal_change_request(v_request.id, 'rejected', '  Bu hafta değişiklik yok  ');
  if v_request.status <> 'rejected'
     or v_request.reviewed_by <> c.dietitian_a
     or v_request.reviewed_at is null
     or v_request.response_note <> 'Bu hafta değişiklik yok' then
    raise exception 'FAIL: MCR_ASSIGNED_DIETITIAN_REVIEWS';
  end if;
  raise notice 'PASS: MCR_ASSIGNED_DIETITIAN_REVIEWS';

  perform faz2_test.expect_error(format(
    $q$select public.review_meal_change_request(%L, 'approved')$q$, v_request.id),
    array['P0001'], 'MCR_DECISION_IS_FINAL');
  perform faz2_test.reset_actor();

  if (select count(*) from public.notifications n
       where n.recipient_id = c.dietitian_a
         and n.category = 'client_activity'
         and n.event_type = 'meal_change_requested'
         and n.meal_change_request_id = v_request.id
         and n.actor_id = c.client_a
         and n.dietitian_client_id = c.relation_a) <> 1 then
    raise exception 'FAIL: MCR_NOTIFIES_ASSIGNED_DIETITIAN_ONCE';
  end if;
  if exists (select 1 from public.notifications where recipient_id = c.dietitian_b and category = 'client_activity') then
    raise exception 'FAIL: MCR_NO_CROSS_DIETITIAN_NOTIFICATION';
  end if;
  raise notice 'PASS: MCR_NOTIFIES_ASSIGNED_DIETITIAN_ONCE';
end
$$;

-- ===========================================================================
-- 2. Unread message counts
-- ===========================================================================
do $$
declare
  c faz2_test.ctx;
  v_m1 public.chat_messages;
  v_m2 public.chat_messages;
  v_m3 public.chat_messages;
  v_count integer;
  v_conversation uuid;
begin
  select * into c from faz2_test.ctx;

  perform faz2_test.act_as(c.client_a);
  select * into v_m1 from public.send_chat_message(c.relation_a, gen_random_uuid(), 'Merhaba');
  select * into v_m2 from public.send_chat_message(c.relation_a, gen_random_uuid(), 'Bir sorum var');
  select * into v_m3 from public.send_chat_message(c.relation_a, gen_random_uuid(), 'Silinecek');
  perform public.delete_chat_message(v_m3.id);
  perform faz2_test.reset_actor();
  v_conversation := v_m1.conversation_id;

  -- Messages sent in one transaction share now(); give them distinct, ordered
  -- timestamps (as in production) without firing the chat contract triggers.
  set local session_replication_role = replica;
  update public.chat_messages set created_at = now() - interval '3 minutes' where id = v_m1.id;
  update public.chat_messages set created_at = now() - interval '2 minutes' where id = v_m2.id;
  update public.chat_messages set created_at = now() - interval '1 minute' where id = v_m3.id;
  set local session_replication_role = origin;

  perform faz2_test.act_as(c.dietitian_a);
  perform public.send_chat_message(c.relation_a, gen_random_uuid(), 'Diyetisyen yanıtı');
  select u.unread_count into v_count from public.get_dietitian_unread_counts() u where u.conversation_id = v_conversation;
  if v_count is distinct from 2 then
    raise exception 'FAIL: UNREAD_COUNTS_CLIENT_NON_DELETED_ONLY (got %)', v_count;
  end if;
  raise notice 'PASS: UNREAD_COUNTS_CLIENT_NON_DELETED_ONLY';

  perform public.mark_chat_conversation_read(v_conversation, v_m1.id);
  select u.unread_count into v_count from public.get_dietitian_unread_counts() u where u.conversation_id = v_conversation;
  if v_count is distinct from 1 then
    raise exception 'FAIL: UNREAD_COUNTS_AFTER_READ_CURSOR (got %)', v_count;
  end if;
  raise notice 'PASS: UNREAD_COUNTS_AFTER_READ_CURSOR';

  perform public.mark_chat_conversation_read(v_conversation, v_m2.id);
  select u.unread_count into v_count from public.get_dietitian_unread_counts() u where u.conversation_id = v_conversation;
  if v_count is distinct from 0 then
    raise exception 'FAIL: UNREAD_COUNTS_ZERO_AFTER_OPEN (got %)', v_count;
  end if;
  raise notice 'PASS: UNREAD_COUNTS_ZERO_AFTER_OPEN';
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_b);
  if exists (select 1 from public.get_dietitian_unread_counts() u where u.conversation_id = v_conversation) then
    raise exception 'FAIL: UNREAD_COUNTS_CROSS_DIETITIAN_ISOLATION';
  end if;
  raise notice 'PASS: UNREAD_COUNTS_CROSS_DIETITIAN_ISOLATION';
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.client_a);
  perform faz2_test.expect_error('select * from public.get_dietitian_unread_counts()', array['42501'], 'UNREAD_COUNTS_CLIENT_DENIED');
  perform faz2_test.reset_actor();
  perform faz2_test.act_as(c.dietitian_pending);
  perform faz2_test.expect_error('select * from public.get_dietitian_unread_counts()', array['42501'], 'UNREAD_COUNTS_UNAPPROVED_DIETITIAN_DENIED');
  perform faz2_test.reset_actor();
  perform faz2_test.act_as_role('anon');
  perform faz2_test.expect_error('select * from public.get_dietitian_unread_counts()', array['42501'], 'UNREAD_COUNTS_ANON_DENIED');
  perform faz2_test.reset_actor();
end
$$;

-- ===========================================================================
-- 3. Client nutrition targets
-- ===========================================================================
do $$
declare
  c faz2_test.ctx;
  v_target public.client_nutrition_targets;
begin
  select * into c from faz2_test.ctx;

  perform faz2_test.act_as(c.dietitian_a);
  select * into v_target from public.set_client_nutrition_target(c.client_a, 1600, 1800);
  if v_target.min_kcal <> 1600 or v_target.max_kcal <> 1800 or v_target.dietitian_id <> c.dietitian_a then
    raise exception 'FAIL: TARGET_DIETITIAN_UPSERT';
  end if;
  select * into v_target from public.set_client_nutrition_target(c.client_a, null, 1900);
  if v_target.min_kcal is not null or v_target.max_kcal <> 1900 then
    raise exception 'FAIL: TARGET_SINGLE_BOUND_NOT_ESTIMATED';
  end if;
  raise notice 'PASS: TARGET_DIETITIAN_UPSERT';
  perform faz2_test.expect_error(format('select public.set_client_nutrition_target(%L, 1900, 1800)', c.client_a), array['22023'], 'TARGET_ORDER_VALIDATED');
  perform faz2_test.expect_error(format('select public.set_client_nutrition_target(%L, 200, null)', c.client_a), array['22023'], 'TARGET_RANGE_VALIDATED');
  perform faz2_test.expect_error(format('select public.set_client_nutrition_target(%L, 1500, 1700)', c.client_x), array['42501'], 'TARGET_PENDING_RELATION_DENIED');
  perform faz2_test.expect_error(format(
    $q$insert into public.client_nutrition_targets (dietitian_id, client_id, min_kcal) values (%L, %L, 1500)$q$, c.dietitian_a, c.client_b),
    array['42501'], 'TARGET_DIRECT_INSERT_DENIED');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_b);
  perform faz2_test.expect_error(format('select public.set_client_nutrition_target(%L, 1500, 1700)', c.client_a), array['42501'], 'TARGET_FOREIGN_DIETITIAN_DENIED');
  if exists (select 1 from public.client_nutrition_targets where client_id = c.client_a) then
    raise exception 'FAIL: TARGET_FOREIGN_DIETITIAN_CANNOT_READ';
  end if;
  raise notice 'PASS: TARGET_FOREIGN_DIETITIAN_CANNOT_READ';
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.client_a);
  if (select max_kcal from public.client_nutrition_targets where client_id = c.client_a) is distinct from 1900 then
    raise exception 'FAIL: TARGET_CLIENT_CAN_READ_OWN';
  end if;
  raise notice 'PASS: TARGET_CLIENT_CAN_READ_OWN';
  perform faz2_test.expect_error(format(
    $q$update public.client_nutrition_targets set max_kcal = 3000 where client_id = %L$q$, c.client_a),
    array['42501'], 'TARGET_CLIENT_CANNOT_UPDATE');
  perform faz2_test.expect_error(format('select public.set_client_nutrition_target(%L, 1500, 1700)', c.client_a), array['42501'], 'TARGET_CLIENT_CANNOT_CALL_RPC');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.client_b);
  if exists (select 1 from public.client_nutrition_targets where client_id = c.client_a) then
    raise exception 'FAIL: TARGET_OTHER_CLIENT_CANNOT_READ';
  end if;
  raise notice 'PASS: TARGET_OTHER_CLIENT_CANNOT_READ';
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_a);
  perform public.set_client_nutrition_target(c.client_a, null, null);
  if exists (select 1 from public.client_nutrition_targets where client_id = c.client_a) then
    raise exception 'FAIL: TARGET_CLEAR_DELETES';
  end if;
  raise notice 'PASS: TARGET_CLEAR_DELETES';
  perform public.set_client_nutrition_target(c.client_a, 1600, 1800);
  perform faz2_test.reset_actor();
end
$$;

-- ===========================================================================
-- 4. Legal acceptance
-- ===========================================================================
do $$
declare
  c faz2_test.ctx;
  v_terms timestamptz;
  v_kvkk timestamptz;
  v_terms_again timestamptz;
begin
  select * into c from faz2_test.ctx;

  if (select terms_accepted_at is null or kvkk_accepted_at is null from public.profiles where id = c.client_a)
     or (select terms_accepted_at is null or kvkk_accepted_at is null from public.profiles where id = c.dietitian_a) then
    raise exception 'FAIL: LEGAL_SIGNUP_FLAGS_RECORD_SERVER_TIME';
  end if;
  raise notice 'PASS: LEGAL_SIGNUP_FLAGS_RECORD_SERVER_TIME';

  if (select terms_accepted_at is not null or kvkk_accepted_at is not null from public.profiles where id = c.client_legacy)
     or not exists (select 1 from public.client_profiles where user_id = c.client_legacy) then
    raise exception 'FAIL: LEGAL_LEGACY_SIGNUP_STILL_CREATES_ACCOUNT';
  end if;
  raise notice 'PASS: LEGAL_LEGACY_SIGNUP_STILL_CREATES_ACCOUNT';

  perform faz2_test.act_as(c.client_legacy);
  perform faz2_test.expect_error(format(
    $q$update public.profiles set terms_accepted_at = '2020-01-01' where id = %L$q$, c.client_legacy),
    array['42501'], 'LEGAL_CLIENT_CANNOT_BACKDATE');
  perform faz2_test.expect_error(format(
    $q$update public.profiles set kvkk_accepted_at = now() where id = %L$q$, c.client_legacy),
    array['42501'], 'LEGAL_CLIENT_CANNOT_SELF_STAMP');
  -- Unrelated profile edits keep working.
  update public.profiles set full_name = 'Legacy Store Build 2' where id = c.client_legacy;

  select r.terms_accepted_at, r.kvkk_accepted_at into v_terms, v_kvkk from public.accept_legal_terms() r;
  if v_terms is null or v_kvkk is null then
    raise exception 'FAIL: LEGAL_ACCEPT_RPC_STAMPS';
  end if;
  select r.terms_accepted_at into v_terms_again from public.accept_legal_terms() r;
  if v_terms_again is distinct from v_terms then
    raise exception 'FAIL: LEGAL_ACCEPT_RPC_IDEMPOTENT';
  end if;
  raise notice 'PASS: LEGAL_ACCEPT_RPC_STAMPS_ONCE';
  perform faz2_test.reset_actor();

  perform faz2_test.act_as_role('anon');
  perform faz2_test.expect_error('select * from public.accept_legal_terms()', array['42501'], 'LEGAL_ACCEPT_ANON_DENIED');
  perform faz2_test.reset_actor();
end
$$;

-- ===========================================================================
-- 5. Weekly plan: slot labels + gated plan-updated notification
-- ===========================================================================
create function faz2_test.week_payload(p_week_start date, p_meals jsonb) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
      'plan_date', (p_week_start + d)::text,
      'notes', null,
      'meals', case when d = 0 then p_meals else '[]'::jsonb end
    ) order by d)
  from generate_series(0, 6) as d;
$$;
grant execute on function faz2_test.week_payload(date, jsonb) to authenticated;

do $$
declare
  c faz2_test.ctx;
  v_week date;
  v_result jsonb;
  v_meal_id uuid;
  v_label text;
begin
  select * into c from faz2_test.ctx;
  v_week := c.today - (extract(isodow from c.today)::integer - 1) + 7;

  perform faz2_test.act_as(c.dietitian_a);
  v_result := public.save_weekly_meal_plan(c.client_a, v_week, faz2_test.week_payload(v_week, jsonb_build_array(
    jsonb_build_object('type', 'snack', 'title', 'Muz', 'time', '17:30', 'sort_order', 0, 'source', 'manual',
      'macros', jsonb_build_object('protein', 1, 'carbs', 27, 'fat', 0), 'calories', 105, 'slot_label', '  Antrenman öncesi  '),
    jsonb_build_object('type', 'breakfast', 'title', 'Yulaf', 'time', '08:00', 'sort_order', 1, 'source', 'manual',
      'macros', jsonb_build_object('protein', 10, 'carbs', 40, 'fat', 6), 'calories', 300)
  )));
  v_meal_id := (v_result -> 'plans' -> 0 -> 'meals' -> 0 ->> 'id')::uuid;
  if (v_result -> 'plans' -> 0 -> 'meals' -> 0 ->> 'slot_label') is distinct from 'Antrenman öncesi'
     or (v_result -> 'plans' -> 0 -> 'meals' -> 1 -> 'slot_label') <> 'null'::jsonb then
    raise exception 'FAIL: SLOT_LABEL_SAVED_AND_TRIMMED %', v_result;
  end if;
  raise notice 'PASS: SLOT_LABEL_SAVED_AND_TRIMMED';

  -- Payload without the key (older Web build) keeps the stored label.
  v_result := public.save_weekly_meal_plan(c.client_a, v_week, faz2_test.week_payload(v_week, jsonb_build_array(
    jsonb_build_object('id', v_meal_id, 'type', 'snack', 'title', 'Muz', 'time', '17:30', 'sort_order', 0, 'source', 'manual',
      'macros', jsonb_build_object('protein', 1, 'carbs', 27, 'fat', 0), 'calories', 105)
  )));
  select slot_label into v_label from public.meals where id = v_meal_id;
  if v_label is distinct from 'Antrenman öncesi' then
    raise exception 'FAIL: SLOT_LABEL_ABSENT_KEY_PRESERVES';
  end if;
  raise notice 'PASS: SLOT_LABEL_ABSENT_KEY_PRESERVES';

  v_result := public.save_weekly_meal_plan(c.client_a, v_week, faz2_test.week_payload(v_week, jsonb_build_array(
    jsonb_build_object('id', v_meal_id, 'type', 'snack', 'title', 'Muz', 'time', '17:30', 'sort_order', 0, 'source', 'manual',
      'macros', jsonb_build_object('protein', 1, 'carbs', 27, 'fat', 0), 'calories', 105, 'slot_label', null)
  )));
  select slot_label into v_label from public.meals where id = v_meal_id;
  if v_label is not null then
    raise exception 'FAIL: SLOT_LABEL_NULL_CLEARS';
  end if;
  raise notice 'PASS: SLOT_LABEL_NULL_CLEARS';

  perform faz2_test.expect_error(format('select public.save_weekly_meal_plan(%L, %L, faz2_test.week_payload(%L, %L))',
    c.client_a, v_week, v_week, jsonb_build_array(jsonb_build_object('type', 'snack', 'title', 'X', 'time', '10:00', 'sort_order', 0,
      'source', 'manual', 'macros', jsonb_build_object('protein', 0, 'carbs', 0, 'fat', 0), 'slot_label', repeat('a', 41)))),
    array['22023'], 'SLOT_LABEL_LENGTH_VALIDATED');
  perform faz2_test.expect_error(format('select public.save_weekly_meal_plan(%L, %L, faz2_test.week_payload(%L, %L))',
    c.client_a, v_week, v_week, jsonb_build_array(jsonb_build_object('type', 'snack', 'title', 'X', 'time', '10:00', 'sort_order', 0,
      'source', 'manual', 'macros', jsonb_build_object('protein', 0, 'carbs', 0, 'fat', 0), 'slot_label', 5))),
    array['22023'], 'SLOT_LABEL_TYPE_VALIDATED');
  perform faz2_test.reset_actor();

  -- Producer is disabled by default: saves above created no client notification.
  if exists (select 1 from public.notifications where recipient_id = c.client_a and category = 'meal_plan') then
    raise exception 'FAIL: PLAN_UPDATED_DISABLED_BY_DEFAULT';
  end if;
  raise notice 'PASS: PLAN_UPDATED_DISABLED_BY_DEFAULT';

  update private.notification_producer_flags set enabled = true where producer = 'client_meal_plan_updated';
  perform faz2_test.act_as(c.dietitian_a);
  perform public.save_weekly_meal_plan(c.client_a, v_week, faz2_test.week_payload(v_week, '[]'::jsonb));
  perform public.save_weekly_meal_plan(c.client_a, v_week, faz2_test.week_payload(v_week, '[]'::jsonb));
  perform public.save_weekly_meal_plan(c.client_a, v_week, faz2_test.week_payload(v_week, '[]'::jsonb));
  perform faz2_test.reset_actor();
  if (select count(*) from public.notifications
       where recipient_id = c.client_a and category = 'meal_plan' and event_type = 'updated'
         and activity_date = v_week and event_count = 1 and read_at is null) <> 1 then
    raise exception 'FAIL: PLAN_UPDATED_ONCE_PER_WEEK_WHEN_ENABLED';
  end if;
  if private.is_push_eligible_notification('meal_plan', 'updated', 'meal_plan_updated') then
    raise exception 'FAIL: PLAN_UPDATED_NOT_PUSH_ELIGIBLE';
  end if;
  raise notice 'PASS: PLAN_UPDATED_ONCE_PER_WEEK_WHEN_ENABLED';
  update private.notification_producer_flags set enabled = false where producer = 'client_meal_plan_updated';
end
$$;

-- ===========================================================================
-- 6. Dietitian activity notifications
-- ===========================================================================
do $$
declare
  c faz2_test.ctx;
  v_plan_id uuid;
  v_meal_id uuid;
  v_created integer;
  v_appt uuid;
  v_start timestamp;
  d integer;
begin
  select * into c from faz2_test.ctx;

  -- Photo completion -> exactly one notification for the plan's dietitian.
  insert into public.meal_plans (client_id, dietitian_id, plan_date) values (c.client_a, c.dietitian_a, c.today)
  on conflict (client_id, dietitian_id, plan_date) do update set notes = public.meal_plans.notes
  returning id into v_plan_id;
  insert into public.meals (plan_id, type, title, time, sort_order) values (v_plan_id, 'lunch', 'Salata', '12:30', 50)
  returning id into v_meal_id;
  update public.meals set is_eaten = true, completed_at = now(),
         completion_photo_url = format('%s/%s/%s.jpg', c.client_a, v_meal_id, gen_random_uuid())
   where id = v_meal_id;
  update public.meals set completion_photo_url = format('%s/%s/%s.jpg', c.client_a, v_meal_id, gen_random_uuid())
   where id = v_meal_id;
  if (select count(*) from public.notifications
       where recipient_id = c.dietitian_a and event_type = 'meal_photo_completed' and meal_id = v_meal_id
         and activity_date = c.today and actor_id = c.client_a) <> 1 then
    raise exception 'FAIL: PHOTO_COMPLETION_NOTIFIES_ONCE';
  end if;
  raise notice 'PASS: PHOTO_COMPLETION_NOTIFIES_ONCE';

  -- Inactivity: client B planned the last 3 days, marked nothing.
  for d in 1..3 loop
    insert into public.meal_plans (client_id, dietitian_id, plan_date) values (c.client_b, c.dietitian_b, c.today - d)
    returning id into v_plan_id;
    insert into public.meals (plan_id, type, title, time, sort_order) values (v_plan_id, 'breakfast', 'Kahvaltı', '08:00', 0);
  end loop;

  v_created := private.process_client_meal_inactivity_at(now());
  if v_created < 1 or (select count(*) from public.notifications
       where recipient_id = c.dietitian_b and event_type = 'meal_inactivity' and actor_id = c.client_b) <> 1 then
    raise exception 'FAIL: INACTIVITY_NOTIFIES';
  end if;
  perform private.process_client_meal_inactivity_at(now());
  if (select count(*) from public.notifications
       where recipient_id = c.dietitian_b and event_type = 'meal_inactivity' and actor_id = c.client_b) <> 1 then
    raise exception 'FAIL: INACTIVITY_NO_DUPLICATE';
  end if;
  if exists (select 1 from public.notifications where recipient_id = c.dietitian_a and event_type = 'meal_inactivity' and actor_id = c.client_b) then
    raise exception 'FAIL: INACTIVITY_CROSS_DIETITIAN';
  end if;
  raise notice 'PASS: INACTIVITY_NOTIFIES_ONCE';

  update private.notification_producer_flags set enabled = false where producer = 'dietitian_meal_inactivity';
  delete from public.notifications where event_type = 'meal_inactivity' and recipient_id = c.dietitian_b;
  if private.process_client_meal_inactivity_at(now()) <> 0 then
    raise exception 'FAIL: INACTIVITY_FLAG_GATES';
  end if;
  update private.notification_producer_flags set enabled = true where producer = 'dietitian_meal_inactivity';
  raise notice 'PASS: INACTIVITY_FLAG_GATES';

  -- 30-minute reminder for the dietitian.
  v_start := date_trunc('minute', (now() at time zone 'Europe/Istanbul')) + interval '32 minutes';
  insert into public.appointments (dietitian_id, client_id, title, date, time, duration, type, status, created_at)
  values (c.dietitian_a, c.client_a, 'Kontrol', v_start::date, v_start::time, 30, 'Yüzyüze', 'upcoming', now() - interval '2 hours')
  returning id into v_appt;
  v_created := private.process_dietitian_appointment_reminders_at(
    ((v_start - interval '30 minutes') at time zone 'Europe/Istanbul') + interval '1 minute');
  perform private.process_dietitian_appointment_reminders_at(
    ((v_start - interval '30 minutes') at time zone 'Europe/Istanbul') + interval '3 minutes');
  if (select count(*) from public.notifications
       where recipient_id = c.dietitian_a and appointment_id = v_appt and event_type = 'reminder_30m') <> 1
     or exists (select 1 from public.notifications where recipient_id = c.client_a and appointment_id = v_appt and event_type = 'reminder_30m') then
    raise exception 'FAIL: DIETITIAN_REMINDER_30M_ONCE';
  end if;
  raise notice 'PASS: DIETITIAN_REMINDER_30M_ONCE';

  if private.is_push_eligible_notification('client_activity', 'meal_inactivity', 'client_meal_inactivity')
     or private.is_push_eligible_notification('appointment', 'reminder_30m', 'appointment_reminder_30m') then
    raise exception 'FAIL: ACTIVITY_NOT_PUSH_ELIGIBLE';
  end if;
  raise notice 'PASS: ACTIVITY_NOT_PUSH_ELIGIBLE';

  -- Recipients read only their own notifications.
  perform faz2_test.act_as(c.dietitian_b);
  if exists (select 1 from public.notifications where recipient_id = c.dietitian_a) then
    raise exception 'FAIL: NOTIFICATIONS_RECIPIENT_ISOLATION';
  end if;
  perform faz2_test.reset_actor();
  raise notice 'PASS: NOTIFICATIONS_RECIPIENT_ISOLATION';

  perform faz2_test.expect_error(format(
    $q$insert into public.notifications (recipient_id, category, event_type, aggregation_key, summary_key, dietitian_client_id, meal_id)
       values (%L, 'chat_message', 'new_message', 'x', 'chat_new_message', null, gen_random_uuid())$q$, c.dietitian_a),
    array['23514'], 'NOTIFICATION_ACTIVITY_COLUMNS_SCOPED');
end
$$;

-- ===========================================================================
-- 7. Application result e-mail outbox
-- ===========================================================================
do $$
declare
  c faz2_test.ctx;
  v_claimed integer;
  v_id uuid;
begin
  select * into c from faz2_test.ctx;

  insert into public.dietitian_verification_audit (
    subject_user_id, subject_user_id_snapshot, previous_status, new_status, rejection_reason, decided_by, decided_by_snapshot, decided_at
  ) values (c.dietitian_b, c.dietitian_b, 'pending', 'rejected', 'Diploma okunamadı', null, gen_random_uuid(), now());

  if (select count(*) from private.application_result_emails
       where subject_user_id = c.dietitian_b and decision = 'rejected' and status = 'pending'
         and rejection_reason = 'Diploma okunamadı') <> 1 then
    raise exception 'FAIL: EMAIL_OUTBOX_ENQUEUED_ON_DECISION';
  end if;
  raise notice 'PASS: EMAIL_OUTBOX_ENQUEUED_ON_DECISION';

  perform faz2_test.act_as(c.dietitian_b);
  perform faz2_test.expect_error('select * from public.claim_application_result_emails(5)', array['42501'], 'EMAIL_CLAIM_AUTHENTICATED_DENIED');
  perform faz2_test.reset_actor();
  perform faz2_test.act_as_role('anon');
  perform faz2_test.expect_error('select * from public.claim_application_result_emails(5)', array['42501'], 'EMAIL_CLAIM_ANON_DENIED');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as_role('service_role');
  select count(*), max(id::text)::uuid into v_claimed, v_id from public.claim_application_result_emails(50)
   where recipient_email like 'faz2+dietitian-b-%';
  if v_claimed <> 1 then
    raise exception 'FAIL: EMAIL_CLAIM_SERVICE_ROLE (got %)', v_claimed;
  end if;
  if not public.complete_application_result_email(v_id, false, null, 'provider_status_500') then
    raise exception 'FAIL: EMAIL_COMPLETE_FAILURE_RECORDED';
  end if;
  perform faz2_test.reset_actor();

  if (select status <> 'failed' or next_attempt_at <= now() or attempts <> 1 from private.application_result_emails where id = v_id) then
    raise exception 'FAIL: EMAIL_FAILURE_BACKOFF';
  end if;
  raise notice 'PASS: EMAIL_CLAIM_AND_BACKOFF';
end
$$;

-- Dashboard deletion preferences: uses the same disposable fixtures and rolls back.
do $$
declare
  c faz2_test.ctx;
  v_key text;
  v_count integer;
begin
  select * into c from faz2_test.ctx;
  v_key := 'measurement_due:' || c.client_a::text;
  perform faz2_test.act_as(c.dietitian_a);
  insert into public.automatic_task_dismissals (dietitian_id, client_id, task_key, task_revision)
    values (c.dietitian_a, c.client_a, v_key, 'first');
  -- Same column set as PostgREST merge-duplicates upsert.
  insert into public.automatic_task_dismissals (dietitian_id, client_id, task_key, task_revision)
    values (c.dietitian_a, c.client_a, v_key, 'second')
    on conflict (dietitian_id, task_key) do update set
      dietitian_id = excluded.dietitian_id, client_id = excluded.client_id,
      task_key = excluded.task_key, task_revision = excluded.task_revision;
  if (select task_revision from public.automatic_task_dismissals where task_key = v_key) <> 'second' then
    raise exception 'FAIL: AUTOMATIC_DISMISSAL_OWNER_UPSERT';
  end if;
  perform faz2_test.expect_error(format(
    'insert into public.automatic_task_dismissals (dietitian_id, client_id, task_key, task_revision) values (%L,%L,%L,%L)',
    c.dietitian_b, c.client_a, v_key, 'foreign'), array['42501'], 'AUTOMATIC_DISMISSAL_FOREIGN_OWNER_DENIED');
  perform faz2_test.expect_error(format(
    'insert into public.automatic_task_dismissals (dietitian_id, client_id, task_key, task_revision) values (%L,%L,%L,%L)',
    c.dietitian_a, c.client_x, 'no_plan:' || c.client_x::text, 'unlinked'), array['42501'], 'AUTOMATIC_DISMISSAL_UNLINKED_CLIENT_DENIED');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_b);
  select count(*) into v_count from public.automatic_task_dismissals;
  if v_count <> 0 then raise exception 'FAIL: AUTOMATIC_DISMISSAL_FOREIGN_READ'; end if;
  update public.automatic_task_dismissals set task_revision = 'foreign' where task_key = v_key;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: AUTOMATIC_DISMISSAL_FOREIGN_UPDATE'; end if;
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.client_a);
  select count(*) into v_count from public.automatic_task_dismissals;
  if v_count <> 0 then raise exception 'FAIL: AUTOMATIC_DISMISSAL_CLIENT_READ'; end if;
  perform faz2_test.expect_error(format(
    'insert into public.automatic_task_dismissals (dietitian_id, client_id, task_key, task_revision) values (%L,%L,%L,%L)',
    c.client_a, c.client_a, v_key, 'client'), array['42501'], 'AUTOMATIC_DISMISSAL_CLIENT_WRITE_DENIED');
  perform faz2_test.reset_actor();

  perform faz2_test.act_as(c.dietitian_pending);
  select count(*) into v_count from public.automatic_task_dismissals;
  if v_count <> 0 then raise exception 'FAIL: AUTOMATIC_DISMISSAL_PENDING_READ'; end if;
  perform faz2_test.expect_error(format(
    'insert into public.automatic_task_dismissals (dietitian_id, client_id, task_key, task_revision) values (%L,%L,%L,%L)',
    c.dietitian_pending, c.client_a, v_key, 'pending'), array['42501'], 'AUTOMATIC_DISMISSAL_PENDING_WRITE_DENIED');
  perform faz2_test.reset_actor();
  perform faz2_test.act_as_role('anon');
  perform faz2_test.expect_error('select * from public.automatic_task_dismissals', array['42501'], 'AUTOMATIC_DISMISSAL_ANON_DENIED');
  perform faz2_test.reset_actor();
  raise notice 'PASS: AUTOMATIC_DISMISSAL_SECURITY_MATRIX';
end
$$;

\echo FAZ2_BACKEND_CONTRACT_PASS

rollback;
