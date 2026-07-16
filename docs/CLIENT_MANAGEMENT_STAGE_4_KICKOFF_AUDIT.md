# DietBridge Web — Aşama 4 Danışan Yönetimi Kickoff Denetimi

## 1. Amaç

Bu belge, Aşama 4 uygulama değişiklikleri başlamadan önce DietBridge Web danışan yönetimi akışının aktif route/import zincirini, veri ve sahiplik modelini, hata/boş durumlarını, mock/fallback davranışlarını ve güvenlik test ihtiyaçlarını salt okunur olarak kaydeder.

Bu denetimde uygulama kodu, Supabase şeması, migration’lar, production verisi ve Storage değiştirilmedi. Production durumu hakkında Aşama 3 kapanışına işlenen sonuçlar kullanıcı tarafından doğrulanmış kapanış girdileridir; bu denetimde uzak Supabase’e bağlanılarak yeniden sorgulanmamıştır.

## 2. İncelenen branch ve commit

- Branch: `codex/client-management`
- HEAD: `a9f0a5874b7b367656a09736de682403aeabb149`
- `origin/main`: `a9f0a5874b7b367656a09736de682403aeabb149`
- Başlangıçta tracked değişiklik yoktu.
- Başlangıçta önceden mevcut tek untracked alan `supabase/.temp/` idi; okunmadı, değiştirilmedi ve stage edilmedi.

## 3. İncelenen dosyalar

Ana zincir:

- `index.tsx`
- `App.tsx`
- `shared/components/ProtectedRoute.tsx`
- `shared/components/DashboardLayout.tsx`
- `shared/components/Sidebar.tsx`
- `features/auth/context/AuthContext.tsx`
- `features/auth/services/authService.ts`
- `features/clients/pages/ClientsPage.tsx`
- `features/clients/services/clientService.ts`
- `pages/ClientDetails.tsx`
- `shared/types.ts`
- `shared/utils/uuid.ts`

Bağımlı ve karşılaştırmalı alanlar:

- `pages/MealPlans.tsx`
- `features/meal-plans/services/mealPlanService.ts`
- `services/api.ts`
- `src/services/api.ts`
- `src/pages/Clients.tsx`
- `types.ts`
- `lib/supabaseClient.ts`
- `src/lib/supabaseClient.ts`
- `supabase/migrations/20260713000001_production_public_baseline.sql`
- `supabase/migrations/20260713010300_critical_table_rls.sql`
- `supabase/migrations/20260714010000_remove_legacy_client_meals_update_policy.sql`

## 4. Aktif route ve import zinciri

Aktif başlangıç zinciri `index.tsx:1-14` → `App.tsx:28-68` biçimindedir. `App.tsx:41-57`, danışan route’larını `ProtectedRoute` ve `DashboardLayout` altında tanımlar.

```text
index.tsx
  → App.tsx
    → AuthProvider
      → ProtectedRoute
        → DashboardLayout
          → /clients      → features/clients/pages/ClientsPage.tsx
          → /clients/:id  → pages/ClientDetails.tsx
```

- Danışan listesi route’u: `/clients` (`App.tsx:45`).
- Aktif liste component’i: `features/clients/pages/ClientsPage.tsx` (`App.tsx:15,45`).
- Menü girişi: `shared/components/Sidebar.tsx:17-20`.
- Liste veri kaynağı: `fetchDietitianClients()` (`ClientsPage.tsx:206-226`; `clientService.ts:78-191`).
- Danışan detay route’u: `/clients/:id` (`App.tsx:46`).
- Route parametresi: `id` (`ClientDetails.tsx:18-20`).
- Aktif detay component’i: `pages/ClientDetails.tsx` (`App.tsx:17,46`).
- Detayın profil, ölçüm ve günlük kayıt okumaları servis üzerinden; Realtime abonelikleri doğrudan sayfa içinden yapılır (`ClientDetails.tsx:28-75`).

`ProtectedRoute.tsx:35-54` yalnız `allowed` durumda `<Outlet />` döndürür; client, eksik rol/profil ve erişim hatası durumları fail-closed ele alınır. Route guard, satır sahipliği yerine geçmez; veri izolasyonunun RLS ile devam etmesi gerekir.

## 5. Danışan veri modeli

Temel kimlik modeli migration ve aktif servis kodunda tutarlıdır:

| Alan | Rol | Statik kanıt |
|---|---|---|
| `profiles.id` | Temel kullanıcı/danışan UUID’si; `auth.users.id` ile aynı kimlik | Baseline `830-839`, FK `1246-1247` |
| `client_profiles.user_id` | `profiles.id` ile birebir danışan profil anahtarı | Baseline `584-624`, PK `924-925`, FK `1191-1192` |
| `dietitian_clients.client_id` | İlişkinin danışan tarafı; `profiles.id` | Baseline `672-684`, FK `1201-1202` |
| `dietitian_clients.dietitian_id` | İlişkinin diyetisyen tarafı; `profiles.id` | Baseline `672-684`, FK `1206-1207` |
| `measurements.client_id` | Ölçüm sahibinin `profiles.id` UUID’si | Baseline `762-778`, FK `1241-1242` |
| `daily_logs.client_id` | Günlük kaydın danışan UUID’si | Baseline `658-666`, FK `1196-1197` |

Aktif `Client.id`, liste sorgusundaki `profiles.id` değerinden üretilir (`clientService.ts:83-122,154-155`) ve detay route’una taşınır (`ClientsPage.tsx:12-14,100-102`). UI sıra numarası veya array index’i aktif liste/detay kimliği olarak kullanılmıyor.

## 6. Diyetisyen–danışan sahiplik modeli

### Uygulama sorguları

- Liste, authenticated kullanıcının UUID’sini alır ve açıkça `.eq('dietitian_id', user.id)` uygular (`clientService.ts:80-122`).
- Liste yalnız `active` ve `pending` ilişkileri ister (`clientService.ts:121-122`).
- Detay ilişkisi `dietitian_id` ve `client_id` ile sınırlandırılır (`clientService.ts:230-236`) ancak `status = active` şartı yoktur.
- Ölçüm ve günlük kayıt sorguları yalnız `client_id` ile filtrelenir (`clientService.ts:344-379`); uygulama sorgusunda diyetisyen ilişkisi tekrar doğrulanmaz.

### Statik RLS/constraint kanıtı

