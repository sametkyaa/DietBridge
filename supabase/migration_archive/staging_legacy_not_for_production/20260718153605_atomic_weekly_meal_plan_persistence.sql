-- Atomically persists one canonical Monday-Sunday meal-plan week.
-- Existing data is never repaired implicitly: incompatible rows fail closed.

do $$
begin
  if to_regclass('public.meal_plans') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null then
    raise exception 'Weekly meal-plan persistence prerequisites are missing.';
  end if;

  if exists (
    select 1
    from public.meal_plans
    where client_id is null or dietitian_id is null or plan_date is null
  ) then
    raise exception 'meal_plans contains null canonical ownership/date values.';
  end if;

  if exists (
    select 1
    from public.meal_plans
    group by client_id, dietitian_id, plan_date
    having count(*) > 1
  ) then
    raise exception 'meal_plans contains duplicate client/dietitian/date rows.';
  end if;

  if exists (
    select 1
    from public.meals
    where plan_id is null
       or sort_order is null
       or sort_order < 0
       or source is null
       or source not in ('manual', 'recipe')
       or (source = 'recipe' and recipe_id is null)
       or (source = 'manual' and recipe_id is not null)
  ) then
    raise exception 'meals contains rows incompatible with the canonical weekly contract.';
  end if;

  if exists (
    select 1
    from public.meals
    group by plan_id, sort_order
    having count(*) > 1
  ) then
    raise exception 'meals contains duplicate sort_order values within a plan.';
  end if;

  if to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is not null then
    raise exception 'save_weekly_meal_plan(uuid,date,jsonb) already exists.';
  end if;
end
$$;

alter table public.meal_plans
  alter column client_id set not null,
  alter column dietitian_id set not null;

alter table public.meal_plans
  add constraint meal_plans_client_dietitian_plan_date_key
  unique (client_id, dietitian_id, plan_date);

alter table public.meals
  alter column plan_id set not null,
  alter column sort_order set default 0,
  alter column sort_order set not null,
  alter column source set default 'manual',
  alter column source set not null;

alter table public.meals
  add constraint meals_sort_order_nonnegative_check
  check (sort_order >= 0),
  add constraint meals_source_contract_check
  check (
    (source = 'manual' and recipe_id is null)
    or (source = 'recipe' and recipe_id is not null)
  ),
  add constraint meals_plan_id_sort_order_key
  unique (plan_id, sort_order)
  deferrable initially deferred;

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
  v_actor_id uuid := auth.uid();
  v_day jsonb;
  v_meal jsonb;
  v_day_index integer;
  v_plan_date date;
  v_plan_id uuid;
  v_meal_id uuid;
  v_existing_plan_id uuid;
  v_saved_meal_ids uuid[];
  v_seen_meal_ids uuid[] := array[]::uuid[];
  v_seen_sort_orders integer[];
  v_sort_order integer;
  v_source text;
  v_recipe_id uuid;
  v_meal_type public.meal_type;
  v_title text;
  v_time time without time zone;
  v_calories integer;
  v_macros jsonb;
  v_photo_url text;
  v_notes text;
  v_result jsonb;
