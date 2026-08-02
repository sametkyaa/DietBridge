begin;

alter table public.chat_messages
  add column deleted_by uuid references public.profiles(id) on delete restrict;

alter table public.chat_messages
  drop constraint chat_messages_canonical_shape_check,
  add constraint chat_messages_canonical_shape_check check (
    (conversation_id is null and client_message_id is null and body is null and deleted_at is null and deleted_by is null)
    or (conversation_id is not null and sender_id is not null and client_message_id is not null and body is not null and deleted_at is null and deleted_by is null)
    or (conversation_id is not null and sender_id is not null and client_message_id is not null and body is null and deleted_at is not null and deleted_by is not distinct from sender_id)
  );

alter table public.chat_read_states
  add column last_delivered_message_id uuid references public.chat_messages(id) on delete restrict,
  add column last_delivered_at timestamptz;

create or replace function public.enforce_chat_message_contract()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_dietitian_id uuid;
  v_client_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.conversation_id is null or old.deleted_at is not null
       or (new.conversation_id, new.sender_id, new.client_message_id, new.created_at, new.receiver_id, new.message_text, new.edited_at)
          is distinct from (old.conversation_id, old.sender_id, old.client_message_id, old.created_at, old.receiver_id, old.message_text, old.edited_at)
       or new.body is not null or new.deleted_at is null or new.deleted_by is distinct from old.sender_id then
      raise exception 'Invalid canonical chat message update.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.conversation_id is null then
    raise exception 'New legacy chat_messages rows are not permitted.' using errcode = '23514';
  end if;

  select c.dietitian_id, c.client_id into v_dietitian_id, v_client_id
    from public.chat_conversations as c where c.id = new.conversation_id for key share;
  if not found or new.sender_id is null or new.sender_id not in (v_dietitian_id, v_client_id)
     or new.client_message_id is null or new.body is null or new.deleted_at is not null or new.deleted_by is not null
     or char_length(btrim(new.body)) not between 1 and 4000 then
    raise exception 'Invalid canonical chat message.' using errcode = '23514';
  end if;
  new.body := btrim(new.body);
  return new;
end
$function$;

create or replace function public.enforce_chat_read_state_contract()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_dietitian_id uuid; v_client_id uuid;
  v_delivered_conversation_id uuid; v_delivered_created_at timestamptz;
  v_read_conversation_id uuid; v_read_created_at timestamptz;
  v_previous_delivered_created_at timestamptz; v_previous_read_created_at timestamptz;
begin
  select c.dietitian_id, c.client_id into v_dietitian_id, v_client_id
    from public.chat_conversations as c where c.id = new.conversation_id for key share;
  if not found or new.user_id not in (v_dietitian_id, v_client_id) then
    raise exception 'Invalid chat read-state participant.' using errcode = '23514';
  end if;

  if new.last_delivered_message_id is null then
    new.last_delivered_at := null;
  else
    select m.conversation_id, m.created_at into v_delivered_conversation_id, v_delivered_created_at
      from public.chat_messages as m where m.id = new.last_delivered_message_id;
    if not found or v_delivered_conversation_id is distinct from new.conversation_id then
      raise exception 'Delivery-state message does not belong to the conversation.' using errcode = '23514';
    end if;
    new.last_delivered_at := v_delivered_created_at;
  end if;

  if new.last_read_message_id is null then
    new.last_read_at := null;
  else
    select m.conversation_id, m.created_at into v_read_conversation_id, v_read_created_at
      from public.chat_messages as m where m.id = new.last_read_message_id;
    if not found or v_read_conversation_id is distinct from new.conversation_id then
      raise exception 'Read-state message does not belong to the conversation.' using errcode = '23514';
    end if;
    new.last_read_at := v_read_created_at;
  end if;

  if new.last_read_message_id is not null and (new.last_delivered_message_id is null
     or (v_delivered_created_at, new.last_delivered_message_id) < (v_read_created_at, new.last_read_message_id)) then
    raise exception 'Chat delivery-state cannot precede read-state.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.last_delivered_message_id is not null then
    select m.created_at into v_previous_delivered_created_at from public.chat_messages as m where m.id = old.last_delivered_message_id;
    if new.last_delivered_message_id is null or (v_delivered_created_at, new.last_delivered_message_id) < (v_previous_delivered_created_at, old.last_delivered_message_id) then
      raise exception 'Chat delivery-state cannot move backwards.' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.last_read_message_id is not null then
    select m.created_at into v_previous_read_created_at from public.chat_messages as m where m.id = old.last_read_message_id;
    if new.last_read_message_id is null or (v_read_created_at, new.last_read_message_id) < (v_previous_read_created_at, old.last_read_message_id) then
      raise exception 'Chat read-state cannot move backwards.' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$function$;