- `dietitian_clients` üzerinde diyetisyen–danışan çifti unique’tir (`baseline:1009`).
- Bir danışan için aynı anda en fazla bir `pending` veya `active` ilişkiyi hedefleyen partial unique index vardır (`baseline:1081-1085`).
- `client_profiles` ve `measurements` diyetisyen SELECT policy’leri yalnız aktif ilişkiye izin verir (`baseline:1347-1367`).
- `dietitian_clients_select_own`, yalnız ilişkinin diyetisyen veya danışan tarafının satırı görmesini sağlar (`baseline:1479`).
- `profiles` için “linking” policy’si, authenticated diyetisyenlerin client rolündeki profil satırlarını görmesine izin verir (`baseline:1371`). Bu geniş temel profil görünürlüğü, ilişki kontrolü zayıf bir uygulama yolunda PII yüzeyini büyütebilir.
- `daily_logs` için baseline’da diyetisyenin aktif ilişkili danışanı okumasına izin veren ayrı SELECT policy görülmedi; yalnız kullanıcının kendi satırını görmesine izin veren policy vardır (`baseline:1435`). Bu nedenle webde diyetisyen günlük kayıt sorgusunun güvenli biçimde sıfır satıra düşmesi beklenir; canlı sonuç bu görevde sorgulanmadı.

## 7. Danışan listesi bulguları

### CL-01 — Sahiplik filtresi mevcut

- Dosya/fonksiyon: `features/clients/services/clientService.ts`, `fetchDietitianClients`, satır `78-191`.
- Gözlenen davranış: Liste hem `dietitian_id = auth user` filtresi hem RLS arkasında çalışır.
- Risk: Düşük.
- Öneri: Filtre ve RLS birlikte korunmalı; regresyon testi eklenmeli.

### CL-02 — Pending kayıtlar aktif kayıtlardan görsel olarak ayrılıyor

- Dosya/component: `features/clients/pages/ClientsPage.tsx`, satır `273-280`, `380-423`, `426-464`.
- Gözlenen davranış: Pending kayıtlar “Onay Bekleyenler” bölümünde gösterilir; active listeye karışmaz. Rejected/removed sorgulanmadığı için “Pasif Danışanlar” bölümü aktif servis sonucunda pratikte beslenmez.
- Risk: Orta; UI’da pasif bölüm var fakat servis sözleşmesi bu durumu üretmiyor.
- Öneri: Aşama 4 ürün kararıyla rejected/removed görünürlüğü netleştirilmeli; görünmeyecekse ölü pasif UI kaldırılması ayrı kapsamda ele alınmalı.

### CL-03 — Liste sorgu hatası boş liste gibi gösteriliyor

- Dosya/component: `ClientsPage.tsx`, `loadClients`, satır `206-220`; empty state `350-362`.
- Gözlenen davranış: Servis hatası catch edilir, `clients=[]` yapılır ve kullanıcı “Henüz danışanınız yok” mesajı görür.
- Risk: Yüksek; erişim/network/şema hatası sahte boş durum üretir.
- Öneri: `loading/error/empty/success` durumlarını ayıran typed sonuç modeli.

### CL-04 — Sabit metrikler gerçek veri gibi sunuluyor

- Dosya/fonksiyon: `clientService.ts:154-178`.
- Gözlenen davranış: `duration='1 Ay'`, `weeklyChange=0`, eksik hedef için `Sağlıklı Yaşam` ve eksik uyum için `0` kullanılır.
- Risk: Orta/yüksek; gerçek danışan listesinde doğrulanmamış değerler üretir.
- Öneri: Bilinmeyen değerleri `null`/“—” olarak modellemek; hesaplanacak metrikleri gerçek kaynakla bağlamak.

### CL-05 — Bazı aksiyonlar yalnız görsel

- Dosya/component: `ClientsPage.tsx:79-90,178-188,342-345`.
- Gözlenen davranış: Mesaj, göz, daha fazla, dışa aktar ve filtre butonlarının hedef handler’ı yoktur.
- Risk: Orta; kullanıcıda çalışan işlem izlenimi doğurur.
- Öneri: Özellik kapsamı netleşene kadar disabled/etiketli durum veya ilgili aşamada gerçek handler.

## 8. Danışan detay ekranı bulguları

### CD-01 — Route UUID’si sorgu öncesinde doğrulanmıyor

- Dosya/component: `pages/ClientDetails.tsx:18-35`; servis `clientService.ts:225-276`.
- Gözlenen davranış: `:id` doğrudan ilişki, profil, ölçüm ve günlük kayıt sorgularına gönderilir.
- Risk: Yüksek; geçersiz UUID teknik DB hatasına ulaşır ve üç paralel isteği/realtime filtresini etkiler.
- Öneri: Sayfa girişinde `isValidUuid(id)` fail-fast; servis fonksiyonlarında savunma katmanı.

### CD-02 — Detay ilişki kontrolü active ile sınırlandırılmıyor

- Dosya/fonksiyon: `clientService.ts`, `fetchClientDetails`, satır `230-242`.
- Gözlenen davranış: İlişkinin varlığı yeterli; `pending`, `rejected` veya `removed` durumları da relation gate’i geçer. Pending için ayrı kısıtlı ekran vardır (`ClientDetails.tsx:117-177`), ancak rejected/removed kayıt `Pasif` eşlemesiyle ana detay akışına girebilir.
- Risk: Yüksek; temel profil policy’sinin geniş linking görünürlüğüyle birleşince artık aktif olmayan ilişkinin temel PII’si gösterilebilir. Sağlık tabloları aktif ilişki RLS’siyle ayrıca korunur.
- Öneri: Ana detay erişimini yalnız `active` ilişkiye açmak; pending için yalnız gerekli minimum ilişki/profil projeksiyonuna sahip ayrı servis sonucu; rejected/removed fail-closed.

### CD-03 — Alt sorgular yetki kararıyla yarışıyor

- Dosya/component: `ClientDetails.tsx:28-38`.
- Gözlenen davranış: Profil ilişki kontrolü, ölçümler ve günlük loglar `Promise.all` ile aynı anda başlar. İlişki yokluğu belirlenmeden hassas alt tablo sorguları gönderilir.
- Risk: Orta; RLS veri sızıntısını engellemelidir ancak uygulama katmanı gereksiz yetkisiz sorgu üretir.
- Öneri: Önce UUID ve aktif ilişki/profil gate’i; sonra yetkili alt kaynakların paralel yüklenmesi.

### CD-04 — Hata, yetkisiz erişim ve bulunamama ayrışmıyor

- Dosya/component: `ClientDetails.tsx:28-43,77-97`.
- Gözlenen davranış: Yükleme hatası yalnız console’a yazılır; `client=null` kaldığı için “Danışan Bulunamadı” gösterilir.
- Risk: Yüksek; güvenlik reddi, network hatası ve gerçek 404 aynı kullanıcı durumuna dönüşür.
- Öneri: `invalid_id`, `forbidden`, `not_found`, `load_error`, `success` durumlarını açık modellemek.