begin
  if v_actor_id is null or p_client_id is null or p_week_start is null then
    raise exception 'Weekly meal plan authorization failed.' using errcode = '42501';
  end if;

  perform 1
    from public.profiles as p
    join public.dietitian_profiles as dp on dp.user_id = p.id
    where p.id = v_actor_id
      and p.role = 'dietitian'::public.user_role
      and dp.verification_status = 'approved'
      and dp.is_verified is true
    for key share of p, dp;
  if not found then
    raise exception 'Weekly meal plan authorization failed.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles as p
    where p.id = p_client_id
      and p.role = 'client'::public.user_role
  ) then
    raise exception 'Selected client is invalid.' using errcode = '22023';
  end if;

  perform 1
    from public.dietitian_clients as dc
    where dc.dietitian_id = v_actor_id
      and dc.client_id = p_client_id
      and dc.status = 'active'::public.client_status
    for key share;
  if not found then
    raise exception 'An active dietitian-client relationship is required.' using errcode = '42501';
  end if;

  if extract(isodow from p_week_start) <> 1 then
    raise exception 'p_week_start must be a Monday.' using errcode = '22023';
  end if;

  if p_days is null
     or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) <> 7 then
    raise exception 'p_days must contain exactly seven days.' using errcode = '22023';
  end if;

  -- Serialize the same actor/client/week while the unique constraint remains
  -- the final cross-session duplicate guard.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_id::text || ':' || p_client_id::text || ':' || p_week_start::text,
      0
    )
  );

  for v_day, v_day_index in
    select item.value, item.ordinality::integer
    from pg_catalog.jsonb_array_elements(p_days) with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(v_day) is distinct from 'object'
       or jsonb_typeof(v_day -> 'plan_date') is distinct from 'string'
       or jsonb_typeof(v_day -> 'meals') is distinct from 'array' then
      raise exception 'Each day must contain plan_date and a meals array.' using errcode = '22023';
    end if;

    begin
      v_plan_date := (v_day ->> 'plan_date')::date;
    exception when others then
      raise exception 'Invalid plan_date in weekly payload.' using errcode = '22023';
    end;

    if v_plan_date <> p_week_start + (v_day_index - 1) then
      raise exception 'Weekly payload dates must be consecutive and ordered.' using errcode = '22023';
    end if;

    if v_day ? 'notes'
       and jsonb_typeof(v_day -> 'notes') not in ('string', 'null') then
      raise exception 'Plan notes must be text or null.' using errcode = '22023';
    end if;
    v_notes := case
      when not (v_day ? 'notes') or jsonb_typeof(v_day -> 'notes') = 'null' then null
      else v_day ->> 'notes'
    end;

    insert into public.meal_plans (client_id, dietitian_id, plan_date, notes)
    values (p_client_id, v_actor_id, v_plan_date, v_notes)
    on conflict (client_id, dietitian_id, plan_date)
    do update set notes = excluded.notes
    returning id into v_plan_id;

    v_saved_meal_ids := array[]::uuid[];
    v_seen_sort_orders := array[]::integer[];

    for v_meal in
      select meal.value
      from pg_catalog.jsonb_array_elements(v_day -> 'meals') as meal(value)
    loop
      if jsonb_typeof(v_meal) is distinct from 'object' then
        raise exception 'Each meal must be an object.' using errcode = '22023';
      end if;

      if v_meal ? 'id' and jsonb_typeof(v_meal -> 'id') <> 'null' then
        if jsonb_typeof(v_meal -> 'id') is distinct from 'string' then
          raise exception 'Meal id must be a UUID string.' using errcode = '22023';
        end if;
        begin
          v_meal_id := (v_meal ->> 'id')::uuid;
        exception when others then
          raise exception 'Meal id must be a valid UUID.' using errcode = '22023';
        end;
        if v_meal_id = '00000000-0000-0000-0000-000000000000'::uuid
           or v_meal_id = any(v_seen_meal_ids) then
          raise exception 'Meal ids must be non-zero and unique within the week.' using errcode = '22023';
        end if;
      else
        v_meal_id := null;
      end if;

      if jsonb_typeof(v_meal -> 'sort_order') is distinct from 'number'
         or (v_meal ->> 'sort_order') !~ '^[0-9]+$' then
        raise exception 'sort_order must be a non-negative integer.' using errcode = '22023';
      end if;
      begin
        v_sort_order := (v_meal ->> 'sort_order')::integer;
      exception when others then
        raise exception 'sort_order is outside the supported integer range.' using errcode = '22023';
      end;
      if v_sort_order = any(v_seen_sort_orders) then
        raise exception 'sort_order must be unique within a plan.' using errcode = '22023';
      end if;
      v_seen_sort_orders := pg_catalog.array_append(v_seen_sort_orders, v_sort_order);

      if jsonb_typeof(v_meal -> 'type') is distinct from 'string' then
        raise exception 'Meal type is required.' using errcode = '22023';
      end if;
      begin
        v_meal_type := (v_meal ->> 'type')::public.meal_type;
      exception when others then
        raise exception 'Meal type is unsupported.' using errcode = '22023';
      end;

      v_title := pg_catalog.btrim(v_meal ->> 'title');
      if jsonb_typeof(v_meal -> 'title') is distinct from 'string' or v_title = '' then
        raise exception 'Meal title is required.' using errcode = '22023';
      end if;

      if jsonb_typeof(v_meal -> 'time') is distinct from 'string'
         or (v_meal ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Meal time must use HH:MM.' using errcode = '22023';
      end if;
      v_time := (v_meal ->> 'time')::time without time zone;

      v_source := v_meal ->> 'source';
      if jsonb_typeof(v_meal -> 'source') is distinct from 'string'
         or v_source not in ('manual', 'recipe') then
        raise exception 'Meal source is unsupported.' using errcode = '22023';
      end if;

      if v_source = 'recipe' then
        if jsonb_typeof(v_meal -> 'recipe_id') is distinct from 'string' then
          raise exception 'Recipe meals require a valid recipe_id.' using errcode = '22023';
        end if;
        begin
          v_recipe_id := (v_meal ->> 'recipe_id')::uuid;
        exception when others then
          raise exception 'Recipe meals require a valid recipe_id.' using errcode = '22023';
        end;
        if v_recipe_id = '00000000-0000-0000-0000-000000000000'::uuid then
          raise exception 'Recipe meals require a valid recipe_id.' using errcode = '22023';
        end if;
      else
        if v_meal ? 'recipe_id' and jsonb_typeof(v_meal -> 'recipe_id') <> 'null' then
          raise exception 'Manual meals cannot include recipe_id.' using errcode = '22023';
        end if;
        v_recipe_id := null;
      end if;

      if not (v_meal ? 'calories') or jsonb_typeof(v_meal -> 'calories') = 'null' then
        v_calories := null;
      elsif jsonb_typeof(v_meal -> 'calories') = 'number'
            and (v_meal ->> 'calories') ~ '^-?[0-9]+$' then
        begin
          v_calories := (v_meal ->> 'calories')::integer;
        exception when others then
          raise exception 'Meal calories are outside the supported integer range.' using errcode = '22023';
        end;
      else
        raise exception 'Meal calories must be an integer or null.' using errcode = '22023';
      end if;

      if not (v_meal ? 'macros') or jsonb_typeof(v_meal -> 'macros') = 'null' then
        v_macros := '{}'::jsonb;
      elsif jsonb_typeof(v_meal -> 'macros') = 'object' then
        v_macros := v_meal -> 'macros';
      else
        raise exception 'Meal macros must be an object.' using errcode = '22023';
      end if;

      if not (v_meal ? 'photo_url') or jsonb_typeof(v_meal -> 'photo_url') = 'null' then
        v_photo_url := null;
      elsif jsonb_typeof(v_meal -> 'photo_url') = 'string' then
        v_photo_url := v_meal ->> 'photo_url';
      else
        raise exception 'Meal photo_url must be text or null.' using errcode = '22023';
      end if;

      if v_meal_id is not null then
        select m.plan_id
        into v_existing_plan_id
        from public.meals as m
        where m.id = v_meal_id;

        if not found or v_existing_plan_id <> v_plan_id then
          raise exception 'Meal id does not belong to the selected daily plan.' using errcode = '42501';
        end if;

        update public.meals
        set type = v_meal_type,
            title = v_title,
            calories = v_calories,
            macros = v_macros,
            photo_url = v_photo_url,
            sort_order = v_sort_order,
            time = v_time,
            source = v_source,
            recipe_id = v_recipe_id
        where id = v_meal_id;
        -- is_eaten is intentionally absent from the update contract.
      else
        insert into public.meals (
          plan_id,
          type,
          title,
          calories,
          macros,
          photo_url,
          sort_order,
          time,
          source,
          recipe_id
        ) values (
          v_plan_id,
          v_meal_type,
          v_title,
          v_calories,
          v_macros,
          v_photo_url,
          v_sort_order,
          v_time,
          v_source,
          v_recipe_id
        )
        returning id into v_meal_id;
        -- New rows use the database is_eaten=false default.
      end if;

      v_seen_meal_ids := pg_catalog.array_append(v_seen_meal_ids, v_meal_id);
      v_saved_meal_ids := pg_catalog.array_append(v_saved_meal_ids, v_meal_id);
    end loop;

    delete from public.meals as m
    where m.plan_id = v_plan_id
      and not (m.id = any(v_saved_meal_ids));
  end loop;

  select pg_catalog.jsonb_build_object(
    'client_id', p_client_id,
    'dietitian_id', v_actor_id,
    'week_start', p_week_start,
    'week_end', p_week_start + 6,
    'plans', coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', plan.id,
          'plan_date', plan.plan_date,
          'notes', plan.notes,
          'meals', plan.meals
        ) order by plan.plan_date
      ),
      '[]'::jsonb
    )
  )
  into v_result
  from (
    select
      mp.id,
      mp.plan_date,
      mp.notes,
      coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id', m.id,
              'plan_id', m.plan_id,
              'type', m.type,
              'title', m.title,
              'calories', m.calories,
              'macros', m.macros,
              'photo_url', m.photo_url,
              'is_eaten', m.is_eaten,
              'sort_order', m.sort_order,
              'time', to_char(m.time, 'HH24:MI'),
              'source', m.source,
              'recipe_id', m.recipe_id
            ) order by m.sort_order, m.id
          )
          from public.meals as m
          where m.plan_id = mp.id
        ),
        '[]'::jsonb
      ) as meals
    from public.meal_plans as mp
    where mp.client_id = p_client_id
      and mp.dietitian_id = v_actor_id
      and mp.plan_date between p_week_start and p_week_start + 6
    order by mp.plan_date
  ) as plan;

  return v_result;
end;
$function$;

revoke execute on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb)
to authenticated;
