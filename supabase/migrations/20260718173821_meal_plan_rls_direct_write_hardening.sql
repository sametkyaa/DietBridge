-- Make canonical RPCs the only meal-plan mutation surface and replace legacy
-- read policies with active-relationship, verified-role authorization.

do $$
begin
  if to_regclass('public.meal_plans') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is null
     or to_regprocedure('public.set_my_meal_completion(uuid,boolean)') is null then
    raise exception 'Meal-plan RLS hardening prerequisites are missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('meal_plans', 'meals')
      and c.relrowsecurity is true
    group by n.nspname
    having count(*) = 2
  ) then
    raise exception 'RLS must already be enabled on meal_plans and meals.';
  end if;
end
$$;

-- Replace the complete legacy policy surface. Only canonical SELECT policies
-- remain; table mutations are unavailable to browser roles.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('meal_plans', 'meals')
  loop
    execute pg_catalog.format(
      'drop policy %I on %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  end loop;
end
$$;

create policy meal_plans_select_canonical
on public.meal_plans
for select
to authenticated
using (
  (
    client_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as client_profile
      where client_profile.id = (select auth.uid())
        and client_profile.role = 'client'::public.user_role
    )
  )
  or
  (
    dietitian_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles as dietitian_profile
      join public.dietitian_profiles as verification
        on verification.user_id = dietitian_profile.id
      join public.dietitian_clients as relationship
        on relationship.dietitian_id = dietitian_profile.id
       and relationship.client_id = meal_plans.client_id
      where dietitian_profile.id = (select auth.uid())
        and dietitian_profile.role = 'dietitian'::public.user_role
        and verification.verification_status = 'approved'
        and verification.is_verified is true
        and relationship.status = 'active'::public.client_status
    )
  )
);

create policy meals_select_canonical
on public.meals
for select
to authenticated
using (
  exists (
    select 1
    from public.meal_plans as parent_plan
    where parent_plan.id = meals.plan_id
      and (
        (
          parent_plan.client_id = (select auth.uid())
          and exists (
            select 1
            from public.profiles as client_profile
            where client_profile.id = (select auth.uid())
              and client_profile.role = 'client'::public.user_role
          )
        )
        or
        (
          parent_plan.dietitian_id = (select auth.uid())
          and exists (
            select 1
            from public.profiles as dietitian_profile
            join public.dietitian_profiles as verification
              on verification.user_id = dietitian_profile.id
            join public.dietitian_clients as relationship
              on relationship.dietitian_id = dietitian_profile.id
             and relationship.client_id = parent_plan.client_id
            where dietitian_profile.id = (select auth.uid())
              and dietitian_profile.role = 'dietitian'::public.user_role
              and verification.verification_status = 'approved'
              and verification.is_verified is true
              and relationship.status = 'active'::public.client_status
          )
        )
      )
  )
);

revoke all on table public.meal_plans from anon, authenticated;
revoke all on table public.meals from anon, authenticated;
grant select on table public.meal_plans to authenticated;
grant select on table public.meals to authenticated;

-- The completion RPC updates only is_eaten and derives the client actor from
-- auth.uid(). Its SECURITY DEFINER body is deliberately narrower than a table
-- UPDATE grant.
create or replace function public.set_my_meal_completion(
  p_meal_id uuid,
  p_is_eaten boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_updated_count integer;
begin
  if v_actor_id is null
     or p_meal_id is null
     or p_is_eaten is null
     or not exists (
       select 1
       from public.profiles as actor_profile
       where actor_profile.id = v_actor_id
         and actor_profile.role = 'client'::public.user_role
     ) then
    raise exception 'Meal completion authorization failed.' using errcode = '42501';
  end if;

  update public.meals as meal
  set is_eaten = p_is_eaten
  where meal.id = p_meal_id
    and exists (
      select 1
      from public.meal_plans as parent_plan
      where parent_plan.id = meal.plan_id
        and parent_plan.client_id = v_actor_id
    );

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Meal completion authorization failed.' using errcode = '42501';
  end if;

  return true;
end;
$function$;

alter function public.save_weekly_meal_plan(uuid, date, jsonb)
  security definer
  set search_path = pg_catalog, public;
alter function public.set_my_meal_completion(uuid, boolean)
  security definer
  set search_path = pg_catalog, public;

revoke all on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.set_my_meal_completion(uuid, boolean)
from public, anon, authenticated, service_role;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb)
to authenticated;
grant execute on function public.set_my_meal_completion(uuid, boolean)
to authenticated;

comment on policy meal_plans_select_canonical on public.meal_plans is
  'Clients read only their own plans; verified dietitians require an active relationship.';
comment on policy meals_select_canonical on public.meals is
  'Meal visibility inherits the canonical authorization of its parent meal plan.';
comment on function public.set_my_meal_completion(uuid, boolean) is
  'Allows an authenticated client to patch only is_eaten on a meal in their own plan.';
