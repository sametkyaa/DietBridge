begin;

do $preflight$
begin
  if to_regclass('public.notifications') is not null
     or to_regprocedure('public.mark_notification_seen(uuid)') is not null
     or to_regprocedure('public.mark_notification_read(uuid)') is not null
     or to_regprocedure('public.mark_notifications_seen(uuid[])') is not null
     or to_regprocedure('private.upsert_notification_aggregate(uuid,text,text,text,text,uuid,uuid,uuid,uuid,text,date,time without time zone,text,public.client_status,public.client_status,timestamptz)') is not null then
    raise exception 'Notification Core objects already exist; inspect schema drift before applying this migration.';
  end if;

  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regprocedure('public.send_chat_message(uuid,uuid,text)') is null
     or to_regprocedure('public.finalize_chat_image_message(uuid,text)') is null then
    raise exception 'Notification Core prerequisites are missing.';
  end if;

  if not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.appointments'::regclass
      and attname = 'client_id'
      and not attisdropped
  )
  or not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.dietitian_clients'::regclass
      and attname = 'status'
      and not attisdropped
  ) then
    raise exception 'Notification Core source columns are missing.';
  end if;
end
$preflight$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to postgres;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  category text not null,
  event_type text not null,
  aggregation_key text not null,
  actor_id uuid,
  actor_display_name text,
  conversation_id uuid,
  appointment_id uuid,
  dietitian_client_id uuid,
  summary_key text not null,
  appointment_title_snapshot text,
  appointment_date date,
  appointment_time time without time zone,
  appointment_status text,
  relationship_from_status public.client_status,
  relationship_to_status public.client_status,
  event_count integer not null default 1,
  occurred_at timestamptz not null default now(),
  seen_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notifications_recipient_fkey
    foreign key (recipient_id)
    references public.profiles(id)
    on delete cascade,
  constraint notifications_actor_fkey
    foreign key (actor_id)
    references public.profiles(id)
    on delete set null,
  constraint notifications_aggregation_key_check
    check (char_length(btrim(aggregation_key)) between 1 and 300),
  constraint notifications_actor_display_name_check
    check (actor_display_name is null or char_length(actor_display_name) between 1 and 120),
  constraint notifications_snapshot_length_check
    check (
      (appointment_title_snapshot is null or char_length(appointment_title_snapshot) <= 120)
      and (appointment_status is null or char_length(appointment_status) between 1 and 32)
    ),
  constraint notifications_appointment_status_check
    check (appointment_status is null or appointment_status in ('upcoming', 'completed', 'cancelled')),
  constraint notifications_event_count_check
    check (event_count >= 1),
  constraint notifications_read_requires_seen_check
    check (read_at is null or seen_at is not null),
  constraint notifications_category_event_check
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
  constraint notifications_source_consistency_check
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
          (
            event_type = 'request_pending'
            and relationship_to_status = 'pending'::public.client_status
            and (relationship_from_status is null or relationship_from_status in ('rejected', 'removed'))
          )
          or (
            event_type = 'accepted'
            and relationship_from_status = 'pending'::public.client_status
            and relationship_to_status = 'active'::public.client_status
          )
          or (
            event_type = 'rejected'
            and relationship_from_status = 'pending'::public.client_status
            and relationship_to_status = 'rejected'::public.client_status
          )
          or (
            event_type = 'removed'
            and relationship_from_status = 'active'::public.client_status
            and relationship_to_status = 'removed'::public.client_status
          )
        )
      )
    )
);

comment on table public.notifications is
  'Recipient-scoped notification projection. It stores bounded snapshots only; chat bodies and health data are intentionally excluded.';

create unique index notifications_recipient_aggregation_key_unique
  on public.notifications (recipient_id, aggregation_key);

create index notifications_recipient_occurred_id_idx
  on public.notifications (recipient_id, occurred_at desc, id desc);

create index notifications_recipient_unseen_idx
  on public.notifications (recipient_id)
  where seen_at is null;

create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, occurred_at desc, id desc)
  where read_at is null;

alter table public.notifications enable row level security;

revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.notifications to authenticated;
grant all on table public.notifications to service_role;

create policy "Notification recipients can select own notifications"
on public.notifications
for select
to authenticated
using ((select auth.uid()) = recipient_id);

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

