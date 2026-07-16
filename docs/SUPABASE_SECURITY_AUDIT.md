# DietBridge — Supabase Şema, RLS ve Storage Güvenlik Denetimi

## 1. Denetimin amacı

Bu belge, DietBridge Web repository’si ile bağlı Supabase projesinin şema, RLS, policy, constraint, index, trigger/function, Realtime ve Storage metadata’sını karşılaştırır. Denetim salt okunur yapılmıştır; amaç sonraki migration ve izolasyon testleri için güvenli bir uygulama planı çıkarmaktır.

## 2. İncelenen Supabase proje referansı

- Yerel `VITE_SUPABASE_URL` ile eşleşen proje: `samesProject`.
- Maskelenmiş proje referansı: `kagv…cuxz`.
- Bölge: `eu-central-1`.
- Durum: `ACTIVE_HEALTHY`.
- URL, anon key, service role, veritabanı parolası ve connection string bu belgede yer almaz.

## 3. Denetim tarihi

2026-07-13.

## 4. Güvenlik sınırları

- Yalnızca metadata ve policy tanımları okundu.
- Veri tablolarında `SELECT *`, kullanıcı satırı veya `auth.users` listelemesi yapılmadı.
- INSERT, UPDATE, DELETE, UPSERT, DDL, migration, seed, RPC mutation, Auth kullanıcı işlemi ve Storage dosya işlemi yapılmadı.
- Gerçek kullanıcı izolasyonu, negatif RLS veya Storage erişim testi yapılmadı; aşağıdaki bulgular metadata/policy tanımıyla sınırlıdır.

## 5. Repository kaynakları

İncelenen başlıca kaynaklar:

- `AGENTS.md`, `docs/ROADMAP.md`
- `lib/env.ts`, `lib/supabaseClient.ts`
- `features/auth/`
- `features/clients/services/clientService.ts`
- `features/dietitians/services/dietitianService.ts`
- `features/appointments/services/appointmentService.ts`
- `features/meal-plans/services/mealPlanService.ts`
- `pages/ClientDetails.tsx`, `pages/MealPlans.tsx`
- `shared/types.ts`, `shared/constants.ts`
- `supabase/migrations/20260706_add_sort_order.sql`

Repository’de görülen erişim ve yazma yüzeyleri:

- Auth/profile: `profiles`, `dietitian_profiles`.
- Danışan ilişkisi ve sağlık verisi: `dietitian_clients`, `client_profiles`, `measurements`, `daily_logs`.
- Plan/öğün: `meal_plans`, `meals`, Storage `meal-photos`.
- Randevu: `appointments`.
- Diploma/avatar: Storage `dietitian-diplomas`, `avatars`.
- Mesaj ekranı mevcut kodda `shared/constants.ts` içindeki mock `CONVERSATIONS` verisini kullanıyor; canlı `chat_messages` tablosu için aktif servis bulunamadı.
- `pages/ClientDetails.tsx` doğrudan Realtime kanalına bağlanıyor; `pages/MealPlans.tsx` doğrudan Storage upload/public URL akışı kullanıyor.

## 6. Canlı şema özeti

`public` şemasında 21 tablo bulundu:

`profiles`, `dietitian_profiles`, `client_profiles`, `dietitian_clients`, `appointments`, `meal_plans`, `meals`, `measurements`, `daily_logs`, `chat_messages`, `meal_change_requests`, `body_measurements`, `activity_levels`, `alcohol_statuses`, `blood_types`, `client_goals`, `nutrition_types`, `medical_conditions`, `medications_catalog`, `client_medical_conditions`, `client_medications`.

İstenen kritik tabloların tümü mevcut. Mesajlaşma için `chat_messages`, ek plan akışı için `meal_change_requests` bulundu. Abonelik tablosu bulunmadı.

RLS özeti:

- Public tablolar: 21.
- RLS açık: 18.
- RLS kapalı: 3.
- Force RLS: kritik public tabloların hiçbirinde açık değil.
- RLS kapalı tablolar: `public.dietitian_profiles`, `public.appointments`, `public.chat_messages`.

