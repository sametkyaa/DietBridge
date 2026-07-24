begin;

-- Fail-closed prerequisite check against the real production schema.
-- Only structures that actually exist in production are verified.
do $$
begin
  if to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.recipes') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is null then
    raise exception 'Recipe meal snapshot prerequisites are missing.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- public.meals.description: nullable snapshot text, max 2000 characters.
-- ---------------------------------------------------------------------------
alter table public.meals
  add column if not exists description text;

alter table public.meals
  drop constraint if exists meals_description_length_check;
alter table public.meals
  add constraint meals_description_length_check
  check (description is null or char_length(description) <= 2000);

-- ---------------------------------------------------------------------------
-- Weekly-plan uniqueness: ON CONFLICT below requires a non-deferrable,
-- non-partial unique arbiter for (client_id, dietitian_id, plan_date).
-- Existing duplicate rows are never repaired implicitly.
-- ---------------------------------------------------------------------------
do $$
declare
  v_has_compatible_unique boolean;
  v_named_constraint_is_compatible boolean;
begin
  if exists (
    select 1
    from public.meal_plans
    group by client_id, dietitian_id, plan_date
    having count(*) > 1
  ) then
    raise exception 'Duplicate daily meal plans prevent creation of the weekly-plan uniqueness contract.';
  end if;

  select exists (
    select 1
    from pg_index as i
    where i.indrelid = 'public.meal_plans'::regclass
      and i.indisunique
      and i.indimmediate
      and i.indpred is null
      and i.indnkeyatts = 3
      and (
        select array_agg(a.attname order by key_columns.ordinality)
        from unnest(i.indkey) with ordinality as key_columns(attnum, ordinality)
        join pg_attribute as a
          on a.attrelid = i.indrelid
         and a.attnum = key_columns.attnum
        where key_columns.ordinality <= i.indnkeyatts
      ) = array['client_id', 'dietitian_id', 'plan_date']::text[]
  ) into v_has_compatible_unique;

  if exists (
    select 1
    from pg_constraint as c
    where c.conrelid = 'public.meal_plans'::regclass
      and c.conname = 'meal_plans_client_dietitian_plan_date_key'
  ) then
    select exists (
      select 1
      from pg_constraint as c
      where c.conrelid = 'public.meal_plans'::regclass
        and c.conname = 'meal_plans_client_dietitian_plan_date_key'
        and c.contype = 'u'
        and not c.condeferrable
        and c.conkey = array[
          (select a.attnum from pg_attribute as a where a.attrelid = 'public.meal_plans'::regclass and a.attname = 'client_id' and not a.attisdropped),
          (select a.attnum from pg_attribute as a where a.attrelid = 'public.meal_plans'::regclass and a.attname = 'dietitian_id' and not a.attisdropped),
          (select a.attnum from pg_attribute as a where a.attrelid = 'public.meal_plans'::regclass and a.attname = 'plan_date' and not a.attisdropped)
        ]::smallint[]
    ) into v_named_constraint_is_compatible;

    if not v_named_constraint_is_compatible then
      raise exception 'Existing meal_plans_client_dietitian_plan_date_key has an incompatible weekly-plan uniqueness contract.';
    end if;
  end if;

  if not v_has_compatible_unique then
    alter table public.meal_plans
      add constraint meal_plans_client_dietitian_plan_date_key
      unique (client_id, dietitian_id, plan_date);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Source contract: manual requires recipe_id=null; recipe allows null FK
-- (after ON DELETE SET NULL).  New recipe_id=null meals are blocked in RPC.
-- ---------------------------------------------------------------------------
alter table public.meals
  drop constraint if exists meals_source_contract_check;
alter table public.meals
  add constraint meals_source_contract_check
  check (
    (source = 'manual' and recipe_id is null)
    or source = 'recipe'
  );

