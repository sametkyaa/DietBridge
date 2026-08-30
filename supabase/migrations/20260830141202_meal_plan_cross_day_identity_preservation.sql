begin;

-- Preserve meal row identity when a weekly editor moves a meal between days.
-- The RPC still owns the whole selected week: all target plans are resolved
-- first, meal IDs are authorized against that week, and stale rows are removed
-- only after every requested row has been updated or inserted.
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
  v_day_index integer;
  v_plan_date date;
  v_plan_id uuid;
  v_plan_ids uuid[] := array[]::uuid[];
  v_meal_id uuid;
  v_existing_plan_id uuid;
  v_final_meal_ids uuid[] := array[]::uuid[];
  v_seen_meal_ids uuid[] := array[]::uuid[];
  v_seen_sort_orders integer[];
  v_sort_order integer;
  v_source text;
  v_recipe_id uuid;
  v_recipe record;
  v_snapshot record;
  v_meal_type public.meal_type;
  v_title text;
  v_description text;
  v_time time without time zone;
  v_calories integer;
  v_macros jsonb;
  v_protein numeric;
  v_carbs numeric;
  v_fat numeric;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_id::text || ':' || p_client_id::text || ':' || p_week_start::text,
      0
    )
  );

  -- Resolve every target plan before touching meals. This also keeps the
  -- response shape and empty-day behavior identical to the existing RPC.
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
    v_plan_ids := pg_catalog.array_append(v_plan_ids, v_plan_id);
  end loop;

  -- All meal validation and updates happen before the single week-wide
  -- cleanup below. Any error aborts this transaction, so no partial move,
  -- insert, or deletion can be observed by the caller.
  for v_day, v_day_index in
    select item.value, item.ordinality::integer
    from pg_catalog.jsonb_array_elements(p_days) with ordinality as item(value, ordinality)
  loop
    v_plan_id := v_plan_ids[v_day_index];
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

        -- An existing ID may originate from any day in this selected week,
        -- but never from another client, dietitian, or week.
        select m.plan_id
        into v_existing_plan_id
        from public.meals as m
        join public.meal_plans as existing_plan on existing_plan.id = m.plan_id
        where m.id = v_meal_id
          and existing_plan.id = any(v_plan_ids)
          and existing_plan.client_id = p_client_id
          and existing_plan.dietitian_id = v_actor_id
          and existing_plan.plan_date between p_week_start and p_week_start + 6
        for update of m;
        if not found then
          raise exception 'Meal id does not belong to the selected weekly plan.' using errcode = '42501';
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
        if jsonb_typeof(v_meal -> 'recipe_id') = 'null' or not (v_meal ? 'recipe_id') then
          if v_meal_id is null then
            raise exception 'Deleted recipe snapshots require an existing meal id.' using errcode = '22023';
          end if;
          select meal.title, meal.description, meal.calories, meal.macros, meal.photo_url
          into v_snapshot
          from public.meals as meal
          join public.meal_plans as snapshot_plan on snapshot_plan.id = meal.plan_id
          where meal.id = v_meal_id
            and snapshot_plan.id = any(v_plan_ids)
            and snapshot_plan.client_id = p_client_id
            and snapshot_plan.dietitian_id = v_actor_id
            and snapshot_plan.plan_date between p_week_start and p_week_start + 6
            and meal.source = 'recipe'
            and meal.recipe_id is null;
          if not found then
            raise exception 'Deleted recipe snapshot is unavailable or does not belong to this week.' using errcode = '42501';
          end if;
          v_title := v_snapshot.title;
          v_description := v_snapshot.description;
          v_calories := v_snapshot.calories;
          v_macros := v_snapshot.macros;
          v_photo_url := v_snapshot.photo_url;
          v_recipe_id := null;
        else
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
          select id, name, description, calories, protein, carbs, fat, image_path
          into v_recipe
          from public.recipes
          where id = v_recipe_id
            and dietitian_id = v_actor_id;
          if not found then
            raise exception 'Recipe is unavailable or does not belong to the current dietitian.' using errcode = '42501';
          end if;
          v_title := v_recipe.name;
          v_description := v_recipe.description;
          v_calories := v_recipe.calories;
          v_macros := jsonb_build_object('protein', v_recipe.protein, 'carbs', v_recipe.carbs, 'fat', v_recipe.fat);
          v_photo_url := v_recipe.image_path;
          v_recipe_id := v_recipe.id;
        end if;
      else
        if v_meal ? 'recipe_id' and jsonb_typeof(v_meal -> 'recipe_id') <> 'null' then
          raise exception 'Manual meals cannot include recipe_id.' using errcode = '22023';
        end if;
        v_recipe_id := null;
        v_title := pg_catalog.btrim(v_meal ->> 'title');
        if jsonb_typeof(v_meal -> 'title') is distinct from 'string' or v_title = '' then
          raise exception 'Meal title is required.' using errcode = '22023';
        end if;
        if not (v_meal ? 'description') or jsonb_typeof(v_meal -> 'description') = 'null' then
          v_description := null;
        elsif jsonb_typeof(v_meal -> 'description') = 'string' then
          v_description := v_meal ->> 'description';
          if char_length(v_description) > 2000 then
            raise exception 'Meal description exceeds the supported length.' using errcode = '22023';
          end if;
        else
          raise exception 'Meal description must be text or null.' using errcode = '22023';
        end if;
        if not (v_meal ? 'calories') or jsonb_typeof(v_meal -> 'calories') = 'null' then
          v_calories := null;
        elsif jsonb_typeof(v_meal -> 'calories') = 'number'
              and (v_meal ->> 'calories') ~ '^[0-9]+$' then
          begin
            v_calories := (v_meal ->> 'calories')::integer;
          exception when others then
            raise exception 'Meal calories are outside the supported integer range.' using errcode = '22023';
          end;
          if v_calories > 100000 then
            raise exception 'Meal calories must be between 0 and 100000 or null.' using errcode = '22023';
          end if;
        else
          raise exception 'Meal calories must be an integer or null.' using errcode = '22023';
        end if;
        if not (v_meal ? 'macros') or jsonb_typeof(v_meal -> 'macros') = 'null' then
          raise exception 'Meal macros are required.' using errcode = '22023';
        elsif jsonb_typeof(v_meal -> 'macros') <> 'object' then
          raise exception 'Meal macros must be an object.' using errcode = '22023';
        end if;
        v_macros := v_meal -> 'macros';
        if jsonb_typeof(v_macros -> 'protein') is distinct from 'number'
           or jsonb_typeof(v_macros -> 'carbs') is distinct from 'number'
           or jsonb_typeof(v_macros -> 'fat') is distinct from 'number' then
          raise exception 'Meal macros must contain numeric protein, carbs and fat.' using errcode = '22023';
        end if;
        v_protein := (v_macros ->> 'protein')::numeric;
        v_carbs := (v_macros ->> 'carbs')::numeric;
        v_fat := (v_macros ->> 'fat')::numeric;
        if not (v_protein >= 0 and v_protein <= 10000)
           or not (v_carbs >= 0 and v_carbs <= 10000)
           or not (v_fat >= 0 and v_fat <= 10000) then
          raise exception 'Meal macros must be finite, non-negative and within range.' using errcode = '22023';
        end if;
        if (select count(*) from jsonb_object_keys(v_macros)) <> 3 then
          raise exception 'Meal macros must contain exactly protein, carbs and fat.' using errcode = '22023';
        end if;
        v_macros := jsonb_build_object('protein', v_protein, 'carbs', v_carbs, 'fat', v_fat);
        if not (v_meal ? 'photo_url') or jsonb_typeof(v_meal -> 'photo_url') = 'null' then
          v_photo_url := null;
        elsif jsonb_typeof(v_meal -> 'photo_url') = 'string' then
          v_photo_url := v_meal ->> 'photo_url';
          if v_photo_url !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
             or split_part(v_photo_url, '/', 2) <> p_client_id::text
             or split_part(v_photo_url, '/', 3) <> v_actor_id::text
             or not exists (select 1 from storage.objects where bucket_id = 'meal-photos' and name = v_photo_url) then
            raise exception 'Meal photo_url is not authorized for this client and dietitian.' using errcode = '42501';
          end if;
        else
          raise exception 'Meal photo_url must be a canonical object path or null.' using errcode = '22023';
        end if;
      end if;

      if v_meal_id is not null then
        -- Updating plan_id is the only additional write needed for a move.
        -- Completion fields (is_eaten and completed_at) are deliberately
        -- omitted, so client-owned completion state survives the save.
        update public.meals
        set plan_id = v_plan_id,
            type = v_meal_type,
            title = v_title,
            description = nullif(pg_catalog.btrim(v_description), ''),
            calories = v_calories,
            macros = v_macros,
            photo_url = v_photo_url,
            sort_order = v_sort_order,
            time = v_time,
            source = v_source,
            recipe_id = v_recipe_id
        where id = v_meal_id;
      else
        insert into public.meals (
          plan_id,
          type,
          title,
          description,
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
          nullif(pg_catalog.btrim(v_description), ''),
          v_calories,
          v_macros,
          v_photo_url,
          v_sort_order,
          v_time,
          v_source,
          v_recipe_id
        )
        returning id into v_meal_id;
      end if;
      v_seen_meal_ids := pg_catalog.array_append(v_seen_meal_ids, v_meal_id);
      v_final_meal_ids := pg_catalog.array_append(v_final_meal_ids, v_meal_id);
    end loop;
  end loop;

  -- Cleanup is intentionally week-wide. A retained ID can now be attached to
  -- a different target day, so day-local deletion would remove moved meals.
  delete from public.meals as m
  using public.meal_plans as mp
  where m.plan_id = mp.id
    and mp.client_id = p_client_id
    and mp.dietitian_id = v_actor_id
    and mp.plan_date between p_week_start and p_week_start + 6
    and (
      pg_catalog.cardinality(v_final_meal_ids) = 0
      or not (m.id = any(v_final_meal_ids))
    );

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
              'description', m.description,
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

revoke all on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb) to authenticated;
notify pgrst, 'reload schema';

commit;