Bu üç tablo PostgREST’e açık olduğundan anon/authenticated istemciler için kritik izolasyon açığı vardır. RLS açmak tek başına yeterli değildir; policy’ler aynı migration içinde tasarlanmalıdır.

## 7. Tablo ve kolon envanteri

Aşağıdaki özet yalnızca kolon adı, tip, nullable/default ve önemli sahiplik kolonlarını içerir; satır verisi içermez.

| Tablo | Önemli kolonlar | PK/FK ve bütünlük notu |
|---|---|---|
| `profiles` | `id uuid NOT NULL`, `email text`, `full_name text`, `avatar_url text`, `role user_role DEFAULT client`, `phone text`, `created_at`, `updated_at NOT NULL DEFAULT now()` | PK `id`; `id -> auth.users(id) ON DELETE CASCADE`; email unique; role enum `dietitian/client`, ancak nullable |
| `dietitian_profiles` | `user_id uuid NOT NULL`, iletişim/uzmanlık alanları, `is_verified boolean DEFAULT false`, `verification_status text NOT NULL DEFAULT pending`, `verified_at`, `rejection_reason` | PK/FK `user_id -> profiles(id) ON DELETE CASCADE`; status check mevcut; RLS kapalı |
| `client_profiles` | `user_id`, hedef/kilo/uyku/sağlık alanları, legacy text alanları ve yeni katalog FK alanları, `created_at`, `updated_at` | PK/FK `user_id -> profiles`; katalog FK’leri; kilo, boy, skor, su ve tarih check’leri mevcut |
| `dietitian_clients` | `id`, `dietitian_id`, `client_id`, `status client_status`, zaman alanları | PK; iki profile FK; partial unique index’ler pending/active ilişkiyi sınırlar |
| `appointments` | `id`, `dietitian_id`, `client_id`, `title`, `date`, `time`, `duration`, `type`, `status`, `created_at` | PK ve iki profile FK; sahiplik kolonları nullable; RLS kapalı |
| `meal_plans` | `id`, `client_id`, `dietitian_id`, `plan_date`, `notes`, `created_at` | PK ve iki profile FK; `client_id/dietitian_id` nullable; plan tarihi unique değil |
| `meals` | `id`, `plan_id`, enum `type`, `title`, `calories`, `macros`, `is_eaten`, `photo_url`, `time`, `sort_order`, `source`, `recipe_id` | PK; `plan_id -> meal_plans ON DELETE CASCADE`; `recipe_id` için FK görülmedi |
| `measurements` | `id`, `client_id`, `measured_at`, kilo/ölçü numeric alanları, `notes`, timestamps | PK; client FK cascade; `(client_id, measured_at)` unique; pozitif değer check’i |
| `daily_logs` | `id`, `client_id`, `date`, `current_weight`, `water_intake`, `mood`, `created_at` | PK; client FK; `(client_id,date)` unique; `client_id` nullable |
| `chat_messages` | `id`, `sender_id`, `receiver_id`, `message_text`, `created_at`, `is_read` | İki profile FK; RLS kapalı |
| `meal_change_requests` | `id`, `client_id`, `dietitian_id`, `plan_date`, `meal_slot`, JSONB istek, `status`, timestamps | İki profile FK; status check; aktif uygulamada canlı servis doğrulaması ayrıca gerekli |
| `body_measurements` | Eski ölçüm alanları ve `client_id` | Deprecated olarak işaretli; RLS açık fakat yeni `measurements` ile model tekrarı var |
| Katalog tabloları | `activity_levels`, `alcohol_statuses`, `blood_types`, `client_goals`, `nutrition_types`, `medical_conditions`, `medications_catalog` | RLS açık, authenticated SELECT policy’leri; kod ve ad alanlarında unique kısıtlar |
| İlişkisel sağlık tabloları | `client_medical_conditions`, `client_medications` | Client FK ve katalog FK; client/katalog çiftlerinde unique kısıtlar |

