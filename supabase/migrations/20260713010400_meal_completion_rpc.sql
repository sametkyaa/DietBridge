-- Client yalnız kendi planındaki meal için yalnız is_eaten alanını değiştirebilir.
-- Legacy meals UPDATE policy bu migration'da korunur.

do $$
begin
  if to_regclass('public.meals') is null or to_regclass('public.meal_plans') is null
     or not exists (select 1 from pg_constraint where conrelid = 'public.meals'::regclass and conname = 'meals_plan_id_fkey')
     or to_regprocedure('public.set_my_meal_completion(uuid,boolean)') is not null then
    raise exception 'Meal completion RPC ön koşulu sağlanmadı; migration durduruldu.';
  end if;
end
$$
create function public.set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)
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
  set is_eaten = p_is_eaten
  where m.id = p_meal_id
    and exists (select 1 from public.meal_plans as mp where mp.id = m.plan_id and mp.client_id = v_user_id);
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;
  return true;
end;
$function$
revoke execute on function public.set_my_meal_completion(uuid, boolean) from public, anon
grant execute on function public.set_my_meal_completion(uuid, boolean) to authenticated
