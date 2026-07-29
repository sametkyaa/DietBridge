begin
do $$
declare
  v_message_text_not_null boolean;
begin
  select a.attnotnull
    into v_message_text_not_null
  from pg_attribute as a
  join pg_class as c on c.oid = a.attrelid
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'chat_messages'
    and a.attname = 'message_text'
    and a.attnum > 0
    and not a.attisdropped;

  if v_message_text_not_null is null then
    raise exception 'Required column public.chat_messages.message_text does not exist';
  end if;
end
$$
alter table public.chat_messages
  alter column message_text drop not null
do $$
declare
  v_message_text_not_null boolean;
begin
  select a.attnotnull
    into v_message_text_not_null
  from pg_attribute as a
  join pg_class as c on c.oid = a.attrelid
  join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'chat_messages'
    and a.attname = 'message_text'
    and a.attnum > 0
    and not a.attisdropped;

  if v_message_text_not_null is distinct from false then
    raise exception 'Postcondition failed: public.chat_messages.message_text remains NOT NULL';
  end if;
end
$$
commit
