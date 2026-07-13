-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: profiles, dietitian_clients, meal_plans ve meals üzerinde mevcut
-- ilişki/sahiplik policy'lerini daraltmak.
--
-- BLOKLAYICI ÖN KOŞUL:
-- Mevcut web diyetisyen kaydı browser'dan profiles.role değerini dietitian
-- yapmaya, danışan ekleme ise aktif ilişki öncesi profile aramasına dayanır.
-- 202607130007_auth_onboarding_hardening.sql, dar linking lookup akışı ve
-- 202607130008_meal_completion_rpc.sql ile mobil geçiş staging'de doğrulanmadan
-- bu taslak production'da çalıştırılmamalıdır.

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Users can insert own profile'
  ) then
    raise exception 'Bloklandı: browser tabanlı kendi profilini insert etme policy''si hala mevcut. Güvenli onboarding uygulanmadan role hardening çalıştırılamaz.';
  end if;

  if to_regprocedure('public.protect_dietitian_client_identity()') is not null then
    raise exception 'protect_dietitian_client_identity() zaten var; mevcut tanım doğrulanmadan üzerine yazılmamalıdır.';
  end if;

  if to_regprocedure('public.protect_profile_role_on_insert()') is not null then
    raise exception 'protect_profile_role_on_insert() zaten var; mevcut tanım doğrulanmadan üzerine yazılmamalıdır.';
  end if;
end
$$;

-- profiles.role UPDATE koruması mevcut protect_profile_system_fields trigger
-- tarafından sağlanır. INSERT için ayrıca browser oturumunun dietitian veya
-- başka yüksek yetkili bir rol atamasını engelleyen trigger eklenir. Güvenilir
-- onboarding yolu auth.uid() bulunmayan yönetimli işlem olarak ayrıca
-- tasarlanmalı ve staging'de doğrulanmalıdır.
create function public.protect_profile_role_on_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is not null and auth.uid() = new.id then
    if new.role is distinct from 'client'::public.user_role then
      raise exception 'Kullanıcı rolü browser tabanlı profil insert işlemiyle atanamaz.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$function$;

create trigger trg_protect_profile_role_on_insert
before insert on public.profiles
for each row execute function public.protect_profile_role_on_insert();

-- Geniş linking SELECT policy'si yalnızca aktif ilişki için daraltılır.
drop policy "Dietitians can view client profiles for linking" on public.profiles;

create policy "Dietitians can view active client profiles"
on public.profiles
for select
to authenticated
using (
  role = 'client'
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = auth.uid()
      and dc.client_id = profiles.id
      and dc.status = 'active'
  )
);

-- İlişki tarafları UPDATE ile değiştirilemez. Mevcut policy'ler yalnızca
-- pending -> active/rejected ve dietitian remove akışını taşır.
create function public.protect_dietitian_client_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.dietitian_id is distinct from old.dietitian_id
     or new.client_id is distinct from old.client_id then
    raise exception 'Diyetisyen-danışan ilişki tarafları değiştirilemez.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

create trigger trg_protect_dietitian_client_identity
before update on public.dietitian_clients
for each row execute function public.protect_dietitian_client_identity();

-- dietitian_clients için doğrulanan mevcut policy'ler korunur:
-- clients_update_own_pending_request
-- dietitian_clients_select_own
-- dietitians_create_pending_client_request
-- dietitians_remove_own_connection
-- Bu policy'ler active/pending/rejected/removed check'i ve partial unique
-- index'lerle staging'de birlikte test edilmelidir.

-- meal_plans: yalnızca aynı aktif ilişki içindeki dietitian için SELECT,
-- UPDATE ve DELETE policy'leri yeni adlarla değiştirilir.
drop policy "Dietitians can view own meal plans" on public.meal_plans;
drop policy "Dietitians can update own meal plans" on public.meal_plans;
drop policy "Dietitians can delete own meal plans" on public.meal_plans;
drop policy "Users can select own meal plans" on public.meal_plans;

create policy "Dietitians can view active client meal plans"
on public.meal_plans
for select
to authenticated
using (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = meal_plans.dietitian_id
      and dc.client_id = meal_plans.client_id
      and dc.status = 'active'
  )
);

