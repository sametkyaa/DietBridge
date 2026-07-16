-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: public.dietitian_profiles, public.appointments ve public.chat_messages
-- için policy'leri RLS açılmadan önce hazırlamak ve ardından fail-closed RLS
-- etkinleştirmek.
--
-- Ön koşullar:
-- 1. Staging/test ortamı ve negatif RLS test hesapları hazır olmalıdır.
-- 2. 202607130007_auth_onboarding_hardening.sql ile güvenli dietitian
--    onboarding modeli staging'de doğrulanmış olmalıdır.
-- 3. 202607130006_verification_consistency.sql için verification veri kapısı
--    ve mirror modeli staging'de doğrulanmış olmalıdır.
-- 4. Bu üç tabloda burada doğrulananlar dışında policy bulunmamalıdır.
-- 5. Bu dosya production'da doğrudan çalıştırılmamalıdır.

do $$
begin
  if to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.chat_messages') is null then
    raise exception 'Kritik RLS taslağı için beklenen tablo bulunamadı.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('dietitian_profiles', 'appointments', 'chat_messages')
  ) then
    raise exception 'Kritik tablolarda beklenmeyen mevcut policy var; güncel policy envanteriyle taslak yeniden incelenmelidir.';
  end if;

  if exists (
    select 1
    from public.appointments
    where dietitian_id is null or client_id is null
  ) then
    raise exception 'appointments sahiplik alanlarında null kayıt var; RLS uygulamasından önce ayrı veri kararı gerekir.';
  end if;

  if to_regprocedure('public.protect_dietitian_profile_system_fields()') is not null then
    raise exception 'protect_dietitian_profile_system_fields() zaten var; mevcut tanım incelenmeden üzerine yazılmamalıdır.';
  end if;
end
$$;

-- Diyetisyen kendi profilindeki sistem alanlarını değiştiremez. Bu trigger
-- browser'dan gelen INSERT ve UPDATE işlemlerini sınırlar; yönetim işlemleri
-- ayrı, güvenilir bir server-side yol gerektirir.
create function public.protect_dietitian_profile_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is not null and auth.uid() = new.user_id then
    if tg_op = 'INSERT' then
      if new.is_verified is distinct from false
         or new.verification_status is distinct from 'pending'
         or new.verified_at is not null
         or new.rejection_reason is not null then
        raise exception 'Diyetisyen doğrulama alanları kullanıcı tarafından atanamaz.'
          using errcode = '42501';
      end if;
    else
      if new.user_id is distinct from old.user_id then
        raise exception 'Diyetisyen profil sahibi değiştirilemez.'
          using errcode = '42501';
      end if;

      if new.is_verified is distinct from old.is_verified
         or new.verification_status is distinct from old.verification_status
         or new.verified_at is distinct from old.verified_at
         or new.rejection_reason is distinct from old.rejection_reason then
        raise exception 'Diyetisyen doğrulama alanları kullanıcı tarafından değiştirilemez.'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

create trigger trg_protect_dietitian_profile_system_fields
before insert or update on public.dietitian_profiles
for each row execute function public.protect_dietitian_profile_system_fields();

-- dietitian_profiles policy'leri
create policy "Dietitians can select own profile"
on public.dietitian_profiles
for select
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'dietitian'
  )
);

create policy "Dietitians can create own pending profile"
on public.dietitian_profiles
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'dietitian'
  )
);

create policy "Dietitians can update own non-system profile fields"
on public.dietitian_profiles
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'dietitian'
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'dietitian'
  )
);

-- appointments policy'leri. Client için yalnızca SELECT; yazma yalnızca
-- aktif ilişkisi bulunan dietitian sahibine verilir.
create policy "Dietitians can select active client appointments"
on public.appointments
for select
to authenticated
using (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'dietitian'
  )
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = appointments.dietitian_id
      and dc.client_id = appointments.client_id
      and dc.status = 'active'
  )
);

create policy "Clients can select own active appointments"
on public.appointments
for select
to authenticated
using (
  client_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'client'
  )
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = appointments.dietitian_id
      and dc.client_id = appointments.client_id
      and dc.status = 'active'
  )
);

create policy "Dietitians can create active client appointments"
on public.appointments
for insert
to authenticated
with check (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'dietitian'
  )
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = appointments.dietitian_id
      and dc.client_id = appointments.client_id
      and dc.status = 'active'
  )
);

create policy "Dietitians can update active client appointments"
on public.appointments
for update
to authenticated
using (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = appointments.dietitian_id
      and dc.client_id = appointments.client_id
      and dc.status = 'active'
  )
)
with check (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = appointments.dietitian_id
      and dc.client_id = appointments.client_id
      and dc.status = 'active'
  )
);

create policy "Dietitians can delete active client appointments"
on public.appointments
for delete
to authenticated
using (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = appointments.dietitian_id
      and dc.client_id = appointments.client_id
      and dc.status = 'active'
  )
);

-- chat_messages için update/delete policy'si tanımlanmaz. Okunma durumu veya
-- mesaj silme ihtiyacı ortaya çıkarsa dar RPC veya ayrı policy ayrı görevde
-- tasarlanmalıdır.
create policy "Participants can select active relationship messages"
on public.chat_messages
for select
to authenticated
using (
  (sender_id = auth.uid() or receiver_id = auth.uid())
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.status = 'active'
      and (
        (dc.dietitian_id = chat_messages.sender_id and dc.client_id = chat_messages.receiver_id)
        or
        (dc.dietitian_id = chat_messages.receiver_id and dc.client_id = chat_messages.sender_id)
      )
  )
);

create policy "Participants can send active relationship messages"
on public.chat_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.status = 'active'
      and (
        (dc.dietitian_id = chat_messages.sender_id and dc.client_id = chat_messages.receiver_id)
        or
        (dc.dietitian_id = chat_messages.receiver_id and dc.client_id = chat_messages.sender_id)
      )
  )
);

-- Policy'ler oluşturulduktan sonra RLS etkinleştirilir.
alter table public.dietitian_profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.chat_messages enable row level security;

-- Uygulama sonrası metadata kontrolü:
-- select tablename, policyname, cmd from pg_policies
-- where schemaname = 'public'
--   and tablename in ('dietitian_profiles', 'appointments', 'chat_messages');
-- select relname, relrowsecurity from pg_class
-- where oid in ('public.dietitian_profiles'::regclass,
--               'public.appointments'::regclass,
--               'public.chat_messages'::regclass);

-- Rollback: Uygulama öncesinde dışa aktarılan policy tanımlarını hedefli
-- geri yükleyin. RLS'yi kapatmak varsayılan rollback değildir.
