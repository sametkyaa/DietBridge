begin;

do $$
begin
  if to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Chat image RPC prerequisites are missing.';
  end if;

  if to_regprocedure('public.create_chat_image_upload_intent(uuid,uuid,text)') is not null
     or to_regprocedure('public.finalize_chat_image_message(uuid,text)') is not null
     or to_regprocedure('public.abort_chat_image_upload(uuid)') is not null
     or to_regprocedure('public.record_chat_image_validation(uuid,text,bigint,integer,integer)') is not null then
    raise exception 'Chat image RPC already exists; inspect migration history or drift.';
  end if;
end
$$;

create function public.create_chat_image_upload_intent(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_expected_mime text
)
returns public.chat_upload_intents
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_existing public.chat_upload_intents%rowtype;
  v_result public.chat_upload_intents%rowtype;
  v_intent_id uuid := gen_random_uuid();
  v_extension constant text := 'jpg';
begin
  if v_actor_id is null
     or p_conversation_id is null
     or p_client_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if p_expected_mime is distinct from 'image/jpeg' then
    raise exception 'Unsupported chat image type.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.chat_conversations as c
    join public.dietitian_clients as dc
      on dc.id = c.dietitian_client_id
    where c.id = p_conversation_id
      and v_actor_id in (c.dietitian_id, c.client_id)
      and dc.status = 'active'::public.client_status
  ) then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  select i.*
    into v_existing
    from public.chat_upload_intents as i
    where i.created_by = v_actor_id
      and i.client_message_id = p_client_message_id
    for update;

  if found then
    if v_existing.conversation_id is distinct from p_conversation_id
       or v_existing.expected_mime is distinct from p_expected_mime then
      raise exception 'Chat image idempotency key conflict.' using errcode = '22023';
    end if;
    return v_existing;
  end if;

  perform 1
  from public.profiles as p
  where p.id = v_actor_id
  for update;
  if not found then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if (
    select count(*)
    from public.chat_upload_intents as i
    where i.created_by = v_actor_id
      and i.status = 'pending'
      and i.expires_at > now()
  ) >= 10
  or (
    select count(*)
    from public.chat_upload_intents as i
    where i.created_by = v_actor_id
      and i.conversation_id = p_conversation_id
      and i.status = 'pending'
      and i.expires_at > now()
  ) >= 3 then
    raise exception 'Chat image upload quota exceeded.' using errcode = '54000';
  end if;

  insert into public.chat_upload_intents (
    id,
    conversation_id,
    created_by,
    client_message_id,
    bucket_id,
    object_path,
    expected_mime,
    max_bytes,
    status,
    expires_at
  ) values (
    v_intent_id,
    p_conversation_id,
    v_actor_id,
    p_client_message_id,
    'chat-images',
    format('pending/%s/%s.%s', v_intent_id, gen_random_uuid(), v_extension),
    p_expected_mime,
    4194304,
    'pending',
    now() + interval '15 minutes'
  ) returning * into v_result;

  return v_result;
end
$function$;

create function public.record_chat_image_validation(
  p_intent_id uuid,
  p_validated_mime text,
  p_validated_byte_size bigint,
  p_validated_width integer,
  p_validated_height integer
)
returns public.chat_upload_intents
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_intent public.chat_upload_intents%rowtype;
  v_object_owner text;
  v_object_mime text;
  v_object_size bigint;
begin
  if p_intent_id is null
     or p_validated_mime is null
     or p_validated_byte_size is null
     or p_validated_width is null
     or p_validated_height is null
     or p_validated_mime is distinct from 'image/jpeg'
     or p_validated_byte_size not between 1 and 4194304
     or p_validated_width not between 1 and 2048
     or p_validated_height not between 1 and 2048
     or p_validated_width::bigint * p_validated_height::bigint > 4194304 then
    raise exception 'Invalid chat image validation.' using errcode = '22023';
  end if;

  select i.*
    into v_intent
    from public.chat_upload_intents as i
    where i.id = p_intent_id
    for update;

  if not found
     or v_intent.status <> 'pending'
     or v_intent.expires_at <= now()
     or v_intent.expected_mime is distinct from p_validated_mime then
    raise exception 'Chat image validation denied.' using errcode = '42501';
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
     or v_object_owner is distinct from v_intent.created_by::text
     or v_object_mime is distinct from p_validated_mime
     or v_object_size is distinct from p_validated_byte_size then
    raise exception 'Chat image object validation failed.' using errcode = '22023';
  end if;

  update public.chat_upload_intents
     set validated_mime = p_validated_mime,
         validated_byte_size = p_validated_byte_size,
         validated_width = p_validated_width,
         validated_height = p_validated_height,
         validated_at = now()
   where id = v_intent.id
   returning * into v_intent;

  return v_intent;
end
$function$;

create function public.finalize_chat_image_message(
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

  if not exists (
    select 1
    from public.chat_conversations as c
    join public.dietitian_clients as dc
      on dc.id = c.dietitian_client_id
    where c.id = v_intent.conversation_id
      and v_actor_id in (c.dietitian_id, c.client_id)
      and dc.status = 'active'::public.client_status
  ) then
    raise exception 'Chat access denied.' using errcode = '42501';
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
    conversation_id,
    sender_id,
    client_message_id,
    body,
    message_kind,
    created_at
  ) values (
    v_intent.conversation_id,
    v_actor_id,
    v_intent.client_message_id,
    v_caption,
    'image',
    now()
  )
  on conflict (sender_id, client_message_id) do nothing
  returning * into v_message;

  if v_message.id is null then
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

  update public.chat_upload_intents
     set status = 'finalized',
         finalized_at = now()
   where id = v_intent.id;

  insert into public.chat_attachments (
    message_id,
    intent_id,
    bucket_id,
    object_path,
    mime_type,
    byte_size,
    width,
    height
  ) values (
    v_message.id,
    v_intent.id,
    v_intent.bucket_id,
    v_intent.object_path,
    v_intent.validated_mime,
    v_intent.validated_byte_size,
    v_intent.validated_width,
    v_intent.validated_height
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

create function public.abort_chat_image_upload(p_intent_id uuid)
returns public.chat_upload_intents
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_intent public.chat_upload_intents%rowtype;
begin
  if v_actor_id is null or p_intent_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
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
  if v_intent.status = 'finalized' then
    raise exception 'Finalized chat image intent cannot be aborted.' using errcode = '22023';
  end if;
  if v_intent.status = 'aborted' then
    return v_intent;
  end if;

  update public.chat_upload_intents
     set status = 'aborted',
         aborted_at = now()
   where id = v_intent.id
   returning * into v_intent;

  return v_intent;
end
$function$;

alter function public.create_chat_image_upload_intent(uuid, uuid, text) owner to postgres;
alter function public.record_chat_image_validation(uuid, text, bigint, integer, integer) owner to postgres;
alter function public.finalize_chat_image_message(uuid, text) owner to postgres;
alter function public.abort_chat_image_upload(uuid) owner to postgres;

revoke all on function public.create_chat_image_upload_intent(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.record_chat_image_validation(uuid, text, bigint, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.finalize_chat_image_message(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.abort_chat_image_upload(uuid) from public, anon, authenticated, service_role;

grant execute on function public.record_chat_image_validation(uuid, text, bigint, integer, integer) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_chat_image_validation(uuid,text,bigint,integer,integer)', 'EXECUTE') then
    raise exception 'Dormant chat image RPC grant postcondition failed.';
  end if;
end
$$;

commit;
