-- Temporarily restrict weekly meal persistence to canonical manual meals.
-- Recipe persistence remains closed until a real recipes table and FK exist.

do $$
begin
  if to_regclass('public.meals') is null
     or to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is null then
    raise exception 'Manual-only meal source prerequisites are missing.';
  end if;

  if to_regclass('public.recipes') is not null then
    raise exception 'A recipes table now exists; review the temporary manual-only contract before applying.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as c
    where c.conrelid = 'public.meals'::regclass
      and c.contype = 'f'
      and exists (
        select 1
        from pg_catalog.unnest(c.conkey) as key(attnum)
        join pg_catalog.pg_attribute as a
          on a.attrelid = c.conrelid
         and a.attnum = key.attnum
        where a.attname = 'recipe_id'
      )
  ) then
    raise exception 'A recipe foreign key now exists; review the temporary manual-only contract before applying.';
  end if;

  if exists (
    select 1
    from public.meals
    where source <> 'manual'
       or recipe_id is not null
  ) then
    raise exception 'Existing meals are incompatible with the temporary manual-only contract.';
  end if;

  if to_regprocedure('private.save_weekly_meal_plan_impl(uuid,date,jsonb)') is not null then
    raise exception 'The private weekly meal-plan implementation already exists.';
  end if;
end
$$;

alter table public.meals
  drop constraint meals_source_contract_check;

alter table public.meals
  add constraint meals_source_contract_check
  check (source = 'manual' and recipe_id is null);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter function public.save_weekly_meal_plan(uuid, date, jsonb)
  set schema private;
alter function private.save_weekly_meal_plan(uuid, date, jsonb)
  rename to save_weekly_meal_plan_impl;

revoke all on function private.save_weekly_meal_plan_impl(uuid, date, jsonb)
from public, anon, authenticated, service_role;

create function public.save_weekly_meal_plan(
  p_client_id uuid,
  p_week_start date,
  p_days jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_day jsonb;
  v_meal jsonb;
begin
  if p_days is not null and pg_catalog.jsonb_typeof(p_days) = 'array' then
    for v_day in
      select item.value
      from pg_catalog.jsonb_array_elements(p_days) as item(value)
    loop
      if pg_catalog.jsonb_typeof(v_day) = 'object'
         and pg_catalog.jsonb_typeof(v_day -> 'meals') = 'array' then
        for v_meal in
          select meal.value
          from pg_catalog.jsonb_array_elements(v_day -> 'meals') as meal(value)
        loop
          if pg_catalog.jsonb_typeof(v_meal) = 'object'
             and (
               (v_meal ->> 'source') is distinct from 'manual'
               or (
                 v_meal ? 'recipe_id'
                 and pg_catalog.jsonb_typeof(v_meal -> 'recipe_id') <> 'null'
               )
             ) then
            raise exception 'Recipe-backed meals are not supported until canonical recipe persistence exists.'
              using errcode = '22023';
          end if;
        end loop;
      end if;
    end loop;
  end if;

  return private.save_weekly_meal_plan_impl(
    p_client_id,
    p_week_start,
    p_days
  );
end;
$function$;

revoke execute on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb)
to authenticated;

comment on function private.save_weekly_meal_plan_impl(uuid, date, jsonb) is
  'Private atomic implementation. Direct execution is revoked; use public.save_weekly_meal_plan.';
comment on function public.save_weekly_meal_plan(uuid, date, jsonb) is
  'Atomic weekly save with temporary fail-closed manual-only source validation.';