alter function private.upsert_notification_aggregate(
  uuid, text, text, text, text, uuid, uuid, uuid, uuid, text, date,
  time without time zone, text, public.client_status, public.client_status, timestamptz
) owner to postgres;
revoke all on function private.upsert_notification_aggregate(
  uuid, text, text, text, text, uuid, uuid, uuid, uuid, text, date,
  time without time zone, text, public.client_status, public.client_status, timestamptz
) from public, anon, authenticated, service_role;

create function public.mark_notification_seen(p_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_result public.notifications%rowtype;
begin
  if v_actor_id is null or p_notification_id is null then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  update public.notifications
     set seen_at = coalesce(seen_at, now()),
         updated_at = now()
   where id = p_notification_id
     and recipient_id = v_actor_id
  returning * into v_result;

  if not found then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  return v_result;
end
$function$;

create function public.mark_notification_read(p_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_result public.notifications%rowtype;
begin
  if v_actor_id is null or p_notification_id is null then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  update public.notifications
     set seen_at = coalesce(seen_at, now()),
         read_at = coalesce(read_at, now()),
         updated_at = now()
   where id = p_notification_id
     and recipient_id = v_actor_id
  returning * into v_result;

  if not found then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

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

alter function public.mark_notification_seen(uuid) owner to postgres;
alter function public.mark_notification_read(uuid) owner to postgres;
alter function public.mark_notifications_seen(uuid[]) owner to postgres;

revoke all on function public.mark_notification_seen(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_notifications_seen(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_notification_seen(uuid) to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_notifications_seen(uuid[]) to authenticated;

create or replace function public.send_chat_message(
  p_dietitian_client_id uuid,
  p_client_message_id uuid,
  p_body text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_dietitian_id uuid;
  v_client_id uuid;
  v_recipient_id uuid;
  v_conversation_id uuid;
  v_body text := btrim(p_body);
  v_message public.chat_messages%rowtype;
  v_existing public.chat_messages%rowtype;
begin
  if v_actor_id is null
     or p_dietitian_client_id is null
     or p_client_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if v_body is null or char_length(v_body) not between 1 and 4000 then
    raise exception 'Invalid chat message.' using errcode = '22023';
  end if;

  select dc.dietitian_id, dc.client_id
    into v_dietitian_id, v_client_id
    from public.dietitian_clients as dc
   where dc.id = p_dietitian_client_id
   for key share;

  if not found
     or not public.chat_has_active_relationship(v_dietitian_id, v_client_id) then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  insert into public.chat_conversations (
    dietitian_client_id,
    dietitian_id,
    client_id
  )
  values (
    p_dietitian_client_id,
    v_dietitian_id,
    v_client_id
  )
  on conflict (dietitian_client_id) do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select c.id
      into v_conversation_id
      from public.chat_conversations as c
     where c.dietitian_client_id = p_dietitian_client_id
     for update;
  end if;

  insert into public.chat_messages (
    conversation_id,
    sender_id,
    client_message_id,
    body,
    created_at
  )
  values (
    v_conversation_id,
    v_actor_id,
    p_client_message_id,
    v_body,
    now()
  )
  on conflict (sender_id, client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
    select m.*
      into v_existing
      from public.chat_messages as m
     where m.sender_id = v_actor_id
       and m.client_message_id = p_client_message_id;

    if not found
       or v_existing.conversation_id is distinct from v_conversation_id
       or v_existing.message_kind is distinct from 'text'
       or v_existing.body is distinct from v_body then
      raise exception 'Chat idempotency key conflict.' using errcode = '22023';
    end if;

    return v_existing;
  end if;

  update public.chat_conversations
     set last_message_id = v_message.id,
         last_message_at = v_message.created_at
   where id = v_conversation_id;

  v_recipient_id := case
    when v_actor_id = v_dietitian_id then v_client_id
    else v_dietitian_id
  end;

  perform private.upsert_notification_aggregate(
    p_recipient_id => v_recipient_id,
    p_category => 'chat_message',
    p_event_type => 'new_message',
    p_aggregation_key => format('chat:%s', v_conversation_id),
    p_summary_key => 'chat_new_message',
    p_actor_id => v_actor_id,
    p_conversation_id => v_conversation_id,
    p_occurred_at => v_message.created_at
  );

  return v_message;
end
$function$;

alter function public.send_chat_message(uuid, uuid, text) owner to postgres;
revoke all on function public.send_chat_message(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.send_chat_message(uuid, uuid, text) to authenticated;

create or replace function public.finalize_chat_image_message(
  p_intent_id uuid,
  p_caption text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_intent public.chat_upload_intents%rowtype;
  v_caption text := nullif(btrim(p_caption), '');
  v_message public.chat_messages%rowtype;
  v_existing public.chat_messages%rowtype;
  v_recipient_id uuid;
  v_message_was_inserted boolean := false;
  v_object_owner text;
  v_object_mime text;
  v_object_size bigint;
begin
  if v_actor_id is null or p_intent_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;
  if v_caption is not null and char_length(v_caption) > 4000 then
    raise exception 'Invalid chat image caption.' using errcode = '22023';
  end if;

  select i.*
    into v_intent
    from public.chat_upload_intents as i
   where i.id = p_intent_id
     and i.created_by = v_actor_id
   for update;

  if not found then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chat_conversations as c
    where c.id = v_intent.conversation_id
      and public.chat_has_active_relationship(c.dietitian_id, c.client_id)
  ) then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if v_intent.status = 'finalized' then
    select m.*
      into v_existing
      from public.chat_messages as m
     where m.sender_id = v_actor_id
       and m.client_message_id = v_intent.client_message_id;
    if not found or v_existing.message_kind <> 'image' then
      raise exception 'Chat image finalize state is inconsistent.' using errcode = '23514';
    end if;
    return v_existing;
  end if;

  if v_intent.status <> 'pending'
     or v_intent.expires_at <= now()
     or v_intent.validated_at is null then
    raise exception 'Chat image intent cannot be finalized.' using errcode = '22023';
  end if;

  select
    o.owner_id,
    o.metadata ->> 'mimetype',
    case
      when o.metadata ->> 'size' ~ '^[0-9]+$'
        then (o.metadata ->> 'size')::bigint
      else null
    end
    into v_object_owner, v_object_mime, v_object_size
    from storage.objects as o
   where o.bucket_id = v_intent.bucket_id
     and o.name = v_intent.object_path;

  if not found
     or v_object_owner is distinct from v_actor_id::text
     or v_object_mime is distinct from v_intent.validated_mime
     or v_object_size is distinct from v_intent.validated_byte_size then
    raise exception 'Chat image object does not match validation.' using errcode = '22023';
  end if;

  insert into public.chat_messages (
    conversation_id, sender_id, client_message_id, body, message_kind, created_at
  ) values (
    v_intent.conversation_id, v_actor_id, v_intent.client_message_id,
    v_caption, 'image', now()
  )
  on conflict (sender_id, client_message_id) do nothing
  returning * into v_message;

  if v_message.id is not null then
    v_message_was_inserted := true;
  else
    select m.*
      into v_existing
      from public.chat_messages as m
     where m.sender_id = v_actor_id
       and m.client_message_id = v_intent.client_message_id;
    if not found
       or v_existing.conversation_id is distinct from v_intent.conversation_id
       or v_existing.message_kind <> 'image'
       or v_existing.body is distinct from v_caption then
      raise exception 'Chat image idempotency key conflict.' using errcode = '22023';
    end if;
    v_message := v_existing;
  end if;

  if v_message_was_inserted then
    select case
      when c.dietitian_id = v_actor_id then c.client_id
      else c.dietitian_id
    end
      into v_recipient_id
      from public.chat_conversations as c
     where c.id = v_intent.conversation_id;

    perform private.upsert_notification_aggregate(
      p_recipient_id => v_recipient_id,
      p_category => 'chat_message',
      p_event_type => 'new_message',
      p_aggregation_key => format('chat:%s', v_intent.conversation_id),
      p_summary_key => 'chat_new_message',
      p_actor_id => v_actor_id,
      p_conversation_id => v_intent.conversation_id,
      p_occurred_at => v_message.created_at
    );
  end if;

  update public.chat_upload_intents
     set status = 'finalized', finalized_at = now()
   where id = v_intent.id;

  insert into public.chat_attachments (
    message_id, intent_id, bucket_id, object_path, mime_type,
    byte_size, width, height
  ) values (
    v_message.id, v_intent.id, v_intent.bucket_id, v_intent.object_path,
    v_intent.validated_mime, v_intent.validated_byte_size,
    v_intent.validated_width, v_intent.validated_height
  )
  on conflict (message_id) do nothing;

  if not exists (
    select 1 from public.chat_attachments as a
    where a.message_id = v_message.id
      and a.intent_id = v_intent.id
  ) then
    raise exception 'Chat image attachment reconciliation failed.' using errcode = '23514';
  end if;

  update public.chat_conversations
     set last_message_id = v_message.id,
         last_message_at = v_message.created_at
   where id = v_intent.conversation_id;

  return v_message;
end
$function$;

create function private.notify_appointment_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_cancelled boolean;
  v_meaningful_change boolean;
begin
  if tg_op = 'INSERT' then
    if new.client_id is null then
      return new;
    end if;

    perform private.upsert_notification_aggregate(
      p_recipient_id => new.client_id,
      p_category => 'appointment',
      p_event_type => 'created',
      p_aggregation_key => format('appointment:%s', new.id),
      p_summary_key => 'appointment_created',
      p_actor_id => v_actor_id,
      p_appointment_id => new.id,
      p_appointment_title_snapshot => new.title,
      p_appointment_date => new.date,
      p_appointment_time => new.time,
      p_appointment_status => coalesce(nullif(btrim(new.status), ''), 'upcoming'),
      p_occurred_at => now()
    );
    return new;
  end if;

  if old.client_id is distinct from new.client_id then
    if old.client_id is not null then
      perform private.upsert_notification_aggregate(
        p_recipient_id => old.client_id,
        p_category => 'appointment',
        p_event_type => 'removed_from_client',
        p_aggregation_key => format('appointment:%s', old.id),
        p_summary_key => 'appointment_removed_from_client',
        p_actor_id => v_actor_id,
        p_appointment_id => old.id,
        p_appointment_title_snapshot => old.title,
        p_appointment_date => old.date,
        p_appointment_time => old.time,
        p_appointment_status => coalesce(nullif(btrim(old.status), ''), 'upcoming'),
        p_occurred_at => now()
      );
    end if;

    if new.client_id is not null then
      perform private.upsert_notification_aggregate(
        p_recipient_id => new.client_id,
        p_category => 'appointment',
        p_event_type => 'assigned',
        p_aggregation_key => format('appointment:%s', new.id),
        p_summary_key => 'appointment_assigned',
        p_actor_id => v_actor_id,
        p_appointment_id => new.id,
        p_appointment_title_snapshot => new.title,
        p_appointment_date => new.date,
        p_appointment_time => new.time,
        p_appointment_status => coalesce(nullif(btrim(new.status), ''), 'upcoming'),
        p_occurred_at => now()
      );
    end if;

    return new;
  end if;

  if new.client_id is null then
    return new;
  end if;

  v_cancelled := old.status = 'upcoming' and new.status = 'cancelled';
  v_meaningful_change := new.date is distinct from old.date
    or new.time is distinct from old.time
    or new.duration is distinct from old.duration
    or new.type is distinct from old.type
    or new.title is distinct from old.title;

  if not v_cancelled and not v_meaningful_change then
    return new;
  end if;

  perform private.upsert_notification_aggregate(
    p_recipient_id => new.client_id,
    p_category => 'appointment',
    p_event_type => case when v_cancelled then 'cancelled' else 'updated' end,
    p_aggregation_key => format('appointment:%s', new.id),
    p_summary_key => case
      when v_cancelled then 'appointment_cancelled'
      else 'appointment_updated'
    end,
    p_actor_id => v_actor_id,
    p_appointment_id => new.id,
    p_appointment_title_snapshot => new.title,
    p_appointment_date => new.date,
    p_appointment_time => new.time,
    p_appointment_status => coalesce(nullif(btrim(new.status), ''), 'upcoming'),
    p_occurred_at => now()
  );

  return new;
end
$function$;

create function private.notify_dietitian_client_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending'::public.client_status then
      perform private.upsert_notification_aggregate(
        p_recipient_id => new.client_id,
        p_category => 'relationship',
        p_event_type => 'request_pending',
        p_aggregation_key => format('relationship:%s', new.id),
        p_summary_key => 'relationship_request_pending',
        p_actor_id => new.dietitian_id,
        p_dietitian_client_id => new.id,
        p_relationship_to_status => new.status,
        p_occurred_at => now()
      );
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status = 'pending'::public.client_status
     and new.status = 'active'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => old.dietitian_id,
      p_category => 'relationship',
      p_event_type => 'accepted',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_accepted',
      p_actor_id => old.client_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  elsif old.status = 'pending'::public.client_status
        and new.status = 'rejected'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => old.dietitian_id,
      p_category => 'relationship',
      p_event_type => 'rejected',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_rejected',
      p_actor_id => old.client_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  elsif old.status = 'active'::public.client_status
        and new.status = 'removed'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => old.client_id,
      p_category => 'relationship',
      p_event_type => 'removed',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_removed',
      p_actor_id => old.dietitian_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  elsif old.status in ('rejected'::public.client_status, 'removed'::public.client_status)
        and new.status = 'pending'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => new.client_id,
      p_category => 'relationship',
      p_event_type => 'request_pending',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_request_pending',
      p_actor_id => new.dietitian_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  end if;

  return new;
end
$function$;

alter function private.notify_appointment_change() owner to postgres;
alter function private.notify_dietitian_client_change() owner to postgres;
revoke all on function private.notify_appointment_change() from public, anon, authenticated, service_role;
revoke all on function private.notify_dietitian_client_change() from public, anon, authenticated, service_role;

do $triggers$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'trg_notify_appointment_change'
      and not tgisinternal
  )
  or exists (
    select 1 from pg_trigger
    where tgrelid = 'public.dietitian_clients'::regclass
      and tgname = 'trg_notify_dietitian_client_change'
      and not tgisinternal
  ) then
    raise exception 'Notification producer trigger already exists; inspect schema drift.';
  end if;
end
$triggers$;

create trigger trg_notify_appointment_change
after insert or update on public.appointments
for each row execute function private.notify_appointment_change();

create trigger trg_notify_dietitian_client_change
after insert or update on public.dietitian_clients
for each row execute function private.notify_dietitian_client_change();

do $realtime$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    raise exception 'Required publication supabase_realtime does not exist.';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$realtime$;

do $postcondition$
begin
  if not exists (
    select 1
    from pg_class
    where oid = 'public.notifications'::regclass
      and relrowsecurity
  )
  or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and policyname = 'Notification recipients can select own notifications'
      and cmd = 'SELECT'
  )
  or not has_table_privilege('authenticated', 'public.notifications', 'SELECT')
  or has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  or has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
  or has_table_privilege('authenticated', 'public.notifications', 'DELETE')
  or has_table_privilege('anon', 'public.notifications', 'SELECT') then
    raise exception 'Notification table RLS or privilege postcondition failed.';
  end if;

  if not has_function_privilege('authenticated', 'public.mark_notification_seen(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_notification_read(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_notifications_seen(uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_notification_seen(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_notification_read(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_notifications_seen(uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.upsert_notification_aggregate(uuid,text,text,text,text,uuid,uuid,uuid,uuid,text,date,time without time zone,text,public.client_status,public.client_status,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.notify_appointment_change()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.notify_dietitian_client_change()', 'EXECUTE') then
    raise exception 'Notification RPC or producer ACL postcondition failed.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'trg_notify_appointment_change'
      and not tgisinternal
  )
  or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.dietitian_clients'::regclass
      and tgname = 'trg_notify_dietitian_client_change'
      and not tgisinternal
  )
  or not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    raise exception 'Notification trigger or Realtime publication postcondition failed.';
  end if;

  if position('private.upsert_notification_aggregate' in pg_get_functiondef('public.send_chat_message(uuid,uuid,text)'::regprocedure)) = 0
     or position('private.upsert_notification_aggregate' in pg_get_functiondef('public.finalize_chat_image_message(uuid,text)'::regprocedure)) = 0 then
    raise exception 'Chat notification producer integration postcondition failed.';
  end if;
end
$postcondition$;

notify pgrst, 'reload schema';

commit;
