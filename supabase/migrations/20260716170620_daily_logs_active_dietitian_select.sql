-- Allow an authenticated dietitian to read daily logs only for clients with
-- whom they currently have an active dietitian_clients relationship.

do $$
begin
  if to_regclass('public.daily_logs') is null then
    raise exception 'Expected public.daily_logs before adding the active dietitian SELECT policy.';
  end if;

  if to_regclass('public.dietitian_clients') is null then
    raise exception 'Expected public.dietitian_clients before adding the active dietitian SELECT policy.';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'daily_logs'
      and c.relrowsecurity
  ) then
    raise exception 'Expected RLS to be enabled on public.daily_logs.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'daily_logs'
      and column_name = 'client_id'
      and data_type = 'uuid'
  ) then
    raise exception 'Expected public.daily_logs.client_id uuid column.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_clients'
      and column_name = 'status'
      and udt_schema = 'public'
      and udt_name = 'client_status'
  ) then
    raise exception 'Expected public.dietitian_clients.status to use public.client_status.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and policyname = 'Dietitians can view active client daily logs'
  ) then
    raise exception 'Daily logs active dietitian SELECT policy already exists.';
  end if;
end
$$;

create policy "Dietitians can view active client daily logs"
on public.daily_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.dietitian_clients dc
    where dc.dietitian_id = (select auth.uid())
      and dc.client_id = daily_logs.client_id
      and dc.status = 'active'::public.client_status
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and policyname = 'Dietitians can view active client daily logs'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual is not null
  ) then
    raise exception 'Daily logs active dietitian SELECT policy postcondition failed.';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and policyname = 'Users can view own daily logs'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) then
    raise exception 'Existing client-own daily logs SELECT policy must remain present.';
  end if;
end
$$;

-- Rollback (run only in a separately approved rollback operation):
-- drop policy "Dietitians can view active client daily logs" on public.daily_logs;