### CD-05 — Realtime erişimi sayfa seviyesinde

- Dosya/component: `ClientDetails.tsx:50-75`.
- Gözlenen davranış: `profiles`, `client_profiles`, `measurements` ve `daily_logs` değişiklikleri için doğrudan Supabase channel kurulur.
- Risk: Orta; UI, erişim ve subscription lifecycle aynı component’te birleşir. Geçersiz veya yetkisiz `id` filtreye girebilir.
- Öneri: Yetki gate’inden sonra çalışan dar bir subscription helper/service; tablo erişimi yine RLS ile korunmalı.

## 9. Profil ve yaşam tarzı bulguları

### Kaynak eşleme matrisi

| İstenen alan | Aktif web eşlemesi | Sonuç/risk |
|---|---|---|
| Ad | `profiles.full_name` | Doğru kaynak; eksikte `İsimsiz Danışan` fallback’i |
| Avatar | `profiles.avatar_url` | Doğru kaynak; URL/path ayrımı heuristik |
| Telefon | `profiles.phone` | Detayda doğru kaynak |
| `height_cm` | `client_profiles.height_cm` | Eşleniyor |
| `current_weight` | `client_profiles.current_weight` | Eşleniyor |
| `target_weight` | `client_profiles.target_weight` | Eşleniyor |
| `chronic_conditions` | Listede junction tabloları; detayda legacy `text[]` | Tutarsız iki kaynak |
| `medications` | Listede junction tabloları; detayda legacy `text[]` | Tutarsız iki kaynak |
| `food_intolerances` | Legacy `text[]` | Detayda eşleniyor |
| `disliked_foods` | Seçilmiyor ve `Client` tipinde yok | Eksik |
| `blood_type` | Listede `blood_type_id → blood_types.code`; detayda legacy `blood_type` | Tutarsız; detay deprecated alanı kullanıyor |
| `last_lab_date` | Legacy doğrudan alan | Eşleniyor |
| `daily_water_goal_ml` | Litreye çevriliyor | Eşleniyor |
| `sleep_hours` | Legacy tek değer | `sleep_hours_min/max` eşlenmiyor |
| `activity_level` | Legacy text | Baseline’da deprecated; normalize ID tablosu kullanılmıyor |
| `alcohol_status` | Seçilmiyor | Eksik |
| `alcohol_use` | Boolean kolon string label map ile işleniyor | Tip/eşleme hatası; UI’da değer kaybolabilir |
| `smoking_status` | Boolean kolon string label map ile işleniyor | Tip/eşleme hatası; UI’da değer kaybolabilir |
| `nutrition_type` | Seçilmiyor | Eksik; normalize ID tablosu da kullanılmıyor |
| `goal` | Legacy text | Baseline’da deprecated; `goal_id` lookup kullanılmıyor |

Statik kanıt: `clientService.ts:47-72,83-178,244-323`; baseline `584-654`.

### CP-01 — Liste ve detay farklı sağlık kaynaklarını kullanıyor

- Gözlenen davranış: Liste kronik durum/ilaç/kan grubunu junction/lookup ilişkilerinden; detay legacy array/text kolonlarından alır.
- Risk: Yüksek; aynı danışan iki ekranda farklı bilgi gösterebilir ve mobilin normalize alanları web detayında kaybolabilir.
- Öneri: Tek typed profil adapter’ı ve kanonik kaynak kararı; mobil uyumluluk onayı olmadan kolon kaldırmamak.

### CP-02 — Eksik profil satırı sahte varsayılanlarla dolduruluyor

- Dosya/fonksiyon: `clientService.ts:278-323`.
- Gözlenen davranış: `client_profiles` hatası warning’e çevrilir; null profil `{}` kabul edilir. Hedef `Sağlıklı Yaşam`, süre `1 Ay`, uyum `0`, ağırlık `-` ile bir danışan nesnesi döner. `profiles` satırı null olsa bile ilişki varsa fallback nesnesi üretilebilir.
- Risk: Yüksek; veri eksikliği ve erişim hatası gerçek profil gibi sunulur.
- Öneri: Eksik `profiles` satırını fail-closed; eksik `client_profiles` satırını açık “profil tamamlanmamış” durumu olarak modellemek.

### CP-03 — `any` veri şekli sorunlarını saklıyor

- Dosya/fonksiyon: `clientService.ts:134-149,187,196`.
- Gözlenen davranış: Nested join ve normalize akışında `any` kullanımı, boolean/string ve relation cardinality uyumsuzluklarını compile-time dışında bırakır.
- Risk: Orta/yüksek.
- Öneri: Supabase satır/projeksiyon tipleri ve açık adapter çıktısı.

## 10. Ölçüm akışı bulguları

- Okuma fonksiyonu: `fetchClientMeasurements()` (`clientService.ts:344-361`).
- Sorgu: `measurements`, `client_id = route id`, `measured_at ASC`.
- Statik RLS: diyetisyen yalnız aktif ilişkili danışan ölçümlerini okuyabilir (`baseline:1347-1349`); danışan kendi CRUD policy’lerine sahiptir (`1519-1531`).
- Web danışan detayında ölçüm ekleme veya silme akışı yoktur. `removeClient()` yalnız ilişkiyi kaldırır; ölçüm silmez.
- Sayfa doğrudan ölçüm sorgusu yapmaz; Realtime aboneliğini doğrudan kurar.
- Hata ve exception `[]` sonucuna çevrilir (`clientService.ts:352-360`). Böylece DB hatası boş geçmiş gibi görünür.
- Boş geçmiş, gerçek empty state yerine mevcut profil ağırlığından tek “Veri Yok” barı oluşturur (`ClientDetails.tsx:185-195`).
- Tarihler `new Date(...)`, ağırlıklar ise TypeScript’te `number` varsayımıyla işlenir; runtime sayı/tarih doğrulaması yoktur (`ClientDetails.tsx:185-199`).
- Aynı `client_id`/`measured_at` için unique index vardır (`baseline:1077`).

Risk seviyesi: Yüksek işlevsel doğruluk, orta güvenlik. Başka danışanın ölçümünü karıştırmayı RLS engellemelidir; uygulama katmanı aktif ilişki gate’inden sonra sorgulamalıdır.

## 11. Günlük kayıt bulguları

