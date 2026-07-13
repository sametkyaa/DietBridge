-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: verification_status alanını kanonik kaynak, is_verified alanını
-- compatibility mirror olarak güvenli biçimde tutmak.
--
-- Bu taslak veri onarımı yapmaz. Tutarsız kayıt varken fail-closed durur.
-- Önce yalnız staging/test ortamında, ayrı onaylı veri kararından sonra deneyin.

do $$
begin
  if to_regclass('public.dietitian_profiles') is null then
    raise exception 'dietitian_profiles bulunamadı; taslak uygulanamaz.';
  end if;

  if exists (
    select 1
    from public.dietitian_profiles
    where verification_status is null
       or verification_status not in ('pending', 'approved', 'rejected')
  ) then
    raise exception 'İzinli olmayan veya boş verification_status bulundu; önce ayrı veri kararı gerekir.';
  end if;

  if exists (
    select 1
    from public.dietitian_profiles
    where is_verified is distinct from (verification_status = 'approved')
  ) then
    raise exception 'Verification mirror tutarsız; bu taslak otomatik veri onarımı yapmaz.';
  end if;

  if to_regprocedure('public.sync_dietitian_verification_fields()') is not null then
    raise exception 'sync_dietitian_verification_fields() zaten var; mevcut tanım incelenmeden üzerine yazılmamalıdır.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.dietitian_profiles'::regclass
      and conname = 'dietitian_profiles_verification_consistency_check'
  ) then
    raise exception 'Verification consistency constraint zaten var; mevcut tanım incelenmelidir.';
  end if;
end
$$;

-- MANUEL ONAY GEREKTİRİR — veri onarımı bu dosyada çalıştırılmaz.
-- Ayrı, review edilmiş ve yalnız staging/test için onaylanmış bir migration’da
-- aşağıdaki mantık kullanılabilir; hiçbir gerçek kullanıcı kimliği eklenmez:
--
-- update public.dietitian_profiles
-- set is_verified = (verification_status = 'approved')
-- where is_verified is distinct from (verification_status = 'approved');
--
-- Production onarımı için ayrıca açık kullanıcı onayı, yedek ve doğrulama gerekir.

create function public.sync_dietitian_verification_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.verification_status is null
     or new.verification_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Geçersiz diyetisyen doğrulama durumu.' using errcode = '23514';
  end if;

  -- Oturumlu kullanıcı kendi verification alanlarını belirleyemez. Güvenilir
  -- yönetim/backend yolunda auth.uid() mevcut değildir; bu yol ayrıca onaylanır.
  if auth.uid() is not null and auth.uid() = new.user_id then
    if tg_op = 'INSERT' then
      if new.verification_status is distinct from 'pending'
         or new.is_verified is distinct from false then
        raise exception 'Diyetisyen doğrulama alanları browser tarafından atanamaz.'
          using errcode = '42501';
      end if;
    elsif new.verification_status is distinct from old.verification_status
       or new.is_verified is distinct from old.is_verified
       or new.verified_at is distinct from old.verified_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Diyetisyen doğrulama alanları browser tarafından değiştirilemez.'
        using errcode = '42501';
    end if;
  end if;

  new.is_verified := (new.verification_status = 'approved');
  return new;
end;
$function$;

create trigger trg_sync_dietitian_verification_fields
before insert or update on public.dietitian_profiles
for each row execute function public.sync_dietitian_verification_fields();

alter table public.dietitian_profiles
  add constraint dietitian_profiles_verification_consistency_check
  check (is_verified is not distinct from (verification_status = 'approved'));

-- Uygulama sonrası yalnız metadata/aggregate doğrulaması:
-- select verification_status, is_verified, count(*)
-- from public.dietitian_profiles
-- group by verification_status, is_verified;
-- select count(*) from public.dietitian_profiles
-- where is_verified is distinct from (verification_status = 'approved');

-- Rollback: ayrı açık onayla önce trigger, sonra function ve constraint hedefli
-- kaldırılır. Rollback mevcut verification kayıtlarını değiştirmez ve RLS kapatmaz.
