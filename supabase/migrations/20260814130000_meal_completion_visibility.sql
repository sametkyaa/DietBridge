-- Meal completion visibility closure.
-- The canonical completion state remains meals.is_eaten. completed_at is only
-- stable event metadata for projections; it is not a second completion state.

begin;

do $preflight$
begin
  if to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regprocedure('public.set_my_meal_completion(uuid,boolean)') is null then
    raise exception 'Meal completion visibility prerequisites are missing.';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'meals'
       and column_name = 'completed_at'
  ) then
    raise exception 'meals.completed_at already exists; reconcile migration history explicitly.';
  end if;
end
$preflight$;

alter table public.meals
  add column completed_at timestamptz;

-- Existing true rows have no historical completion instant and remain NULL so
-- the chat projection never invents a past completion event. Meal Tracking
-- still exposes their canonical is_eaten state; future transitions receive an
-- exact timestamp from set_my_meal_completion.

create index meals_completed_activity_idx
  on public.meals (plan_id, completed_at, id)
 where is_eaten is true;

create or replace function public.set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_updated_count integer;
begin
  if v_user_id is null or p_is_eaten is null then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;

  update public.meals as m
     set is_eaten = p_is_eaten,
         completed_at = case
           when p_is_eaten then coalesce(m.completed_at, now())
           else null
         end
   where m.id = p_meal_id
     and exists (
       select 1
         from public.meal_plans as mp
        where mp.id = m.plan_id
          and mp.client_id = v_user_id
     );

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;
  return true;
end;
$function$;

alter function public.set_my_meal_completion(uuid, boolean) owner to postgres;
revoke all on function public.set_my_meal_completion(uuid, boolean) from public, anon, service_role;
grant execute on function public.set_my_meal_completion(uuid, boolean) to authenticated;

do $postflight$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'meals'
       and column_name = 'completed_at'
  )
  or to_regprocedure('public.set_my_meal_completion(uuid,boolean)') is null
  or has_function_privilege('anon', 'public.set_my_meal_completion(uuid,boolean)', 'EXECUTE') then
    raise exception 'Meal completion visibility postcondition failed.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
commit;