## 8. Constraint ve foreign key envanteri

Olumlu bulgular:

- UUID PK kullanımı tutarlı.
- `profiles.id -> auth.users.id` ve alt profiller için cascade FK’leri mevcut.
- `dietitian_clients` üzerinde `(dietitian_id, client_id)` unique ve pending/active partial unique index’leri mevcut.
- `measurements (client_id, measured_at)` ve `daily_logs (client_id, date)` unique.
- Client profile kilo, boy, uyku, compliance ve tarih aralığı check’leri mevcut.
- `dietitian_profiles.verification_status` için `pending/approved/rejected` check’i mevcut.

Riskler:

- `profiles.role` enum olsa da kolon nullable; rol okunamaması uygulamada fail-closed olsa da DB modeli daha güçlü `NOT NULL`/kontrollü yönetim gerektiriyor.
- `dietitian_profiles.is_verified` nullable ve `verification_status` ile birlikte tutuluyor; iki alanın çelişmesini engelleyen constraint yok.
- `dietitian_clients` enum’unda `inactive` değeri görünürken check constraint yalnızca `pending/active/rejected/removed` kabul ediyor; enum/check drift’i var.
- `appointments` sahiplik FK’leri nullable ve status/type için check yok.
- `meal_plans.client_id` ve `dietitian_id` nullable; aynı client/date için unique kısıt görünmüyor.
- `meals.plan_id` nullable ve `recipe_id` için canlı FK görünmüyor.
- `daily_logs.client_id` nullable; `measurements` için pozitiflik var ancak üst sınır yok.
- `updated_at` alanları için bazı tablolarda trigger var, ancak tüm kritik tablolarda ortak trigger standardı yok.

## 9. Index envanteri ve önerileri

Mevcut önemli index’ler:

- `dietitian_clients`: ilişki index’i ve iki pending/active partial unique index.
- `meal_plans`: `client_id` index’i.
- `meals`: `(plan_id, sort_order)` ve `(plan_id, time)` index’leri.
- `measurements`: `client_id`, `measured_at DESC`, `(client_id, measured_at)` unique.
- `daily_logs`: `client_id` ve `(client_id,date)` unique.
- `profiles`: unique email ve email yardımcı index’i.

Öneriler; bu aşamada oluşturulmadı:

| Tablo/kolon | Desteklediği sorgu | Beklenen fayda | Yazma maliyeti |
|---|---|---|---|
| `appointments(dietitian_id, date, time)` | Diyetisyen takvimi | Listeleme ve tarih sıralama | Orta |
| `appointments(client_id, date, time)` | Client randevu görünümü | Client filtreleme | Orta |
| `meal_plans(dietitian_id, plan_date)` | Diyetisyen plan listesi | Plan tarih erişimi | Düşük/orta |
| `meal_plans(client_id, plan_date)` | Client plan restore | Tarih ve client filtreleme | Düşük/orta |
| `body_measurements(client_id)` | Legacy ölçüm temizliği süresince okuma | FK join performansı | Düşük |
| `chat_messages(receiver_id, created_at)` | Mesaj/unread listesi | Konuşma sorgusu | Orta |
| `daily_logs(client_id, date)` mevcut | İhtiyaç halinde ayrı date sıralama testi | Mevcut index yeterliliği doğrulanmalı | Yok |

Supabase performance advisor ayrıca 10 unindexed FK, 43 auth-RLS initplan, 9 multiple-permissive-policy ve 12 unused-index bulgusu döndürdü. Advisor çıktısı performans sinyalidir; index silme veya policy birleştirme kararı workload ile verilmelidir.

## 10. Trigger ve function envanteri

Metadata’da profil oluşturma, updated_at ve sistem alanlarını koruma trigger’ları bulundu:

- `on_auth_user_created -> handle_new_user()`.
- `profiles` ve `client_profiles` updated_at/system-field trigger’ları.
- `sync_client_weight_to_measurements()`.
- `measurements`, `meal_change_requests` updated_at trigger’ları.

