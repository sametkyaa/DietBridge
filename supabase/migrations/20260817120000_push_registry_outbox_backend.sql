begin;

do $preflight$
begin
  if to_regclass('public.notifications') is null
     or to_regclass('public.profiles') is null
     or to_regclass('auth.users') is null then
    raise exception 'Push outbox prerequisites are missing.';
  end if;

  if to_regclass('private.push_installations') is not null
     or to_regclass('private.push_occurrences') is not null
     or to_regclass('private.push_deliveries') is not null
     or to_regprocedure('public.register_push_installation(uuid,text,text,uuid,text,text)') is not null
     or to_regprocedure('public.revoke_push_installation(uuid)') is not null then
    raise exception 'Push registry/outbox objects already exist; inspect schema drift before applying this migration.';
  end if;
end
$preflight$;

create table private.push_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references auth.users(id)
    on delete cascade,
  installation_id uuid not null,
  expo_push_token text not null,
  platform text not null,
  project_id uuid not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text,
  app_version text,
  native_build_version text,
  constraint push_installations_platform_check
    check (platform in ('android', 'ios')),
  constraint push_installations_token_check
    check (
      char_length(expo_push_token) between 10 and 512
      and expo_push_token ~ '^Expo(nent)?PushToken\[[^[:space:]]+\]$'
    ),
  constraint push_installations_disabled_state_check
    check (
      (enabled and disabled_at is null and disabled_reason is null)
      or (not enabled and disabled_at is not null)
    ),
  constraint push_installations_disabled_reason_check
    check (disabled_reason is null or char_length(disabled_reason) between 1 and 120),
  constraint push_installations_app_version_check
    check (app_version is null or char_length(app_version) between 1 and 64),
  constraint push_installations_native_build_version_check
    check (native_build_version is null or char_length(native_build_version) between 1 and 64)
);

comment on table private.push_installations is
  'Private server-side binding between an authenticated account, an opaque app installation, and an Expo Push token. Tokens are never client-readable.';

create unique index push_installations_active_installation_unique
  on private.push_installations (installation_id)
  where enabled;

create unique index push_installations_active_token_unique
  on private.push_installations (expo_push_token)
  where enabled;

create index push_installations_active_user_idx
  on private.push_installations (user_id, updated_at desc, id)
  where enabled;

create table private.push_occurrences (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null
    references public.notifications(id)
    on delete cascade,
  recipient_id uuid not null
    references public.profiles(id)
    on delete cascade,
  category text not null,
  event_type text not null,
  aggregation_key text not null,
  summary_key text not null,
  occurred_at timestamptz not null,
  event_count integer not null,
  created_at timestamptz not null default now(),
  constraint push_occurrences_event_count_check
    check (event_count >= 1),
  constraint push_occurrences_category_event_check
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
    ),
  constraint push_occurrences_aggregation_key_check
    check (char_length(btrim(aggregation_key)) between 1 and 300),
  constraint push_occurrences_summary_key_check
    check (char_length(btrim(summary_key)) between 1 and 120),
  constraint push_occurrences_logical_unique
    unique (notification_id, occurred_at, event_count, event_type)
);

comment on table private.push_occurrences is
  'Durable Push-worthy occurrences derived from public.notifications. It stores bounded Notification metadata only; it never stores rendered Push content.';

create index push_occurrences_recipient_created_idx
  on private.push_occurrences (recipient_id, created_at desc, id);

create table private.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null
    references private.push_occurrences(id)
    on delete cascade,
  notification_id uuid not null
    references public.notifications(id)
    on delete cascade,
  recipient_id uuid not null
    references public.profiles(id)
    on delete cascade,
  installation_id uuid not null
    references private.push_installations(id)
    on delete cascade,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  expo_ticket_id text,
  receipt_status text,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ticketed_at timestamptz,
  receipt_checked_at timestamptz,
  failed_at timestamptz,
  constraint push_deliveries_status_check
    check (status in (
      'pending',
      'claimed',
      'ticketed',
      'receipt_ok',
      'retryable',
      'permanent',
      'disabled',
      'coalesced'
    )),
  constraint push_deliveries_attempt_count_check
    check (attempt_count >= 0),
  constraint push_deliveries_ticket_id_check
    check (expo_ticket_id is null or char_length(expo_ticket_id) between 1 and 160),
  constraint push_deliveries_receipt_status_check
    check (receipt_status is null or char_length(receipt_status) between 1 and 64),
  constraint push_deliveries_error_code_check
    check (last_error_code is null or char_length(last_error_code) between 1 and 64),
  constraint push_deliveries_error_detail_check
    check (last_error_detail is null or char_length(last_error_detail) between 1 and 500),
  constraint push_deliveries_occurrence_installation_unique
    unique (occurrence_id, installation_id)
);

