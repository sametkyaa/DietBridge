-- Aşama 6.1: Chat tables are readable only by conversation participants.
-- All client-side mutation paths stay closed; SECURITY DEFINER RPCs own writes.

do $$
begin
  if to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_read_states') is null then
    raise exception 'Chat RLS prerequisites are missing.';
  end if;
end
$$
alter table public.chat_conversations enable row level security
alter table public.chat_messages enable row level security
alter table public.chat_read_states enable row level security
drop policy if exists "Participants can select active relationship messages" on public.chat_messages
drop policy if exists "Participants can send active relationship messages" on public.chat_messages
revoke all on table public.chat_conversations from public, anon
revoke all on table public.chat_messages from public, anon
revoke all on table public.chat_read_states from public, anon
revoke insert, update, delete on table public.chat_conversations from authenticated
revoke insert, update, delete on table public.chat_messages from authenticated
revoke insert, update, delete on table public.chat_read_states from authenticated
grant select on table public.chat_conversations to authenticated
grant select on table public.chat_messages to authenticated
grant select on table public.chat_read_states to authenticated
-- Trusted server-side maintenance keeps explicit service-role table grants.
grant select, insert, update, delete on table public.chat_conversations to service_role
grant select, insert, update, delete on table public.chat_messages to service_role
grant select, insert, update, delete on table public.chat_read_states to service_role
create policy "Chat participants can select conversations"
on public.chat_conversations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and ((select auth.uid()) = dietitian_id or (select auth.uid()) = client_id)
)
create policy "Chat participants can select canonical messages"
on public.chat_messages
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (
    exists (
      select 1
      from public.chat_conversations as c
      where c.id = chat_messages.conversation_id
        and ((select auth.uid()) = c.dietitian_id or (select auth.uid()) = c.client_id)
    )
    or (
      chat_messages.conversation_id is null
      and ((select auth.uid()) = chat_messages.sender_id or (select auth.uid()) = chat_messages.receiver_id)
      and exists (
        select 1
        from public.dietitian_clients as dc
        where dc.status in ('active'::public.client_status, 'removed'::public.client_status)
          and (
            (dc.dietitian_id = chat_messages.sender_id and dc.client_id = chat_messages.receiver_id)
            or (dc.dietitian_id = chat_messages.receiver_id and dc.client_id = chat_messages.sender_id)
          )
      )
    )
  )
)
create policy "Chat participants can select own read state"
on public.chat_read_states
for select
to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1
    from public.chat_conversations as c
    where c.id = chat_read_states.conversation_id
      and ((select auth.uid()) = c.dietitian_id or (select auth.uid()) = c.client_id)
  )
)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_conversations'
      and policyname = 'Chat participants can select conversations'
  )
  or exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_conversations', 'chat_messages', 'chat_read_states')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Chat RLS postcondition failed.';
  end if;
end
$$
-- Forward-only rollback: use a separately reviewed policy migration. Do not
-- disable RLS to recover from an application defect.