Public security-definer function’lar:

- `current_user_role()` — `search_path=public`, fakat anon/authenticated EXECUTE açık.
- `is_current_user_dietitian()` — `search_path=public`, anon/authenticated EXECUTE açık.
- `save_my_current_weight(numeric)` — auth.uid ve 20–500 aralığı kontrolü var; authenticated EXECUTE açık.
- `sync_client_weight_to_measurements()` — trigger amaçlı, fakat anon/authenticated EXECUTE metadata’da açık görünüyor.
- `handle_new_user()` — auth trigger’ı; service_role/postgres EXECUTE.

Supabase security advisor bulguları:

- 3 anon SECURITY DEFINER function execute uyarısı.
- 4 authenticated SECURITY DEFINER function execute uyarısı.
- `public.set_updated_at` için mutable `search_path` uyarısı.
- `save_my_current_weight` auth.uid ile sınırlandırılmış olsa da RPC yüzeyi ayrı allowlist ve negative test gerektirir.
- `sync_client_weight_to_measurements` doğrudan RPC olarak çağrılmamalı; yalnızca trigger yolu için erişim modelinin daraltılması değerlendirilmelidir.

Function body’lerinde kullanıcı satırı, secret veya token raporlanmamıştır.

## 11. RLS durumu ve policy envanteri

Policy sayıları metadata ile doğrulandı. `public` kritik tabloları için özet:

| Tablo | RLS | Policy özeti | Değerlendirme |
|---|---|---|---|
| `profiles` | Açık | Own select/update/insert; diyetisyen client-linking SELECT | Linking policy aktif ilişki yerine `is_current_user_dietitian()` kullanıyor; geniş okuma riski |
| `dietitian_profiles` | Kapalı | Policy yok | Kritik: anon/authenticated tüm satırlara erişebilir |
| `client_profiles` | Açık | Own CRUD; aktif ilişkili diyetisyen SELECT | Sahiplik modeli genel olarak doğru; own update sistem alanları trigger ile korunmalı |
| `dietitian_clients` | Açık | İlişki SELECT, diyetisyen pending INSERT, client pending UPDATE, diyetisyen remove UPDATE | Status geçişleri ve çoklu permissive UPDATE sadeleştirilmeli |
| `appointments` | Kapalı | Policy yok | Kritik: randevu sahipliği tamamen açıkta |
| `meal_plans` | Açık | Client/diyetisyen SELECT; diyetisyen insert/update/delete | INSERT aktif ilişki kontrol ediyor; update/delete ilişki doğrulaması ayrıca güçlendirilmeli |
| `meals` | Açık | Plan üzerinden client/diyetisyen SELECT/CRUD | Plan sahipliği doğru yönde; aynı eylemde çoklu permissive policy var |
| `measurements` | Açık | Client own CRUD; aktif diyetisyen SELECT | Model doğru yönde; policy initplan ve birleşik policy maliyeti var |
| `daily_logs` | Açık | Client own CRUD | Diyetisyen SELECT policy’si yok; web analiz ihtiyacı için erişim eksikliği olabilir |
| `chat_messages` | Kapalı | Policy yok | Kritik: sender/receiver izolasyonu yok |

Storage `objects` üzerinde 10 policy var. Avatar ve diploma policy’leri kullanıcı klasörü/owner üzerinden sınırlandırılmış; meal-photo policy’leri `public` rolüne verilmiş ve klasörün ilk parçasını `auth.uid()` ile eşleştiriyor. Bucket private olsa da policy rolü authenticated ile daraltılmalı ve update/delete davranışı açıkça tanımlanmalıdır.

## 12. Sahiplik matrisi