comment on table private.push_deliveries is
  'Private occurrence-to-installation delivery ledger. Dispatch must resolve the current enabled installation owner and token at send time; no token snapshot is stored here.';

comment on column private.push_deliveries.status is
  'Future transitions: pending -> claimed/retryable/permanent/disabled/coalesced; claimed -> pending/ticketed/retryable/permanent/disabled; ticketed -> receipt_ok/retryable/permanent/disabled; retryable -> pending/claimed/permanent/disabled. receipt_ok, permanent, disabled and coalesced are terminal.';

create index push_deliveries_claim_idx
  on private.push_deliveries (available_at, next_attempt_at, id)
  where status in ('pending', 'retryable');

create index push_deliveries_current_owner_idx
  on private.push_deliveries (installation_id, recipient_id, status, id);

create index push_deliveries_ticket_lookup_idx
  on private.push_deliveries (expo_ticket_id, id)
  where expo_ticket_id is not null;

create function private.is_push_eligible_notification(
  p_category text,
  p_event_type text,
  p_summary_key text
)
returns boolean
language sql
immutable
security invoker
set search_path = pg_catalog
as $function$
  select (
    (
      p_category = 'chat_message'
      and p_event_type = 'new_message'
      and p_summary_key = 'chat_new_message'
    )
    or (
      p_category = 'appointment'
      and (
        (p_event_type = 'created' and p_summary_key = 'appointment_created')
        or (p_event_type = 'updated' and p_summary_key = 'appointment_updated')
        or (p_event_type = 'cancelled' and p_summary_key = 'appointment_cancelled')
        or (p_event_type = 'assigned' and p_summary_key = 'appointment_assigned')
        or (p_event_type = 'removed_from_client' and p_summary_key = 'appointment_removed_from_client')
        or (p_event_type = 'reminder_24h' and p_summary_key = 'appointment_reminder_24h')
        or (p_event_type = 'reminder_1h' and p_summary_key = 'appointment_reminder_1h')
      )
    )
    or (
      p_category = 'relationship'
      and (
        (p_event_type = 'request_pending' and p_summary_key = 'relationship_request_pending')
        or (p_event_type = 'accepted' and p_summary_key = 'relationship_accepted')
        or (p_event_type = 'rejected' and p_summary_key = 'relationship_rejected')
        or (p_event_type = 'removed' and p_summary_key = 'relationship_removed')
      )
    )
  );
$function$;

create function private.capture_push_occurrence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_occurrence_id uuid;
  v_available_at timestamptz := now();