- Okuma fonksiyonu: `fetchClientDailyLogs()` (`clientService.ts:363-380`).
- Sorgu `daily_logs.client_id = route id` filtresi kullanır.
- Baseline’da diyetisyen için aktif ilişki tabanlı `daily_logs` SELECT policy görülmedi; yalnız client’ın kendi kaydını okuma policy’si var (`baseline:1435`). Bu statik bulgu, web günlük kayıt grafiğinin diyetisyen oturumunda veri alamayabileceğini gösterir.
- Hata ve RLS kaynaklı sıfır satır `[]` sonucuna çevrilir; UI hata/boş/yetkisiz durumunu ayırmaz.
- Yedi güne tamamlanan sıfır barlar gösterilir (`ClientDetails.tsx:201-217`). Kayıt yokken `0 / 0` sonucu fallback `1` olduğu için ortalama `1.0 Lt` gösterilebilir (`ClientDetails.tsx:219`); bu sahte metriktir.
- `daily_logs.client_id` FK’sinde `ON DELETE CASCADE` yoktur (`baseline:1196-1197`). Bu, önceki Aşama 3 cleanup bulgusuyla uyumlu referential cleanup riskidir.
- Günlük kayıtlarda ekleme/silme web akışı yoktur.

Risk seviyesi: Yüksek. Policy değişikliği düşünülürse ayrı migration, staging testi ve mobil uyumluluk değerlendirmesi gerekir.

## 12. Profil fotoğrafı ve Storage bulguları

- Kaynak alan gerçekten `profiles.avatar_url` (`clientService.ts:47-52,83-91,244-249`).
- `resolveProfilePhotoUrl()` http/https değerini doğrudan URL kabul eder; diğer değerleri `avatars` bucket path’i kabul edip `getPublicUrl()` çağırır (`clientService.ts:7-25`).
- Kod, bucket’ın public olmasını varsayar. Private bucket veya signed URL yenileme sözleşmesi yoktur. Storage path ile public URL ayrımı yalnız regex heuristiğidir.
- Detay ekranı resim yükleme hatasında initials fallback gösterir (`ClientDetails.tsx:9-16,237-246`); liste satırı/kartı için `onError` fallback’i yoktur (`ClientsPage.tsx:18,107`).
- Web danışan yönetiminde danışan avatar upload/update akışı bulunmadı. Bu nedenle upload başarısızken DB URL yazılması veya yetim dosya üretilmesi bu aktif akışta gözlenmedi.
- Yetkisiz avatar erişimi statik frontend koduyla kanıtlanamaz. `getPublicUrl()` kullanımı nedeniyle bucket public ise URL’yi bilen herkesin erişim riski vardır; Storage policy/bucket görünürlüğü ayrı salt-okunur denetimle doğrulanmalıdır.

Risk seviyesi: Orta/yüksek; canlı bucket görünürlüğü bu görevde doğrulanmadı.

## 13. Doğrudan sayfa seviyesindeki Supabase erişimleri

| Dosya | Doğrudan erişim | Değerlendirme |
|---|---|---|
| `features/clients/pages/ClientsPage.tsx` | Yok | Liste ve ilişkilendirme servis katmanında |
| `pages/ClientDetails.tsx` | Realtime channel/subscribe/removeChannel | Service/helper katmanına taşınmalı; UUID ve aktif ilişki gate’inden sonra kurulmalı |
| `pages/MealPlans.tsx` | `meal-photos` upload ve `getPublicUrl` | Danışan listeleme servis üzerinden; Storage erişimi sayfa içinde ve Aşama 5/Storage kapsamını etkiliyor |

`ClientDetails` profil/ölçüm/günlük SELECT’leri servistedir. Ancak servis fonksiyonları farklı hata sözleşmeleri kullanır: detay hata fırlatırken ölçüm/log hataları boş array’e çevrilir.

Teknik Supabase hata nesnesi genel olarak console’a yazılır. `addClientByEmail()` profil arama hatasında `profileError.message` değerini servis sonucuna koyar (`clientService.ts:404-410`); `ClientsPage.tsx:262-264` bunu kullanıcıya gösterebilir. Teknik hata doğrudan kullanıcı mesajına sızabilir.

## 14. Mock, fallback ve sahte başarı bulguları

| Bulgu | Konum | Sınıf | Etki |
|---|---|---|---|
| `duration='1 Ay'` | `clientService.ts:163,306` | Production akışını etkiliyor | Gerçek süre gibi gösteriliyor |
| `weeklyChange=0` | `clientService.ts:167,310` | Production akışını etkiliyor | Gerçek haftalık değişim gibi gösteriliyor |
| Eksik hedef → `Sağlıklı Yaşam` | `clientService.ts:161,304` | Production akışını etkiliyor | Bilinmeyen veri sahte değerle doluyor |
| Ölçüm yok → profil kilosundan “Veri Yok” barı | `ClientDetails.tsx:185-195` | Production akışını etkiliyor | Gerçek ölçüm geçmişi izlenimi verebilir |
| Günlük kayıt yok → `1.0 Lt` ortalama | `ClientDetails.tsx:201-219` | Production akışını etkiliyor | Sahte su tüketim metriği |
| `CLIENT_DETAILS['1'/'2'/default]` | `MealPlans.tsx:42-63,354,649,976-1002` | Production akışını etkiliyor | Gerçek UUID’ler default sabit not/tercih alır; “Standart beslenme düzeni.” plan notuna kaydedilebilir |
| Görsel fakat handlersız butonlar | `ClientsPage.tsx:79-90,342-345` | Production akışını etkiliyor | Çalışan işlem izlenimi |
| `services/api.ts` | Kök legacy servis | Kullanılmayan veya aktifliği belirsiz | Hata durumunu `[]` yapar; aktif import bulunmadı |
| `src/services/api.ts`, `src/pages/Clients.tsx` | Alternatif `src` zinciri | Kullanılmayan veya aktifliği belirsiz | Eski client liste akışı; `App.tsx` tarafından import edilmiyor |
| Root `types.ts` / `shared/types.ts` ayrışması | Birden çok aktif sayfa | Aşama 4 ve repository cleanup sınırında | Client tipi farklı route’larda farklı sözleşme taşır |

### Sahte başarı riski

`addClientByEmail()` rejected/removed mevcut ilişkiyi `pending` yapmaya çalışır (`clientService.ts:435-452`). Statik baseline policy’si diyetisyenin yalnız `pending/active → removed` güncellemesine izin verir (`baseline:1491`); rejected/removed → pending yolu için uygun policy görülmedi. Update `.select()` veya etkilenen satır doğrulaması yapmadığı için RLS’nin `0 satır + error yok` davranışı success sonucuna dönüşebilir. Bu, staging entegrasyon testiyle kesinleştirilmelidir.