| Kaynak | Client kendi verisi | İlişkili diyetisyen | İlişkisiz diyetisyen | Anon | Beklenen yazma yetkisi | Mevcut durum | Risk |
|---|---|---|---|---|---|---|---|
| `profiles` | Own SELECT/UPDATE | Link ekranı için client SELECT | Policy tanımından geniş client listesi çıkarımı | SELECT policy yok; RLS fail-closed değilse dikkat | Own izinli alanlar | Own policy + geniş dietitian linking | Yüksek |
| `dietitian_profiles` | Uygulanamaz | Kendi profili | Engellenmeli | RLS kapalı | Kendi izinli alanları | Herkese açık tablo | Kritik |
| `client_profiles` | Own CRUD | Active relation SELECT | Engelleniyor | Policy yok | Client kendi izinli alanları | Active relation policy mevcut | Orta |
| `dietitian_clients` | Kendi ilişki/status akışı | Kendi ilişkileri | Engellenmeli | Policy yok | Kontrollü pending/status geçişi | İlişki policy’leri var | Orta |
| `appointments` | Doğrudan güvenli erişim yok | Doğrudan güvenli erişim yok | Engellenmiyor | RLS kapalı | Taraf bazlı CRUD | Policy yok | Kritik |
| `meal_plans` | Own SELECT | Own SELECT/CRUD | Plan ID tahminine güvenmemeli | Policy yok | Active relation ile insert, owner update/delete | Kısmen doğru | Yüksek |
| `meals` | Own plan SELECT/completion | Own plan CRUD | Plan FK üzerinden engel | Policy yok | Plan sahibi CRUD | Plan EXISTS policy’leri var | Orta |
| `measurements` | Own CRUD | Active relation SELECT | Engellenmeli | Policy yok | Client insert/update, diyetisyen ürün gereksinimine göre | Policy mevcut | Orta |
| `daily_logs` | Own CRUD | Beklenen read policy eksik | Engellenmeli | Policy yok | Client CRUD, diyetisyen read gerekirse ayrı | Client-only policy | Orta |
| Storage `avatars` | Own folder | Ürün gereksinimine göre signed read | Engellenmeli | Private | Own upload/update/delete | Own folder policy | Düşük/orta |
| Storage `diplomas` | Own upload/read | Yönetim akışı dışında engelli | Engellenmeli | Private | Own owner/path policy | Private ve owner/path kontrollü | Orta |
| Storage `meal-photos` | Own folder | Active relation ile signed read | Engellenmeli | Private bucket, public-role policy | Own folder insert/select | Rol ve lifecycle policy’si daraltılmalı | Yüksek |

Bu tablo policy tanımından çıkarımdır; iki gerçek kullanıcı ile negatif izolasyon testi yapılmamıştır.

## 13. Auth/verification modeli

- `profiles.role`: `user_role` enum (`dietitian`, `client`), default `client`, nullable.
- `dietitian_profiles.verification_status`: `pending`, `approved`, `rejected` check’i; NOT NULL.
- `dietitian_profiles.is_verified`: nullable boolean, default false, bağımsız check yok.
- İki doğrulama alanının çelişmesini engelleyen constraint veya trigger görülmedi.
- Repository Aşama 2 resolver’ı çelişkili durumları fail-closed ele alıyor; canlı model bu yaklaşımı destekliyor ancak sistem alanlarının client UPDATE’inden korunması policy/trigger seviyesinde ayrıca kanıtlanmalı.
- `profiles` own update policy’si role değişimini tek başına engellemiyor; trigger ve güvenli yönetim yolu doğrulaması gereklidir.

## 14. Storage bucket ve policy denetimi

| Bucket | Public | Limit | MIME | Bulgular |
|---|---:|---:|---|---|
| `avatars` | Hayır | 5 MiB | JPEG/PNG/WebP | Own user-folder policy’leri mevcut |
| `dietitian-diplomas` | Hayır | 10 MiB | PDF | Owner ve `diplomas/<user>` path policy’leri mevcut; diploma public yapılmamalı |
| `meal-photos` | Hayır | Yok | Yok | Public-role select/insert policy’si var; MIME/limit ve lifecycle net değil |

