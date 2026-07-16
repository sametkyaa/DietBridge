-- TASLAK — ÇALIŞTIRILMADI
-- Amaç: Veri uyumluluğu ön koşulları, güvenli constraint adayları ve
-- sorgu odaklı index taslakları.
--
-- Bu dosya veri düzeltmesi yapmaz. Aggregate ön koşul sağlanmıyorsa açık
-- hata verir. CREATE INDEX CONCURRENTLY kullanılmaz; Supabase migration
-- transaction modeliyle uyumluluğu bu görevde doğrulanmamıştır.

do $$
begin
  if exists (select 1 from public.profiles where role is null) then
    raise exception 'profiles.role null kayıt içeriyor; NOT NULL kararı onboarding tasarımıyla birlikte ayrı ele alınmalıdır.';
  end if;

  if exists (
    select 1 from public.appointments
    where dietitian_id is null or client_id is null
  ) then
    raise exception 'appointments sahiplik kolonlarında null kayıt var; NOT NULL uygulanamaz.';
  end if;

  if exists (
    select 1 from public.appointments
    where status is not null
      and status not in ('upcoming', 'completed', 'cancelled')
  ) then
    raise exception 'appointments.status geçersiz değer içeriyor; check constraint eklenemez.';
  end if;

  if exists (
    select 1
    from public.meal_plans
    group by client_id, plan_date
    having count(*) > 1
  ) then
    raise exception 'meal_plans client/tarih çakışması var; unique index oluşturulamaz.';
  end if;
end
$$;

-- profiles.role mevcut user_role enum'u ile sınırlı olsa da dietitian
-- onboarding sırasında geçici null üretilebildiği doğrulandı. NOT NULL veya
-- yeni role check bu taslakta bilinçli olarak eklenmez.

-- Verification consistency constraint/trigger modeli bu dosyadan ayrıldı:
-- 202607130006_verification_consistency.sql. Bu dosya önce aggregate kapısı,
-- sonra ayrı onaylı staging veri onarımı olmadan devam etmez. Aynı constraint'i
-- burada yeniden eklemeyin.

alter table public.appointments
  alter column dietitian_id set not null;
alter table public.appointments
  alter column client_id set not null;
alter table public.appointments
  add constraint appointments_status_check
  check (status is null or status in ('upcoming', 'completed', 'cancelled'))
  not valid;

-- Aynı client ve tarih için tek plan iş kuralı onaylanırsa, bu unique index
-- meal plan sorgusunu da destekler. Production yazma lock riski staging
-- rehearsal ve bakım penceresi ile kabul edilmeden uygulanmamalıdır.
create unique index meal_plans_client_plan_date_unique
  on public.meal_plans (client_id, plan_date);

-- Mevcut index ile çakışmayan adaylar:
-- appointments şu anda yalnızca primary key index'ine sahiptir.
create index idx_appointments_dietitian_date_time
  on public.appointments (dietitian_id, date, time);
create index idx_appointments_client_date_time
  on public.appointments (client_id, date, time);

-- meal_plans yalnızca client_id index'ine sahiptir; web sorgusu client,
-- dietitian ve tarih aralığı ile filtreler.
create index idx_meal_plans_dietitian_client_plan_date
  on public.meal_plans (dietitian_id, client_id, plan_date);

-- chat_messages üzerinde sender/receiver index'i var, created_at yoktur.
-- Web chat şu anda mock olduğundan bu index ayrı Aşama 6 sorgu planıyla
-- yeniden doğrulanmalıdır; yanlış konuşma sorgusunu optimize etmemek için
-- burada oluşturulmaz.

-- dietitian_profiles.user_id ve client_profiles.user_id primary key ile,
-- dietitian_clients ilişki kolonları mevcut composite/partial index'lerle,
-- meals.plan_id, measurements.client_id ve daily_logs.client_id mevcut
-- index'lerle kapsanmaktadır. Eşdeğer index tekrar oluşturulmaz.

-- meals.recipe_id için doğrulanmış public parent tablo veya foreign key
-- bulunmadı. Tahmini recipes foreign key ya da orphan kontrolü eklenmez.

-- Uygulama sonrası metadata kontrolü:
-- select conname, pg_get_constraintdef(oid, true)
-- from pg_constraint
-- where conrelid in ('public.dietitian_profiles'::regclass,
--                    'public.appointments'::regclass);
-- select indexname from pg_indexes
-- where schemaname = 'public'
--   and tablename in ('appointments', 'meal_plans');

-- Rollback: NOT VALID constraint validate edilmeden kaldırılabilir. Index
-- kaldırma yazma/okuma etkisi gözden geçirilerek ayrı açık onayla yapılır.