`removeClient()` da etkilenen satırı doğrulamadan boolean success döndürür (`clientService.ts:484-503`); stale/0-row update başarı sayılabilir.

## 15. UUID ve kimlik eşleme riskleri

- UUID doğrulayıcı `shared/utils/uuid.ts:1-6` içinde mevcuttur.
- Liste sonucu `profiles.id` için UUID filtrelemesi yapar (`clientService.ts:181-186`).
- MealPlans navigation/localStorage client kimliği UUID ve mevcut liste üyeliğiyle doğrulanır (`MealPlans.tsx:146-196`).
- `/clients/:id`, `fetchClientDetails`, `fetchClientMeasurements`, `fetchClientDailyLogs` ve `removeClient` girişlerinde UUID doğrulaması yoktur.
- Geçersiz route id, Supabase sorgularına ve Realtime filtrelerine ulaşabilir.
- Aktif danışan listesi/detayında `String(index + 1)` veya sabit `"1"` kimlik fallback’i bulunmadı.
- `MealPlans.tsx` içindeki sabit `CLIENT_DETAILS` anahtarları `"1"` ve `"2"` gerçek UUID’lerle eşleşmez; gerçek danışanlar `default` sahte veriye düşer.
- Nested Supabase join’lerinin `any` ile map edilmesi kimlik ve cardinality sözleşmesini zayıflatır.

## 16. Yetkisiz erişim riskleri

1. Başka diyetisyenin client UUID’si detay route’una yazıldığında ilişki sorgusu `dietitian_id=current user` nedeniyle null dönmelidir; profil sorgusu relation gate’inden sonra olduğu için çalışmaz. Ölçüm/log sorguları ise aynı anda gönderilir ve güvenlik tamamen RLS’ye dayanır.
2. Aynı diyetisyenin `pending`, `rejected` veya `removed` ilişkisinde detail relation gate’i geçilebilir. Pending kısıtlı UI alır; rejected/removed için açık fail-closed gate yoktur.
3. `profiles` linking SELECT policy’si tüm client rolündeki profil satırlarına geniş görünürlük verir. Bu policy Aşama 4’te email aramayla ilişkilendirme tasarımına bağlıdır ve PII minimizasyonu açısından ayrıca değerlendirilmelidir.
4. Ölçüm RLS’si aktif ilişki ister; günlük log için diyetisyen SELECT policy’si statik zincirde görünmez.
5. Frontend route guard yalnız dietitian web erişimini doğrular; tenant izolasyonu RLS ve ilişki filtresinin birlikte çalışmasına bağlıdır.

## 17. Mobil veri modeli uyumluluğu

- Web, temel UUID ve `profiles`/`client_profiles`/`dietitian_clients` ilişkisinde mobil ile aynı model üzerindedir.
- Baseline yorumları `goal`, `blood_type`, `activity_level`, `alcohol_status` text alanlarını deprecated; `*_id` lookup alanlarını hedef olarak tanımlar (`baseline:630-654`). Web detay servisi hâlâ legacy alanları kullanır.
- Web, `nutrition_type(_id)`, `disliked_foods`, `sleep_hours_min/max`, `goal_id`, `activity_level_id`, `alcohol_status_id` alanlarını tam eşlemez.
- `smoking_status` ve `alcohol_use` baseline’da boolean iken web adapter’ı string label bekler; mobilde kaydedilen doğru boolean değerler webde görünmeyebilir.
- Kronik durum ve ilaçlar liste/detail arasında normalize junction ve legacy array kaynaklarına bölünmüştür.
- `daily_logs.client_id` cascade eksikliği mobilin ürettiği günlük kayıtlarla cleanup/silme süreçlerini etkileyebilir.
- Bu denetimde mobil repository açılmadı veya değiştirilmedi; mobilde hangi kanonik alanların güncel olarak yazıldığı, Aşama 4 profil adapter değişikliği öncesi ayrı sözleşme testiyle doğrulanmalıdır.

## 18. Production mutation gerektiren testler

Aşağıdaki testler production üzerinde yürütülecekse **AÇIK KULLANICI ONAYI GEREKİR**:

- Danışan email’iyle yeni `dietitian_clients` pending isteği oluşturma.
- Rejected/removed ilişkiyi yeniden pending yapma ve etkilenen satırı doğrulama.
- Danışan bağlantısını `removed` durumuna getirme.
- Ölçüm ekleme, güncelleme veya silme; yenileme sonrası kalıcılık doğrulaması.
- Günlük kayıt oluşturma/güncelleme/silme ve web görünürlüğü testi.
- Profil/yaşam tarzı alanlarını mobil veya web üzerinden değiştirme.
- Avatar upload/update/delete ve yetim dosya telafi testi.
- Test kullanıcısı, ilişki, ölçüm, günlük kayıt veya Storage fixture’ı oluşturma/temizleme.

Önerilen yaklaşım, bu mutasyon testlerini production yerine izole staging ve sentetik fixture’larla yapmaktır. Fixture oluşturulması bu görevde yapılmadı.

## 19. Negatif test matrisi

