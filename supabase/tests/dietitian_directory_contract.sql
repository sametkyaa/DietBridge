\set ON_ERROR_STOP on

\echo DIETITIAN_DIRECTORY_CONTRACT_START

begin;

create temporary table directory_test_context (
  label text primary key,
  user_id uuid not null
) on commit drop;
grant select on table directory_test_context to authenticated, anon;

insert into directory_test_context
select label, gen_random_uuid()
from unnest(array['d_listed_1','d_listed_2','d_listed_3','d_listed_4','d_unlisted','d_pending','d_full','client_a','client_b','client_c']) as label;

-- The auth onboarding trigger creates the corresponding public.profiles rows.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select c.user_id, gen_random_uuid(), 'authenticated', 'authenticated',
  'directory-harness+' || c.label || '-' || c.user_id::text || '@example.invalid',
  '$2a$10$fixturefixturefixturefixturefixturefixturefixturefixture', now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('account_type', case when c.label like 'd\_%' then 'dietitian' else 'client' end, 'full_name', 'Harness ' || c.label),
  now(), now()
from directory_test_context c;

update public.dietitian_profiles dp
   set verification_status = case when c.label = 'd_pending' then 'pending' else 'approved' end,
       is_verified = c.label <> 'd_pending',
       verified_at = case when c.label = 'd_pending' then null else now() end,
       is_publicly_listed = c.label <> 'd_unlisted',
       specialization = 'Harness ' || c.label
  from directory_test_context c
 where dp.user_id = c.user_id and c.label like 'd\_%';

insert into public.dietitian_subscriptions (dietitian_id, plan_id, status, client_limit_override)
-- d_full has no entitled subscription, so its effective client limit is 0.
select user_id, 'core', case when label = 'd_full' then 'inactive' else 'active' end, null
from directory_test_context where label like 'd\_%'
on conflict (dietitian_id) do update set plan_id = excluded.plan_id, status = excluded.status,
  client_limit_override = excluded.client_limit_override;

update public.profiles p set avatar_url = p.id::text || '/avatar.jpg'
  from directory_test_context c where p.id = c.user_id and c.label in ('d_listed_1', 'd_unlisted');

do $$
begin
  if (select count(*) from public.dietitian_profiles dp join directory_test_context c on c.user_id = dp.user_id
       where dp.verification_status = 'approved' and dp.is_verified) <> 6 then
    raise exception 'FAIL: DIRECTORY_FIXTURES';
  end if;
  if (select count(*) from public.dietitian_profiles where user_id in (select user_id from directory_test_context)
       and social_links <> '{}'::jsonb) <> 0 then
    raise exception 'FAIL: DIRECTORY_DEFAULTS';
  end if;
  if (select count(*) from public.dietitian_profiles where not is_publicly_listed
       and user_id not in (select user_id from directory_test_context)) <> (select count(*) from public.dietitian_profiles
       where user_id not in (select user_id from directory_test_context)) then
    raise exception 'FAIL: EXISTING_DIETITIANS_STAY_UNLISTED';
  end if;
  if has_table_privilege('anon', 'public.dietitian_inquiries', 'select')
     or has_table_privilege('authenticated', 'public.dietitian_inquiries', 'insert')
     or has_table_privilege('authenticated', 'public.dietitian_inquiry_messages', 'insert')
     or has_table_privilege('authenticated', 'public.dietitian_connection_requests', 'update')
     or has_function_privilege('anon', 'public.list_public_dietitians(text,integer,integer)', 'execute') then
    raise exception 'FAIL: DIRECTORY_GRANTS';
  end if;
end $$;

create function pg_temp.uid(p_label text) returns uuid language sql stable as
$$ select user_id from directory_test_context where label = p_label $$;
grant execute on function pg_temp.uid(text) to authenticated, anon;

