-- Faz 0: canonical Realtime publication membership for meal, daily log and
-- appointment tables.
--
-- Production added some of these tables to supabase_realtime by hand
-- (see docs/SUPABASE_SECURITY_AUDIT.md section 15); staging and disposable
-- replays have none of them. This forward-only migration makes membership
-- part of the canonical chain. It is idempotent: a table that is already a
-- member is left untouched, nothing is ever dropped from the publication,
-- and replica identity is intentionally not changed.
--
-- Realtime postgres_changes delivery is authorized by each table's RLS
-- SELECT policies, so the preflight refuses to publish a table whose RLS is
-- disabled or which has no SELECT-capable policy for authenticated users.
begin;

do $preflight$
declare
  v_table_name text;
  v_relation regclass;
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception
      'Required publication supabase_realtime does not exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
      and puballtables
  ) then
    raise exception
      'Publication supabase_realtime is FOR ALL TABLES; per-table membership cannot be managed';
  end if;

  foreach v_table_name in array array[
    'meals',
    'meal_plans',
    'meal_change_requests',
    'daily_logs',
    'appointments'
  ]
  loop
    v_relation := to_regclass(format('public.%I', v_table_name));

    if v_relation is null then
      raise exception
        'Required Realtime table public.% does not exist',
        v_table_name;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class as c
      where c.oid = v_relation
        and c.relkind = 'r'
        and c.relrowsecurity is true
    ) then
      raise exception
        'RLS must be enabled on public.% before it is added to supabase_realtime',
        v_table_name;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_policies as p
      where p.schemaname = 'public'
        and p.tablename = v_table_name
        and p.cmd in ('SELECT', 'ALL')
        and p.permissive = 'PERMISSIVE'
        and (
          'authenticated' = any (p.roles)
          or 'public' = any (p.roles)
        )
    ) then
      raise exception
        'public.% has no permissive SELECT policy for authenticated users; Realtime would deliver nothing',
        v_table_name;
    end if;
  end loop;
end
$preflight$;

do $publication$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'meals',
    'meal_plans',
    'meal_change_requests',
    'daily_logs',
    'appointments'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        v_table_name
      );
    end if;
  end loop;
end
$publication$;

do $postflight$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'meals',
    'meal_plans',
    'meal_change_requests',
    'daily_logs',
    'appointments'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table_name
    ) then
      raise exception
        'Realtime publication postcondition failed for public.%',
        v_table_name;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class as c
      where c.oid = to_regclass(format('public.%I', v_table_name))
        and c.relrowsecurity is true
    ) then
      raise exception
        'RLS postcondition failed for public.%',
        v_table_name;
    end if;
  end loop;
end
$postflight$;

commit;
