begin;

do $$
begin
  if to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'chat_messages'
         and column_name = 'message_kind'
     ) then
    raise exception 'Chat image RLS prerequisites are missing.';
  end if;
end
$$;

alter table public.chat_upload_intents enable row level security;
alter table public.chat_attachments enable row level security;

revoke all on table public.chat_upload_intents from public, anon, authenticated;
revoke all on table public.chat_attachments from public, anon, authenticated;

grant select on table public.chat_upload_intents to authenticated;
grant select on table public.chat_attachments to authenticated;

create policy chat_upload_intents_select_own
on public.chat_upload_intents
for select
to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.chat_conversations as c
    where c.id = chat_upload_intents.conversation_id
      and (select auth.uid()) in (c.dietitian_id, c.client_id)
  )
);

create policy chat_attachments_select_participant
on public.chat_attachments
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from public.chat_messages as m
    join public.chat_conversations as c
      on c.id = m.conversation_id
    where m.id = chat_attachments.message_id
      and m.message_kind = 'image'
      and m.deleted_at is null
      and (select auth.uid()) in (c.dietitian_id, c.client_id)
  )
);

do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'public.chat_upload_intents',
    'public.chat_attachments'
  ]
  loop
    if not has_table_privilege('authenticated', v_table_name, 'SELECT')
       or has_table_privilege('authenticated', v_table_name, 'INSERT')
       or has_table_privilege('authenticated', v_table_name, 'UPDATE')
       or has_table_privilege('authenticated', v_table_name, 'DELETE')
       or has_table_privilege('anon', v_table_name, 'SELECT')
       or has_table_privilege('anon', v_table_name, 'INSERT')
       or has_table_privilege('anon', v_table_name, 'UPDATE')
       or has_table_privilege('anon', v_table_name, 'DELETE') then
      raise exception 'Unexpected chat image table privilege on %', v_table_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_upload_intents', 'chat_attachments')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Chat image direct DML policy exists unexpectedly.';
  end if;
end
$$;

commit;