-- Social links are validated by the table constraint on the dietitian's own update.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_listed_1'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    update public.dietitian_profiles set social_links = '{"instagram":"http://instagram.com/a"}' where user_id = pg_temp.uid('d_listed_1');
    raise exception 'FAIL: SOCIAL_HTTP_REJECTED';
  exception when check_violation then null;
  end;
  begin
    update public.dietitian_profiles set social_links = '{"instagram":"https://evil.example/a"}' where user_id = pg_temp.uid('d_listed_1');
    raise exception 'FAIL: SOCIAL_HOST_REJECTED';
  exception when check_violation then null;
  end;
  begin
    update public.dietitian_profiles set social_links = '{"facebook":"https://facebook.com/a"}' where user_id = pg_temp.uid('d_listed_1');
    raise exception 'FAIL: SOCIAL_UNKNOWN_KEY_REJECTED';
  exception when check_violation then null;
  end;
  update public.dietitian_profiles
     set social_links = '{"instagram":"https://www.instagram.com/harness","website":"https://harness.example/diyet"}'
   where user_id = pg_temp.uid('d_listed_1');
  if not found then raise exception 'FAIL: SOCIAL_VALID_SAVED'; end if;
  begin
    perform public.list_public_dietitians(null, 20, 0);
    raise exception 'FAIL: DIETITIAN_CANNOT_BROWSE_DIRECTORY';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Directory visibility and inquiry rules for client A.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('client_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v jsonb; v_ids uuid[]; v_profile jsonb; v_inquiry uuid; v_message uuid;
begin
  select array_agg(id) into v_ids from public.list_public_dietitians('Harness', 50, 0);
  if not (pg_temp.uid('d_listed_1') = any(v_ids)) or pg_temp.uid('d_unlisted') = any(v_ids) or pg_temp.uid('d_pending') = any(v_ids) then
    raise exception 'FAIL: DIRECTORY_ONLY_APPROVED_LISTED';
  end if;
  if (select count(*) from public.list_public_dietitians('d_listed_2', 50, 0)) <> 1 then
    raise exception 'FAIL: DIRECTORY_SEARCH';
  end if;
  if (select count(*) from public.list_public_dietitians('%', 50, 0) where id = any(array[pg_temp.uid('d_listed_1')])) <> 0 then
    raise exception 'FAIL: DIRECTORY_SEARCH_ESCAPES_WILDCARDS';
  end if;
  v_profile := public.get_public_dietitian(pg_temp.uid('d_listed_1'));
  if v_profile ? 'email' or v_profile ? 'phone' or v_profile ? 'diploma_url'
     or v_profile -> 'social_links' ->> 'instagram' <> 'https://www.instagram.com/harness' then
    raise exception 'FAIL: PUBLIC_PROFILE_FIELDS %', v_profile;
  end if;
  if public.get_public_dietitian(pg_temp.uid('d_unlisted')) is not null or public.get_public_dietitian(pg_temp.uid('d_pending')) is not null then
    raise exception 'FAIL: HIDDEN_PROFILE_NOT_READABLE';
  end if;
  if (select count(*) from public.get_public_dietitian_avatar_paths(array[pg_temp.uid('d_listed_1'), pg_temp.uid('d_unlisted')])) <> 1 then
    raise exception 'FAIL: AVATAR_PATHS_ONLY_VISIBLE';
  end if;

  v := public.start_dietitian_inquiry(pg_temp.uid('d_listed_1'), 'Merhaba, kilo vermek istiyorum.', '00000000-0000-4000-8000-000000000001');
  if v ->> 'result' <> 'started' then raise exception 'FAIL: INQUIRY_STARTED %', v; end if;
  v_inquiry := (v ->> 'inquiry_id')::uuid; v_message := (v ->> 'message_id')::uuid;
  v := public.start_dietitian_inquiry(pg_temp.uid('d_listed_1'), 'Merhaba, kilo vermek istiyorum.', '00000000-0000-4000-8000-000000000001');
  if v ->> 'result' <> 'duplicate' or (v ->> 'message_id')::uuid <> v_message then raise exception 'FAIL: INQUIRY_IDEMPOTENT %', v; end if;
  v := public.start_dietitian_inquiry(pg_temp.uid('d_listed_1'), 'Ücret nedir?', '00000000-0000-4000-8000-000000000002');
  if v ->> 'result' <> 'sent' or (v ->> 'inquiry_id')::uuid <> v_inquiry then raise exception 'FAIL: INQUIRY_CONTINUES %', v; end if;
  if (public.start_dietitian_inquiry(pg_temp.uid('d_listed_2'), 'Merhaba', gen_random_uuid())) ->> 'result' <> 'started'
     or (public.start_dietitian_inquiry(pg_temp.uid('d_listed_3'), 'Merhaba', gen_random_uuid())) ->> 'result' <> 'started' then
    raise exception 'FAIL: THREE_INQUIRIES_ALLOWED';
  end if;
  v := public.start_dietitian_inquiry(pg_temp.uid('d_listed_4'), 'Merhaba', gen_random_uuid());
  if v ->> 'result' <> 'limit_reached' then raise exception 'FAIL: FOURTH_INQUIRY_BLOCKED %', v; end if;
  v := public.start_dietitian_inquiry(pg_temp.uid('d_unlisted'), 'Merhaba', gen_random_uuid());
  if v ->> 'result' <> 'not_found' then raise exception 'FAIL: UNLISTED_INQUIRY_BLOCKED %', v; end if;
  if (public.start_dietitian_inquiry(pg_temp.uid('d_listed_4'), '   ', gen_random_uuid())) ->> 'result' <> 'invalid'
     or (public.start_dietitian_inquiry(pg_temp.uid('d_listed_4'), repeat('a', 1001), gen_random_uuid())) ->> 'result' <> 'invalid' then
    raise exception 'FAIL: INQUIRY_BODY_VALIDATED';
  end if;

  if public.close_dietitian_inquiry((select id from public.dietitian_inquiries where dietitian_id = pg_temp.uid('d_listed_3'))) <> 'closed' then
    raise exception 'FAIL: CLIENT_CLOSES_INQUIRY';
  end if;
  if (public.start_dietitian_inquiry(pg_temp.uid('d_listed_4'), 'Merhaba', gen_random_uuid())) ->> 'result' <> 'started' then
    raise exception 'FAIL: CLOSED_INQUIRY_FREES_SLOT';
  end if;
  if (public.start_dietitian_inquiry(pg_temp.uid('d_listed_3'), 'Tekrar merhaba', gen_random_uuid())) ->> 'result' <> 'limit_reached' then
    raise exception 'FAIL: REOPEN_COUNTS_TOWARDS_LIMIT';
  end if;

  begin
    insert into public.dietitian_inquiry_messages(inquiry_id, sender_id, client_message_id, body)
      values (v_inquiry, pg_temp.uid('client_a'), gen_random_uuid(), 'direct');
    raise exception 'FAIL: DIRECT_MESSAGE_INSERT_DENIED';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.dietitian_inquiries) <> 4 or (select count(*) from public.dietitian_inquiry_messages) <> 5 then
    raise exception 'FAIL: CLIENT_SEES_OWN_INQUIRIES';
  end if;
