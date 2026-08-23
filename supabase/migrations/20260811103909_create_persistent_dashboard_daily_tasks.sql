-- MVP-5: persistent, dietitian-owned Dashboard daily tasks.
-- This migration creates no fixture rows and grants clients no task access.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null then
    raise exception 'Daily task prerequisites are missing; migration stopped.';
  end if;

  if to_regclass('public.daily_tasks') is not null
     or to_regprocedure('public.enforce_daily_task_contract()') is not null then
    raise exception 'Daily task objects already exist; migration will not overwrite them.';
  end if;
end
$preflight$;

create table public.daily_tasks (
  id uuid primary key default gen_random_uuid(),
  dietitian_id uuid not null
    references public.profiles(id) on delete cascade,
  client_id uuid null
    references public.profiles(id) on delete set null,
  title text not null,
  description text null,
  due_date date not null,
  due_time time(0) without time zone null,
  priority text not null default 'medium',
  status text not null default 'pending',
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_tasks_title_length_check
    check (char_length(btrim(title)) between 1 and 160),
  constraint daily_tasks_description_length_check
    check (description is null or char_length(btrim(description)) between 1 and 2000),
  constraint daily_tasks_priority_check
    check (priority in ('low', 'medium', 'high')),
  constraint daily_tasks_status_check
    check (status in ('pending', 'completed')),
  constraint daily_tasks_completion_state_check
    check (
      (status = 'pending' and completed_at is null)
      or (status = 'completed' and completed_at is not null)
    ),
  constraint daily_tasks_distinct_client_check
    check (client_id is null or client_id <> dietitian_id)
);

create index daily_tasks_dietitian_status_due_idx
  on public.daily_tasks (dietitian_id, status, due_date, due_time, id);

create index daily_tasks_client_idx
  on public.daily_tasks (client_id)
  where client_id is not null;

create function public.enforce_daily_task_contract()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  v_client_link_changed boolean := true;
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(new.description), '');

  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending' or new.completed_at is not null then
      raise exception 'New daily tasks must start pending.' using errcode = '23514';
    end if;
    new.created_at := now();
  else
    v_client_link_changed := new.client_id is distinct from old.client_id;
    if new.id is distinct from old.id
       or new.dietitian_id is distinct from old.dietitian_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Daily task identity and ownership fields are immutable.' using errcode = '42501';
    end if;

    if new.status is distinct from old.status then
      if new.status = 'completed' then
        new.completed_at := now();
      elsif new.status = 'pending' then
        new.completed_at := null;
      end if;
    else
      new.completed_at := old.completed_at;
    end if;
  end if;

  if new.client_id is not null
     and v_client_link_changed
     and not exists (
       select 1
       from public.dietitian_clients as dc
       where dc.dietitian_id = new.dietitian_id
         and dc.client_id = new.client_id
         and dc.status = 'active'::public.client_status
     ) then
    raise exception 'Daily tasks can reference only an active linked client.' using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end
$function$;

create trigger daily_tasks_enforce_contract
before insert or update on public.daily_tasks
for each row execute function public.enforce_daily_task_contract();

alter table public.daily_tasks enable row level security;

create policy "Approved dietitians can select own daily tasks"
on public.daily_tasks
for select
to authenticated
using (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
);

create policy "Approved dietitians can create own daily tasks"
on public.daily_tasks
for insert
to authenticated
with check (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
  and status = 'pending'
  and completed_at is null
  and (
    client_id is null
    or exists (
      select 1
      from public.dietitian_clients as dc
      where dc.dietitian_id = (select auth.uid())
        and dc.client_id = daily_tasks.client_id
        and dc.status = 'active'::public.client_status
    )
  )
);

create policy "Approved dietitians can update own daily tasks"
on public.daily_tasks
for update
to authenticated
using (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
)
with check (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
);

create policy "Approved dietitians can delete own daily tasks"
on public.daily_tasks
for delete
to authenticated
using (
  dietitian_id = (select auth.uid())
  and (select public.is_current_user_dietitian())
);

revoke all privileges on table public.daily_tasks from public, anon, authenticated;
grant select, insert, update, delete on table public.daily_tasks to authenticated;
grant all privileges on table public.daily_tasks to service_role;

revoke all on function public.enforce_daily_task_contract() from public, anon, authenticated;
grant execute on function public.enforce_daily_task_contract() to service_role;

comment on table public.daily_tasks is
  'Dietitian-owned operational dashboard tasks. Clients have no direct access.';
comment on column public.daily_tasks.due_date is
  'Civil due date interpreted in the DietBridge business timezone (Europe/Istanbul).';
comment on column public.daily_tasks.due_time is
  'Optional Europe/Istanbul wall-clock due time without timezone conversion.';

do $postflight$
declare
  v_policy_count integer;
begin
  if to_regclass('public.daily_tasks') is null
     or not (select relrowsecurity from pg_class where oid = 'public.daily_tasks'::regclass) then
    raise exception 'Daily task table or RLS postflight failed.';
  end if;

  select count(*)
    into v_policy_count
    from pg_policies
   where schemaname = 'public'
     and tablename = 'daily_tasks';

  if v_policy_count <> 4
     or has_table_privilege('anon', 'public.daily_tasks', 'select')
     or not has_table_privilege('authenticated', 'public.daily_tasks', 'select')
     or not has_table_privilege('authenticated', 'public.daily_tasks', 'insert')
     or not has_table_privilege('authenticated', 'public.daily_tasks', 'update')
     or not has_table_privilege('authenticated', 'public.daily_tasks', 'delete') then
    raise exception 'Daily task policy or privilege postflight failed.';
  end if;
end
$postflight$;

commit;
