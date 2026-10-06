-- Faz 2 / 5: per-conversation unread message counts for the dietitian panel.
--
-- Semantics (shared with chat_read_states):
--   * only messages sent by the client of the conversation are counted;
--   * soft-deleted messages (deleted_at is not null) are not counted;
--   * a message is unread when its (created_at, id) cursor is strictly after
--     the dietitian's own (last_read_at, last_read_message_id) cursor; with no
--     read state every client message is unread;
--   * only conversations of ACTIVE relationships of the calling, approved
--     dietitian are visible. Marking a conversation read through
--     mark_chat_conversation_read therefore brings its count to 0.
begin;

do $preflight$
begin
  if to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_read_states') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null then
    raise exception 'Unread count prerequisites are missing.';
  end if;

  if to_regprocedure('public.get_dietitian_unread_counts()') is not null then
    raise exception 'get_dietitian_unread_counts already exists; inspect schema drift before applying this migration.';
  end if;
end
$preflight$;

create function public.get_dietitian_unread_counts()
returns table (
  conversation_id uuid,
  client_id uuid,
  unread_count integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or not (select public.is_current_user_dietitian()) then
    raise exception 'Chat access denied.' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.client_id,
    (
      select count(*)::integer
        from public.chat_messages as m
       where m.conversation_id = c.id
         and m.sender_id = c.client_id
         and m.deleted_at is null
         and (
           rs.last_read_message_id is null
           or rs.last_read_at is null
           or (m.created_at, m.id) > (rs.last_read_at, rs.last_read_message_id)
         )
    )
  from public.chat_conversations as c
  join public.dietitian_clients as dc
    on dc.id = c.dietitian_client_id
   and dc.dietitian_id = c.dietitian_id
   and dc.client_id = c.client_id
   and dc.status = 'active'::public.client_status
  left join public.chat_read_states as rs
    on rs.conversation_id = c.id
   and rs.user_id = v_actor_id
  where c.dietitian_id = v_actor_id
  order by c.id;
end
$function$;

alter function public.get_dietitian_unread_counts() owner to postgres;
revoke all on function public.get_dietitian_unread_counts() from public, anon, service_role;
grant execute on function public.get_dietitian_unread_counts() to authenticated;

do $postflight$
begin
  if has_function_privilege('anon', 'public.get_dietitian_unread_counts()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_dietitian_unread_counts()', 'EXECUTE') then
    raise exception 'get_dietitian_unread_counts ACL is incorrect.';
  end if;
end
$postflight$;

commit;