Storage bucket’ın private olması RLS policy’sinin yerine geçmez. Diploma için signed URL ve yalnızca yetkili yönetim/owner erişimi korunmalıdır. Object satırları veya dosya içerikleri listelenmedi.

## 15. Realtime publication durumu

`supabase_realtime` publication içinde:

- `client_profiles`
- `dietitian_clients`
- `meal_plans`
- `meals`
- `measurements`
- `profiles`

`appointments`, `daily_logs` ve `chat_messages` bu publication içinde görünmedi. Ayrı `supabase_realtime_messages_publication` içinde yalnızca `realtime.messages` bulundu.

Realtime publication içinde olmak RLS yerine geçmez; event filtreleri ve tablo policy’leri birlikte doğrulanmalıdır.

## 16. Repository–canlı şema drift analizi

- Repository migration sayısı: 1 (`20260706_add_sort_order.sql`).
- Bu migration yalnızca `meals.sort_order` ve `meals.time` kolonlarını ekliyor.
- Supabase migration listesi eklenti üzerinden boş döndü; bu, canlı şemanın repository migration geçmişiyle izlenemediğini gösterir.
- Canlıda repository migration’da olmayan kritik tablolar, FK’ler, partial unique index’ler, policy’ler, trigger’lar, function’lar, katalog tabloları ve Storage nesneleri var.
- Repository’de migration olarak bulunmayan canlı nesneler: auth/profile sistemi, danışan ilişkisi, ölçümler/loglar, plan/meal RLS’i, Storage policy’leri ve Realtime yayın ayarları.
- Repository migration’larının canlı şemayı tam temsil ettiği söylenemez; migration drift’i yüksek riskli bir yönetişim bulgusudur.
- Canlıda bulunmayan repository migration değişikliği saptanmadı; ancak migration history boş olduğu için kesin tarihsel karşılaştırma yapılamadı.

## 17. Risk sınıflandırması

| Seviye | Bulgu sayısı |
|---|---:|
| Kritik | 3 |
| Yüksek | 6 |
| Orta | 5 |
| Düşük | 3 |
| Bilgilendirme | 5 |

Sayımlar aynı kök nedenden doğan advisor tekrarlarını tek bulgu altında gruplayan denetim sayımıdır. Nesne bazlı ayrıntılar aşağıdadır.

### Kritik

1. `dietitian_profiles` RLS kapalı.
2. `appointments` RLS kapalı.
3. `chat_messages` RLS kapalı.

Bu tabloların anon/authenticated istemcilerce tablo seviyesinde korunmadığı metadata ile doğrulandı. Supabase advisor da aynı üç tablo için ERROR verdi.

### Yüksek

- `profiles` client-linking SELECT policy’si active `dietitian_clients` ilişkisini doğrulamadan diyetisyen rolüne geniş client görünürlüğü veriyor.
- `meal_plans` update/delete policy’leri active relation kontrolü olmadan yalnızca dietitian_id’ye dayanıyor.
- `meal-photos` private bucket üzerinde public-role policy’leri ve sınırsız MIME/limit metadata’sı var.
- Public SECURITY DEFINER RPC yüzeyi: anon için üç, authenticated için dört advisor uyarısı.
- Verification sistem alanları için client UPDATE’i ve `is_verified/status` çelişkisi tek bir DB kuralıyla engellenmiyor.
- `profiles.role` nullable ve own update policy’sinin sistem alanlarını nasıl koruduğu yalnızca trigger tanımına bağlı.

### Orta ve düşük

- `appointments` ve `meal_plans` sorgu desenleri için eksik FK index’leri.
- `dietitian_profiles` ve `appointments` sahiplik kolonlarının nullable olması.
- `daily_logs` için diyetisyen read policy’sinin olmaması.
- `dietitian_clients` enum/check drift’i.
- 43 auth-RLS initplan, 9 multiple-permissive-policy ve mutable search_path advisor bulgusu.
- Legacy `body_measurements` ve client profile legacy text alanları model drift’i oluşturuyor.