create function public.delete_chat_message(p_message_id uuid)
returns public.chat_messages language plpgsql security definer set search_path = pg_catalog, public as $function$
declare v_actor_id uuid := auth.uid(); v_message public.chat_messages%rowtype;
begin
  if v_actor_id is null or p_message_id is null then raise exception 'Chat access denied.' using errcode = '42501'; end if;
  select m.* into v_message from public.chat_messages as m join public.chat_conversations as c on c.id = m.conversation_id
    where m.id = p_message_id and v_actor_id in (c.dietitian_id, c.client_id) for update of m;
  if not found or v_message.conversation_id is null or v_message.sender_id is distinct from v_actor_id or v_message.client_message_id is null then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;
  if v_message.deleted_at is not null then return v_message; end if;
  update public.chat_messages set body = null, deleted_at = now(), deleted_by = v_actor_id where id = v_message.id returning * into v_message;
  return v_message;
end
$function$;

create function public.mark_chat_conversation_delivered(p_conversation_id uuid, p_last_delivered_message_id uuid)
returns public.chat_read_states language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_actor_id uuid := auth.uid(); v_target_created_at timestamptz; v_read_created_at timestamptz;
  v_existing public.chat_read_states%rowtype; v_result public.chat_read_states%rowtype;
  v_desired_message_id uuid := p_last_delivered_message_id; v_desired_created_at timestamptz;
begin
  if v_actor_id is null or p_conversation_id is null or p_last_delivered_message_id is null then raise exception 'Chat access denied.' using errcode = '42501'; end if;
  if not exists (select 1 from public.chat_conversations as c where c.id = p_conversation_id and v_actor_id in (c.dietitian_id, c.client_id)) then raise exception 'Chat access denied.' using errcode = '42501'; end if;
  select m.created_at into v_target_created_at from public.chat_messages as m where m.id = p_last_delivered_message_id and m.conversation_id = p_conversation_id;
  if not found then raise exception 'Invalid chat delivery pointer.' using errcode = '22023'; end if;
  v_desired_created_at := v_target_created_at;
  select rs.* into v_existing from public.chat_read_states as rs where rs.conversation_id = p_conversation_id and rs.user_id = v_actor_id for update;
  if found and v_existing.last_read_message_id is not null then
    select m.created_at into v_read_created_at from public.chat_messages as m where m.id = v_existing.last_read_message_id;
    if (v_read_created_at, v_existing.last_read_message_id) > (v_desired_created_at, v_desired_message_id) then v_desired_created_at := v_read_created_at; v_desired_message_id := v_existing.last_read_message_id; end if;
  end if;
  if found and v_existing.last_delivered_message_id is not null and (v_existing.last_delivered_at, v_existing.last_delivered_message_id) >= (v_desired_created_at, v_desired_message_id) then return v_existing; end if;
  insert into public.chat_read_states (conversation_id, user_id, last_delivered_message_id) values (p_conversation_id, v_actor_id, v_desired_message_id)
    on conflict (conversation_id, user_id) do update set last_delivered_message_id = excluded.last_delivered_message_id returning * into v_result;
  return v_result;
end
$function$;

