begin;

do $$
begin
  if to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.recipes') is null
     or to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is null
     or to_regprocedure('private.save_weekly_meal_plan_impl(uuid,date,jsonb)') is null
     or to_regprocedure('public.is_canonical_meal_macros(jsonb)') is null then
    raise exception 'Recipe meal snapshot prerequisites are missing.';
  end if;
end
$$;

alter table public.meals
  add column if not exists description text;

alter table public.meals
  drop constraint if exists meals_description_length_check;
alter table public.meals
  add constraint meals_description_length_check
  check (description is null or char_length(description) <= 2000);

alter table public.meals
  drop constraint if exists meals_source_contract_check;
alter table public.meals
  add constraint meals_source_contract_check
  check (
    (source = 'manual' and recipe_id is null)
    or source = 'recipe'
  );

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

alter table public.meals
  drop constraint if exists meals_photo_url_canonical_path_check;
alter table public.meals
  add constraint meals_photo_url_canonical_path_check
  check (
    photo_url is null
    or photo_url ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
    or photo_url ~ '^recipes/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  );

drop index if exists public.meals_photo_url_one_reference;
create index if not exists meals_photo_url_reference_idx
  on public.meals (photo_url) where photo_url is not null;

create or replace function private.queue_replaced_meal_photo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_path text;
begin
  if tg_op = 'DELETE' then
    v_path := old.photo_url;
  elsif old.photo_url is distinct from new.photo_url then
    v_path := old.photo_url;
  else
    return new;
  end if;

  -- Recipe snapshots live in another bucket and are never meal-photo cleanup candidates.
  if v_path is null or v_path !~ '^meal-plans/' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform private.enqueue_meal_photo_cleanup(
    v_path,
    split_part(v_path, '/', 2)::uuid,
    split_part(v_path, '/', 3)::uuid
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

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
  v_days jsonb := p_days;
  v_impl_days jsonb := p_days;
  v_day_index integer;
  v_meal_index integer;
  v_meal jsonb;
  v_impl_meal jsonb;
  v_source text;
  v_recipe_id uuid;
  v_recipe record;
  v_snapshot record;
  v_photo_path text;
  v_result jsonb;
begin
  if v_actor_id is null then
    raise exception 'Weekly meal plan authorization failed.' using errcode = '42501';
  end if;

  -- The private implementation retains the authorization, relationship, week,
  -- lock, atomicity, ordering and is_eaten contracts. This wrapper validates
  -- image ownership and replaces recipe-controlled snapshot fields first.
  if v_days is null or jsonb_typeof(v_days) <> 'array' then
    raise exception 'p_days must be a JSON array.' using errcode = '22023';
  end if;

  for v_day_index in 0 .. jsonb_array_length(v_days) - 1 loop
    if jsonb_typeof(v_days -> v_day_index -> 'meals') is distinct from 'array' then
      raise exception 'Each day must contain a meals array.' using errcode = '22023';
    end if;
    for v_meal_index in 0 .. jsonb_array_length(v_days -> v_day_index -> 'meals') - 1 loop
      v_meal := v_days -> v_day_index -> 'meals' -> v_meal_index;
      if jsonb_typeof(v_meal) is distinct from 'object'
         or jsonb_typeof(v_meal -> 'source') is distinct from 'string' then
        raise exception 'Meal source is required.' using errcode = '22023';
      end if;
      v_source := v_meal ->> 'source';

      if v_source = 'recipe' then
        if jsonb_typeof(v_meal -> 'recipe_id') = 'null' then
          begin
            select meal.title, meal.description, meal.calories, meal.macros, meal.photo_url
            into v_snapshot
            from public.meals as meal
            join public.meal_plans as plan on plan.id = meal.plan_id
            where meal.id = (v_meal ->> 'id')::uuid
              and meal.source = 'recipe'
              and meal.recipe_id is null
              and plan.client_id = p_client_id
              and plan.dietitian_id = v_actor_id;
          exception when others then
            raise exception 'Deleted recipe snapshots require an existing meal id.' using errcode = '22023';
          end;
          if not found then
            raise exception 'Deleted recipe snapshot is unavailable.' using errcode = '42501';
          end if;
          v_meal := v_meal || jsonb_build_object(
            'source', 'recipe', 'recipe_id', null,
            'title', v_snapshot.title, 'description', v_snapshot.description,
            'calories', v_snapshot.calories, 'macros', v_snapshot.macros,
            'photo_url', v_snapshot.photo_url
          );
        else
          if jsonb_typeof(v_meal -> 'recipe_id') is distinct from 'string' then
            raise exception 'Recipe meals require a valid recipe_id.' using errcode = '22023';
          end if;
          begin
            v_recipe_id := (v_meal ->> 'recipe_id')::uuid;
          exception when others then
            raise exception 'Recipe meals require a valid recipe_id.' using errcode = '22023';
          end;

          select id, name, description, calories, protein, carbs, fat, image_path
          into v_recipe
          from public.recipes
          where id = v_recipe_id and dietitian_id = v_actor_id;
          if not found then
            raise exception 'Recipe is unavailable or does not belong to the current dietitian.' using errcode = '42501';
          end if;

          v_meal := v_meal
            || jsonb_build_object(
              'source', 'recipe',
              'recipe_id', v_recipe.id,
              'title', v_recipe.name,
              'description', v_recipe.description,
              'calories', v_recipe.calories,
              'macros', jsonb_build_object('protein', v_recipe.protein, 'carbs', v_recipe.carbs, 'fat', v_recipe.fat),
              'photo_url', v_recipe.image_path
            );
        end if;
      elsif v_source = 'manual' then
        if v_meal ? 'recipe_id' and jsonb_typeof(v_meal -> 'recipe_id') <> 'null' then
          raise exception 'Manual meals cannot include recipe_id.' using errcode = '22023';
        end if;
        if v_meal ? 'description' and jsonb_typeof(v_meal -> 'description') not in ('string', 'null') then
          raise exception 'Meal description must be text or null.' using errcode = '22023';
        end if;
        if jsonb_typeof(v_meal -> 'description') = 'string' and char_length(v_meal ->> 'description') > 2000 then
          raise exception 'Meal description exceeds the supported length.' using errcode = '22023';
        end if;
        if not coalesce(public.is_canonical_meal_macros(v_meal -> 'macros'), false) then
          raise exception 'Meal macros must be canonical.' using errcode = '22023';
        end if;
        if jsonb_typeof(v_meal -> 'photo_url') = 'string' then
          v_photo_path := v_meal ->> 'photo_url';
          if v_photo_path !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
             or split_part(v_photo_path, '/', 2) <> p_client_id::text
             or split_part(v_photo_path, '/', 3) <> v_actor_id::text
             or not exists (select 1 from storage.objects where bucket_id = 'meal-photos' and name = v_photo_path) then
            raise exception 'Meal photo_url is not authorized for this client and dietitian.' using errcode = '42501';
          end if;
        elsif v_meal ? 'photo_url' and jsonb_typeof(v_meal -> 'photo_url') <> 'null' then
          raise exception 'Meal photo_url must be a canonical object path or null.' using errcode = '22023';
        end if;
      else
        raise exception 'Meal source is unsupported.' using errcode = '22023';
      end if;

      v_days := jsonb_set(v_days, array[v_day_index::text, 'meals', v_meal_index::text], v_meal, false);
      v_impl_meal := case
        when v_meal ->> 'source' = 'recipe' and jsonb_typeof(v_meal -> 'recipe_id') = 'null'
          then v_meal || jsonb_build_object('source', 'manual', 'recipe_id', null)
        else v_meal
      end;
      v_impl_days := jsonb_set(v_impl_days, array[v_day_index::text, 'meals', v_meal_index::text], v_impl_meal, false);
    end loop;
  end loop;

  v_result := private.save_weekly_meal_plan_impl(p_client_id, p_week_start, v_impl_days);

  update public.meals as meal
  set description = nullif(btrim(payload.meal ->> 'description'), ''),
      source = payload.meal ->> 'source'
  from jsonb_array_elements(v_days) with ordinality as day_payload(day, day_index)
  cross join lateral jsonb_array_elements(day_payload.day -> 'meals') as payload(meal)
  join public.meal_plans as plan
    on plan.client_id = p_client_id
   and plan.dietitian_id = v_actor_id
   and plan.plan_date = (day_payload.day ->> 'plan_date')::date
  where meal.plan_id = plan.id
    and meal.sort_order = (payload.meal ->> 'sort_order')::integer;

  select jsonb_build_object(
    'client_id', p_client_id,
    'dietitian_id', v_actor_id,
    'week_start', p_week_start,
    'week_end', p_week_start + 6,
    'plans', coalesce(jsonb_agg(jsonb_build_object(
      'id', plan.id,
      'plan_date', plan.plan_date,
      'notes', plan.notes,
      'meals', coalesce((select jsonb_agg(jsonb_build_object(
        'id', meal.id, 'plan_id', meal.plan_id, 'type', meal.type,
        'title', meal.title, 'description', meal.description, 'calories', meal.calories,
        'macros', meal.macros, 'photo_url', meal.photo_url, 'is_eaten', meal.is_eaten,
        'sort_order', meal.sort_order, 'time', to_char(meal.time, 'HH24:MI'),
        'source', meal.source, 'recipe_id', meal.recipe_id
      ) order by meal.sort_order, meal.id) from public.meals as meal where meal.plan_id = plan.id), '[]'::jsonb)
    ) order by plan.plan_date), '[]'::jsonb)
  ) into v_result
  from public.meal_plans as plan
  where plan.client_id = p_client_id
    and plan.dietitian_id = v_actor_id
    and plan.plan_date between p_week_start and p_week_start + 6;

  return v_result;
end;
$function$;

revoke all on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb) to authenticated;

commit;
