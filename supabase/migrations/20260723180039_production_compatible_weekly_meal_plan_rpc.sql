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
  v_meal_type public.meal_type;
  v_title text;
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

  if not exists (
    select 1
    from public.profiles as p
    join public.dietitian_profiles as dp on dp.user_id = p.id
    where p.id = v_actor_id
      and p.role = 'dietitian'::public.user_role
      and dp.verification_status = 'approved'
      and dp.is_verified is true
  ) then
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

  if not exists (
    select 1
    from public.dietitian_clients as dc
    where dc.dietitian_id = v_actor_id
      and dc.client_id = p_client_id
      and dc.status = 'active'::public.client_status
  ) then
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

  for v_day, v_day_index in
    select item.value, item.ordinality::integer
    from pg_catalog.jsonb_array_elements(p_days) with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(v_day) is distinct from 'object'
       or jsonb_typeof(v_day -> 'plan_date') is distinct from 'string'
       or jsonb_typeof(v_day -> 'meals') is distinct from 'array' then
      raise exception 'Each day must contain plan_date and a meals array.' using errcode = '22023';
    end if;

    if jsonb_array_length(v_day -> 'meals') > 50 then
      raise exception 'A daily plan cannot contain more than 50 meals.' using errcode = '22023';
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
      else nullif(pg_catalog.btrim(v_day ->> 'notes'), '')
    end;

    if v_notes is not null and length(v_notes) > 5000 then
      raise exception 'Plan notes are too long.' using errcode = '22023';
    end if;

    begin
      select mp.id
      into strict v_plan_id
      from public.meal_plans as mp
      where mp.client_id = p_client_id
        and mp.dietitian_id = v_actor_id
        and mp.plan_date = v_plan_date
      for update;
    exception
      when no_data_found then
        insert into public.meal_plans (client_id, dietitian_id, plan_date, notes)
        values (p_client_id, v_actor_id, v_plan_date, v_notes)
        returning id into v_plan_id;
      when too_many_rows then
        raise exception 'Duplicate daily plans prevent a safe weekly save.' using errcode = '23505';
    end;

    update public.meal_plans
    set notes = v_notes
    where id = v_plan_id;

    v_saved_meal_ids := array[]::uuid[];
    v_seen_sort_orders := array[]::integer[];

    for v_meal in
      select meal.value
      from pg_catalog.jsonb_array_elements(v_day -> 'meals') as meal(value)
    loop
      v_meal_id := null;
      v_existing_plan_id := null;

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
        raise exception 'sort_order must be unique within a daily plan.' using errcode = '22023';
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

      if jsonb_typeof(v_meal -> 'title') is distinct from 'string' then
        raise exception 'Meal title is required.' using errcode = '22023';
      end if;
      v_title := pg_catalog.btrim(v_meal ->> 'title');
      if v_title = '' or length(v_title) > 300 then
        raise exception 'Meal title is invalid.' using errcode = '22023';
      end if;

      if jsonb_typeof(v_meal -> 'time') is distinct from 'string'
         or (v_meal ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        raise exception 'Meal time must use HH:MM.' using errcode = '22023';
      end if;
      v_time := (v_meal ->> 'time')::time without time zone;

      if (v_meal ->> 'source') is distinct from 'manual'
         or (v_meal ? 'recipe_id' and jsonb_typeof(v_meal -> 'recipe_id') <> 'null') then
        raise exception 'Weekly plans accept canonical manual snapshots only.' using errcode = '22023';
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
          raise exception 'Meal calories are outside the supported range.' using errcode = '22023';
        end if;
      else
        raise exception 'Meal calories must be a non-negative integer or null.' using errcode = '22023';
      end if;

      if jsonb_typeof(v_meal -> 'macros') is distinct from 'object'
         or not ((v_meal -> 'macros') ?& array['protein', 'carbs', 'fat']::text[])
         or (select count(*) from pg_catalog.jsonb_object_keys(v_meal -> 'macros')) <> 3
         or jsonb_typeof(v_meal -> 'macros' -> 'protein') <> 'number'
         or jsonb_typeof(v_meal -> 'macros' -> 'carbs') <> 'number'
         or jsonb_typeof(v_meal -> 'macros' -> 'fat') <> 'number' then
        raise exception 'Meal macros must be exactly protein, carbs and fat numbers.' using errcode = '22023';
      end if;

      begin
        v_protein := (v_meal -> 'macros' ->> 'protein')::numeric;
        v_carbs := (v_meal -> 'macros' ->> 'carbs')::numeric;
        v_fat := (v_meal -> 'macros' ->> 'fat')::numeric;
      exception when others then
        raise exception 'Meal macros contain invalid numeric values.' using errcode = '22023';
      end;

      if v_protein < 0 or v_carbs < 0 or v_fat < 0
         or v_protein > 10000 or v_carbs > 10000 or v_fat > 10000 then
        raise exception 'Meal macros are outside the supported range.' using errcode = '22023';
      end if;

      v_macros := pg_catalog.jsonb_build_object(
        'protein', v_protein,
        'carbs', v_carbs,
        'fat', v_fat
      );

      if not (v_meal ? 'photo_url') or jsonb_typeof(v_meal -> 'photo_url') = 'null' then
        v_photo_url := null;
      elsif jsonb_typeof(v_meal -> 'photo_url') = 'string' then
        v_photo_url := nullif(pg_catalog.btrim(v_meal ->> 'photo_url'), '');
        if v_photo_url is not null and length(v_photo_url) > 2048 then
          raise exception 'Meal photo_url is too long.' using errcode = '22023';
        end if;
      else
        raise exception 'Meal photo_url must be text or null.' using errcode = '22023';
      end if;

      if v_meal_id is not null then
        select m.plan_id
        into v_existing_plan_id
        from public.meals as m
        where m.id = v_meal_id
        for update;

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
            source = 'manual',
            recipe_id = null
        where id = v_meal_id;
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
          'manual',
          null
        )
        returning id into v_meal_id;
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

revoke all on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb)
to authenticated;

comment on function public.save_weekly_meal_plan(uuid, date, jsonb) is
  'Production compatibility RPC for atomic seven-day manual-snapshot meal plan persistence without bulk legacy data rewrites.';

notify pgrst, 'reload schema';
