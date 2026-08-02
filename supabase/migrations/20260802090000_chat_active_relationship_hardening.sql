begin;

do $$
begin
  if to_regclass('public.dietitian_clients') is null
     or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_read_states') is null
     or to_regprocedure('public.send_chat_message(uuid,uuid,text)') is null
     or to_regprocedure('public.delete_chat_message(uuid)') is null
     or to_regprocedure('public.mark_chat_conversation_delivered(uuid,uuid)') is null
     or to_regprocedure('public.mark_chat_conversation_read(uuid,uuid)') is null then
    raise exception 'Chat active-relationship hardening prerequisites are missing.';
  end if;
end
$$;

create or replace function public.chat_has_active_relationship(
  p_dietitian_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.dietitian_clients as dc
    where dc.dietitian_id = p_dietitian_id
      and dc.client_id = p_client_id
      and dc.status = 'active'::public.client_status
      and (select auth.uid()) in (dc.dietitian_id, dc.client_id)
  );
$function$;

alter function public.chat_has_active_relationship(uuid, uuid) owner to postgres;
revoke all on function public.chat_has_active_relationship(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.chat_has_active_relationship(uuid, uuid) to authenticated;

drop policy if exists "Chat participants can select conversations" on public.chat_conversations;
create policy "Chat participants can select conversations"
on public.chat_conversations
for select
to authenticated
using (
  (select public.chat_has_active_relationship(dietitian_id, client_id))
);

drop policy if exists "Chat participants can select canonical messages" on public.chat_messages;
create policy "Chat participants can select canonical messages"
on public.chat_messages
for select
to authenticated
using (
  (
    chat_messages.conversation_id is not null
    and exists (
      select 1
      from public.chat_conversations as c
      where c.id = chat_messages.conversation_id
        and (select public.chat_has_active_relationship(c.dietitian_id, c.client_id))
    )
  )
  or (
    chat_messages.conversation_id is null
    and ((select auth.uid()) = chat_messages.sender_id or (select auth.uid()) = chat_messages.receiver_id)
    and (
      (select public.chat_has_active_relationship(chat_messages.sender_id, chat_messages.receiver_id))
      or (select public.chat_has_active_relationship(chat_messages.receiver_id, chat_messages.sender_id))
    )
  )
);

drop policy if exists "Chat participants can select own read state" on public.chat_read_states;
drop policy if exists "Chat participants can select read states" on public.chat_read_states;
create policy "Chat participants can select read states"
on public.chat_read_states
for select
to authenticated
using (
  (select auth.uid()) = chat_read_states.user_id
  and exists (
    select 1
    from public.chat_conversations as c
    where c.id = chat_read_states.conversation_id
      and (select public.chat_has_active_relationship(c.dietitian_id, c.client_id))
  )
);

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

  return v_message;
end
$function$;

create or replace function public.delete_chat_message(p_message_id uuid)
returns public.chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_message public.chat_messages%rowtype;
begin
  if v_actor_id is null or p_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  select m.*
    into v_message
    from public.chat_messages as m
    join public.chat_conversations as c on c.id = m.conversation_id
    where m.id = p_message_id
      and public.chat_has_active_relationship(c.dietitian_id, c.client_id)
    for update of m;

  if not found
     or v_message.conversation_id is null
     or v_message.sender_id is distinct from v_actor_id
     or v_message.client_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if v_message.deleted_at is not null then
    return v_message;
  end if;

  update public.chat_messages
     set body = null,
         deleted_at = now(),
         deleted_by = v_actor_id
   where id = v_message.id
  returning * into v_message;

  return v_message;
end
$function$;

create or replace function public.mark_chat_conversation_delivered(
  p_conversation_id uuid,
  p_last_delivered_message_id uuid
)
returns public.chat_read_states
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_target_created_at timestamptz;
  v_read_created_at timestamptz;
  v_existing public.chat_read_states%rowtype;
  v_result public.chat_read_states%rowtype;
  v_desired_message_id uuid := p_last_delivered_message_id;
  v_desired_created_at timestamptz;
begin
  if v_actor_id is null
     or p_conversation_id is null
     or p_last_delivered_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chat_conversations as c
    where c.id = p_conversation_id
      and public.chat_has_active_relationship(c.dietitian_id, c.client_id)
  ) then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  select m.created_at
    into v_target_created_at
    from public.chat_messages as m
    where m.id = p_last_delivered_message_id
      and m.conversation_id = p_conversation_id;

  if not found then
    raise exception 'Invalid chat delivery pointer.' using errcode = '22023';
  end if;

  v_desired_created_at := v_target_created_at;

  select rs.*
    into v_existing
    from public.chat_read_states as rs
    where rs.conversation_id = p_conversation_id
      and rs.user_id = v_actor_id
    for update;

  if found and v_existing.last_read_message_id is not null then
    select m.created_at
      into v_read_created_at
      from public.chat_messages as m
      where m.id = v_existing.last_read_message_id;
    if (v_read_created_at, v_existing.last_read_message_id)
       > (v_desired_created_at, v_desired_message_id) then
      v_desired_created_at := v_read_created_at;
      v_desired_message_id := v_existing.last_read_message_id;
    end if;
  end if;

  if found
     and v_existing.last_delivered_message_id is not null
     and (v_existing.last_delivered_at, v_existing.last_delivered_message_id)
         >= (v_desired_created_at, v_desired_message_id) then
    return v_existing;
  end if;

  insert into public.chat_read_states (
    conversation_id,
    user_id,
    last_delivered_message_id
  )
  values (
    p_conversation_id,
    v_actor_id,
    v_desired_message_id
  )
  on conflict (conversation_id, user_id) do update
    set last_delivered_message_id = excluded.last_delivered_message_id
  returning * into v_result;

  return v_result;