| Alan | Senaryo | Beklenen | Tür/izin |
|---|---|---|---|
| Liste | Diyetisyen A yalnız kendi active ilişkilerini görür | Yalnız A tenant verisi | Staging read-only fixture sorgusu |
| Liste | Diyetisyen A, B’nin danışanını göremez | 0 satır | Staging read-only fixture sorgusu |
| Liste | Pending active bölümüne karışmaz | Ayrı pending bölüm | UI testi |
| Liste | Rejected/removed active görünmez | Active listede yok | UI/service testi |
| Liste | Gerçek boş liste | Açık empty state | UI testi |
| Liste | Sorgu hatası | Error state; sahte empty yok | Unit/integration hata enjeksiyonu |
| Liste | Arama/filtre | Yalnız yüklenmiş tenant verisi | UI testi |
| Detay | A kendi active danışanını açar | Profil ve yetkili alt veriler görünür | Staging read-only |
| Detay | A, B’nin UUID’sini URL’ye yazar | Forbidden/not found; veri yok | Staging read-only |
| Detay | Geçersiz UUID | Network/DB isteğinden önce reddedilir | Unit/UI testi |
| Detay | İlişki yok | Fail-closed | Staging read-only |
| Detay | Pending ilişki | Yalnız minimum pending ekranı | Staging read-only |
| Detay | Rejected/removed ilişki | Ana detay reddedilir | Staging read-only |
| Detay | Client rolü route’u açar | Auth katmanında reddedilir ve sign-out | Auth UI testi |
| Detay | Profil/ilişki sorgusu hata verir | Erişim izni sayılmaz | Hata enjeksiyonu |
| Profil | Mobil alanlar webde eşlenir | Kanonik lookup/array değerleri aynı | Staging sözleşme testi |
| Profil | `client_profiles` eksik | Açık tamamlanmamış profil durumu | Staging fixture gerekir |
| Profil | Başka danışanın sağlık verisi | 0 satır | Staging read-only |
| Profil | Boş alanlar | “—”/empty; sahte değer yok | Unit/UI testi |
| Profil | Teknik Supabase hatası | Güvenli Türkçe mesaj | Hata enjeksiyonu |
| Ölçüm | Doğru danışana kayıt | Kalıcı ve yenilemede görünür | **AÇIK KULLANICI ONAYI GEREKİR** production’da; staging önerilir |
| Ölçüm | Başka danışana yazma | Reddedilir; satır değişmez | Staging mutation fixture |
| Ölçüm | Geçersiz değer | Client/DB validation reddi | Staging mutation fixture |
| Ölçüm | DB hatası | Başarı/empty gösterilmez | Hata enjeksiyonu |
| Ölçüm | Yetkisiz okuma | 0 satır | Staging read-only |
| Ölçüm | Boş geçmiş | Gerçek empty state | UI testi |
| Günlük | Yalnız ilgili danışanın logları | Aktif ilişkiyle doğru satırlar | Policy sonrası staging read-only |
| Günlük | Başka danışanın logu | 0 satır | Staging read-only |
| Günlük | Boş log | `0`/empty; sahte `1.0 Lt` yok | Unit/UI testi |
| Günlük | Sorgu hatası | Error state; sahte grafik yok | Hata enjeksiyonu |
| Avatar | Doğru avatar | Doğru kullanıcı URL’si | Read-only UI testi |
| Avatar | Eksik/bozuk avatar | Kontrollü initials/generic fallback | UI testi |
| Avatar | Private Storage path | Signed/authenticated çözüm; doğrudan path yok | Staging Storage testi |
| Avatar | Yetkisiz URL | Erişim reddi | Staging Storage policy testi |
| Avatar | Upload hatası | DB URL yazılmaz, yetim dosya yok | **AÇIK KULLANICI ONAYI GEREKİR** production’da; staging önerilir |

## 20. Önerilen Aşama 4 iş paketleri

### İş Paketi 4.1 — UUID ve aktif ilişki erişim kapısı

- **Amaç:** Detay route’unu geçersiz kimlik ve active olmayan ilişkiye karşı fail-closed yapmak.
- **Kapsam:** Route UUID doğrulama; typed detail access sonucu; önce ilişki, sonra alt kaynak yükleme; pending minimum görünüm; rejected/removed reddi.
- **Kapsam dışı:** Profil alan eşleme, migration, UI tasarım yenilemesi.
- **Değişmesi beklenen dosyalar:** `pages/ClientDetails.tsx`, `features/clients/services/clientService.ts`, gerekirse `shared/types.ts`; test dosyaları.
- **Supabase etkisi:** Sorgular daralır; uzakta şema değişmez.
- **Production yazması:** Hayır.
- **Migration:** Hayır.
- **Mobil uyumluluk:** Veri modeli değişmez.
- **Risk seviyesi:** Yüksek güvenlik önceliği, düşük/orta uygulama riski.
- **Kabul kriterleri:** Geçersiz UUID DB’ye ulaşmaz; yalnız active ilişki tam detaya erişir; alt sorgular gate sonrasında çalışır; durumlar ayrışır.
- **Manuel testler:** Kendi active/pending/rejected/removed danışanı; ilişkisiz ve geçersiz UUID.
- **Otomatik test fırsatları:** UUID unit testi; service call-order ve durum reducer testleri.
- **Önerilen commit sınırı:** Yalnız detail authorization ve ID validation.
- **Bağımlılık:** Yok; ilk iş paketi.

### İş Paketi 4.2 — Liste hata ve ilişki durum sözleşmesi

- **Amaç:** Gerçek empty ile sorgu hatasını ayırmak; active/pending görünürlüğünü açık sözleşmeye bağlamak.
- **Kapsam:** Typed load state; güvenli hata mesajı; passive UI ürün kararı; teknik hata sızıntısının kaldırılması.
- **Kapsam dışı:** Yeni ilişki mutasyonu ve mock temizliği.
- **Değişmesi beklenen dosyalar:** `ClientsPage.tsx`, `clientService.ts`, `shared/types.ts`; testler.
- **Supabase etkisi:** Okuma sorgusu sözleşmesi netleşir.
- **Production yazması:** Hayır.
- **Migration:** Hayır.
- **Mobil uyumluluk:** Yok.
- **Risk seviyesi:** Orta.
- **Kabul kriterleri:** Error/empty ayrı; pending active’e karışmaz; rejected/removed kararı UI ile uyumlu.
- **Manuel testler:** Empty, network error, active+pending, arama sonucu yok.
- **Otomatik test fırsatları:** Adapter ve component state testleri.
- **Önerilen commit sınırı:** Liste yükleme ve durum modeli.
- **Bağımlılık:** 4.1 ile paralel yapılabilir; ortak tip çakışması koordine edilmeli.

### İş Paketi 4.3 — İlişkilendirme mutation postcondition’ları

- **Amaç:** Add/reactivate/remove işlemlerinde 0-row güncellemenin başarı sayılmasını engellemek.
- **Kapsam:** Etkilenen satır/status doğrulaması; rejected/removed yeniden istek ürün/policy kararı; güvenli kullanıcı mesajları.
- **Kapsam dışı:** Production’da gerçek ilişki oluşturma; geniş RLS yeniden tasarımı.
- **Değişmesi beklenen dosyalar:** `clientService.ts`, `ClientsPage.tsx`; testler. Policy değişecekse ayrı migration görevi.
- **Supabase etkisi:** Update/insert sonuçları doğrulanır; olası policy gap’i açığa çıkar.
- **Production yazması:** Uygulama davranışı yazma içerir; production entegrasyon testi için **AÇIK KULLANICI ONAYI GEREKİR**.
- **Migration:** Karara bağlı; rejected/removed → pending desteklenirse muhtemelen evet.
- **Mobil uyumluluk:** İlişki durum makinesi ortak olduğundan yüksek önem.
- **Risk seviyesi:** Yüksek.
- **Kabul kriterleri:** Success yalnız satır gerçekten beklenen statüye geldiğinde; duplicate ve RLS 0-row açık hata.
- **Manuel testler:** Yeni istek, duplicate, active, pending, rejected, removed, başka diyetisyene bağlı client.
- **Otomatik test fırsatları:** Supabase response adapter unit testleri; staging integration.
- **Önerilen commit sınırı:** Mutation postcondition ve hata sözleşmesi; migration ayrı commit/görev.
- **Bağımlılık:** 4.2.

