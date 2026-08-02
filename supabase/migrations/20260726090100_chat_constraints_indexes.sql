-- Aşama 6.1: Canonical chat integrity, participant enforcement and query indexes.
-- Existing legacy rows are preserved because all new canonical columns are null.

do $$
begin
  if to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_read_states') is null
     or to_regclass('public.dietitian_clients') is null then
    raise exception 'Chat constraint prerequisites are missing.';
  end if;

  if to_regprocedure('public.enforce_chat_conversation_contract()') is not null
     or to_regprocedure('public.enforce_chat_message_contract()') is not null
     or to_regprocedure('public.enforce_chat_read_state_contract()') is not null then
    raise exception 'Chat integrity functions already exist; inspect schema drift first.';
  end if;
end
$$
alter table public.chat_conversations
  add constraint chat_conversations_relation_key unique (dietitian_client_id),
  add constraint chat_conversations_participants_key unique (dietitian_id, client_id),
  add constraint chat_conversations_distinct_participants_check
    check (dietitian_id <> client_id),
  add constraint chat_conversations_last_message_pair_check
    check (
      (last_message_id is null and last_message_at is null)
      or (last_message_id is not null and last_message_at is not null)
    )
alter table public.chat_messages
  add constraint chat_messages_canonical_shape_check
    check (
      (conversation_id is null and client_message_id is null and body is null)
      or (
        conversation_id is not null
        and sender_id is not null
        and client_message_id is not null
        and body is not null
      )
    ),
  add constraint chat_messages_body_length_check
    check (body is null or char_length(btrim(body)) between 1 and 4000),
  add constraint chat_messages_canonical_created_at_check
    check (conversation_id is null or created_at is not null),
  add constraint chat_messages_sender_client_message_key
    unique (sender_id, client_message_id)
create index chat_messages_conversation_created_id_idx
  on public.chat_messages (conversation_id, created_at desc, id desc)
  where conversation_id is not null
create index chat_conversations_dietitian_last_message_idx
  on public.chat_conversations (dietitian_id, last_message_at desc nulls last, id desc)
create index chat_conversations_client_last_message_idx
  on public.chat_conversations (client_id, last_message_at desc nulls last, id desc)
create index chat_read_states_user_updated_idx
  on public.chat_read_states (user_id, updated_at desc, conversation_id desc)
create function public.enforce_chat_conversation_contract()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid;
  v_client_id uuid;
  v_status public.client_status;
  v_message_conversation_id uuid;
  v_message_created_at timestamptz;
begin
  select dc.dietitian_id, dc.client_id, dc.status
    into v_dietitian_id, v_client_id, v_status
    from public.dietitian_clients as dc
    where dc.id = new.dietitian_client_id
    for key share;

  if not found
     or new.dietitian_id is distinct from v_dietitian_id
     or new.client_id is distinct from v_client_id
     or new.dietitian_id = new.client_id then
    raise exception 'Invalid chat conversation relationship.' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and v_status is distinct from 'active'::public.client_status then
    raise exception 'A chat conversation requires an active relationship.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (new.dietitian_client_id, new.dietitian_id, new.client_id)
         is distinct from (old.dietitian_client_id, old.dietitian_id, old.client_id) then
    raise exception 'Chat conversation participants are immutable.' using errcode = '42501';
  end if;

  if new.last_message_id is null then
    new.last_message_at := null;
  else
    select m.conversation_id, m.created_at
      into v_message_conversation_id, v_message_created_at
      from public.chat_messages as m
      where m.id = new.last_message_id;

    if not found
       or v_message_conversation_id is distinct from new.id
       or new.last_message_at is distinct from v_message_created_at then
      raise exception 'Chat last-message pointer is invalid.' using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$function$
create function public.enforce_chat_message_contract()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid;
  v_client_id uuid;
begin
  if new.conversation_id is null then
    raise exception 'New legacy chat_messages rows are not permitted.' using errcode = '23514';
  end if;

  select c.dietitian_id, c.client_id
    into v_dietitian_id, v_client_id
    from public.chat_conversations as c
    where c.id = new.conversation_id
    for key share;

  if not found
     or new.sender_id is null
     or new.sender_id not in (v_dietitian_id, v_client_id)
     or new.client_message_id is null
     or new.body is null
     or char_length(btrim(new.body)) not between 1 and 4000 then
    raise exception 'Invalid canonical chat message.' using errcode = '23514';
  end if;

  new.body := btrim(new.body);
  return new;
end
$function$
create function public.enforce_chat_read_state_contract()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid;
  v_client_id uuid;
  v_message_conversation_id uuid;
  v_message_created_at timestamptz;
  v_previous_created_at timestamptz;
begin
  select c.dietitian_id, c.client_id
    into v_dietitian_id, v_client_id
    from public.chat_conversations as c
    where c.id = new.conversation_id
    for key share;

  if not found or new.user_id not in (v_dietitian_id, v_client_id) then
    raise exception 'Invalid chat read-state participant.' using errcode = '23514';
  end if;

  if new.last_read_message_id is null then
    new.last_read_at := null;
  else
    select m.conversation_id, m.created_at
      into v_message_conversation_id, v_message_created_at
      from public.chat_messages as m
      where m.id = new.last_read_message_id;

    if not found or v_message_conversation_id is distinct from new.conversation_id then
      raise exception 'Read-state message does not belong to the conversation.' using errcode = '23514';
    end if;

    if tg_op = 'UPDATE' and old.last_read_message_id is not null then
      select m.created_at
        into v_previous_created_at
        from public.chat_messages as m
        where m.id = old.last_read_message_id;

      if (v_message_created_at, new.last_read_message_id)
           < (v_previous_created_at, old.last_read_message_id) then
        raise exception 'Chat read-state cannot move backwards.' using errcode = '22023';
      end if;
    end if;

    new.last_read_at := v_message_created_at;
  end if;

  new.updated_at := now();
  return new;
end
$function$
create trigger trg_enforce_chat_conversation_contract
before insert or update on public.chat_conversations
for each row execute function public.enforce_chat_conversation_contract()
create trigger trg_enforce_chat_message_contract
before insert or update on public.chat_messages
for each row execute function public.enforce_chat_message_contract()
create trigger trg_enforce_chat_read_state_contract
before insert or update on public.chat_read_states
for each row execute function public.enforce_chat_read_state_contract()
revoke all on function public.enforce_chat_conversation_contract() from public, anon, authenticated, service_role
revoke all on function public.enforce_chat_message_contract() from public, anon, authenticated, service_role
revoke all on function public.enforce_chat_read_state_contract() from public, anon, authenticated, service_role
do $$
begin
  if to_regprocedure('public.enforce_chat_conversation_contract()') is null
     or to_regprocedure('public.enforce_chat_message_contract()') is null
     or to_regprocedure('public.enforce_chat_read_state_contract()') is null
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.chat_conversations'::regclass
         and tgname = 'trg_enforce_chat_conversation_contract'
     ) then
    raise exception 'Chat constraint postcondition failed.';
  end if;
end
$$
-- Forward-only rollback: preserve canonical tables and ship a targeted forward
-- fix; dropping the constraints would make existing conversation history unsafe.