end
$function$;

create or replace function public.mark_chat_conversation_read(
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
  v_target_created_at timestamptz;
  v_existing public.chat_read_states%rowtype;
  v_result public.chat_read_states%rowtype;
  v_delivered_message_id uuid := p_last_read_message_id;
  v_delivered_created_at timestamptz;
begin
  if v_actor_id is null
     or p_conversation_id is null
     or p_last_read_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.chat_conversations as c
    where c.id = p_conversation_id
      and public.chat_has_active_relationship(c.dietitian_id, c.client_id)
  ) then
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
     and (v_existing.last_read_at, v_existing.last_read_message_id)
         >= (v_target_created_at, p_last_read_message_id) then
    return v_existing;
  end if;

  v_delivered_created_at := v_target_created_at;
  if found
     and v_existing.last_delivered_message_id is not null
     and (v_existing.last_delivered_at, v_existing.last_delivered_message_id)
         > (v_delivered_created_at, v_delivered_message_id) then
    v_delivered_created_at := v_existing.last_delivered_at;
    v_delivered_message_id := v_existing.last_delivered_message_id;
  end if;

  insert into public.chat_read_states (
    conversation_id,
    user_id,
    last_delivered_message_id,
    last_read_message_id
  )
  values (
    p_conversation_id,
    v_actor_id,
    v_delivered_message_id,
    p_last_read_message_id
  )
  on conflict (conversation_id, user_id) do update
    set last_delivered_message_id = excluded.last_delivered_message_id,
        last_read_message_id = excluded.last_read_message_id
  returning * into v_result;

  return v_result;
end
$function$;

alter function public.send_chat_message(uuid, uuid, text) owner to postgres;
alter function public.delete_chat_message(uuid) owner to postgres;
alter function public.mark_chat_conversation_delivered(uuid, uuid) owner to postgres;
alter function public.mark_chat_conversation_read(uuid, uuid) owner to postgres;

revoke all on function public.send_chat_message(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_chat_message(uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_chat_conversation_delivered(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_chat_conversation_read(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.send_chat_message(uuid, uuid, text) to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;
grant execute on function public.mark_chat_conversation_delivered(uuid, uuid) to authenticated;
grant execute on function public.mark_chat_conversation_read(uuid, uuid) to authenticated;

do $$
declare
  v_function_name text;
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_conversations', 'chat_messages', 'chat_read_states')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  )
  or has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE')
  or has_table_privilege('authenticated', 'public.chat_read_states', 'INSERT')
  or has_table_privilege('authenticated', 'public.chat_read_states', 'UPDATE')
  or has_function_privilege('anon', 'public.chat_has_active_relationship(uuid,uuid)', 'EXECUTE')
  or not has_function_privilege('authenticated', 'public.chat_has_active_relationship(uuid,uuid)', 'EXECUTE') then
    raise exception 'Chat active-relationship policy or privilege postcondition failed.';
  end if;

  foreach v_function_name in array array[
    'send_chat_message(uuid,uuid,text)',
    'delete_chat_message(uuid)',
    'mark_chat_conversation_delivered(uuid,uuid)',
    'mark_chat_conversation_read(uuid,uuid)'
  ]
  loop
    if not exists (
      select 1
      from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace
      where p.oid = to_regprocedure('public.' || v_function_name)
        and n.nspname = 'public'
        and p.prosecdef
        and p.proconfig @> array['search_path=pg_catalog, public']::text[]
        and pg_get_functiondef(p.oid) ~ 'chat_has_active_relationship'
    )
    or not has_function_privilege('authenticated', 'public.' || v_function_name, 'EXECUTE')
    or has_function_privilege('anon', 'public.' || v_function_name, 'EXECUTE') then
      raise exception 'Chat RPC hardening postcondition failed for %.', v_function_name;
    end if;
  end loop;
end
$$;

commit;