### İş Paketi 4.4 — Kanonik profil adapter’ı ve mobil alan eşlemesi

- **Amaç:** Liste ve detayın aynı kanonik profil kaynaklarını kullanması.
- **Kapsam:** Typed Supabase projection; lookup/junction alanları; boolean durumlar; null semantiği; eksik profil durumu.
- **Kapsam dışı:** Legacy kolon silme, mobil kod değişikliği, geniş UI tasarımı.
- **Değişmesi beklenen dosyalar:** `clientService.ts`, `shared/types.ts`, `ClientsPage.tsx`, `ClientDetails.tsx`; adapter testleri.
- **Supabase etkisi:** SELECT projeksiyonları değişir.
- **Production yazması:** Hayır.
- **Migration:** Hayır; mevcut kanonik alanlar yeterliyse.
- **Mobil uyumluluk:** Yüksek; mobilin yazdığı kanonik alanlar önce doğrulanmalı.
- **Risk seviyesi:** Yüksek veri doğruluğu.
- **Kabul kriterleri:** İki ekran aynı sağlık/veri kaynağını gösterir; boolean/string uyumsuzluğu yok; eksik alan sahte değer olmaz.
- **Manuel testler:** Tam, kısmi ve eksik profil; lookup/array/boolean alanlar.
- **Otomatik test fırsatları:** Projection fixture ve adapter unit testleri.
- **Önerilen commit sınırı:** Yalnız profil sorgusu/adapter/UI null gösterimi.
- **Bağımlılık:** 4.1.

### İş Paketi 4.5 — Ölçüm ve günlük kayıt okuma doğruluğu

- **Amaç:** Hata/empty ayrımını, normalize tarih/sayıları ve gerçek grafikleri sağlamak.
- **Kapsam:** Typed read sonuçları; gerçek empty state; sahte `1.0 Lt` ve fallback barın kaldırılması; active ilişki sonrası yükleme.
- **Kapsam dışı:** Ölçüm yazma UI’si; policy migration’ı.
- **Değişmesi beklenen dosyalar:** `clientService.ts`, `ClientDetails.tsx`, `shared/types.ts`; testler.
- **Supabase etkisi:** Salt okunur sorgu ve sonuç modeli.
- **Production yazması:** Hayır.
- **Migration:** Hayır.
- **Mobil uyumluluk:** Ölçüm/log kolon sözleşmesi ortak; normalize format korunmalı.
- **Risk seviyesi:** Orta/yüksek.
- **Kabul kriterleri:** Error empty olmaz; kayıt yokken sahte metrik yok; invalid değer kontrollü.
- **Manuel testler:** 0/1/8+ ölçüm, 0/1/7+ log, hatalı tarih/sayı fixture’ı.
- **Otomatik test fırsatları:** Chart adapter unit testleri.
- **Önerilen commit sınırı:** Read model ve grafik empty/error durumları.
- **Bağımlılık:** 4.1 ve 4.4.

### İş Paketi 4.6 — `daily_logs` diyetisyen erişim policy kararı

- **Amaç:** Aktif diyetisyenin yalnız bağlı danışanın günlük kayıtlarını okuyabilmesini sağlamak veya özelliği webden kaldırmak.
- **Kapsam:** Canlı/staging policy envanteri; aktif ilişki tabanlı SELECT policy taslağı; negatif tenant testleri; FK cleanup kararının belgelenmesi.
- **Kapsam dışı:** Production uygulama; client mutation policy’lerinin genişletilmesi.
- **Değişmesi beklenen dosyalar:** Ayrı migration ve doğrulama/runbook belgeleri; uygulama dosyaları 4.5 sonrasında.
- **Supabase etkisi:** RLS policy değişikliği olası.
- **Production yazması:** Migration uygulaması için **AÇIK KULLANICI ONAYI GEREKİR**.
- **Migration:** Evet, özellik korunacaksa.
- **Mobil uyumluluk:** Yüksek; client own policy korunmalı, aktif ilişki dışında okuma açılmamalı.
- **Risk seviyesi:** Yüksek güvenlik.
- **Kabul kriterleri:** A kendi active client logunu görür; B göremez; pending/rejected/removed göremez; client kendi logunu kullanmaya devam eder.
- **Manuel testler:** İki diyetisyen, active/pending/ilişkisiz client matrisi.
- **Otomatik test fırsatları:** Disposable local RLS ve staging harness.
- **Önerilen commit sınırı:** Migration+verification; production rollout ayrı onaylı görev.
- **Bağımlılık:** 4.1; canlı salt-okunur policy doğrulaması.

### İş Paketi 4.7 — Avatar URL ve Storage sözleşmesi

- **Amaç:** Path/public/signed URL davranışını ve hata fallback’ini açıklaştırmak.
- **Kapsam:** Typed avatar resolver; liste/detail onError; bucket görünürlük kararı; yetkisiz erişim testi planı.
- **Kapsam dışı:** Yeni upload UI; production Storage mutasyonu.
- **Değişmesi beklenen dosyalar:** `clientService.ts`, `ClientsPage.tsx`, `ClientDetails.tsx`; gerekirse ayrı Storage policy migration/runbook.
- **Supabase etkisi:** Salt okunur URL çözümleme; policy kararı ayrı.
- **Production yazması:** Hayır; upload testi için açık onay gerekir.
- **Migration:** Yalnız bucket/policy sözleşmesi değişirse.
- **Mobil uyumluluk:** Avatar storage formatı ortak olduğundan yüksek.
- **Risk seviyesi:** Orta/yüksek.
- **Kabul kriterleri:** Path URL olarak kullanılmaz; private/public sözleşme açık; bozuk resim kontrollü fallback.
- **Manuel testler:** Null, public URL, path, expired signed URL, 403/404.
- **Otomatik test fırsatları:** Resolver unit testleri.
- **Önerilen commit sınırı:** Resolver ve UI fallback; policy ayrı görev.
- **Bağımlılık:** 4.4 ve Storage salt-okunur doğrulaması.

### İş Paketi 4.8 — Cross-stage mock ve tüketici sözleşmesi kaydı