end $$;
reset role;

-- Client B sees nothing of client A and cannot post into A's inquiry.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('client_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_inquiry uuid;
begin
  if (select count(*) from public.dietitian_inquiries) <> 0 or (select count(*) from public.dietitian_inquiry_messages) <> 0 then
    raise exception 'FAIL: INQUIRY_ISOLATION';
  end if;
  reset role;
  select id into v_inquiry from public.dietitian_inquiries where client_id = pg_temp.uid('client_a') and dietitian_id = pg_temp.uid('d_listed_1');
  set local role authenticated;
  if (public.send_dietitian_inquiry_message(v_inquiry, 'Araya giriyorum', gen_random_uuid())) ->> 'result' <> 'not_found' then
    raise exception 'FAIL: FOREIGN_INQUIRY_SEND_DENIED';
  end if;
  if public.close_dietitian_inquiry(v_inquiry) <> 'not_found' then raise exception 'FAIL: FOREIGN_INQUIRY_CLOSE_DENIED'; end if;
end $$;
reset role;

-- Dietitian 1 replies; dietitian 2 closes its inquiry.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_listed_1'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_inquiry uuid; v jsonb;
begin
  select id into v_inquiry from public.dietitian_inquiries where client_id = pg_temp.uid('client_a');
  if v_inquiry is null or (select count(*) from public.dietitian_inquiries) <> 1 then raise exception 'FAIL: DIETITIAN_SEES_OWN_INQUIRY'; end if;
  if (select unread_count from public.list_my_dietitian_inquiries() where id = v_inquiry) <> 2 then
    raise exception 'FAIL: DIETITIAN_UNREAD_COUNT';
  end if;
  v := public.send_dietitian_inquiry_message(v_inquiry, 'Merhaba, yardımcı olabilirim.', gen_random_uuid());
  if v ->> 'result' <> 'sent' then raise exception 'FAIL: DIETITIAN_REPLIES %', v; end if;
  if (select counterpart_name from public.list_my_dietitian_inquiries() where id = v_inquiry) <> 'Harness client_a' then
    raise exception 'FAIL: DIETITIAN_SEES_CLIENT_NAME';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_listed_2'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if public.close_dietitian_inquiry((select id from public.dietitian_inquiries where client_id = pg_temp.uid('client_a'))) <> 'closed' then
    raise exception 'FAIL: DIETITIAN_CLOSES_INQUIRY';
  end if;
end $$;
reset role;

