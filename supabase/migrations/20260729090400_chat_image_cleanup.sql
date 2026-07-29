begin;

do $$
begin
  if to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null
     or to_regprocedure('public.abort_chat_image_upload(uuid)') is null then
    raise exception 'Chat image cleanup prerequisites are missing.';
  end if;
end
$$;

create table public.chat_image_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid references public.chat_upload_intents(id) on delete restrict,
  attachment_id uuid references public.chat_attachments(id) on delete restrict,
  bucket_id text not null,
  object_path text not null,
  reason text not null,
  available_at timestamptz not null,
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chat_image_cleanup_queue_source_check
    check (intent_id is not null or attachment_id is not null),
  constraint chat_image_cleanup_queue_bucket_check
    check (bucket_id = 'chat-images'),
  constraint chat_image_cleanup_queue_path_check
    check (
      object_path ~ '^pending/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    ),
  constraint chat_image_cleanup_queue_reason_check
    check (reason in ('aborted_intent', 'expired_intent', 'message_tombstone')),
  constraint chat_image_cleanup_queue_attempt_count_check
    check (attempt_count >= 0)
);

create unique index chat_image_cleanup_queue_one_pending_path_idx
  on public.chat_image_cleanup_queue (bucket_id, object_path)
  where completed_at is null;

create index chat_image_cleanup_queue_available_idx
  on public.chat_image_cleanup_queue (available_at, claimed_at, id)
  where completed_at is null;

alter table public.chat_image_cleanup_queue enable row level security;
revoke all on table public.chat_image_cleanup_queue from public, anon, authenticated;

create function public.queue_aborted_chat_image_intent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if old.status = 'pending' and new.status = 'aborted' then
    insert into public.chat_image_cleanup_queue (
      intent_id,
      bucket_id,
      object_path,
      reason,
      available_at
    ) values (
      new.id,
      new.bucket_id,
      new.object_path,
      'aborted_intent',
      now()
    )
    on conflict (bucket_id, object_path) where completed_at is null do nothing;
  end if;
  return new;
end
$function$;

create trigger trg_queue_aborted_chat_image_intent
after update of status on public.chat_upload_intents
for each row execute function public.queue_aborted_chat_image_intent();

create function public.queue_deleted_chat_image_attachment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_attachment public.chat_attachments%rowtype;
begin
  if old.message_kind = 'image'
     and old.deleted_at is null
     and new.deleted_at is not null then
    update public.chat_attachments
       set deleted_at = new.deleted_at
     where message_id = new.id
       and deleted_at is null
     returning * into v_attachment;

    if found then
      insert into public.chat_image_cleanup_queue (
        intent_id,
        attachment_id,
        bucket_id,
        object_path,
        reason,
        available_at
      ) values (
        v_attachment.intent_id,
        v_attachment.id,
        v_attachment.bucket_id,
        v_attachment.object_path,
        'message_tombstone',
        new.deleted_at + interval '10 minutes'
      )
      on conflict (bucket_id, object_path) where completed_at is null do nothing;
    end if;
  end if;
  return new;
end
$function$;

create trigger trg_queue_deleted_chat_image_attachment
after update of deleted_at on public.chat_messages
for each row execute function public.queue_deleted_chat_image_attachment();

create function public.claim_chat_image_cleanup_batch(p_limit integer default 50)
returns table (cleanup_id uuid, bucket_id text, object_path text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid cleanup batch size.' using errcode = '22023';
  end if;

  update public.chat_upload_intents
     set status = 'aborted',
         aborted_at = now()
   where status = 'pending'
     and expires_at <= now();

  update public.chat_image_cleanup_queue as q
     set reason = 'expired_intent'
   where q.reason = 'aborted_intent'
     and exists (
       select 1
       from public.chat_upload_intents as i
       where i.id = q.intent_id
         and i.expires_at <= i.aborted_at
     );

  return query
  with candidates as (
    select q.id
    from public.chat_image_cleanup_queue as q
    where q.completed_at is null
      and q.available_at <= now()
      and (q.claimed_at is null or q.claimed_at <= now() - interval '5 minutes')
    order by q.available_at, q.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.chat_image_cleanup_queue as q
       set claimed_at = now(),
           attempt_count = q.attempt_count + 1
      from candidates as c
     where q.id = c.id
     returning q.id, q.bucket_id, q.object_path
  )
  select c.id, c.bucket_id, c.object_path
  from claimed as c;
end
$function$;

create function public.complete_chat_image_cleanup(p_cleanup_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_completed boolean;
begin
  if p_cleanup_id is null then
    raise exception 'Invalid cleanup identifier.' using errcode = '22023';
  end if;

  update public.chat_image_cleanup_queue
     set completed_at = coalesce(completed_at, now())
   where id = p_cleanup_id
   returning true into v_completed;

  return coalesce(v_completed, false);
end
$function$;

alter function public.queue_aborted_chat_image_intent() owner to postgres;
alter function public.queue_deleted_chat_image_attachment() owner to postgres;
alter function public.claim_chat_image_cleanup_batch(integer) owner to postgres;
alter function public.complete_chat_image_cleanup(uuid) owner to postgres;

revoke all on function public.queue_aborted_chat_image_intent() from public, anon, authenticated, service_role;
revoke all on function public.queue_deleted_chat_image_attachment() from public, anon, authenticated, service_role;
revoke all on function public.claim_chat_image_cleanup_batch(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_chat_image_cleanup(uuid) from public, anon, authenticated, service_role;

grant execute on function public.claim_chat_image_cleanup_batch(integer) to service_role;
grant execute on function public.complete_chat_image_cleanup(uuid) to service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'SELECT')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'INSERT')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'UPDATE')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'DELETE')
     or has_function_privilege('authenticated', 'public.claim_chat_image_cleanup_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_chat_image_cleanup(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_chat_image_cleanup_batch(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_chat_image_cleanup(uuid)', 'EXECUTE') then
    raise exception 'Chat image cleanup security postcondition failed.';
  end if;
end
$$;

commit;