- **Amaç:** Danışan verisini kullanan diğer aktif route’larda sahte/farklı sözleşmeleri production’dan ayırmak.
- **Kapsam:** `MealPlans.tsx` sabit `CLIENT_DETAILS` notunun DB’ye yazılmasını engelleme kararı; root/shared Client type tüketicilerinin envanteri.
- **Kapsam dışı:** Genel mock temizliği, tarifler ve tüm repository mimari sadeleştirmesi.
- **Değişmesi beklenen dosyalar:** Aşama 5 veya Aşama 9’da `MealPlans.tsx`/meal plan service; repository cleanup aşamasında legacy dosyalar.
- **Supabase etkisi:** Sahte notun yeni plan kayıtlarına taşınması engellenir.
- **Production yazması:** Kod doğrulaması için hayır; gerçek plan kaydı testi için açık onay gerekir.
- **Migration:** Hayır.
- **Mobil uyumluluk:** Plan notu mobilde görünüyorsa doğrudan etkili.
- **Risk seviyesi:** Yüksek veri doğruluğu.
- **Kabul kriterleri:** Gerçek UUID default mock sağlık/not verisine düşmez; DB’ye yalnız kullanıcı tarafından sağlanan gerçek not gider.
- **Manuel testler:** Gerçek UUID ile plan ekranı ve kaydetme payload’ı.
- **Otomatik test fırsatları:** Payload builder unit testi.
- **Önerilen commit sınırı:** Meal plan mock-not guard; Aşama 4 kod commit’ine karıştırılmamalı.
- **Bağımlılık:** Aşama 4.4 veri sözleşmesi; uygulama Aşama 5/Aşama 9 kararı.

## 21. Önceliklendirme

1. **P0/P1:** 4.1 UUID ve active ilişki kapısı.
2. **P1:** 4.2 liste error/empty ayrımı ve 4.3 mutation postcondition’ları.
3. **P1:** 4.4 kanonik profil adapter’ı; boolean/lookup/legacy ayrışması.
4. **P1:** 4.6 `daily_logs` RLS ürün/policy kararı.
5. **P2:** 4.5 ölçüm/log grafik doğruluğu.
6. **P2:** 4.7 avatar/Storage sözleşmesi.
7. **Cross-stage P1:** 4.8 MealPlans sabit client notunun production kaydına girmesinin engellenmesi.

## 22. Kabul kriterleri

Aşama 4 tamamlanmadan önce:

- Geçersiz UUID hiçbir client-detail Supabase isteğine ulaşmamalı.
- Tam detay yalnız authenticated, approved diyetisyenin kendi `active` ilişkili danışanı için açılmalı.
- Pending yalnız minimum bekleme görünümü; rejected/removed/ilişkisiz durumlar fail-closed olmalı.
- Liste, detay, ölçüm ve günlük kayıt akışlarında error/empty/not-found/forbidden ayrılmalı.
- Liste ve detay aynı kanonik profil alanlarını kullanmalı; mobilde yazılan alanlar webde kaybolmamalı.
- Eksik veriler `1 Ay`, `Sağlıklı Yaşam`, `1.0 Lt` gibi sahte değerlerle doldurulmamalı.
- Başarılı ilişki mutasyonu, beklenen DB satırı/status postcondition’ıyla kanıtlanmalı.
- Ölçüm ve günlük kayıtlar yalnız active ilişkili danışana ait olmalı; cross-tenant testler geçmeli.
- Avatar path/URL sözleşmesi ve Storage yetkisi açık olmalı.
- Teknik Supabase hatası kullanıcıya doğrudan gösterilmemeli.
- Typecheck, lint, ilgili testler ve production build değişiklik görevlerinde çalıştırılmalı.

## 23. Açık sorular

1. Rejected/removed ilişkiler danışan listesinde tarihsel/pasif olarak görünmeli mi, yoksa tamamen gizlenmeli mi?
2. Rejected/removed ilişki için aynı diyetisyen yeniden pending istek gönderebilmeli mi? Mevcut statik RLS bunu desteklemiyor görünüyor.
3. Kanonik profil kaynakları mobilde tam olarak `*_id` lookup/junction alanlarına geçti mi?
4. `daily_logs` verisinin diyetisyen web panelinde görünmesi ürün gereksinimi mi? Evetse active ilişki SELECT policy’si gerekir.
5. `avatars` bucket public mi, private mı? `avatar_url` kolonunda path mi, public URL mi, signed URL mi saklanması kanonik sözleşmedir?
6. Ölçüm ekleme/silme web Aşama 4 MVP kapsamına gerçekten dahil mi? Mevcut UI yalnız okumaktadır.
7. `CLIENT_DETAILS.default.notes` değerinin production plan kaydına girmesi daha önce gerçek kayıtlarda oluştu mu? Bu görevde production sorgulanmadı.
8. `profiles` linking policy’sinin tüm client profillerini diyetisyene görünür kılması gerekli mi, yoksa güvenli RPC/email lookup ile daraltılmalı mı?

## 24. Kalan riskler

- Bu rapor statik repository denetimidir; canlı production/staging policy ve Storage bucket görünürlüğü yeniden sorgulanmadı.
- Detay service relation gate’i active değildir.
- Geçersiz route UUID DB/Realtime katmanına ulaşabilir.
- Günlük kayıt diyetisyen SELECT policy’si statik migration zincirinde görünmüyor.
- Profil kanonik/legacy alanları ve boolean/string tipleri ayrışmıştır.
- Hatalar boş veri veya bulunamadı olarak gösterilebilir.
- İlişki update’lerinde 0-row sonucu success olabilir.
- MealPlans gerçek UUID’ler için sabit default danışan notunu kullanır ve kaydetme payload’ına katabilir.
- Avatar erişim modeli `getPublicUrl()` varsayımına bağlıdır.
- Kök `types.ts`, `services/api.ts` ve `src/` alternatifleri veri sözleşmesi drift’i yaratır; bu kickoff görevinde silinmedi.

## 25. Önerilen ilk uygulama görevi

**İş Paketi 4.1 — UUID ve aktif ilişki erişim kapısı** ilk uygulama görevi olmalıdır.

Dar kapsam:

1. `/clients/:id` parametresini `isValidUuid` ile Supabase çağrısından önce doğrula.
2. `fetchClientDetails` sonucunu `active`, `pending`, `forbidden/not_found`, `error` olarak typed ayır.
3. Tam profil/ölçüm/log sorgularını yalnız doğrulanmış `active` ilişkiden sonra başlat.
4. Pending görünümünü minimum veriyle koru; rejected/removed ve ilişkisiz erişimi kapat.
5. Error/not-found/forbidden UI durumlarını ayır.
6. Başka diyetisyen UUID’si, pending, rejected/removed ve geçersiz UUID için unit/service/manual test ekle.

Bu ilk görev migration veya production mutation gerektirmez ve diğer Aşama 4 iş paketleri için güvenli sahiplik temelini kurar.