create policy "Dietitians can update active client meal plans"
on public.meal_plans
for update
to authenticated
using (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = meal_plans.dietitian_id
      and dc.client_id = meal_plans.client_id
      and dc.status = 'active'
  )
)
with check (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = meal_plans.dietitian_id
      and dc.client_id = meal_plans.client_id
      and dc.status = 'active'
  )
);

create policy "Dietitians can delete active client meal plans"
on public.meal_plans
for delete
to authenticated
using (
  dietitian_id = auth.uid()
  and exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = meal_plans.dietitian_id
      and dc.client_id = meal_plans.client_id
      and dc.status = 'active'
  )
);

-- Mevcut Clients can view own meal plans ve Dietitians can insert own meal
-- plans policy'leri sırasıyla client own-read ve active-relation INSERT
-- kontrolü sağladığı için değiştirilmez.

-- meals: aynı eylem için yinelenen dietitian UPDATE ve SELECT policy'leri
-- hedefli kaldırılır; aktif ilişki şartı yeni policy'lerde eklenir.
drop policy "Dietitians can view meals of own plans" on public.meals;
drop policy "Users can select own meal rows" on public.meals;
drop policy "Dietitians can insert meals into own plans" on public.meals;
drop policy "Dietitians can update meals of own plans" on public.meals;
drop policy "Dietitians can update own meal rows" on public.meals;
drop policy "Dietitians can delete meals of own plans" on public.meals;

create policy "Dietitians can view active client meals"
on public.meals
for select
to authenticated
using (
  exists (
    select 1
    from public.meal_plans mp
    join public.dietitian_clients dc
      on dc.dietitian_id = mp.dietitian_id
     and dc.client_id = mp.client_id
     and dc.status = 'active'
    where mp.id = meals.plan_id
      and mp.dietitian_id = auth.uid()
  )
);

create policy "Dietitians can insert meals into active client plans"
on public.meals
for insert
to authenticated
with check (
  exists (
    select 1
    from public.meal_plans mp
    join public.dietitian_clients dc
      on dc.dietitian_id = mp.dietitian_id
     and dc.client_id = mp.client_id
     and dc.status = 'active'
    where mp.id = meals.plan_id
      and mp.dietitian_id = auth.uid()
  )
);

create policy "Dietitians can update meals in active client plans"
on public.meals
for update
to authenticated
using (
  exists (
    select 1
    from public.meal_plans mp
    join public.dietitian_clients dc
      on dc.dietitian_id = mp.dietitian_id
     and dc.client_id = mp.client_id
     and dc.status = 'active'
    where mp.id = meals.plan_id
      and mp.dietitian_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.meal_plans mp
    join public.dietitian_clients dc
      on dc.dietitian_id = mp.dietitian_id
     and dc.client_id = mp.client_id
     and dc.status = 'active'
    where mp.id = meals.plan_id
      and mp.dietitian_id = auth.uid()
  )
);

create policy "Dietitians can delete meals in active client plans"
on public.meals
for delete
to authenticated
using (
  exists (
    select 1
    from public.meal_plans mp
    join public.dietitian_clients dc
      on dc.dietitian_id = mp.dietitian_id
     and dc.client_id = mp.client_id
     and dc.status = 'active'
    where mp.id = meals.plan_id
      and mp.dietitian_id = auth.uid()
  )
);

-- Clients can update own meal completion policy'si alan bazlı UPDATE
-- kısıtlaması sağlamaz. 202607130008_meal_completion_rpc.sql dar RPC yolunu
-- tanımlar. Policy ancak mobil istemcinin RPC geçişi ve staging negatif testleri
-- kanıtlandıktan sonra ayrı, açık onaylı contract migration'ında kaldırılır;
-- bu taslak onu kaldırmaz.

-- Rollback: Uygulama öncesi saklanan dört dietitian_clients ve ilgili
-- meal_plans/meals policy tanımlarını hedefli geri yükleyin. Trigger geri
-- alma, yalnızca ilişki tarafı değişimi gereksinimi onaylanırsa yapılmalıdır.