begin
  if not private.is_push_eligible_notification(
    new.category,
    new.event_type,
    new.summary_key
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and not (
       new.event_count > old.event_count
       or (
         old.read_at is not null
         and new.read_at is null
         and new.occurred_at is distinct from old.occurred_at
         and new.event_count = 1
       )
     ) then
    return new;
  end if;

  if new.category = 'chat_message' then
    v_available_at := now() + interval '60 seconds';
  end if;

  insert into private.push_occurrences (
    notification_id,
    recipient_id,
    category,
    event_type,
    aggregation_key,
    summary_key,
    occurred_at,
    event_count
  ) values (
    new.id,
    new.recipient_id,
    new.category,
    new.event_type,
    new.aggregation_key,
    new.summary_key,
    new.occurred_at,
    new.event_count
  )
  on conflict (notification_id, occurred_at, event_count, event_type) do nothing
  returning id into v_occurrence_id;

  if v_occurrence_id is null then
    return new;
  end if;

  insert into private.push_deliveries (
    occurrence_id,
    notification_id,
    recipient_id,
    installation_id,
    status,
    available_at,
    next_attempt_at
  )
  select
    v_occurrence_id,
    new.id,
    new.recipient_id,
    installation.id,
    'pending',
    v_available_at,
    v_available_at
  from private.push_installations as installation
  where installation.enabled
    and installation.user_id = new.recipient_id
  on conflict (occurrence_id, installation_id) do nothing;

  return new;
end
$function$;

alter function private.is_push_eligible_notification(text, text, text) owner to postgres;
alter function private.capture_push_occurrence() owner to postgres;

create trigger trg_capture_push_occurrence
after insert or update on public.notifications
for each row execute function private.capture_push_occurrence();

create function private.guard_push_delivery_status_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if (
    (old.status = 'pending' and new.status not in ('claimed', 'retryable', 'permanent', 'disabled', 'coalesced'))
    or (old.status = 'claimed' and new.status not in ('pending', 'ticketed', 'retryable', 'permanent', 'disabled'))
    or (old.status = 'ticketed' and new.status not in ('receipt_ok', 'retryable', 'permanent', 'disabled'))
    or (old.status = 'retryable' and new.status not in ('pending', 'claimed', 'permanent', 'disabled'))
    or (old.status in ('receipt_ok', 'permanent', 'disabled', 'coalesced'))
  ) then
    raise exception 'Invalid Push delivery status transition: % -> %.', old.status, new.status
      using errcode = '22023';
  end if;

  return new;
end
$function$;

alter function private.guard_push_delivery_status_transition() owner to postgres;

create trigger trg_guard_push_delivery_status_transition
before update of status on private.push_deliveries
for each row execute function private.guard_push_delivery_status_transition();

create function public.register_push_installation(
  p_installation_id uuid,
  p_expo_push_token text,
  p_platform text,
  p_project_id uuid,
  p_app_version text default null,
  p_native_build_version text default null
)
returns table (
  installation_id uuid,
  platform text,
  project_id uuid,
  enabled boolean,
  last_registered_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_platform text := lower(nullif(btrim(p_platform), ''));
  v_token text := nullif(btrim(p_expo_push_token), '');
  v_app_version text := nullif(btrim(p_app_version), '');
  v_native_build_version text := nullif(btrim(p_native_build_version), '');
  v_installation_lock text;
  v_token_lock text;
  v_reusable_id uuid;
  v_result private.push_installations%rowtype;
begin
  if v_user_id is null
     or not exists (
       select 1
       from public.profiles as profile
       where profile.id = v_user_id
     ) then
    raise exception 'Push registration requires an authenticated profile.' using errcode = '42501';
  end if;

  if p_installation_id is null
     or v_token is null
     or p_project_id is null
     or v_platform not in ('android', 'ios')
     or v_token !~ '^Expo(nent)?PushToken\[[^[:space:]]+\]$'
     or char_length(v_token) > 512 then
    raise exception 'Invalid Push installation registration.' using errcode = '22023';
  end if;

  if v_app_version is not null and char_length(v_app_version) > 64 then
    raise exception 'Push app version is too long.' using errcode = '22023';
  end if;

  if v_native_build_version is not null and char_length(v_native_build_version) > 64 then
    raise exception 'Push native build version is too long.' using errcode = '22023';
  end if;

  v_installation_lock := format('push-installation:%s', p_installation_id);
  v_token_lock := format('push-token:%s', v_token);

  if v_installation_lock <= v_token_lock then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_installation_lock, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_token_lock, 0)
    );
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_token_lock, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_installation_lock, 0)
    );
  end if;

  select installation.id
    into v_reusable_id
    from private.push_installations as installation
   where installation.enabled
     and installation.installation_id = p_installation_id
     and installation.user_id = v_user_id
   for update;

  update private.push_installations as installation
     set enabled = false,
         updated_at = now(),
         disabled_at = coalesce(installation.disabled_at, now()),
         disabled_reason = case
           when installation.installation_id = p_installation_id then 'rebound'
           else 'token_replaced'
         end
   where installation.enabled
     and (installation.installation_id = p_installation_id
       or installation.expo_push_token = v_token)
     and (v_reusable_id is null or installation.id <> v_reusable_id);

  if v_reusable_id is not null then
    update private.push_installations as installation
       set expo_push_token = v_token,
           platform = v_platform,
           project_id = p_project_id,
           enabled = true,
           updated_at = now(),
           last_registered_at = now(),
           last_seen_at = now(),
           disabled_at = null,
           disabled_reason = null,
           app_version = v_app_version,
           native_build_version = v_native_build_version
     where installation.id = v_reusable_id
     returning installation.* into v_result;
  else
    insert into private.push_installations (
      user_id,
      installation_id,
      expo_push_token,
      platform,
      project_id,
      enabled,
      last_registered_at,
      last_seen_at,
      app_version,
      native_build_version
    ) values (
      v_user_id,
      p_installation_id,
      v_token,
      v_platform,
      p_project_id,
      true,
      now(),
      now(),
      v_app_version,
      v_native_build_version
    )
    returning * into v_result;
  end if;

  return query
  select
    v_result.installation_id,
    v_result.platform,
    v_result.project_id,
    v_result.enabled,
    v_result.last_registered_at;