-- Client A: unread counts, dietitian-closed inquiry stays closed, one pending request.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('client_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v jsonb; v_request uuid; v_inquiry uuid;
begin
  select id into v_inquiry from public.dietitian_inquiries where dietitian_id = pg_temp.uid('d_listed_1');
  if (select unread_count from public.list_my_dietitian_inquiries() where id = v_inquiry) <> 1
     or (select counterpart_name from public.list_my_dietitian_inquiries() where id = v_inquiry) <> 'Harness d_listed_1' then
    raise exception 'FAIL: CLIENT_UNREAD_AND_NAME';
  end if;
  perform public.mark_dietitian_inquiry_read(v_inquiry);
  if (select unread_count from public.list_my_dietitian_inquiries() where id = v_inquiry) <> 0 then raise exception 'FAIL: MARK_READ'; end if;
  v := public.start_dietitian_inquiry(pg_temp.uid('d_listed_2'), 'Neden kapattınız?', gen_random_uuid());
  if v ->> 'result' <> 'closed' then raise exception 'FAIL: DIETITIAN_CLOSED_STAYS_CLOSED %', v; end if;

  v := public.send_dietitian_connection_request(pg_temp.uid('d_listed_1'), 'Sizinle çalışmak istiyorum.');
  if v ->> 'result' <> 'sent' then raise exception 'FAIL: REQUEST_SENT %', v; end if;
  v_request := (v ->> 'request_id')::uuid;
  if (public.send_dietitian_connection_request(pg_temp.uid('d_listed_1'), null)) ->> 'result' <> 'already_pending'
     or (public.send_dietitian_connection_request(pg_temp.uid('d_listed_4'), null)) ->> 'result' <> 'has_pending' then
    raise exception 'FAIL: ONE_PENDING_REQUEST';
  end if;
  if (public.send_dietitian_connection_request(pg_temp.uid('d_unlisted'), null)) ->> 'result' <> 'has_pending' then
    raise exception 'FAIL: PENDING_CHECK_FIRST';
  end if;
  if public.cancel_dietitian_connection_request(v_request) <> 'cancelled' then raise exception 'FAIL: REQUEST_CANCEL'; end if;
  if (public.send_dietitian_connection_request(pg_temp.uid('d_unlisted'), null)) ->> 'result' <> 'not_found' then
    raise exception 'FAIL: UNLISTED_REQUEST_BLOCKED';
  end if;
  v := public.send_dietitian_connection_request(pg_temp.uid('d_listed_1'), null);
  if v ->> 'result' <> 'sent' then raise exception 'FAIL: REQUEST_RESENT %', v; end if;
  begin
    perform public.respond_dietitian_connection_request((v ->> 'request_id')::uuid, true);
    raise exception 'FAIL: CLIENT_CANNOT_RESPOND';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Another dietitian cannot answer; the target dietitian accepts.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_listed_4'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if (select count(*) from public.list_my_dietitian_connection_requests()) <> 0 then raise exception 'FAIL: REQUEST_ISOLATION'; end if;
  reset role;
  set local role authenticated;
end $$;
reset role;
do $$
declare v_request uuid;
begin
  select id into v_request from public.dietitian_connection_requests where client_id = pg_temp.uid('client_a') and status = 'pending';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_listed_4'), 'role', 'authenticated')::text, true);
  perform set_config('directory.request_id', v_request::text, true);
end $$;
set local role authenticated;
do $$
begin
  if public.respond_dietitian_connection_request(current_setting('directory.request_id')::uuid, true) <> 'not_found' then
    raise exception 'FAIL: FOREIGN_DIETITIAN_CANNOT_ACCEPT';
  end if;
end $$;
reset role;

select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_listed_1'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if (select client_name from public.list_my_dietitian_connection_requests()) <> 'Harness client_a' then
    raise exception 'FAIL: DIETITIAN_LISTS_REQUEST';
  end if;
  if public.respond_dietitian_connection_request(current_setting('directory.request_id')::uuid, true) <> 'accepted' then
    raise exception 'FAIL: DIETITIAN_ACCEPTS';
  end if;
  if public.respond_dietitian_connection_request(current_setting('directory.request_id')::uuid, true) <> 'not_found' then
    raise exception 'FAIL: ACCEPT_ONCE';
  end if;
end $$;
reset role;

do $$
declare v_relationship public.dietitian_clients;
begin
  select * into v_relationship from public.dietitian_clients where client_id = pg_temp.uid('client_a') and status = 'active';
  if v_relationship.dietitian_id is distinct from pg_temp.uid('d_listed_1') or v_relationship.accepted_at is null then
    raise exception 'FAIL: RELATIONSHIP_ACTIVE';
  end if;
  if (select status from public.dietitian_inquiries where client_id = pg_temp.uid('client_a') and dietitian_id = pg_temp.uid('d_listed_1')) <> 'connected'
     or exists(select 1 from public.dietitian_inquiries where client_id = pg_temp.uid('client_a') and status = 'open') then
    raise exception 'FAIL: INQUIRIES_CLOSE_ON_CONNECT';
  end if;
  if (select status from public.dietitian_connection_requests where id = current_setting('directory.request_id')::uuid) <> 'accepted'
     or (select dietitian_client_id from public.dietitian_connection_requests where id = current_setting('directory.request_id')::uuid) <> v_relationship.id then
    raise exception 'FAIL: REQUEST_ACCEPTED_LINKED';
  end if;
  if (select count(*) from public.notifications where aggregation_key = format('relationship:%s', v_relationship.id)) <> 1
     or not exists(select 1 from public.notifications where aggregation_key = format('relationship:%s', v_relationship.id)
       and recipient_id = pg_temp.uid('client_a') and summary_key = 'relationship_accepted' and actor_id = pg_temp.uid('d_listed_1')) then
    raise exception 'FAIL: ACCEPT_NOTIFIES_CLIENT_ONLY';
  end if;
end $$;

-- Connected client can no longer use directory writes.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('client_a'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if (public.start_dietitian_inquiry(pg_temp.uid('d_listed_3'), 'Merhaba', gen_random_uuid())) ->> 'result' <> 'has_dietitian'
     or (public.send_dietitian_connection_request(pg_temp.uid('d_listed_3'), null)) ->> 'result' <> 'has_dietitian'
     or (public.send_dietitian_inquiry_message((select id from public.dietitian_inquiries where dietitian_id = pg_temp.uid('d_listed_1')),
          'Hala burada mıyız?', gen_random_uuid())) ->> 'result' <> 'closed' then
    raise exception 'FAIL: CONNECTED_CLIENT_DIRECTORY_LOCKED';
  end if;
  if (select count(*) from public.dietitian_inquiry_messages) <> 6 then raise exception 'FAIL: CONNECTED_HISTORY_READABLE'; end if;
end $$;
reset role;

-- Capacity: a dietitian at its limit cannot accept; the request stays pending.
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('client_b'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v jsonb;
begin
  v := public.send_dietitian_connection_request(pg_temp.uid('d_full'), null);
  if v ->> 'result' <> 'sent' then raise exception 'FAIL: REQUEST_TO_FULL_SENT %', v; end if;
  perform set_config('directory.full_request_id', v ->> 'request_id', true);
end $$;
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('d_full'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  if public.respond_dietitian_connection_request(current_setting('directory.full_request_id')::uuid, true) <> 'limit_reached' then
    raise exception 'FAIL: CAPACITY_ENFORCED';
  end if;
  if public.respond_dietitian_connection_request(current_setting('directory.full_request_id')::uuid, false) <> 'declined' then
    raise exception 'FAIL: DIETITIAN_DECLINES';
  end if;
end $$;
reset role;

-- Invite-code style activation also closes directory state (trigger path).
do $$
declare v_relationship uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.uid('client_c'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (public.start_dietitian_inquiry(pg_temp.uid('d_listed_2'), 'Merhaba', gen_random_uuid())) ->> 'result' <> 'started'
     or (public.send_dietitian_connection_request(pg_temp.uid('d_listed_2'), null)) ->> 'result' <> 'sent' then
    raise exception 'FAIL: CLIENT_C_SETUP';
  end if;
  reset role;
  insert into public.dietitian_clients(dietitian_id, client_id, status) values (pg_temp.uid('d_listed_3'), pg_temp.uid('client_c'), 'pending')
    returning id into v_relationship;
  update public.dietitian_clients set status = 'active' where id = v_relationship;
  if exists(select 1 from public.dietitian_inquiries where client_id = pg_temp.uid('client_c') and status = 'open')
     or (select closed_reason from public.dietitian_inquiries where client_id = pg_temp.uid('client_c')) <> 'connected_elsewhere'
     or (select status from public.dietitian_connection_requests where client_id = pg_temp.uid('client_c')) <> 'cancelled' then
    raise exception 'FAIL: OTHER_ACTIVATION_CLOSES_DIRECTORY_STATE';
  end if;
end $$;

rollback;

\echo DIETITIAN_DIRECTORY_CONTRACT_PASS
