begin;

revoke all privileges
on table
  public.chat_conversations,
  public.chat_messages,
  public.chat_read_states
from anon;

revoke insert, update, delete, truncate, references, trigger
on table
  public.chat_conversations,
  public.chat_messages,
  public.chat_read_states
from authenticated;

grant select
on table
  public.chat_conversations,
  public.chat_messages,
  public.chat_read_states
to authenticated;

do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'public.chat_conversations',
    'public.chat_messages',
    'public.chat_read_states'
  ]
  loop
    if has_table_privilege('anon', v_table_name, 'SELECT')
       or has_table_privilege('anon', v_table_name, 'INSERT')
       or has_table_privilege('anon', v_table_name, 'UPDATE')
       or has_table_privilege('anon', v_table_name, 'DELETE')
       or has_table_privilege('anon', v_table_name, 'TRUNCATE')
       or has_table_privilege('anon', v_table_name, 'REFERENCES')
       or has_table_privilege('anon', v_table_name, 'TRIGGER')
    then
      raise exception
        'anon retains an unexpected privilege on %',
        v_table_name;
    end if;

    if not has_table_privilege(
      'authenticated',
      v_table_name,
      'SELECT'
    ) then
      raise exception
        'authenticated SELECT is missing on %',
        v_table_name;
    end if;

    if has_table_privilege(
         'authenticated',
         v_table_name,
         'INSERT'
       )
       or has_table_privilege(
         'authenticated',
         v_table_name,
         'UPDATE'
       )
       or has_table_privilege(
         'authenticated',
         v_table_name,
         'DELETE'
       )
       or has_table_privilege(
         'authenticated',
         v_table_name,
         'TRUNCATE'
       )
       or has_table_privilege(
         'authenticated',
         v_table_name,
         'REFERENCES'
       )
       or has_table_privilege(
         'authenticated',
         v_table_name,
         'TRIGGER'
       )
    then
      raise exception
        'authenticated retains an unexpected privilege on %',
        v_table_name;
    end if;
  end loop;
end;
$$;

commit;