## 18. Eksik bilgiler veya eklenti sınırlamaları

- Eklenti metadata/SQL okuma sağladı; kullanıcı satırları ve auth.users okunmadı.
- Migration history boş döndüğü için canlı nesnelerin hangi migration ile geldiği kesinleştirilemedi.
- Policy’lerin gerçek kullanıcılarla negative sonucu test edilmedi.
- Storage object erişim ve signed URL davranışı dosya indirmeden doğrulanmadı.
- Function execute grant’leri metadata ile görüldü; uygulama dışı RPC çağrıları negatif test edilmedi.

## 19. Önerilen düzeltme sırası

1. RLS’siz üç kritik tablo için staging’de policy tasarımı ve deny-by-default doğrulaması.
2. `profiles`, `dietitian_profiles` ve verification sistem alanlarının güvenli yazma modelini netleştirme.
3. `appointments`, `meal_plans`, `meals`, `measurements`, `daily_logs` sahiplik ve ilişki policy’lerini tek matrisle doğrulama.
4. Storage path, signed URL, MIME/limit ve public-role policy’lerini daraltma.
5. SECURITY DEFINER function execute grant’lerini allowlist’e indirme; `search_path` standardını tamamlama.
6. Index/performance advisor bulgularını staging workload ile ölçme.
7. Migration drift çözülmeden production schema değişikliği uygulamama.

## 20. Önerilen migration grupları

### Migration 1 — Auth ve profil sistem alanlarının korunması

- Amaç: role, verification status ve is_verified yazma sınırlarını güvenceye almak.
- Nesneler: `profiles`, `dietitian_profiles`, ilgili trigger/function.
- Risk: mevcut kayıtların erişim kaybetmesi.
- Ön koşul: mevcut uygulama yazma alanları ve yönetim akışı onayı.
- Doğrulama: iki rol ile SELECT/UPDATE negative testleri.
- Rollback: policy/trigger migration’ını tersleyen ayrı, onaylı migration.
- Web/mobil: ortak `profiles` ve role modelini korumalı.

### Migration 2 — Diyetisyen–danışan sahiplik ve RLS politikaları

- Amaç: `profiles`, `client_profiles`, `dietitian_clients` ilişki izolasyonu.
- Risk: linking ekranının daralması.
- Ön koşul: active/pending/rejected geçiş matrisi.
- Doğrulama: iki diyetisyen ve ilişkisiz client negative testleri.
- Rollback: policy sürümünü geri alma; veri silme yok.
- Web/mobil: ilişki tablosu iki istemcinin ortak kaynağıdır.

### Migration 3 — Randevu sahipliği ve RLS

- Amaç: `appointments` RLS’sini açıp taraf bazlı SELECT/INSERT/UPDATE/DELETE policy’leri eklemek.
- Risk: mevcut web randevu listesinin boş görünmesi.
- Ön koşul: UI servisinin gerçek kolonları ve taraf modelini doğrulaması.
- Doğrulama: dietitian/client/ilişkisiz kullanıcı testleri.
- Web/mobil: aynı sahiplik kolonları kullanılmalı.

### Migration 4 — Beslenme planı ve meals RLS

- Amaç: plan ve öğünlerde active relation + plan sahipliği.
- Risk: mevcut fallback/mutation akışının policy ile çakışması.
- Ön koşul: `meal_plans` nullable alanları ve recipe ilişkisi kararı.
- Doğrulama: plan ID tahminiyle yetkisiz CRUD reddi.
- Web/mobil: `meals.plan_id`, `is_eaten`, `sort_order`, `time` korunmalı.

### Migration 5 — Ölçüm ve daily log RLS

- Amaç: client own CRUD ve ilişkili diyetisyen read modelini netleştirmek.
- Risk: mobil ölçüm akışının engellenmesi.
- Ön koşul: `body_measurements` legacy geçiş planı.
- Doğrulama: iki client ve iki dietitian ile negative test.
- Web/mobil: `measurements` ortak kaynak olmalı.