end
$function$;

create function public.revoke_push_installation(p_installation_id uuid)
returns table (
  installation_id uuid,
  enabled boolean,
  disabled_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or p_installation_id is null then
    raise exception 'Push revoke requires an authenticated installation owner.' using errcode = '42501';
  end if;

  return query
  update private.push_installations as installation
     set enabled = false,
         updated_at = now(),
         disabled_at = coalesce(installation.disabled_at, now()),
         disabled_reason = 'client_revoke'
   where installation.installation_id = p_installation_id
     and installation.user_id = v_user_id
     and installation.enabled
  returning
    installation.installation_id,
    installation.enabled,
    installation.disabled_at;
end
$function$;

alter function public.register_push_installation(uuid, text, text, uuid, text, text) owner to postgres;
alter function public.revoke_push_installation(uuid) owner to postgres;

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to postgres, service_role;

revoke all on table private.push_installations from public, anon, authenticated, service_role;
revoke all on table private.push_occurrences from public, anon, authenticated, service_role;
revoke all on table private.push_deliveries from public, anon, authenticated, service_role;

grant select, update on table private.push_installations to service_role;
grant select on table private.push_occurrences to service_role;
grant select, update on table private.push_deliveries to service_role;

alter table private.push_installations enable row level security;
alter table private.push_occurrences enable row level security;
alter table private.push_deliveries enable row level security;

revoke all on function private.is_push_eligible_notification(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.capture_push_occurrence()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_push_delivery_status_transition()
  from public, anon, authenticated, service_role;
revoke all on function public.register_push_installation(uuid, text, text, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_push_installation(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.register_push_installation(uuid, text, text, uuid, text, text)
  to authenticated;
grant execute on function public.revoke_push_installation(uuid)
  to authenticated;

do $postcondition$
begin
  if not exists (
    select 1
    from pg_class
    where oid = 'private.push_installations'::regclass
      and relrowsecurity
  )
  or not exists (
    select 1
    from pg_class
    where oid = 'private.push_occurrences'::regclass
      and relrowsecurity
  )
  or not exists (
    select 1
    from pg_class
    where oid = 'private.push_deliveries'::regclass
      and relrowsecurity
  ) then
    raise exception 'Push private-table RLS postcondition failed.';
  end if;

  if has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_table_privilege('anon', 'private.push_installations', 'SELECT')
     or has_table_privilege('authenticated', 'private.push_installations', 'SELECT')
     or has_table_privilege('anon', 'private.push_occurrences', 'SELECT')
     or has_table_privilege('authenticated', 'private.push_occurrences', 'SELECT')
     or has_table_privilege('anon', 'private.push_deliveries', 'SELECT')
     or has_table_privilege('authenticated', 'private.push_deliveries', 'SELECT') then
    raise exception 'Push private-table ACL postcondition failed.';
  end if;

  if not has_table_privilege('service_role', 'private.push_installations', 'SELECT')
     or not has_table_privilege('service_role', 'private.push_installations', 'UPDATE')
     or not has_table_privilege('service_role', 'private.push_occurrences', 'SELECT')
     or not has_table_privilege('service_role', 'private.push_deliveries', 'SELECT')
     or not has_table_privilege('service_role', 'private.push_deliveries', 'UPDATE') then
    raise exception 'Future server worker ACL postcondition failed.';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.register_push_installation(uuid,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.revoke_push_installation(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.register_push_installation(uuid,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.revoke_push_installation(uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.register_push_installation(uuid,text,text,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.revoke_push_installation(uuid)',
       'EXECUTE'
     ) then
    raise exception 'Push RPC ACL postcondition failed.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.notifications'::regclass
      and tgname = 'trg_capture_push_occurrence'
      and not tgisinternal
  )
  or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.push_deliveries'::regclass
      and tgname = 'trg_guard_push_delivery_status_transition'
      and not tgisinternal
  ) then
    raise exception 'Push trigger postcondition failed.';
  end if;

  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'private'
  ) then
    raise exception 'Private Push tables must not be published to Realtime.';
  end if;
end
$postcondition$;

notify pgrst, 'reload schema';

commit;
