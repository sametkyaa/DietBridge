begin;

do $preflight$
declare
  v_constraint_definition text;
begin
  if to_regclass('public.notifications') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_clients') is null then
    raise exception 'Appointment reminder prerequisites are missing.';
  end if;

  if to_regprocedure('private.insert_appointment_reminder_once(uuid,uuid,text,text,text,date,time without time zone,text,timestamptz)') is not null
     or to_regprocedure('private.process_appointment_reminders_at(timestamptz)') is not null
     or to_regprocedure('private.process_appointment_reminders()') is not null then
    raise exception 'Appointment reminder functions already exist; inspect schema drift before applying this migration.';
  end if;

  select pg_get_constraintdef(oid)
    into v_constraint_definition
    from pg_constraint
   where conrelid = 'public.notifications'::regclass
     and conname = 'notifications_category_event_check';

  if v_constraint_definition is null then
    raise exception 'Expected Notification category/event constraint is missing.';
  end if;

  if exists (
    select 1
      from public.notifications
     where event_type in ('reminder_24h', 'reminder_1h')
  ) then
    raise exception 'Appointment reminder rows already exist; migration will not reinterpret history.';
  end if;
end
$preflight$;

alter table public.notifications
  drop constraint notifications_category_event_check;

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
  );

alter table public.notifications
  add constraint notifications_appointment_reminder_contract_check
  check (
    event_type not in ('reminder_24h', 'reminder_1h')
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

create index appointments_upcoming_reminder_candidate_idx
  on public.appointments (date, time, client_id, id)
  where status = 'upcoming';

create function private.insert_appointment_reminder_once(
  p_recipient_id uuid,
  p_appointment_id uuid,
  p_event_type text,
  p_summary_key text,
  p_appointment_title_snapshot text,
  p_appointment_date date,
  p_appointment_time time without time zone,
  p_offset_code text,
  p_occurred_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_key text;
  v_title text := nullif(left(btrim(p_appointment_title_snapshot), 120), '');
  v_inserted_id uuid;
begin
  if p_recipient_id is null
     or p_appointment_id is null
     or p_appointment_date is null
     or p_appointment_time is null
     or p_occurred_at is null
     or p_offset_code not in ('24h', '1h')
     or p_event_type is distinct from (
       case p_offset_code
         when '24h' then 'reminder_24h'
         when '1h' then 'reminder_1h'
       end
     )
     or p_summary_key is distinct from (
       case p_offset_code
         when '24h' then 'appointment_reminder_24h'
         when '1h' then 'appointment_reminder_1h'
       end
     ) then
    raise exception 'Invalid appointment reminder producer input.' using errcode = '22023';
  end if;

  v_key := format(
    'appointment_reminder:%s:%s:%s:%s',
    p_appointment_id,
    p_appointment_date,
    to_char(p_appointment_time, 'HH24:MI'),
    p_offset_code
  );

  insert into public.notifications (
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
    'appointment',
    p_event_type,
    v_key,
    null,
    null,
    null,
    p_appointment_id,
    null,
    p_summary_key,
    v_title,
    p_appointment_date,
    p_appointment_time,
    'upcoming',
    null,
    null,
    1,
    p_occurred_at,
    null,
    null
  )
  on conflict (recipient_id, aggregation_key) do nothing
  returning id into v_inserted_id;

  return v_inserted_id is not null;
end
$function$;

alter function private.insert_appointment_reminder_once(
  uuid, uuid, text, text, text, date, time without time zone, text, timestamptz
) owner to postgres;

revoke all on function private.insert_appointment_reminder_once(
  uuid, uuid, text, text, text, date, time without time zone, text, timestamptz
) from public, anon, authenticated, service_role;
create function private.process_appointment_reminders_at(p_reference_at timestamptz)
returns table (
  candidates integer,
  created integer,
  conflict_noop integer,
  stale_target integer,
  invalid_relationship integer,
  invalid_status integer,
  invalid_profile integer,
  deleted integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_reference_at timestamptz := p_reference_at;
  v_local_reference_at timestamp without time zone;
  v_candidate record;
  v_current record;
  v_relation_id uuid;
  v_start_at timestamptz;
  v_target_at timestamptz;
  v_candidates integer := 0;
  v_created integer := 0;
  v_conflict_noop integer := 0;
  v_stale_target integer := 0;
  v_invalid_relationship integer := 0;
  v_invalid_status integer := 0;
  v_invalid_profile integer := 0;
  v_deleted integer := 0;
begin
  if v_reference_at is null then
    raise exception 'Appointment reminder reference time is required.' using errcode = '22023';
  end if;

  v_local_reference_at := v_reference_at at time zone 'Europe/Istanbul';

  for v_candidate in
    select
      a.id as appointment_id,
      reminder.offset_code,
      reminder.event_type,
      reminder.summary_key,
      reminder.target_at
    from public.appointments as a
    cross join lateral (
      select (a.date::timestamp without time zone + a.time)
        at time zone 'Europe/Istanbul' as appointment_start_at
    ) as schedule
    cross join lateral (
      values
        (
          '24h'::text,
          'reminder_24h'::text,
          'appointment_reminder_24h'::text,
          schedule.appointment_start_at - interval '24 hours'
        ),
        (
          '1h'::text,
          'reminder_1h'::text,
          'appointment_reminder_1h'::text,
          schedule.appointment_start_at - interval '1 hour'
        )
    ) as reminder(offset_code, event_type, summary_key, target_at)
   where a.status = 'upcoming'
     and a.client_id is not null
     and a.created_at is not null
     and a.date between v_local_reference_at::date and (v_local_reference_at::date + 2)
     and reminder.target_at <= v_reference_at
     and reminder.target_at > v_reference_at - interval '10 minutes'
     and a.created_at <= reminder.target_at
   order by a.date, a.time, a.id, reminder.offset_code
   for update of a skip locked
  loop
    v_candidates := v_candidates + 1;

    select
      a.id,
      a.dietitian_id,
      a.client_id,
      a.title,
      a.date,
      a.time,
      a.status,
      a.created_at
      into v_current
      from public.appointments as a
     where a.id = v_candidate.appointment_id
     for update;

    if not found then
      v_deleted := v_deleted + 1;
      continue;
    end if;

    if v_current.status is distinct from 'upcoming' then
      v_invalid_status := v_invalid_status + 1;
      continue;
    end if;

    v_start_at := (v_current.date::timestamp without time zone + v_current.time)
      at time zone 'Europe/Istanbul';
    v_target_at := v_start_at - case v_candidate.offset_code
      when '24h' then interval '24 hours'
      when '1h' then interval '1 hour'
    end;

    if v_target_at > v_reference_at
       or v_target_at <= v_reference_at - interval '10 minutes'
       or v_current.created_at is null
       or v_current.created_at > v_target_at then
      v_stale_target := v_stale_target + 1;
      continue;
    end if;

    if not exists (
      select 1
        from public.profiles as p
       where p.id = v_current.client_id
         and p.role = 'client'::public.user_role
    ) then
      v_invalid_profile := v_invalid_profile + 1;
      continue;
    end if;

    select dc.id
      into v_relation_id
      from public.dietitian_clients as dc
     where dc.dietitian_id = v_current.dietitian_id
       and dc.client_id = v_current.client_id
       and dc.status = 'active'::public.client_status
     order by dc.id
     limit 1
     for update;

    if v_relation_id is null then
      v_invalid_relationship := v_invalid_relationship + 1;
      continue;
    end if;

    if private.insert_appointment_reminder_once(
      p_recipient_id => v_current.client_id,
      p_appointment_id => v_current.id,
      p_event_type => v_candidate.event_type,
      p_summary_key => v_candidate.summary_key,
      p_appointment_title_snapshot => v_current.title,
      p_appointment_date => v_current.date,
      p_appointment_time => v_current.time,
      p_offset_code => v_candidate.offset_code,
      p_occurred_at => v_reference_at
    ) then
      v_created := v_created + 1;
    else
      v_conflict_noop := v_conflict_noop + 1;
    end if;
  end loop;

  return query
  select
    v_candidates,
    v_created,
    v_conflict_noop,
    v_stale_target,
    v_invalid_relationship,
    v_invalid_status,
    v_invalid_profile,
    v_deleted;
end
$function$;

alter function private.process_appointment_reminders_at(timestamptz) owner to postgres;

revoke all on function private.process_appointment_reminders_at(timestamptz)
  from public, anon, authenticated, service_role;

create function private.process_appointment_reminders()
returns table (
  candidates integer,
  created integer,
  conflict_noop integer,
  stale_target integer,
  invalid_relationship integer,
  invalid_status integer,
  invalid_profile integer,
  deleted integer
)
language sql
security definer
set search_path = pg_catalog, public, private
as $function$
  select * from private.process_appointment_reminders_at(now());
$function$;

alter function private.process_appointment_reminders() owner to postgres;

revoke all on function private.process_appointment_reminders()
  from public, anon, authenticated, service_role;
create extension if not exists pg_cron;

do $cron$
declare
  v_existing_job record;
  v_command text := 'select private.process_appointment_reminders();';
begin
  select jobid, schedule, command, active
    into v_existing_job
    from cron.job
   where jobname = 'appointment-reminders-every-5-minutes';

  if found then
    if v_existing_job.schedule is distinct from '*/5 * * * *'
       or btrim(v_existing_job.command) is distinct from v_command
       or v_existing_job.active is not true then
      raise exception 'Appointment reminder cron job exists with unexpected configuration.';
    end if;
  else
    perform cron.schedule(
      'appointment-reminders-every-5-minutes',
      '*/5 * * * *',
      v_command
    );
  end if;

  if (
    select count(*)
      from cron.job
     where jobname = 'appointment-reminders-every-5-minutes'
       and active
       and schedule = '*/5 * * * *'
       and btrim(command) = v_command
  ) <> 1 then
    raise exception 'Appointment reminder cron registration postcondition failed.';
  end if;
end
$cron$;

do $postflight$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_appointment_reminder_contract_check'
  ) then
    raise exception 'Appointment reminder notification constraint is missing.';
  end if;

  if has_function_privilege('anon', 'private.insert_appointment_reminder_once(uuid,uuid,text,text,text,date,time without time zone,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.insert_appointment_reminder_once(uuid,uuid,text,text,text,date,time without time zone,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.insert_appointment_reminder_once(uuid,uuid,text,text,text,date,time without time zone,text,timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'private.process_appointment_reminders_at(timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.process_appointment_reminders_at(timestamptz)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.process_appointment_reminders_at(timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'private.process_appointment_reminders()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.process_appointment_reminders()', 'EXECUTE')
     or has_function_privilege('service_role', 'private.process_appointment_reminders()', 'EXECUTE') then
    raise exception 'Appointment reminder private function ACL is too broad.';
  end if;
end
$postflight$;

comment on function private.insert_appointment_reminder_once(
  uuid, uuid, text, text, text, date, time without time zone, text, timestamptz
) is
  'Internal insert-once appointment reminder producer. Conflicts are true no-ops.';

comment on function private.process_appointment_reminders() is
  'Internal Europe/Istanbul appointment reminder processor. It only inserts persistent Notification Core rows.';

commit;
