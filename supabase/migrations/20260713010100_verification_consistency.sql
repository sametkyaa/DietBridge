-- verification_status kanonik kaynaktır; is_verified uyumluluk aynasıdır.
-- Veri onarımı yapmaz; mevcut tutarsızlıkta fail-closed durur.

do $$
begin
  if to_regclass('public.dietitian_profiles') is null then
    raise exception 'dietitian_profiles bulunamadı; migration durduruldu.';
  end if;
  if exists (
    select 1 from public.dietitian_profiles
    where verification_status is null
       or verification_status not in ('pending', 'approved', 'rejected')
       or is_verified is distinct from (verification_status = 'approved')
  ) then
    raise exception 'Verification verisi tutarsız; otomatik veri onarımı yapılmayacak.';
  end if;
  if to_regprocedure('public.sync_dietitian_verification_fields()') is not null then
    raise exception 'Verification trigger function zaten var; üzerine yazılmaz.';
  end if;
end
$$
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
  if auth.uid() is not null and auth.uid() = new.user_id then
    if tg_op = 'INSERT' then
      if new.verification_status is distinct from 'pending'
         or new.is_verified is distinct from false then
        raise exception 'Diyetisyen doğrulama alanları browser tarafından atanamaz.' using errcode = '42501';
      end if;
    elsif new.verification_status is distinct from old.verification_status
       or new.is_verified is distinct from old.is_verified
       or new.verified_at is distinct from old.verified_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Diyetisyen doğrulama alanları browser tarafından değiştirilemez.' using errcode = '42501';
    end if;
  end if;
  new.is_verified := (new.verification_status = 'approved');
  return new;
end;
$function$
create trigger trg_sync_dietitian_verification_fields
before insert or update on public.dietitian_profiles
for each row execute function public.sync_dietitian_verification_fields()
revoke execute on function public.sync_dietitian_verification_fields() from public, anon, authenticated
alter table public.dietitian_profiles
  add constraint dietitian_profiles_verification_consistency_check
  check (is_verified is not distinct from (verification_status = 'approved'))
