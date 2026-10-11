-- Local-only schema and deliberately replaying RPCs for entry/trigger tests.
create schema if not exists private;
alter table public.dietitian_clients add column id uuid default gen_random_uuid();
update public.dietitian_clients set id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
create table public.chat_conversations(id uuid primary key default gen_random_uuid(),dietitian_client_id uuid,dietitian_id uuid,client_id uuid);
create table public.chat_messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,sender_id uuid,receiver_id uuid,body text,deleted_at timestamptz,deleted_by uuid);
create table public.chat_upload_intents(id uuid primary key default gen_random_uuid(),conversation_id uuid,created_by uuid,bucket_id text default 'chat-images',object_path text,status text default 'pending',aborted_at timestamptz,validated_at timestamptz);
create table public.chat_attachments(id uuid primary key default gen_random_uuid(),message_id uuid,deleted_at timestamptz);
create table public.chat_read_states(conversation_id uuid,user_id uuid);
create table public.appointments(id uuid primary key,client_id uuid);
create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,category text,conversation_id uuid,dietitian_client_id uuid,appointment_id uuid,seen_at timestamptz,read_at timestamptz,updated_at timestamptz,body text);
create table private.push_occurrences(id uuid primary key default gen_random_uuid(),notification_id uuid);
create table private.push_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid,status text default 'pending');
create function public.chat_has_active_relationship(p_dietitian_id uuid,p_client_id uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.dietitian_clients d where d.dietitian_id=p_dietitian_id and d.client_id=p_client_id and status='active' and auth.uid() in (p_dietitian_id,p_client_id));
$$;
create function public.send_chat_message(p_dietitian_client_id uuid,p_client_message_id uuid,p_body text) returns public.chat_messages language plpgsql security definer set search_path='' as $$
declare result public.chat_messages%rowtype;
begin
 select * into result from public.chat_messages where id=p_client_message_id;
 if found then return result; end if;
 insert into public.chat_messages(id,conversation_id,sender_id,receiver_id,body)
 select p_client_message_id,c.id,auth.uid(),c.dietitian_id,p_body from public.chat_conversations c where c.dietitian_client_id=p_dietitian_client_id returning * into result;
 return result;
end $$;
create function public.create_chat_image_upload_intent(p_conversation_id uuid,p_client_message_id uuid,p_expected_mime text) returns public.chat_upload_intents language plpgsql security definer set search_path='' as $$
declare result public.chat_upload_intents%rowtype;
begin
 select * into result from public.chat_upload_intents where id=p_client_message_id; return result;
end $$;
create function public.finalize_chat_image_message(p_intent_id uuid,p_caption text) returns public.chat_messages language plpgsql security definer set search_path='' as $$
declare result public.chat_messages%rowtype;
begin
 select m.* into result from public.chat_messages m join public.chat_upload_intents i on i.conversation_id=m.conversation_id where i.id=p_intent_id limit 1;return result;
end $$;
create function public.delete_chat_message(p_message_id uuid) returns public.chat_messages language plpgsql security definer set search_path='' as $$
declare result public.chat_messages%rowtype;
begin
 update public.chat_messages set body=null,deleted_at=now(),deleted_by=auth.uid() where id=p_message_id returning * into result; return result;
end $$;
create function public.mark_chat_conversation_read(p_conversation_id uuid,p_last_read_message_id uuid) returns public.chat_read_states language plpgsql security definer set search_path='' as $$
declare result public.chat_read_states%rowtype;
begin
 select * into result from public.chat_read_states where conversation_id=p_conversation_id limit 1;return result;
end $$;
create function public.mark_chat_conversation_delivered(p_conversation_id uuid,p_last_delivered_message_id uuid) returns public.chat_read_states language plpgsql security definer set search_path='' as $$
declare result public.chat_read_states%rowtype;
begin
 select * into result from public.chat_read_states where conversation_id=p_conversation_id limit 1;return result;
end $$;
create function public.mark_notification_seen(p_notification_id uuid) returns public.notifications language plpgsql security definer set search_path='' as $$
declare result public.notifications%rowtype;
begin
 update public.notifications set seen_at=now() where id=p_notification_id and recipient_id=auth.uid() returning * into result;return result;
