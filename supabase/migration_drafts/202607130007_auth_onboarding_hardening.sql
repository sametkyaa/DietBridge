-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: auth.users INSERT tetikleyicisiyle güvenli client/dietitian onboarding.
-- Mevcut on_auth_user_created trigger'ı public.handle_new_user() çağırır.
-- Bu dosya ikinci trigger oluşturmaz; staging'de gerçek tanım yeniden doğrulanır.

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.client_profiles') is null
     or to_regclass('public.dietitian_profiles') is null then
    raise exception 'Onboarding için beklenen public profil tabloları bulunamadı.';
  end if;

  if to_regprocedure('public.handle_new_user()') is null then
    raise exception 'public.handle_new_user() bulunamadı; mevcut auth trigger incelenmelidir.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and t.tgname = 'on_auth_user_created'
      and t.tgfoid = 'public.handle_new_user()'::regprocedure
  ) then
    raise exception 'Beklenen on_auth_user_created -> handle_new_user() tetikleyicisi bulunamadı.';
  end if;
end
$$;

-- raw_user_meta_data kullanıcı kontrollüdür. Buradaki değer yalnız başvuru
-- türüdür; dashboard veya yönetim yetkisi vermez. Dietitian her zaman pending
-- başlar ve Aşama 2 resolver'ı approved durumunu ayrıca zorunlu tutar.
-- Function auth.users INSERT transaction'ının içinde çalışır; hata verirse
-- auth kullanıcısı ve bağlı profil adımları birlikte geri alınır.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_requested_account_type text;
  v_profile_role public.user_role;
  v_full_name text;
  v_phone text;
  v_existing_role public.user_role;
begin
  v_requested_account_type := lower(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'account_type', ''),
      nullif(new.raw_user_meta_data ->> 'role', ''),
      ''
    )
  );

  if v_requested_account_type = 'client' then
    v_profile_role := 'client'::public.user_role;
  elsif v_requested_account_type = 'dietitian' then
    v_profile_role := 'dietitian'::public.user_role;
  else
    raise exception 'Geçersiz hesap türü; yalnız client veya dietitian kabul edilir.'
      using errcode = '22023';
  end if;

  v_full_name := nullif(
    btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')),
    ''
  );
  v_phone := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

  select role into v_existing_role
  from public.profiles
  where id = new.id;

  if found then
    -- Yeni auth kullanıcısı için mevcut farklı rol olağan dışıdır. Özellikle
    -- client -> dietitian yükseltmesini sessizce yapmayın.
    if v_existing_role is distinct from v_profile_role then
      raise exception 'Mevcut profil rolü onboarding talebiyle uyuşmuyor.'
        using errcode = '42501';
    end if;
  else
    insert into public.profiles (id, email, full_name, phone, role)
    values (new.id, new.email, v_full_name, v_phone, v_profile_role);
  end if;

  if v_profile_role = 'client'::public.user_role then
    insert into public.client_profiles (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  else
    insert into public.dietitian_profiles (
      user_id,
      is_verified,
      verification_status,
      verified_at,
      rejection_reason
    )
    values (new.id, false, 'pending', null, null)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$function$;

-- Trigger doğrudan çağrı yüzeyi değildir. Trigger çalışması owner yetkisiyle
-- sürer; browser/anon direct execute izni verilmez.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Uygulama sonrası metadata doğrulaması:
-- select t.tgname, pg_get_triggerdef(t.oid, true)
-- from pg_trigger t
-- where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
-- select p.oid::regprocedure::text, p.proconfig, p.prosecdef
-- from pg_proc p where p.oid = 'public.handle_new_user()'::regprocedure;

-- Rollback: Uygulama öncesinde saklanan exact function body, search_path ve
-- grant envanteri ayrı açık onayla hedefli geri yüklenir. Kullanıcı rolleri,
-- auth kullanıcıları veya başvuru kayıtları otomatik değiştirilmez.