-- ---------------------------------------------------------------------------
-- recipe_id foreign key: ON DELETE SET NULL preserves snapshot data.
-- Idempotent: drops and recreates only if the delete action is wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint_name text;
  v_delete_action "char";
begin
  select c.conname, c.confdeltype
  into v_constraint_name, v_delete_action
  from pg_constraint as c
  where c.conrelid = 'public.meals'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.recipes'::regclass
    and exists (
      select 1 from unnest(c.conkey) as key(attnum)
      join pg_attribute as a on a.attrelid = c.conrelid and a.attnum = key.attnum
      where a.attname = 'recipe_id'
    );

  if v_constraint_name is not null and v_delete_action <> 'n' then
    execute format('alter table public.meals drop constraint %I', v_constraint_name);
    v_constraint_name := null;
  end if;

  if v_constraint_name is null then
    alter table public.meals
      add constraint meals_recipe_id_fkey
      foreign key (recipe_id) references public.recipes(id) on delete set null;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Photo path constraint: canonical meal-plans/... or recipes/... paths only.
-- Signed URLs, blob URLs and temporary URLs are rejected.
-- ---------------------------------------------------------------------------
alter table public.meals
  drop constraint if exists meals_photo_url_canonical_path_check;
alter table public.meals
  add constraint meals_photo_url_canonical_path_check
  check (
    photo_url is null
    or photo_url ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
    or photo_url ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  );

-- Partial index for photo_url lookups; recipe image paths may repeat across meals.
drop index if exists public.meals_photo_url_one_reference;
create index if not exists meals_photo_url_reference_idx
  on public.meals (photo_url) where photo_url is not null;

