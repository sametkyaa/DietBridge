-- Faz 2 / 3 + 4: dietitian activity notifications and the gated client
-- "plan updated" notification.
--
-- New notification shapes (all bounded metadata, no free text):
--   appointment / reminder_30m          -> dietitian, 30 min before a session
--   client_activity / meal_photo_completed   -> dietitian, client completed a
--                                               meal with a photo
--   client_activity / meal_inactivity        -> dietitian, client marked no
--                                               meal for 3 days
--   client_activity / meal_change_requested  -> dietitian, new change request
--   meal_plan / updated                      -> client, weekly plan saved
--
-- Every producer is behind a row in private.notification_producer_flags.
-- Dietitian-facing producers start enabled: only the Web panel receives them
-- and the Web parser already skips unknown rows (Faz 0). The client-facing
-- meal_plan/updated producer starts DISABLED: it must stay off in production
-- until a mobile build that renders it is live in the stores.
--
-- None of the new shapes is push-eligible (private.is_push_eligible_notification
-- is unchanged), so no device receives a push for them.
--
-- Duplicate protection: every producer writes a deterministic aggregation key
-- and uses the (recipient_id, aggregation_key) unique index.
begin;

do $preflight$
begin
  if to_regclass('public.notifications') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.meal_change_requests') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('private.is_push_eligible_notification(text,text,text)') is null then
    raise exception 'Dietitian activity notification prerequisites are missing.';
  end if;

  if to_regclass('private.notification_producer_flags') is not null
     or to_regprocedure('private.process_dietitian_appointment_reminders_at(timestamptz)') is not null
     or to_regprocedure('private.process_client_meal_inactivity_at(timestamptz)') is not null
     or to_regprocedure('private.notify_client_meal_plan_updated(uuid,uuid,date)') is not null then
    raise exception 'Dietitian activity notification objects already exist; inspect schema drift.';
  end if;

  if exists (
    select 1 from public.notifications
     where category in ('client_activity', 'meal_plan')
        or event_type = 'reminder_30m'
  ) then
    raise exception 'Rows of the new notification shapes already exist; migration will not reinterpret history.';
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is required for scheduled notification producers.';
  end if;
end
$preflight$;

-- ---------------------------------------------------------------------------
-- Producer flags
-- ---------------------------------------------------------------------------
create table private.notification_producer_flags (
  producer text primary key,
  enabled boolean not null,
  audience text not null,
  description text not null,
  updated_at timestamptz not null default now(),
  constraint notification_producer_flags_audience_check
    check (audience in ('dietitian', 'client'))
);

revoke all on table private.notification_producer_flags from public, anon, authenticated, service_role;

insert into private.notification_producer_flags (producer, enabled, audience, description) values
  ('dietitian_appointment_reminder_30m', true, 'dietitian', 'Diyetisyene randevudan 30 dakika önce hatırlatma.'),
  ('dietitian_meal_photo_completed', true, 'dietitian', 'Danışan öğünü fotoğrafla tamamladığında diyetisyene bildirim.'),
  ('dietitian_meal_inactivity', true, 'dietitian', 'Danışan 3 gündür öğün işaretlemediğinde diyetisyene bildirim.'),
  ('dietitian_meal_change_requested', true, 'dietitian', 'Danışan öğün değişikliği istediğinde diyetisyene bildirim.'),
  ('client_meal_plan_updated', false, 'client', 'Haftalık plan kaydedildiğinde danışana bildirim. Uyumlu mobil sürüm mağazada yayında olmadan açılmaz.');