end $$;
create function public.mark_notification_read(p_notification_id uuid) returns public.notifications language plpgsql security definer set search_path='' as $$
declare result public.notifications%rowtype;
begin
 update public.notifications set read_at=now() where id=p_notification_id and recipient_id=auth.uid() returning * into result;return result;
end $$;
create function public.get_dietitian_unread_counts() returns table(conversation_id uuid,client_id uuid,unread_count integer) language plpgsql security definer set search_path='' as $$
declare v_actor_id uuid:=auth.uid();
begin
 return query select c.id,c.client_id,1 from public.chat_conversations c
  where c.dietitian_id = v_actor_id;
end $$;
do $$
declare t text;
begin
 foreach t in array array['chat_conversations','chat_messages','chat_attachments','chat_upload_intents','chat_read_states','notifications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  if t='chat_conversations' then
   execute 'create policy fixture_participant on public.chat_conversations for all to authenticated using (auth.uid() in (client_id,dietitian_id)) with check (auth.uid() in (client_id,dietitian_id))';
  elsif t='chat_messages' then
   execute 'create policy fixture_participant on public.chat_messages for all to authenticated using (auth.uid() in (sender_id,receiver_id)) with check (auth.uid() in (sender_id,receiver_id))';
  elsif t='notifications' then
   execute 'create policy fixture_owner on public.notifications for all to authenticated using (recipient_id=auth.uid()) with check (recipient_id=auth.uid())';
  elsif t='chat_attachments' then
   execute 'create policy fixture_participant on public.chat_attachments for all to authenticated using (true)';
  else
   execute format('create policy fixture_participant on public.%I for all to authenticated using (exists(select 1 from public.chat_conversations c where c.id=conversation_id and auth.uid() in (c.client_id,c.dietitian_id)))',t);
  end if;
 end loop;
end $$;
-- Attachments have message_id, so the preceding generic policy is overridden.
drop policy fixture_participant on public.chat_attachments;
create policy fixture_participant on public.chat_attachments for all to authenticated using (exists(select 1 from public.chat_messages m where m.id=message_id and auth.uid() in (m.sender_id,m.receiver_id)));
grant usage on schema private to service_role;
grant select,insert,update,delete on public.chat_messages,public.chat_upload_intents,public.notifications,public.measurements,public.meals,private.push_occurrences,private.push_deliveries to service_role;

-- Actual producer/bulk bodies retained to exercise entry edits on repository SQL.
create function private.upsert_notification_aggregate(
  p_recipient_id uuid,
  p_category text,
  p_event_type text,
  p_aggregation_key text,
  p_summary_key text,
  p_actor_id uuid default null,
  p_conversation_id uuid default null,
  p_appointment_id uuid default null,
  p_dietitian_client_id uuid default null,
  p_appointment_title_snapshot text default null,
  p_appointment_date date default null,
  p_appointment_time time without time zone default null,
  p_appointment_status text default null,
  p_relationship_from_status public.client_status default null,
  p_relationship_to_status public.client_status default null,
  p_occurred_at timestamptz default now()
)
returns public.notifications
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_display_name text;
  v_category text := nullif(btrim(p_category), '');
  v_event_type text := nullif(btrim(p_event_type), '');
  v_aggregation_key text := nullif(btrim(p_aggregation_key), '');
  v_summary_key text := nullif(btrim(p_summary_key), '');
  v_title text := nullif(left(btrim(p_appointment_title_snapshot), 120), '');
  v_appointment_status text := nullif(left(btrim(p_appointment_status), 32), '');
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_result public.notifications%rowtype;
begin
  if p_recipient_id is null
     or v_category is null
     or v_event_type is null
     or v_aggregation_key is null
     or v_summary_key is null then
    raise exception 'Invalid notification producer input.' using errcode = '22023';
  end if;

  select nullif(left(btrim(p.full_name), 120), '')
    into v_actor_display_name
    from public.profiles as p
   where p.id = p_actor_id;

  insert into public.notifications as n (
    recipient_id,
    category,
    event_type,
    aggregation_key,
    actor_id,
    actor_display_name,
    conversation_id,
    appointment_id,
    dietitian_client_id,
    summary_key,
    appointment_title_snapshot,
    appointment_date,
    appointment_time,
    appointment_status,
    relationship_from_status,
    relationship_to_status,
    event_count,
    occurred_at,
    seen_at,
    read_at
  ) values (
    p_recipient_id,
    v_category,
    v_event_type,
    v_aggregation_key,
    p_actor_id,
    v_actor_display_name,
    p_conversation_id,
    p_appointment_id,
    p_dietitian_client_id,
    v_summary_key,
    v_title,
    p_appointment_date,
    p_appointment_time,
    v_appointment_status,
    p_relationship_from_status,
    p_relationship_to_status,
    1,
    v_occurred_at,
    null,
    null
  )
  on conflict (recipient_id, aggregation_key) do update
    set category = excluded.category,
        event_type = excluded.event_type,
        actor_id = excluded.actor_id,
        actor_display_name = excluded.actor_display_name,
        conversation_id = excluded.conversation_id,
        appointment_id = excluded.appointment_id,
        dietitian_client_id = excluded.dietitian_client_id,
        summary_key = excluded.summary_key,
        appointment_title_snapshot = excluded.appointment_title_snapshot,
        appointment_date = excluded.appointment_date,
        appointment_time = excluded.appointment_time,
        appointment_status = excluded.appointment_status,
        relationship_from_status = excluded.relationship_from_status,
        relationship_to_status = excluded.relationship_to_status,
        event_count = case when n.read_at is null then n.event_count + 1 else 1 end,
        occurred_at = excluded.occurred_at,
        seen_at = null,
        read_at = null,
        updated_at = now()
  returning * into v_result;

  return v_result;
end
$function$;
create function public.mark_notifications_seen(p_notification_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_count integer;
begin
  if v_actor_id is null or p_notification_ids is null then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  if cardinality(p_notification_ids) > 100 then
    raise exception 'Notification batch is too large.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_notification_ids) as requested(notification_id)
    where requested.notification_id is null
  )
  or exists (
    select 1
    from unnest(p_notification_ids) as requested(notification_id)
    group by requested.notification_id
    having count(*) > 1
  ) then
    raise exception 'Notification batch is invalid.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_notification_ids) as requested(notification_id)
    where not exists (
      select 1
      from public.notifications as n
      where n.id = requested.notification_id
        and n.recipient_id = v_actor_id
    )
  ) then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  update public.notifications
     set seen_at = coalesce(seen_at, now()),
         updated_at = now()
   where recipient_id = v_actor_id
     and id = any(p_notification_ids);

  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
