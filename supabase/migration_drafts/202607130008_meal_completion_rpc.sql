-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: Client'ın yalnız kendi planındaki bir öğünün is_eaten alanını dar RPC
-- üzerinden değiştirmesi. Mevcut geniş UPDATE policy bu dosyada kaldırılmaz.

do $$
begin
  if to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null then
    raise exception 'Meal completion için beklenen tablolar bulunamadı.';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.meals'::regclass
      and conname = 'meals_plan_id_fkey'
  ) then
    raise exception 'meals.plan_id foreign key bulunamadı; sahiplik doğrulaması uygulanamaz.';
  end if;

  if to_regprocedure('public.set_my_meal_completion(uuid,boolean)') is not null then
    raise exception 'set_my_meal_completion(uuid,boolean) zaten var; mevcut tanım incelenmeden üzerine yazılmamalıdır.';
  end if;
end
$$;

create function public.set_my_meal_completion(
  p_meal_id uuid,
  p_is_eaten boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_updated_count integer;
begin
  if v_user_id is null then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;

  if p_is_eaten is null then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '22023';
  end if;

  update public.meals as m
  set is_eaten = p_is_eaten
  where m.id = p_meal_id
    and exists (
      select 1
      from public.meal_plans mp
      where mp.id = m.plan_id
        and mp.client_id = v_user_id
    );

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    -- Not-found ve unauthorized aynı hata ile döner; kaynak varlığı sızmaz.
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;

  return true;
end;
$function$;

revoke execute on function public.set_my_meal_completion(uuid, boolean)
  from public, anon;
grant execute on function public.set_my_meal_completion(uuid, boolean)
  to authenticated;

-- GEÇİŞ KAPISI: "Clients can update own meal completion" policy'si ancak web/
-- mobil istemciler bu RPC'ye geçtikten ve staging negatif testleri başarılı
-- olduktan sonra ayrı, açık onaylı contract migration'ında kaldırılabilir.
-- Bu taslak eski geniş UPDATE policy'sini kaldırmaz.

-- Uygulama sonrası metadata doğrulaması:
-- select p.oid::regprocedure::text, p.prosecdef, p.proconfig
-- from pg_proc p where p.oid = 'public.set_my_meal_completion(uuid,boolean)'::regprocedure;
-- select grantee, privilege_type from information_schema.routine_privileges
-- where specific_schema = 'public' and routine_name = 'set_my_meal_completion';

-- Rollback: Function/grant yalnız ayrı açık onayla hedefli kaldırılır veya
-- önceki tanıma döndürülür. Eski geniş policy otomatik olarak geri eklenmez.
