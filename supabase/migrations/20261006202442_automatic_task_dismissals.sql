-- Additive web preference; no changes to task derivation or mobile business tables.
-- Apply before deploying the dashboard that reads these preferences.
begin;

do $preflight$
begin
  if to_regclass('public.automatic_task_dismissals') is not null then
    raise exception 'automatic_task_dismissals already exists; inspect migration history before applying';
  end if;
  if to_regprocedure('public.is_current_user_dietitian()') is null
    or to_regclass('public.dietitian_clients') is null then
    raise exception 'Approved dietitian helper and relationship table are required';
  end if;
end
$preflight$;

create table public.automatic_task_dismissals (
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  task_key text not null check (task_key ~ '^(no_plan|plan_expired|meal_inactivity|meal_change_request|measurement_due):[0-9a-f-]{36}$'),
  task_revision text not null check (length(task_revision) between 1 and 256),
  created_at timestamptz not null default now(),
  primary key (dietitian_id, task_key)
);
create index automatic_task_dismissals_client_idx on public.automatic_task_dismissals(client_id);
alter table public.automatic_task_dismissals enable row level security;

revoke all on public.automatic_task_dismissals from public, anon, authenticated;
grant select on public.automatic_task_dismissals to authenticated;
grant insert (dietitian_id, client_id, task_key, task_revision) on public.automatic_task_dismissals to authenticated;
-- PostgREST upsert updates all payload columns, including conflict keys.
grant update (dietitian_id, client_id, task_key, task_revision) on public.automatic_task_dismissals to authenticated;
grant all on public.automatic_task_dismissals to service_role;

create policy automatic_task_dismissals_select_owner on public.automatic_task_dismissals
for select to authenticated using (
  dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian())
);

create policy automatic_task_dismissals_insert_owner on public.automatic_task_dismissals
for insert to authenticated with check (
  dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian())
  and exists (select 1 from public.dietitian_clients dc
    where dc.dietitian_id = (select auth.uid()) and dc.client_id = automatic_task_dismissals.client_id and dc.status = 'active')
);

create policy automatic_task_dismissals_update_owner on public.automatic_task_dismissals
for update to authenticated using (
  dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian())
) with check (
  dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian())
  and exists (select 1 from public.dietitian_clients dc
    where dc.dietitian_id = (select auth.uid()) and dc.client_id = automatic_task_dismissals.client_id and dc.status = 'active')
);

do $postflight$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.automatic_task_dismissals'::regclass)
    or has_table_privilege('anon', 'public.automatic_task_dismissals', 'SELECT')
    or has_table_privilege('authenticated', 'public.automatic_task_dismissals', 'DELETE') then
    raise exception 'Unexpected automatic_task_dismissals security configuration';
  end if;
end
$postflight$;
commit;
