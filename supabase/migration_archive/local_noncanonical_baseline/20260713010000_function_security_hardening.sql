-- Public function'larda sabit search_path ve en dar doğrudan execute yüzeyi.
-- Signature'lar korunur; yalnız mevcut nesneler hedeflenir.

do $$
begin
  if to_regprocedure('public.current_user_role()') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null
     or to_regprocedure('public.save_my_current_weight(numeric)') is null
     or to_regprocedure('public.sync_client_weight_to_measurements()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Beklenen function signature bulunamadı; migration durduruldu.';
  end if;
end
$$;

-- Onaylı diyetisyen kontrolü, RLS policy'lerinde tekrar eden ilişkiyi güvenli
-- SECURITY DEFINER helper ile merkezi tutar. Metadata yerine tabloları kullanır.
create or replace function public.is_current_user_dietitian()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.profiles as p
    join public.dietitian_profiles as dp on dp.user_id = p.id
    where p.id = auth.uid()
      and p.role = 'dietitian'::public.user_role
      and dp.verification_status = 'approved'
      and dp.is_verified is true
  );
$function$;

alter function public.current_user_role() set search_path = pg_catalog, public;
alter function public.save_my_current_weight(numeric) set search_path = pg_catalog, public;
alter function public.sync_client_weight_to_measurements() set search_path = pg_catalog, public;
alter function public.set_updated_at() set search_path = pg_catalog, public;
alter function public.set_client_profiles_updated_at() set search_path = pg_catalog, public;
alter function public.set_profiles_updated_at() set search_path = pg_catalog, public;
alter function public.protect_client_profile_system_fields() set search_path = pg_catalog, public;
alter function public.protect_profile_system_fields() set search_path = pg_catalog, public;

revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;
revoke execute on function public.is_current_user_dietitian() from public, anon;
grant execute on function public.is_current_user_dietitian() to authenticated;
revoke execute on function public.save_my_current_weight(numeric) from public, anon;
grant execute on function public.save_my_current_weight(numeric) to authenticated;

revoke execute on function public.sync_client_weight_to_measurements() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_client_profiles_updated_at() from public, anon, authenticated;
revoke execute on function public.set_profiles_updated_at() from public, anon, authenticated;
revoke execute on function public.protect_client_profile_system_fields() from public, anon, authenticated;
revoke execute on function public.protect_profile_system_fields() from public, anon, authenticated;