create function private.is_notification_producer_enabled(p_producer text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, private
as $function$
  select coalesce(
    (select f.enabled from private.notification_producer_flags as f where f.producer = p_producer),
    false
  );
$function$;

alter function private.is_notification_producer_enabled(text) owner to postgres;
revoke all on function private.is_notification_producer_enabled(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Notification shape
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column meal_id uuid,
  add column meal_change_request_id uuid,
  add column activity_date date;

comment on column public.notifications.meal_id is
  'Opaque meal reference for client_activity/meal_photo_completed. No FK: history survives plan edits.';
comment on column public.notifications.meal_change_request_id is
  'Opaque request reference for client_activity/meal_change_requested.';
comment on column public.notifications.activity_date is
  'Plan date (photo, change request), last completion date (inactivity) or week start (meal_plan/updated).';

alter table public.notifications drop constraint notifications_category_event_check;
alter table public.notifications
  add constraint notifications_category_event_check
  check (
    (
      category = 'chat_message'
      and event_type = 'new_message'
      and summary_key = 'chat_new_message'
    )
    or (
      category = 'appointment'
      and (
        (event_type = 'created' and summary_key = 'appointment_created')
        or (event_type = 'updated' and summary_key = 'appointment_updated')
        or (event_type = 'cancelled' and summary_key = 'appointment_cancelled')
        or (event_type = 'assigned' and summary_key = 'appointment_assigned')
        or (event_type = 'removed_from_client' and summary_key = 'appointment_removed_from_client')
        or (event_type = 'reminder_24h' and summary_key = 'appointment_reminder_24h')
        or (event_type = 'reminder_1h' and summary_key = 'appointment_reminder_1h')
        or (event_type = 'reminder_30m' and summary_key = 'appointment_reminder_30m')
      )
    )
    or (
      category = 'relationship'
      and (
        (event_type = 'request_pending' and summary_key = 'relationship_request_pending')
        or (event_type = 'accepted' and summary_key = 'relationship_accepted')
        or (event_type = 'rejected' and summary_key = 'relationship_rejected')
        or (event_type = 'removed' and summary_key = 'relationship_removed')
      )
    )
    or (
      category = 'client_activity'
      and (
        (event_type = 'meal_photo_completed' and summary_key = 'client_meal_photo_completed')
        or (event_type = 'meal_inactivity' and summary_key = 'client_meal_inactivity')
        or (event_type = 'meal_change_requested' and summary_key = 'client_meal_change_requested')
      )
    )
    or (
      category = 'meal_plan'
      and event_type = 'updated'
      and summary_key = 'meal_plan_updated'
    )
  );

alter table public.notifications drop constraint notifications_appointment_reminder_contract_check;
alter table public.notifications
  add constraint notifications_appointment_reminder_contract_check
  check (
    event_type not in ('reminder_24h', 'reminder_1h', 'reminder_30m')
    or (
      category = 'appointment'
      and actor_id is null
      and actor_display_name is null
      and conversation_id is null
      and dietitian_client_id is null
      and appointment_status = 'upcoming'
      and event_count = 1
    )
  );

alter table public.notifications drop constraint notifications_source_consistency_check;
alter table public.notifications
  add constraint notifications_source_consistency_check
  check (
    (
      category = 'chat_message'
      and conversation_id is not null
      and appointment_id is null
      and dietitian_client_id is null
      and appointment_title_snapshot is null
      and appointment_date is null
      and appointment_time is null
      and appointment_status is null
      and relationship_from_status is null
      and relationship_to_status is null
    )
    or (
      category = 'appointment'
      and conversation_id is null
      and appointment_id is not null
      and dietitian_client_id is null
      and appointment_date is not null
      and appointment_time is not null
      and appointment_status is not null
      and relationship_from_status is null
      and relationship_to_status is null
    )
    or (
      category = 'relationship'
      and conversation_id is null
      and appointment_id is null
      and dietitian_client_id is not null
      and appointment_title_snapshot is null
      and appointment_date is null
      and appointment_time is null
      and appointment_status is null
      and (
        (event_type = 'request_pending' and relationship_to_status = 'pending'
          and (relationship_from_status is null or relationship_from_status in ('rejected', 'removed')))
        or (event_type = 'accepted' and relationship_from_status = 'pending' and relationship_to_status = 'active')
        or (event_type = 'rejected' and relationship_from_status = 'pending' and relationship_to_status = 'rejected')
        or (event_type = 'removed' and relationship_from_status = 'active' and relationship_to_status = 'removed')
      )
    )
    or (
      category in ('client_activity', 'meal_plan')
      and conversation_id is null
      and appointment_id is null
      and dietitian_client_id is not null
      and appointment_title_snapshot is null
      and appointment_date is null
      and appointment_time is null
      and appointment_status is null
      and relationship_from_status is null
      and relationship_to_status is null
      and (
        (event_type = 'meal_photo_completed' and meal_id is not null
          and meal_change_request_id is null and activity_date is not null)
        or (event_type = 'meal_inactivity' and meal_id is null
          and meal_change_request_id is null)
        or (event_type = 'meal_change_requested' and meal_id is null
          and meal_change_request_id is not null and activity_date is not null)
        or (event_type = 'updated' and meal_id is null
          and meal_change_request_id is null and activity_date is not null)
      )
    )
  );

alter table public.notifications
  add constraint notifications_activity_columns_scope_check
  check (
    category in ('client_activity', 'meal_plan')
    or (meal_id is null and meal_change_request_id is null and activity_date is null)
  );

-- ---------------------------------------------------------------------------
-- Shared insert-once helper for the new shapes
-- ---------------------------------------------------------------------------
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

alter function private.insert_activity_notification_once(uuid, text, text, text, text, uuid, uuid, uuid, uuid, date, timestamptz) owner to postgres;
revoke all on function private.insert_activity_notification_once(uuid, text, text, text, text, uuid, uuid, uuid, uuid, date, timestamptz)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- client_activity / meal_photo_completed
-- ---------------------------------------------------------------------------
create function private.notify_meal_photo_completed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_plan record;
  v_relation_id uuid;
begin
  if new.completion_photo_url is null
     or new.is_eaten is not true
     or new.completion_photo_url is not distinct from old.completion_photo_url
     or not private.is_notification_producer_enabled('dietitian_meal_photo_completed') then
    return new;
  end if;

  select mp.client_id, mp.dietitian_id, mp.plan_date
    into v_plan
    from public.meal_plans as mp
   where mp.id = new.plan_id;

  if not found or v_plan.client_id is null or v_plan.dietitian_id is null then
    return new;
  end if;

  select dc.id
    into v_relation_id
    from public.dietitian_clients as dc
   where dc.dietitian_id = v_plan.dietitian_id
     and dc.client_id = v_plan.client_id
     and dc.status = 'active'::public.client_status
   order by dc.id
   limit 1;

  if v_relation_id is null then
    return new;
  end if;

  perform private.insert_activity_notification_once(
    p_recipient_id => v_plan.dietitian_id,
    p_category => 'client_activity',
    p_event_type => 'meal_photo_completed',
    p_summary_key => 'client_meal_photo_completed',
    p_aggregation_key => format('client_meal_photo:%s', new.id),
    p_actor_id => v_plan.client_id,
    p_dietitian_client_id => v_relation_id,
    p_meal_id => new.id,
    p_meal_change_request_id => null,
    p_activity_date => v_plan.plan_date,
    p_occurred_at => coalesce(new.completed_at, now())
  );
  return new;
end
$function$;

alter function private.notify_meal_photo_completed() owner to postgres;
revoke all on function private.notify_meal_photo_completed() from public, anon, authenticated, service_role;

create trigger trg_notify_meal_photo_completed
after update of completion_photo_url on public.meals
for each row execute function private.notify_meal_photo_completed();

-- ---------------------------------------------------------------------------
-- client_activity / meal_change_requested
-- ---------------------------------------------------------------------------
create function private.notify_meal_change_requested()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_relation_id uuid;
begin
  if new.status is distinct from 'pending'
     or new.dietitian_id is null
     or not private.is_notification_producer_enabled('dietitian_meal_change_requested') then
    return new;
  end if;

  select dc.id
    into v_relation_id
    from public.dietitian_clients as dc
   where dc.dietitian_id = new.dietitian_id
     and dc.client_id = new.client_id
     and dc.status = 'active'::public.client_status
   order by dc.id
   limit 1;

  if v_relation_id is null then
    return new;
  end if;

  perform private.insert_activity_notification_once(
    p_recipient_id => new.dietitian_id,
    p_category => 'client_activity',
    p_event_type => 'meal_change_requested',
    p_summary_key => 'client_meal_change_requested',
    p_aggregation_key => format('client_meal_change_request:%s', new.id),
    p_actor_id => new.client_id,
    p_dietitian_client_id => v_relation_id,
    p_meal_id => null,
    p_meal_change_request_id => new.id,
    p_activity_date => new.plan_date,
    p_occurred_at => new.created_at
  );
  return new;
end
$function$;

alter function private.notify_meal_change_requested() owner to postgres;
revoke all on function private.notify_meal_change_requested() from public, anon, authenticated, service_role;

create trigger trg_notify_meal_change_requested
after insert on public.meal_change_requests
for each row execute function private.notify_meal_change_requested();

-- ---------------------------------------------------------------------------
-- client_activity / meal_inactivity (3 days)
-- ---------------------------------------------------------------------------
-- A client is inactive when, for an ACTIVE relationship older than the window,
-- meals were planned by this dietitian on the last 3 Istanbul days and none of
-- the meals planned from that window start up to today was marked eaten.
-- The aggregation key carries the last completion date, so one lapse produces
-- exactly one notification and a later lapse (after new completions) a new one.
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

alter function private.process_client_meal_inactivity_at(timestamptz) owner to postgres;
revoke all on function private.process_client_meal_inactivity_at(timestamptz) from public, anon, authenticated, service_role;

create function private.process_client_meal_inactivity()
returns integer
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  select private.process_client_meal_inactivity_at(now());
$function$;

alter function private.process_client_meal_inactivity() owner to postgres;
revoke all on function private.process_client_meal_inactivity() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- appointment / reminder_30m for the dietitian
-- ---------------------------------------------------------------------------
create function private.process_dietitian_appointment_reminders_at(p_reference_at timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_local_reference_at timestamp without time zone;
  v_candidate record;
  v_created integer := 0;
  v_inserted_id uuid;
begin
  if p_reference_at is null then
    raise exception 'Appointment reminder reference time is required.' using errcode = '22023';
  end if;

  if not private.is_notification_producer_enabled('dietitian_appointment_reminder_30m') then
    return 0;
  end if;

  v_local_reference_at := p_reference_at at time zone 'Europe/Istanbul';

  for v_candidate in
    select a.id, a.dietitian_id, a.client_id, a.title, a.date, a.time
      from public.appointments as a
      cross join lateral (
        select ((a.date::timestamp without time zone + a.time) at time zone 'Europe/Istanbul')
          - interval '30 minutes' as target_at
      ) as schedule
      join public.dietitian_profiles as dprof
        on dprof.user_id = a.dietitian_id
       and dprof.verification_status = 'approved'
       and dprof.is_verified is true
     where a.status = 'upcoming'
       and a.dietitian_id is not null
       and a.created_at is not null
       and a.date between v_local_reference_at::date and (v_local_reference_at::date + 1)
       and schedule.target_at <= p_reference_at
       and schedule.target_at > p_reference_at - interval '10 minutes'
       and a.created_at <= schedule.target_at
       and (
         a.client_id is null
         or exists (
           select 1 from public.dietitian_clients as dc
            where dc.dietitian_id = a.dietitian_id
              and dc.client_id = a.client_id
              and dc.status = 'active'::public.client_status
         )
       )
     order by a.date, a.time, a.id
  loop
    v_inserted_id := null;
    insert into public.notifications (
      recipient_id, category, event_type, aggregation_key, summary_key,
      appointment_id, appointment_title_snapshot, appointment_date, appointment_time,
      appointment_status, event_count, occurred_at
    ) values (
      v_candidate.dietitian_id, 'appointment', 'reminder_30m',
      format('appointment_reminder:%s:%s:%s:30m', v_candidate.id, v_candidate.date, to_char(v_candidate.time, 'HH24:MI')),
      'appointment_reminder_30m',
      v_candidate.id, nullif(left(btrim(v_candidate.title), 120), ''), v_candidate.date, v_candidate.time,
      'upcoming', 1, p_reference_at
    )
    on conflict (recipient_id, aggregation_key) do nothing
    returning id into v_inserted_id;

    if v_inserted_id is not null then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end
$function$;

alter function private.process_dietitian_appointment_reminders_at(timestamptz) owner to postgres;
revoke all on function private.process_dietitian_appointment_reminders_at(timestamptz) from public, anon, authenticated, service_role;

create function private.process_dietitian_appointment_reminders()
returns integer
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  select private.process_dietitian_appointment_reminders_at(now());
$function$;

alter function private.process_dietitian_appointment_reminders() owner to postgres;
revoke all on function private.process_dietitian_appointment_reminders() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- meal_plan / updated for the client (gated, default OFF)
-- ---------------------------------------------------------------------------
-- One notification per (dietitian, week). While it is unread, further saves of
-- the same week do nothing. After the client has read it, a later save only
-- re-surfaces it when the previous occurrence is older than 6 hours.
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

alter function private.notify_client_meal_plan_updated(uuid, uuid, date) owner to postgres;
revoke all on function private.notify_client_meal_plan_updated(uuid, uuid, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
do $cron$
declare
  v_jobs constant jsonb := jsonb_build_array(
    jsonb_build_object(
      'name', 'dietitian-appointment-reminders-every-5-minutes',
      'schedule', '*/5 * * * *',
      'command', 'select private.process_dietitian_appointment_reminders();'
    ),
    jsonb_build_object(
      'name', 'client-meal-inactivity-hourly',
      'schedule', '17 * * * *',
      'command', 'select private.process_client_meal_inactivity();'
    )
  );
  v_job jsonb;
  v_existing record;
begin
  for v_job in select value from jsonb_array_elements(v_jobs)
  loop
    select jobid, schedule, command, active
      into v_existing
      from cron.job
     where jobname = v_job ->> 'name';

    if found then
      if v_existing.schedule is distinct from v_job ->> 'schedule'
         or btrim(v_existing.command) is distinct from v_job ->> 'command'
         or v_existing.active is not true then
        raise exception 'Cron job % exists with unexpected configuration.', v_job ->> 'name';
      end if;
    else
      perform cron.schedule(v_job ->> 'name', v_job ->> 'schedule', v_job ->> 'command');
    end if;
  end loop;
end
$cron$;

do $postflight$
begin
  if private.is_push_eligible_notification('client_activity', 'meal_photo_completed', 'client_meal_photo_completed')
     or private.is_push_eligible_notification('meal_plan', 'updated', 'meal_plan_updated')
     or private.is_push_eligible_notification('appointment', 'reminder_30m', 'appointment_reminder_30m') then
    raise exception 'New notification shapes must not be push-eligible.';
  end if;

  if (select enabled from private.notification_producer_flags where producer = 'client_meal_plan_updated') is not false then
    raise exception 'Client-facing meal_plan/updated producer must start disabled.';
  end if;

  if (
    select count(*) from cron.job
     where jobname in ('dietitian-appointment-reminders-every-5-minutes', 'client-meal-inactivity-hourly')
       and active
  ) <> 2 then
    raise exception 'Scheduled notification producers were not registered.';
  end if;
end
$postflight$;

commit;