create or replace function public.mark_chat_conversation_read(p_conversation_id uuid, p_last_read_message_id uuid)
returns public.chat_read_states language plpgsql security definer set search_path = pg_catalog, public as $function$
declare
  v_actor_id uuid := auth.uid(); v_target_created_at timestamptz;
  v_existing public.chat_read_states%rowtype; v_result public.chat_read_states%rowtype;
  v_delivered_message_id uuid := p_last_read_message_id; v_delivered_created_at timestamptz;
begin
  if v_actor_id is null or p_conversation_id is null or p_last_read_message_id is null then raise exception 'Chat access denied.' using errcode = '42501'; end if;
  if not exists (select 1 from public.chat_conversations as c where c.id = p_conversation_id and v_actor_id in (c.dietitian_id, c.client_id)) then raise exception 'Chat access denied.' using errcode = '42501'; end if;
  select m.created_at into v_target_created_at from public.chat_messages as m where m.id = p_last_read_message_id and m.conversation_id = p_conversation_id;
  if not found then raise exception 'Invalid chat read pointer.' using errcode = '22023'; end if;
  select rs.* into v_existing from public.chat_read_states as rs where rs.conversation_id = p_conversation_id and rs.user_id = v_actor_id for update;
  if found and v_existing.last_read_message_id is not null and (v_existing.last_read_at, v_existing.last_read_message_id) >= (v_target_created_at, p_last_read_message_id) then return v_existing; end if;
  v_delivered_created_at := v_target_created_at;
  if found and v_existing.last_delivered_message_id is not null and (v_existing.last_delivered_at, v_existing.last_delivered_message_id) > (v_delivered_created_at, v_delivered_message_id) then v_delivered_created_at := v_existing.last_delivered_at; v_delivered_message_id := v_existing.last_delivered_message_id; end if;
  insert into public.chat_read_states (conversation_id, user_id, last_delivered_message_id, last_read_message_id) values (p_conversation_id, v_actor_id, v_delivered_message_id, p_last_read_message_id)
    on conflict (conversation_id, user_id) do update set last_delivered_message_id = excluded.last_delivered_message_id, last_read_message_id = excluded.last_read_message_id returning * into v_result;
  return v_result;
end
$function$;

alter table public.chat_messages replica identity full;
drop policy if exists "Chat participants can select own read state" on public.chat_read_states;
create policy "Chat participants can select read states" on public.chat_read_states for select to authenticated using (
  (select auth.uid()) is not null and exists (select 1 from public.chat_conversations as c where c.id = chat_read_states.conversation_id and ((select auth.uid()) = c.dietitian_id or (select auth.uid()) = c.client_id))
);

alter function public.delete_chat_message(uuid) owner to postgres;
alter function public.mark_chat_conversation_delivered(uuid, uuid) owner to postgres;
alter function public.mark_chat_conversation_read(uuid, uuid) owner to postgres;
revoke all on function public.delete_chat_message(uuid) from public, anon, service_role;
revoke all on function public.mark_chat_conversation_delivered(uuid, uuid) from public, anon, service_role;
revoke all on function public.mark_chat_conversation_read(uuid, uuid) from public, anon, service_role;
grant execute on function public.delete_chat_message(uuid) to authenticated;
grant execute on function public.mark_chat_conversation_delivered(uuid, uuid) to authenticated;
grant execute on function public.mark_chat_conversation_read(uuid, uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'chat_read_states' and policyname = 'Chat participants can select read states')
     or has_table_privilege('authenticated', 'public.chat_messages', 'UPDATE')
     or has_table_privilege('authenticated', 'public.chat_read_states', 'INSERT')
     or has_table_privilege('authenticated', 'public.chat_read_states', 'UPDATE')
     or not has_function_privilege('authenticated', 'public.delete_chat_message(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_chat_conversation_delivered(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_chat_conversation_read(uuid,uuid)', 'EXECUTE') then
    raise exception 'Chat delete and receipt security postcondition failed.';
  end if;
end
$$;

commit;
