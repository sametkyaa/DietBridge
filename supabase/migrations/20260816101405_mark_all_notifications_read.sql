begin;

do $precondition$
begin
  if to_regclass('public.notifications') is null then
    raise exception 'Notification Core table is missing.';
  end if;

  if to_regprocedure('public.mark_all_notifications_read()') is not null then
    raise exception 'mark_all_notifications_read() already exists; inspect schema drift before applying this migration.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications'
      and column_name in ('recipient_id', 'seen_at', 'read_at')
    group by table_schema, table_name
    having count(*) = 3
  ) then
    raise exception 'Notification Core read-state columns are missing.';
  end if;
end
$precondition$;

create function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := (select auth.uid());
  v_operation_at timestamptz := now();
  v_count integer;
begin
  if v_actor_id is null then
    raise exception 'Notification access denied.' using errcode = '42501';
  end if;

  update public.notifications
     set seen_at = coalesce(seen_at, v_operation_at),
         read_at = coalesce(read_at, v_operation_at),
         updated_at = v_operation_at
   where recipient_id = v_actor_id
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end
$function$;

alter function public.mark_all_notifications_read() owner to postgres;

revoke all on function public.mark_all_notifications_read() from public, anon, authenticated, service_role;
grant execute on function public.mark_all_notifications_read() to authenticated;

do $postcondition$
declare
  v_function_definition text;
  v_security_definer boolean;
  v_fixed_search_path boolean;
begin
  select pg_get_functiondef('public.mark_all_notifications_read()'::regprocedure)
    into v_function_definition;

  select p.prosecdef,
         exists (
           select 1
           from unnest(coalesce(p.proconfig, array[]::text[])) as setting
           where setting like 'search_path=pg_catalog%public%'
         )
    into v_security_definer, v_fixed_search_path
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid = 'public.mark_all_notifications_read()'::regprocedure;

  if not has_function_privilege('authenticated', 'public.mark_all_notifications_read()', 'EXECUTE')
     or has_function_privilege('anon', 'public.mark_all_notifications_read()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.mark_all_notifications_read()', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     or has_table_privilege('authenticated', 'public.notifications', 'DELETE')
     or has_table_privilege('anon', 'public.notifications', 'SELECT')
     or coalesce(v_security_definer, false) = false
     or coalesce(v_fixed_search_path, false) = false
     or position('auth.uid()' in v_function_definition) = 0
     or position('recipient_id = v_actor_id' in v_function_definition) = 0
     or position('read_at is null' in lower(v_function_definition)) = 0
     or position('get diagnostics v_count = row_count' in lower(v_function_definition)) = 0 then
    raise exception 'mark_all_notifications_read() security or scope postcondition failed.';
  end if;
end
$postcondition$;

notify pgrst, 'reload schema';

commit;