### Migration 6 — Storage bucket policy’leri

- Amaç: avatar, diploma ve meal-photo path/role/MIME/size policy’lerini netleştirmek.
- Risk: mevcut public URL varsayımlarının kırılması.
- Ön koşul: signed URL ve upload path standardı.
- Doğrulama: owner/ilişkili/anon object testleri.
- Web/mobil: ortak bucket path sözleşmesi.

### Migration 7 — Eksik constraint ve index’ler

- Amaç: nullable/unique/check ve FK index eksiklerini workload’a göre tamamlamak.
- Risk: lock ve yazma maliyeti.
- Ön koşul: migration drift çözümü ve staging planı.
- Doğrulama: explain plan ve constraint negative testleri.
- Web/mobil: kolon/enum sözleşmesi değişmemeli.

### Migration 8 — Function ve trigger hardening

- Amaç: execute grant allowlist, search_path ve sistem alanı koruması.
- Risk: Auth trigger veya mobil RPC akışının kırılması.
- Ön koşul: tüm RPC çağrı noktalarının envanteri.
- Doğrulama: anon/authenticated RPC negative testleri, trigger regression.
- Web/mobil: `save_my_current_weight` gibi ortak RPC’ler ayrıca onaylanmalı.

Bu gruplar plan niteliğindedir; bu görevde hiçbir SQL migration dosyası oluşturulmadı ve çalıştırılmadı.

## 21. Doğrulama test planı

- RLS’siz tablolar için anon, authenticated, client, ilişkili dietitian ve ilişkisiz dietitian SELECT/INSERT/UPDATE/DELETE matrisi.
- `profiles.role`, `dietitian_profiles.is_verified`, `verification_status` değişmezlik testleri.
- Pending/active/rejected/removed ilişki geçişleri ve partial unique index testleri.
- Appointment taraf sahipliği ve tarih filtreleri.
- Plan → meal sahipliği; client’ın yalnızca izinli `is_eaten` alanını güncellemesi.
- Ölçüm/log client izolasyonu ve diyetisyen read kapsamı.
- Storage owner/path/signed URL/MIME/limit testleri.
- Realtime event’lerinin RLS ile birlikte doğrulanması.
- RPC execute grant ve auth.uid negative testleri.

Bu testler metadata ile çalıştırılmış gerçek izolasyon testi değildir; staging/test hesapları gerektirir.

## 22. Rollback yaklaşımı

- Her migration yalnızca bir mantıksal güvenlik alanını değiştirmeli.
- Önce staging snapshot/backup ve policy diff alınmalı.
- RLS açma ile policy ekleme aynı kontrollü pakette uygulanmalı; RLS açıp policy’siz bırakılmamalı.
- Uygulama deploy’u ile migration arasında uyum kontrolü yapılmalı.
- Rollback veri silmeye değil, önceki policy/constraint/index sürümüne dönmeye dayanmalı.
- Production uygulaması ayrı kullanıcı onayı ve geri dönüş planı gerektirir.

## 23. Sonuç

Denetim, canlı şemada kritik RLS açıkları ve repository migration drift’i bulunduğunu doğruladı. Özellikle `dietitian_profiles`, `appointments` ve `chat_messages` RLS’siz olduğu için Aşama 3A çıktısı migration uygulamasına hazır bir onay değildir. Önce bulgular kullanıcı tarafından incelenmeli, ardından staging/test ortamında policy migration’ları ve negatif izolasyon testleri ayrı görevlerde yürütülmelidir.

## Veri güvenliği özeti

- Production verisine yazılmadı.
- SQL mutation çalıştırılmadı.
- Migration oluşturulmadı ve çalıştırılmadı.
- Kullanıcı verileri okunmadı veya raporlanmadı.
- Auth kullanıcısı oluşturulmadı.
- Storage dosya işlemi yapılmadı.
- Secret, key, token, email, user ID veya connection string raporlanmadı.