create function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_operation_at timestamptz := now();
  v_count integer;
begin
  if v_actor_id is null then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  update public.notifications
     set seen_at = coalesce(seen_at, v_operation_at),
         read_at = coalesce(read_at, v_operation_at),
         updated_at = v_operation_at
   where recipient_id = v_actor_id
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end
$function$;
create function private.insert_activity_notification_once(
  p_recipient_id uuid,
  p_category text,
  p_event_type text,
  p_summary_key text,
  p_aggregation_key text,
  p_actor_id uuid,
  p_dietitian_client_id uuid,
  p_meal_id uuid,
  p_meal_change_request_id uuid,
  p_activity_date date,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_display_name text;
  v_inserted_id uuid;
begin
  if p_recipient_id is null or p_aggregation_key is null or p_dietitian_client_id is null then
    raise exception 'Invalid activity notification producer input.' using errcode = '22023';
  end if;

  select nullif(left(btrim(p.full_name), 120), '')
    into v_actor_display_name
    from public.profiles as p
   where p.id = p_actor_id;

  insert into public.notifications (
    recipient_id, category, event_type, aggregation_key, actor_id, actor_display_name,
    dietitian_client_id, summary_key, meal_id, meal_change_request_id, activity_date,
    event_count, occurred_at, seen_at, read_at
  ) values (
    p_recipient_id, p_category, p_event_type, p_aggregation_key, p_actor_id, v_actor_display_name,
    p_dietitian_client_id, p_summary_key, p_meal_id, p_meal_change_request_id, p_activity_date,
    1, coalesce(p_occurred_at, now()), null, null
  )
  on conflict (recipient_id, aggregation_key) do nothing
  returning id into v_inserted_id;

  return v_inserted_id is not null;
end
$function$;
create function private.notify_client_meal_plan_updated(
  p_client_id uuid,
  p_dietitian_id uuid,
  p_week_start date
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_relation_id uuid;
  v_key text;
  v_actor_display_name text;
  v_touched_id uuid;
begin
  if p_client_id is null or p_dietitian_id is null or p_week_start is null then
    return false;
  end if;

  if not private.is_notification_producer_enabled('client_meal_plan_updated') then
    return false;
  end if;

  select dc.id
    into v_relation_id
    from public.dietitian_clients as dc
   where dc.dietitian_id = p_dietitian_id
     and dc.client_id = p_client_id
     and dc.status = 'active'::public.client_status
   order by dc.id
   limit 1;

  if v_relation_id is null then
    return false;
  end if;

  v_key := format('meal_plan_updated:%s:%s', p_dietitian_id, p_week_start);

  select nullif(left(btrim(p.full_name), 120), '')
    into v_actor_display_name
    from public.profiles as p
   where p.id = p_dietitian_id;

  insert into public.notifications as n (
    recipient_id, category, event_type, aggregation_key, actor_id, actor_display_name,
    dietitian_client_id, summary_key, activity_date, event_count, occurred_at, seen_at, read_at
  ) values (
    p_client_id, 'meal_plan', 'updated', v_key, p_dietitian_id, v_actor_display_name,
    v_relation_id, 'meal_plan_updated', p_week_start, 1, now(), null, null
  )
  on conflict (recipient_id, aggregation_key) do update
    set occurred_at = now(),
        event_count = 1,
        seen_at = null,
        read_at = null,
        actor_display_name = excluded.actor_display_name,
        dietitian_client_id = excluded.dietitian_client_id,
        updated_at = now()
    where n.read_at is not null
      and n.occurred_at < now() - interval '6 hours'
  returning n.id into v_touched_id;

  return v_touched_id is not null;
end
$function$;
create function private.process_client_meal_inactivity_at(p_reference_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_today date;
  v_window_start date;
  v_candidate record;
  v_created integer := 0;
begin
  if p_reference_at is null then
    raise exception 'Inactivity reference time is required.' using errcode = '22023';
  end if;

  if not private.is_notification_producer_enabled('dietitian_meal_inactivity') then
    return 0;
  end if;

  v_today := (p_reference_at at time zone 'Europe/Istanbul')::date;
  v_window_start := v_today - 3;

  for v_candidate in
    select
      dc.id as relation_id,
      dc.dietitian_id,
      dc.client_id,
      (
        select max(mp.plan_date)
          from public.meal_plans as mp
          join public.meals as m on m.plan_id = mp.id
         where mp.client_id = dc.client_id
           and mp.dietitian_id = dc.dietitian_id
           and m.is_eaten is true
      ) as last_completed_date
    from public.dietitian_clients as dc
    join public.profiles as dp on dp.id = dc.dietitian_id and dp.role = 'dietitian'::public.user_role
    join public.dietitian_profiles as dprof
      on dprof.user_id = dc.dietitian_id
     and dprof.verification_status = 'approved'
     and dprof.is_verified is true
    where dc.status = 'active'::public.client_status
      and coalesce(dc.accepted_at, dc.created_at) <= (v_window_start::timestamp at time zone 'Europe/Istanbul')
      and (
        select count(distinct mp.plan_date)
          from public.meal_plans as mp
         where mp.client_id = dc.client_id
           and mp.dietitian_id = dc.dietitian_id
           and mp.plan_date between v_window_start and v_today - 1
           and exists (select 1 from public.meals as m where m.plan_id = mp.id)
      ) = 3
      and not exists (
        select 1
          from public.meal_plans as mp
          join public.meals as m on m.plan_id = mp.id
         where mp.client_id = dc.client_id
           and mp.dietitian_id = dc.dietitian_id
           and mp.plan_date between v_window_start and v_today
           and m.is_eaten is true
      )
    order by dc.id
  loop
    if private.insert_activity_notification_once(
      p_recipient_id => v_candidate.dietitian_id,
      p_category => 'client_activity',
      p_event_type => 'meal_inactivity',
      p_summary_key => 'client_meal_inactivity',
      p_aggregation_key => format(
        'client_meal_inactivity:%s:%s',
        v_candidate.relation_id,
        coalesce(v_candidate.last_completed_date::text, 'never')
      ),
      p_actor_id => v_candidate.client_id,
      p_dietitian_client_id => v_candidate.relation_id,
      p_meal_id => null,
      p_meal_change_request_id => null,
      p_activity_date => v_candidate.last_completed_date,
      p_occurred_at => p_reference_at
    ) then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end
$function$;
revoke all on function private.upsert_notification_aggregate(uuid,text,text,text,text,uuid,uuid,uuid,uuid,text,date,time without time zone,text,public.client_status,public.client_status,timestamptz) from public;

-- Nutrition clear uses the repository body; fixture status is plain text.
alter table public.client_nutrition_targets add column dietitian_id uuid default '33333333-3333-4333-8333-333333333333';
alter table public.client_nutrition_targets add column max_kcal integer;
alter table public.client_nutrition_targets add column updated_at timestamptz default now();
create function public.is_current_user_dietitian() returns boolean language sql as $$select exists(select 1 from public.profiles where id=auth.uid() and role='dietitian')$$;
create function public.set_client_nutrition_target(
  p_client_id uuid,
  p_min_kcal integer,
  p_max_kcal integer
)
returns public.client_nutrition_targets
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_result public.client_nutrition_targets%rowtype;
begin
  if v_actor_id is null or p_client_id is null then
    raise exception 'Nutrition target access denied.' using errcode = '42501';
  end if;

  if not (select public.is_current_user_dietitian()) then
    raise exception 'Nutrition target access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.dietitian_clients as dc
     where dc.dietitian_id = v_actor_id
       and dc.client_id = p_client_id
       and dc.status = 'active'
  ) then
    raise exception 'An active dietitian-client relationship is required.' using errcode = '42501';
  end if;

  if (p_min_kcal is not null and (p_min_kcal < 500 or p_min_kcal > 10000))
     or (p_max_kcal is not null and (p_max_kcal < 500 or p_max_kcal > 10000)) then
    raise exception 'Calorie target must be between 500 and 10000 kcal.' using errcode = '22023';
  end if;

  if p_min_kcal is not null and p_max_kcal is not null and p_min_kcal > p_max_kcal then
    raise exception 'Lower calorie target cannot exceed the upper target.' using errcode = '22023';
  end if;

  if p_min_kcal is null and p_max_kcal is null then
    delete from public.client_nutrition_targets as t
     where t.dietitian_id = v_actor_id
       and t.client_id = p_client_id
    returning t.* into v_result;
    -- Clearing returns the removed row (or null when nothing was stored).
    return v_result;
  end if;

  insert into public.client_nutrition_targets (dietitian_id, client_id, min_kcal, max_kcal)
  values (v_actor_id, p_client_id, p_min_kcal, p_max_kcal)
  on conflict (dietitian_id, client_id) do update
    set min_kcal = excluded.min_kcal,
        max_kcal = excluded.max_kcal,
        updated_at = now()
  returning * into v_result;

  return v_result;
end
$function$;

-- Deliberately replay an already reviewed request to test the entry guard.
create function public.review_meal_change_request(p_request_id uuid,p_decision text,p_response_note text default null)
returns public.meal_change_requests language plpgsql security definer set search_path='' as $$
declare result public.meal_change_requests%rowtype;
begin
 select * into result from public.meal_change_requests where id=p_request_id;
 return result;
end $$;
