-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: Denetimde doğrulanan function signature'larında function gövdesini
-- yeniden yazmadan search_path ve execute yüzeyini daraltmak.
--
-- Ön koşullar:
-- 1. Bu dosya staging'de trigger regression testiyle denenmelidir.
-- 2. Trigger function revoke adımları client güncelleme akışını bozmadığını
--    göstermelidir.
-- 3. handle_new_user ve diğer kapsam dışı function'lar bu taslakta
--    değiştirilmez.

do $$
begin
  if to_regprocedure('public.current_user_role()') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null
     or to_regprocedure('public.save_my_current_weight(numeric)') is null
     or to_regprocedure('public.sync_client_weight_to_measurements()') is null
     or to_regprocedure('public.set_updated_at()') is null then
    raise exception 'Beklenen function signature bulunamadı; güncel metadata ile taslak yeniden incelenmelidir.';
  end if;
end
$$;

-- Doğrulanmış SECURITY DEFINER function'larda güvenli ve sabit search_path.
-- Function body'leri değiştirilmez.
alter function public.current_user_role()
  set search_path = pg_catalog, public;
alter function public.is_current_user_dietitian()
  set search_path = pg_catalog, public;
alter function public.save_my_current_weight(numeric)
  set search_path = pg_catalog, public;
alter function public.sync_client_weight_to_measurements()
  set search_path = pg_catalog, public;

-- set_updated_at SECURITY DEFINER değildir; yine de advisor bulgusundaki
-- mutable search_path sorunu doğrulanan signature üzerinde giderilir.
alter function public.set_updated_at()
  set search_path = pg_catalog, public;

-- Role lookup helper'ları anon tarafından çağrılmamalıdır. Authenticated
-- execute, RLS policy değerlendirmesi ve oturumlu istemci ihtiyacı için
-- korunur.
revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

revoke execute on function public.is_current_user_dietitian() from public, anon;
grant execute on function public.is_current_user_dietitian() to authenticated;

-- Aşağıdaki iki function trigger yolunda kullanılır. Web/mobile source içinde
-- doğrudan RPC çağrısı bulunmadı. PUBLIC/anon/authenticated direct execute
-- kaldırılmadan önce staging'de client_profiles, measurements ve
-- meal_change_requests update trigger regression testi zorunludur.
revoke execute on function public.sync_client_weight_to_measurements()
  from public, anon, authenticated;
revoke execute on function public.set_updated_at()
  from public, anon, authenticated;

-- save_my_current_weight(numeric) authenticated execute ile auth.uid() ve
-- değer aralığı kontrolü içerir. Mevcut mobil çağrı sözleşmesi doğrulanmadan
-- grant'i bu taslakta kaldırılmaz.

-- Uygulama sonrası metadata kontrolü:
-- select p.proname, pg_get_function_identity_arguments(p.oid), p.proconfig
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and p.proname in ('current_user_role', 'is_current_user_dietitian',
--                     'save_my_current_weight',
--                     'sync_client_weight_to_measurements', 'set_updated_at');

-- Rollback: Uygulama öncesi saklanan function configuration ve execute grant
-- envanterini hedefli geri yükleyin. Function body değiştirilmediği için
-- rollback yalnızca configuration/grant kapsamındadır.