-- ---------------------------------------------------------------------------
-- Independent save_weekly_meal_plan RPC.
--
-- This function is fully self-contained: it does not delegate to any private
-- implementation.  All authorization, relationship validation, week locking,
-- atomic persistence, meal CRUD, recipe snapshot derivation, and response
-- building happen within this single function body.
-- ---------------------------------------------------------------------------
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
  v_meal_id uuid;
  v_existing_plan_id uuid;
  v_saved_meal_ids uuid[];
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
  -- -----------------------------------------------------------------
  -- Authorization
  -- -----------------------------------------------------------------
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

  -- -----------------------------------------------------------------
  -- Week validation
  -- -----------------------------------------------------------------
  if extract(isodow from p_week_start) <> 1 then
    raise exception 'p_week_start must be a Monday.' using errcode = '22023';
  end if;

  if p_days is null
     or jsonb_typeof(p_days) <> 'array'
     or jsonb_array_length(p_days) <> 7 then
    raise exception 'p_days must contain exactly seven days.' using errcode = '22023';
  end if;

  -- Serialize the same actor/client/week.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_actor_id::text || ':' || p_client_id::text || ':' || p_week_start::text,
      0
    )
  );

  -- -----------------------------------------------------------------
  -- Day loop
  -- -----------------------------------------------------------------
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

    -- ---------------------------------------------------------------
    -- Meal loop
    -- ---------------------------------------------------------------
    for v_meal in
      select meal.value
      from pg_catalog.jsonb_array_elements(v_day -> 'meals') as meal(value)
    loop
      if jsonb_typeof(v_meal) is distinct from 'object' then
        raise exception 'Each meal must be an object.' using errcode = '22023';
      end if;

      -- Meal id validation
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

      -- sort_order validation
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

      -- type validation
      if jsonb_typeof(v_meal -> 'type') is distinct from 'string' then
        raise exception 'Meal type is required.' using errcode = '22023';
      end if;
      begin
        v_meal_type := (v_meal ->> 'type')::public.meal_type;
      exception when others then
        raise exception 'Meal type is unsupported.' using errcode = '22023';
      end;

      -- time validation
      if jsonb_typeof(v_meal -> 'time') is distinct from 'string'
         or (v_meal ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Meal time must use HH:MM.' using errcode = '22023';
      end if;
      v_time := (v_meal ->> 'time')::time without time zone;

      -- source validation
      v_source := v_meal ->> 'source';
      if jsonb_typeof(v_meal -> 'source') is distinct from 'string'
         or v_source not in ('manual', 'recipe') then
        raise exception 'Meal source is unsupported.' using errcode = '22023';
      end if;

      -- -------------------------------------------------------------
      -- Recipe meal: derive snapshot from public.recipes or preserve
      -- deleted-recipe snapshot from existing meal row.
      -- -------------------------------------------------------------
      if v_source = 'recipe' then
        if jsonb_typeof(v_meal -> 'recipe_id') = 'null' or not (v_meal ? 'recipe_id') then
          -- Deleted-recipe snapshot: must be an existing meal owned by this
          -- client/dietitian with source='recipe' and recipe_id=null.
          if v_meal_id is null then
            raise exception 'Deleted recipe snapshots require an existing meal id.' using errcode = '22023';
          end if;

          select meal.title, meal.description, meal.calories, meal.macros, meal.photo_url
          into v_snapshot
          from public.meals as meal
          where meal.id = v_meal_id
            and meal.source = 'recipe'
            and meal.recipe_id is null
            and meal.plan_id = v_plan_id;

          if not found then
            raise exception 'Deleted recipe snapshot is unavailable or does not belong to this plan.' using errcode = '42501';
          end if;

          v_title := v_snapshot.title;
          v_description := v_snapshot.description;
          v_calories := v_snapshot.calories;
          v_macros := v_snapshot.macros;
          v_photo_url := v_snapshot.photo_url;
          v_recipe_id := null;
        else
          -- Active recipe: derive all snapshot fields from public.recipes.
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

      -- -------------------------------------------------------------
      -- Manual meal: validate all fields from payload.
      -- -------------------------------------------------------------
      else
        if v_meal ? 'recipe_id' and jsonb_typeof(v_meal -> 'recipe_id') <> 'null' then
          raise exception 'Manual meals cannot include recipe_id.' using errcode = '22023';
        end if;
        v_recipe_id := null;

        v_title := pg_catalog.btrim(v_meal ->> 'title');
        if jsonb_typeof(v_meal -> 'title') is distinct from 'string' or v_title = '' then
          raise exception 'Meal title is required.' using errcode = '22023';
        end if;

        -- description
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

        -- calories
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

        -- macros: independent validation (no is_canonical_meal_macros dependency)
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

        -- Reject extra macro keys
        if (select count(*) from jsonb_object_keys(v_macros)) <> 3 then
          raise exception 'Meal macros must contain exactly protein, carbs and fat.' using errcode = '22023';
        end if;

        v_macros := jsonb_build_object('protein', v_protein, 'carbs', v_carbs, 'fat', v_fat);

        -- photo_url: only canonical meal-plans/... paths for manual meals
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

      -- -------------------------------------------------------------
      -- Persist meal row
      -- -------------------------------------------------------------
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
            description = nullif(pg_catalog.btrim(v_description), ''),
            calories = v_calories,
            macros = v_macros,
            photo_url = v_photo_url,
            sort_order = v_sort_order,
            time = v_time,
            source = v_source,
            recipe_id = v_recipe_id
        where id = v_meal_id;
        -- is_eaten is intentionally never overwritten.
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
        -- New rows use the database is_eaten=false default.
      end if;

      v_seen_meal_ids := pg_catalog.array_append(v_seen_meal_ids, v_meal_id);
      v_saved_meal_ids := pg_catalog.array_append(v_saved_meal_ids, v_meal_id);
    end loop;

    -- Delete meals removed from the payload.
    delete from public.meals as m
    where m.plan_id = v_plan_id
      and not (m.id = any(v_saved_meal_ids));
  end loop;

  -- -----------------------------------------------------------------
  -- Response
  -- -----------------------------------------------------------------
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
