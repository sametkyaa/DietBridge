-- Auth trigger yalnız allowlist account_type ile client veya pending dietitian oluşturur.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.client_profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regprocedure('public.handle_new_user()') is null then
    raise exception 'Onboarding için beklenen nesne bulunamadı; migration durduruldu.';
  end if;
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_account_type text;
  v_role public.user_role;
  v_full_name text;
  v_phone text;
begin
  v_account_type := lower(coalesce(nullif(new.raw_user_meta_data ->> 'account_type', ''), nullif(new.raw_user_meta_data ->> 'role', ''), ''));
  if v_account_type = 'client' then
    v_role := 'client'::public.user_role;
  elsif v_account_type = 'dietitian' then
    v_role := 'dietitian'::public.user_role;
  else
    raise exception 'Geçersiz hesap türü; yalnız client veya dietitian kabul edilir.' using errcode = '22023';
  end if;
  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  v_phone := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

  insert into public.profiles (id, email, full_name, phone, role)
  values (new.id, new.email, v_full_name, v_phone, v_role)
  on conflict (id) do nothing;

  if v_role = 'client'::public.user_role then
    insert into public.client_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  else
    insert into public.dietitian_profiles (user_id, is_verified, verification_status, verified_at, rejection_reason)
    values (new.id, false, 'pending', null, null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$function$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
