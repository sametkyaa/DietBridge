-- Aşama 6.1: The public write surface is restricted to authenticated,
-- parameter-minimal SECURITY DEFINER RPCs. No caller-supplied sender ID exists.

do $$
begin
  if to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_read_states') is null
     or to_regprocedure('public.enforce_chat_conversation_contract()') is null
     or to_regprocedure('public.enforce_chat_message_contract()') is null
     or to_regprocedure('public.enforce_chat_read_state_contract()') is null then
    raise exception 'Chat RPC prerequisites are missing.';
  end if;

  if to_regprocedure('public.send_chat_message(uuid,uuid,text)') is not null
     or to_regprocedure('public.mark_chat_conversation_read(uuid,uuid)') is not null then
    raise exception 'Chat RPC already exists; inspect schema drift first.';
  end if;
end
$$
-- The first parameter is the authenticated caller's relationship row rather
-- than a conversation ID. This is intentional: it lets the function lazily
-- create the one canonical conversation atomically on the first message.
create function public.send_chat_message(
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
  v_relationship_status public.client_status;
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

  select dc.dietitian_id, dc.client_id, dc.status
    into v_dietitian_id, v_client_id, v_relationship_status
    from public.dietitian_clients as dc
    where dc.id = p_dietitian_client_id
    for key share;

  if not found
     or v_relationship_status is distinct from 'active'::public.client_status
     or v_actor_id not in (v_dietitian_id, v_client_id) then
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
       or v_existing.body is distinct from v_body then
      raise exception 'Chat idempotency key conflict.' using errcode = '22023';
    end if;

    return v_existing;
  end if;

  update public.chat_conversations
     set last_message_id = v_message.id,
         last_message_at = v_message.created_at
   where id = v_conversation_id;

  return v_message;
end
$function$
create function public.mark_chat_conversation_read(
  p_conversation_id uuid,
  p_last_read_message_id uuid
)
returns public.chat_read_states
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_dietitian_id uuid;
  v_client_id uuid;
  v_target_created_at timestamptz;
  v_existing public.chat_read_states%rowtype;
  v_result public.chat_read_states%rowtype;
begin
  if v_actor_id is null
     or p_conversation_id is null
     or p_last_read_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  select c.dietitian_id, c.client_id
    into v_dietitian_id, v_client_id
    from public.chat_conversations as c
    where c.id = p_conversation_id
    for key share;

  if not found or v_actor_id not in (v_dietitian_id, v_client_id) then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  select m.created_at
    into v_target_created_at
    from public.chat_messages as m
    where m.id = p_last_read_message_id
      and m.conversation_id = p_conversation_id;

  if not found then
    raise exception 'Invalid chat read pointer.' using errcode = '22023';
  end if;

  select rs.*
    into v_existing
    from public.chat_read_states as rs
    where rs.conversation_id = p_conversation_id
      and rs.user_id = v_actor_id
    for update;

  if found
     and v_existing.last_read_message_id is not null
     and (v_target_created_at, p_last_read_message_id)
         <= (v_existing.last_read_at, v_existing.last_read_message_id) then
    return v_existing;
  end if;

  insert into public.chat_read_states (
    conversation_id,
    user_id,
    last_read_message_id
  )
  values (
    p_conversation_id,
    v_actor_id,
    p_last_read_message_id
  )
  on conflict (conversation_id, user_id) do update
    set last_read_message_id = excluded.last_read_message_id
  returning * into v_result;

  return v_result;
end
$function$
alter function public.send_chat_message(uuid, uuid, text) owner to postgres
alter function public.mark_chat_conversation_read(uuid, uuid) owner to postgres
revoke execute on function public.send_chat_message(uuid, uuid, text) from public, anon, service_role
revoke execute on function public.mark_chat_conversation_read(uuid, uuid) from public, anon, service_role
grant execute on function public.send_chat_message(uuid, uuid, text) to authenticated
grant execute on function public.mark_chat_conversation_read(uuid, uuid) to authenticated
do $$
begin
  if not exists (
    select 1
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('send_chat_message', 'mark_chat_conversation_read')
      and p.prosecdef
  ) then
    raise exception 'Chat RPC security-definer postcondition failed.';
  end if;
end
$$
-- Forward-only rollback: revoke authenticated execute and deploy a targeted
-- replacement function. Never make direct client DML the emergency fallback.
