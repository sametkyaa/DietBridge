begin;

do $$
begin
  if to_regclass('public.meals') is null
     or to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is null then
    raise exception 'Canonical meal macros prerequisites are missing.';
  end if;

  if to_regprocedure('public.is_canonical_meal_macros(jsonb)') is not null then
    raise exception 'Canonical meal macros helper already exists; inspect the active contract before continuing.';
  end if;
end
$$;

create function public.is_canonical_meal_macros(p_macros jsonb)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $function$
  select
    jsonb_typeof(p_macros) = 'object'
    and p_macros ?& array['protein', 'carbs', 'fat']::text[]
    and (select count(*) from jsonb_object_keys(p_macros)) = 3
    and jsonb_typeof(p_macros -> 'protein') = 'number'
    and jsonb_typeof(p_macros -> 'carbs') = 'number'
    and jsonb_typeof(p_macros -> 'fat') = 'number'
    and (p_macros ->> 'protein')::numeric > '-Infinity'::numeric
    and (p_macros ->> 'protein')::numeric < 'Infinity'::numeric
    and (p_macros ->> 'carbs')::numeric > '-Infinity'::numeric
    and (p_macros ->> 'carbs')::numeric < 'Infinity'::numeric
    and (p_macros ->> 'fat')::numeric > '-Infinity'::numeric
    and (p_macros ->> 'fat')::numeric < 'Infinity'::numeric
    and (p_macros ->> 'protein')::numeric >= 0
    and (p_macros ->> 'carbs')::numeric >= 0
    and (p_macros ->> 'fat')::numeric >= 0;
$function$;

revoke all on function public.is_canonical_meal_macros(jsonb)
from public, anon, authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from public.meals
    where not coalesce(public.is_canonical_meal_macros(macros), false)
  ) then
    raise exception 'WP5.3C0_BLOCKED_BY_EXISTING_MACROS_DATA: public.meals contains non-canonical macros.'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meals'::regclass
      and conname = 'meals_macros_canonical_check'
  ) then
    raise exception 'Canonical meals.macros constraint already exists; inspect the active contract before continuing.';
  end if;
end
$$;

alter table public.meals
  alter column macros drop default,
  alter column macros set not null,
  add constraint meals_macros_canonical_check
    check (public.is_canonical_meal_macros(macros));

create or replace function public.save_weekly_meal_plan(
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
  v_actor_id uuid := auth.uid();
  v_day jsonb;
  v_meal jsonb;
  v_photo_path text;
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
          if pg_catalog.jsonb_typeof(v_meal) = 'object' then
            if (v_meal ->> 'source') is distinct from 'manual'
               or (v_meal ? 'recipe_id' and pg_catalog.jsonb_typeof(v_meal -> 'recipe_id') <> 'null') then
              raise exception 'Recipe-backed meals are not supported until canonical recipe persistence exists.'
                using errcode = '22023';
            end if;

            if not coalesce(public.is_canonical_meal_macros(v_meal -> 'macros'), false) then
              raise exception 'Meal macros must be exactly {protein:number, carbs:number, fat:number} with finite non-negative values.'
                using errcode = '22023';
            end if;

            if not (v_meal ? 'photo_url') or pg_catalog.jsonb_typeof(v_meal -> 'photo_url') = 'null' then
              continue;
            end if;

            if pg_catalog.jsonb_typeof(v_meal -> 'photo_url') <> 'string' then
              raise exception 'Meal photo_url must be a canonical object path or null.' using errcode = '22023';
            end if;

            v_photo_path := v_meal ->> 'photo_url';
            if v_actor_id is null
               or v_photo_path !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
               or split_part(v_photo_path, '/', 2) <> p_client_id::text
               or split_part(v_photo_path, '/', 3) <> v_actor_id::text
               or not exists (
                 select 1
                 from storage.objects
                 where bucket_id = 'meal-photos'
                   and name = v_photo_path
               ) then
              raise exception 'Meal photo_url is not authorized for this client and dietitian.' using errcode = '42501';
            end if;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  return private.save_weekly_meal_plan_impl(p_client_id, p_week_start, p_days);
end;
$function$;

revoke all on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb) to authenticated;

comment on function public.is_canonical_meal_macros(jsonb) is
  'WP5.3C0 canonical meals.macros validator: exact protein, carbs, fat JSON numbers; finite and non-negative.';
comment on constraint meals_macros_canonical_check on public.meals is
  'WP5.3C0 canonical meals.macros contract; macros are required exact protein/carbs/fat JSON numbers.';
comment on function public.save_weekly_meal_plan(uuid, date, jsonb) is
  'Atomic weekly save with manual-only source, canonical macros, and canonical private meal-photo path validation.';

commit;
