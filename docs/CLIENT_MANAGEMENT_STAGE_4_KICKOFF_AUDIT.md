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

## 26. İş Paketi 4.1 Uygulama Sonucu

### Değiştirilen dosyalar

- `features/clients/services/clientService.ts`
- `pages/ClientDetails.tsx`
- `docs/ROADMAP.md`
- `docs/CLIENT_MANAGEMENT_STAGE_4_KICKOFF_AUDIT.md`

### Erişim sözleşmesi ve veri yükleme sırası

- Servis sonucu `active`, `pending`, `invalid_id`, `unavailable` ve `error` durumlarını ayıran discriminated union ile açık hâle getirildi.
- Route ve servis katmanları mevcut `shared/utils/uuid.ts` içindeki `isValidUuid()` helper’ını kullanır. Geçersiz UUID, auth veya tablo sorgusu başlamadan `invalid_id` olarak durur.
- İlişki sorgusu authenticated diyetisyenin kimliği ve route client UUID’si ile sınırlandırılır. Yalnız `active` ilişki tam profil yüklemesine geçebilir.
- `pending` ilişki yalnız ad, e-posta ve mevcut avatar görünümü için gereken minimum `profiles` alanlarını yükler; `client_profiles`, ölçüm ve günlük kayıt sorguları başlamaz.
- `rejected`, `removed`, ilişkisiz ve RLS nedeniyle görünmeyen kayıtlar tenant varlığını ayırmadan `unavailable` sonucuna dönüşür.
- Ölçüm ve günlük kayıt okumaları yalnız active profil kapısı geçtikten sonra paralel başlar. Bu alt kaynakların sorgu hataları boş diziye çevrilmez; sayfa güvenli `error` durumuna geçer.

### UI ve Realtime kapısı

- Sayfa `loading`, `active`, `pending`, `invalid_id`, `unavailable` ve `error` durumlarını açık bir state modeliyle yönetir.
- Teknik Supabase hata alanları UI’ya veya yeni console kayıtlarına aktarılmaz; kullanıcıya yalnız güvenli Türkçe mesajlar gösterilir.
- Realtime kanalı yalnız geçerli route UUID’si ile eşleşen doğrulanmış active client için kurulur. Pending ve diğer fail-closed durumlarda kanal oluşturulmaz.
- Profil, client profile, ölçüm, daily log ve ilişki değişiklikleri active erişim kapısını yeniden çalıştırır; route değişimi ve unmount sırasında önceki kanal kaldırılır.

### Kalite doğrulaması

- `npm run typecheck`: başarılı.
- `npm run lint`: başarılı; 0 error, 60 mevcut warning.
- `npm run build`: başarılı; Vite büyük chunk uyarısı devam ediyor.
- `git diff --check`: başarılı.
- Otomatik test: Çalıştırılmadı — repository’de bu kapsam için mevcut otomatik test scripti/harness’i yok. Yeni test framework’ü veya paket eklenmedi.
- Production veya staging üzerinde manuel hesap/fixture testi yapılmadı; kabul senaryoları kod yolu üzerinden statik olarak doğrulandı.

### Production ve migration etkisi

- Production ve staging Supabase projelerine bağlanılmadı; veri yazılmadı.
- Migration oluşturulmadı veya çalıştırılmadı.
- RLS, Storage policy, Auth, Storage ve mobil uygulama değiştirilmedi.

### Kalan riskler ve sonraki adım

- Realtime aboneliği hedefli biçimde active kapısının arkasına alındı ancak hâlâ sayfa katmanındadır; servis/helper katmanına taşıma ayrı ve küçük bir refactor olarak değerlendirilebilir.
- Açık sayfadaki ilişki iptalinde Realtime olayı kaçırılırsa active ekran pencere yeniden odaklandığında ilişki kapısını tekrar çalıştırır. Sürekli odakta kalan ve Realtime olayı alamayan bir sekmede anlık UI revocation garantisi yoktur; RLS veri erişiminin zorunlu savunma katmanı olmaya devam eder.
- `daily_logs` policy kararı, grafik empty/error doğruluğu, kanonik profil adapter’ı, avatar sözleşmesi ve mutation postcondition’ları ilgili ayrı iş paketlerinde açık kalır.
- Aşama 4 genel durumu `Devam ediyor` olarak korunmuştur. Önerilen sonraki çalışma İş Paketi 4.2 — liste error/empty ayrımıdır.

## 27. İş Paketi 4.1 Kod İncelemesi ve Staging Doğrulama Hazırlığı

### İnceleme kararı

`REVIEW PASSED / STAGING VERIFICATION PENDING`

Bağımsız statik incelemede UUID, tenant sahipliği, ilişki durumu, pending veri minimizasyonu, active veri sırası, async generation counter ve UI state ayrımı fail-closed bulundu. Realtime olayının bağlantı kesintisi veya görünürlük nedeniyle kaçırılması hâlinde açık active ekranın ilişki durumunu kendiliğinden tekrar doğrulamadığı dar risk giderildi: active danışan sayfası pencere odağına döndüğünde mevcut `loadData(false)` akışını çalıştırır. Listener yalnız active ve route UUID’si eşleşen durumda kurulur; route değişimi, state değişimi ve unmount sırasında kaldırılır. Periyodik polling eklenmedi.

### Statik senaryo matrisi

| Senaryo | Doğrulanan kod yolu | Sonuç |
|---|---|---|
| `/clients/not-a-uuid` | Route `isValidUuid()` sonucu null; `loadData()` servis çağrısından önce `invalid_id` döner; Realtime effect guard’ı geçmez | PASS — Supabase/Auth/Realtime çağrısı yok |
| Geçerli UUID, auth hatası | `auth.getUser()` error sonucu servis `error` döndürür | PASS — relation/profile sorgusu yok |
| Geçerli UUID, ilişki sorgusu hatası | Relation error doğrudan typed `error` sonucuna dönüşür | PASS — profil ve alt kaynak sorgusu yok |
| Geçerli UUID, ilişki yok | `maybeSingle()` null sonucu `unavailable` | PASS — tenant varlığı açıklanmıyor |
| Başka diyetisyenin danışanı | `dietitian_id = authenticated user` ve `client_id = route UUID` birlikte aranır | PASS — aynı genel `unavailable` sonucu |
| Pending | Relation `pending`; yalnız `profiles(full_name, avatar_url, email)` | PASS — health/measurement/log/Realtime yok |
| Rejected | Active/pending dışındaki status | PASS — genel `unavailable` |
| Removed | Active/pending dışındaki status | PASS — genel `unavailable` |
| Active | Relation → temel profil → client profile → ölçüm/log sırası | PASS — alt kaynaklar gate sonrasında |
| Active profil sorgusu hatası | Profile veya client profile error typed `error` | PASS — ölçüm/log başlamıyor |
| Ölçüm sorgusu hatası | Ölçüm fonksiyonu error fırlatır; orchestration catch state’i temizler | PASS — boş diziyle sahte başarı yok |
| Daily log sorgusu hatası | Daily log fonksiyonu error fırlatır; orchestration catch state’i temizler | PASS — boş diziyle sahte başarı yok |
| Route UUID değişimi | `loadData` bağımlılığı değişir; cleanup request generation’ı artırır; eski client ID render guard’ında loading gösterir | PASS — eski sonuç state yazamaz, eski veri gösterilmez |
| Unmount | Request generation cleanup’ı async yazıları geçersizleştirir; Realtime ve focus listener cleanup edilir | PASS — unmount sonrası state/subscription yazımı engelli |

### Realtime ve ilişki iptali değerlendirmesi

- Kanal yalnız `activeClientId === routeClientId` olduğunda kurulur. Kanal adı doğrulanmış route UUID’sini içerir; aktif uygulama zincirinde aynı ada sahip başka channel yoktur.
- Auth state değişiminde `ProtectedRoute`, erişim yeniden çözülürken outlet’i unmount eder. Böylece eski kullanıcı bağlamındaki `ClientDetails` kanalı cleanup edilir.
- Effect bağımlılıkları yalnız active client ID, route UUID ve route’a bağlı `loadData` referansıdır; aynı danışandaki sıradan render duplicate subscription oluşturmaz.
- Subscription callback’i veriyi doğrudan state’e yazmaz; önce tüm UUID/auth/relation gate’ini yeniden çalıştırır. Sonuç pending/unavailable/error ise active state temizlenir ve channel cleanup olur.
- Statik baseline’daki `dietitian_clients_select_own` policy’si diyetisyenin kendi relation satırını status’tan bağımsız görmesine izin verir. Bununla birlikte canlı Realtime publication/reconnect teslim garantisi bu görevde uzak ortama bağlanılarak doğrulanmadı.
- Kaçırılan olay için active ekranda pencere focus revalidation savunması eklendi. Realtime kapalıyken ve sekme sürekli odaktayken anlık UI revocation garanti edilemez; yeni veri sorguları yine RLS tarafından sınırlandırılmalıdır.

### Sentetik staging fixture planı

Gerçek kullanıcı veya production verisi kullanılmamalıdır. Aşağıdaki fixture’lar yalnız ayrı, açık onaylı staging test görevinde oluşturulmalıdır.

| Fixture | Gerekli kayıtlar | Kullanılacağı senaryo | Cleanup gereksinimi |
|---|---|---|---|
| Diyetisyen A | Sentetik Auth user, `profiles.role=dietitian`, onaylı `dietitian_profiles` | Active/pending/rejected/removed/other-tenant web girişleri | İlişkiler ve alt veriler silindikten sonra profil ve Auth user kaldırılır |
| Diyetisyen B | Sentetik Auth user, `profiles.role=dietitian`, onaylı `dietitian_profiles` | Tenant izolasyonu; Active-B’nin gerçek sahibi | Active-B ilişkisi kaldırıldıktan sonra profil ve Auth user kaldırılır |
| Danışan Active-A | Sentetik Auth user, client profile, Diyetisyen A ile `active` ilişki | Tam detay, ölçüm/log, Realtime ve ilişki iptali | Ölçüm/log → ilişki → client profile/profile → Auth sırasıyla temizlenir |
| Danışan Pending-A | Sentetik Auth user, minimum profile, A ile `pending` ilişki | Minimum pending UI ve alt sorgu/Realtime yokluğu | Pending relation sonra profile/Auth temizlenir |
| Danışan Rejected-A | Sentetik Auth user/profile, A ile `rejected` ilişki | Generic unavailable | Relation sonra profile/Auth temizlenir |
| Danışan Removed-A | Sentetik Auth user/profile, A ile `removed` ilişki | Generic unavailable | Relation sonra profile/Auth temizlenir |
| Danışan Active-B | Sentetik Auth user/client profile, yalnız B ile `active` ilişki | A oturumunda başka tenant ve ilişkisiz UUID; B oturumunda pozitif kontrol | Alt veriler → B ilişkisi → profile/Auth temizlenir |
| Active-A ölçümü | Active-A’ya ait tek sentetik `measurements` satırı | Active alt kaynak pozitif yolu | Client/Auth cleanup öncesi explicit ID ile silinir |
| Active-A daily log | Active-A’ya ait tek sentetik `daily_logs` satırı | Daily log pozitif yolu ve policy görünürlüğü | Client/Auth cleanup öncesi explicit ID ile silinir |

İlişki iptali senaryosunda Diyetisyen A active detay ekranını açık tutar; ayrı sentetik client veya kontrollü test işlemi Active-A relation durumunu `removed` yapar. Önce Realtime ile kapanma, olay alınmazsa pencere odağından çıkıp geri dönüldüğünde generic unavailable state’e geçiş doğrulanır. Bu mutation ve fixture oluşturma bu inceleme görevinde yapılmadı.

### Staging test sırası ve cleanup kapısı

1. Staging proje kimliği production ve GROUNDLESS’tan ayrıştırılır.
2. Yalnız sentetik fixture’lar deterministic etiket ve explicit UUID envanteriyle oluşturulur.
3. Diyetisyen A ile invalid, active, pending, rejected, removed ve Active-B URL senaryoları çalıştırılır.
4. Diyetisyen B ile Active-B pozitif kontrolü yapılır.
5. Active-A açıkken relation iptali ve focus revalidation denenir.
6. Hata senaryoları gerçek policy/şema bozulmadan kontrollü network veya request interception ile ayrı test harness’inde uygulanır.
7. Cleanup ters bağımlılık sırasıyla `measurements`/`daily_logs` → `dietitian_clients` → client/dietitian profile satırları → `profiles` → Auth users biçiminde yapılır.
8. Final aggregate kontrolünde sentetik Auth user, public row ve Storage nesnesi sayıları `0` olmalıdır. Migration history ve Storage değiştirilmemelidir.

### Kalite ve kapsam notu

- Başlangıç baseline’ı: typecheck başarılı; lint `0 error, 60 warning`; build başarılı ve büyük chunk uyarısı mevcut.
- Repository’de otomatik `test` scripti/harness’i yoktur; test başarılı sayılmadı ve yeni framework eklenmedi.
- Production ve staging Supabase’e bağlanılmadı; kullanıcı/fixture/veri oluşturulmadı veya değiştirilmedi.
- Migration, RLS, Storage, Auth, paket, mobil uygulama ve İş Paketi 4.2 kapsamında değişiklik yapılmadı.
- Aşama 4 genel durumu `Devam ediyor` olarak korunmuştur.

## 28. İş Paketi 4.1 Staging Manuel Doğrulama Sonucu

### Ortam ve fixture kapsamı

- Hedef proje adı `DietBridge Staging` olarak doğrulandı; environment içindeki project ref maskeli olarak `ezwq…rjkv` biçiminde eşleşti.
- Staging hedefinin `dietbridge_Production` ve görev dışı `GROUNDLESS` projelerinden farklı olduğu doğrulandı. Production ve GROUNDLESS üzerinde sorgu veya mutation çalıştırılmadı.
- Repository dışında tutulan yerel manifest ile 2 sentetik diyetisyen, 5 sentetik danışan, 5 ilişki, 1 ölçüm ve 1 daily log kaydı izlendi. Manifest parola, token, URL veya API anahtarı içermedi.
- Test sırasında kullanılan ayrıcalıklı staging anahtarı yalnız geçici test sürecinde tutuldu; tarayıcı bundle’ına, repository dosyalarına veya manifest’e yazılmadı.

### Senaryo sonuçları

| Senaryo | Sonuç | Kanıt ve not |
|---|---|---|
| Geçersiz UUID | PASS | Güvenli geçersiz bağlantı görünümü açıldı; detay REST sorgusu ve Realtime kanalı oluşmadı. |
| Active-A | FAIL | Profil ve `72.4` ölçümü göründü, tek Realtime kanalı kuruldu ve reload sonrası erişim korundu. Ancak daily log sorgusu teknik hata vermeden boş döndü; fixture görünmek yerine mevcut sabit `1.0 Lt (Ort.)` fallback’i gösterildi. |
| Pending-A | PASS | Yalnız minimum kimlik ve ilişki durumu yüklendi; health, ölçüm, daily log ve Realtime başlamadı. |
| Rejected-A | PASS | Genel erişilemiyor görünümü kullanıldı; hassas profil ve alt kaynaklar yüklenmedi, kanal kurulmadı. |
| Removed-A | PASS | Genel erişilemiyor görünümü kullanıldı; hassas profil ve alt kaynaklar yüklenmedi, kanal kurulmadı. |
| İlişkisiz geçerli UUID | PASS | Tenant varlığı açıklanmadan genel erişilemiyor görünümü gösterildi; alt sorgu ve kanal oluşmadı. |
| Cross-tenant A/B | PASS | Diyetisyen A, Diyetisyen B’nin active danışanını göremedi; gerçek sahibi Diyetisyen B aynı danışanın active detayını görebildi. |
| SPA route geçişleri | PASS | Active→pending/rejected/invalid ve pending→active geçişlerinde eski danışan verisi görünmedi; son route doğru state ve kanal sayısıyla sonuçlandı. |
| Unmount ve kanal cleanup | PASS | Active detayda bir kanal vardı; listeye dönüşte sıfıra indi, yeniden açılışta yalnız bir kanal kuruldu. Duplicate subscription veya unmount sonrası state uyarısı görülmedi. |
| Active→removed revocation | BLOCKED | Relation `removed` yapıldıktan sonra Realtime olayı kısa gözlem aralığında ekranı kapatmadı. In-app tarayıcı sekme dönüşü gerçek `window focus` olayı üretmediği için focus fallback’i canlı olarak kanıtlanamadı. Reload sonrasında genel erişilemiyor görünümü, sıfır hassas veri ve sıfır kanal doğrulandı. |
| Unavailable→active | PASS | Sayfa otomatik erişim kazanmadı; reload sonrasında active görünüm açıldı ve tek kanal kuruldu. Fixture daha sonra tekrar `removed` durumuna alındı. |
| Güvenli hata enjeksiyonu | PASS | Ölçüm ve daily log GET çağrıları ayrı ayrı yerel runtime katmanında `503` ile kesildi; güvenli Türkçe hata görünümü oluştu, active veri ve Realtime kanalı temizlendi. Şema veya policy değiştirilmedi. |

### Bloklayıcı bulgular

1. Active pozitif yolun daily log kabul kriteri geçmedi. Staging’deki mevcut dietitian read policy kapsamı fixture daily log satırını görünür kılmadı; sayfa da boş sonucu gerçek veri yerine sabit su tüketimi fallback’iyle sundu. Bu, daha önce kaydedilen daily log policy ve fake empty-state riskleriyle uyumludur. Çözüm RLS kararını ve UI fallback sözleşmesini kapsayan ayrı, açık onaylı çalışma gerektirir; bu görevde migration veya geniş kapsamlı uygulama düzeltmesi yapılmadı.
2. Relation revocation reload sonrasında fail-closed doğrulandı; fakat test aracının gerçek focus olayı üretememesi nedeniyle focus revalidation staging kanıtı tamamlanamadı. Bu sonuç tek başına kod kusuru kanıtı değildir, ancak kabul adımı geçilmiş sayılmadı.
3. Cross-tenant veri açıklama, yetkisiz mutation, duplicate Realtime subscription veya teknik hata sızıntısı gözlenmedi. Daily log pozitif yol başarısızlığı ve eksik focus kanıtı nedeniyle nihai kapı yine de blokludur.

### Cleanup ve güvenlik sonucu

Cleanup, yalnız manifestteki explicit sentetik kimlikler üzerinden ters bağımlılık sırasıyla tamamlandı. Görev fixture’ları için final aggregate sonuçları:

```text
Sentetik Auth users = 0
Sentetik profiles rows = 0
Sentetik dietitian_profiles rows = 0
Sentetik client_profiles rows = 0
Sentetik dietitian_clients rows = 0
Sentetik measurements rows = 0
Sentetik daily_logs rows = 0
Sentetik Storage objects = 0
```

- Cleanup öncesi ek bağımlılık taraması sıfırdı; cleanup sonrası global staging sayıları fixture öncesi snapshot ile eşleşti.
- Production verisi okunmadı veya değiştirilmedi. Staging’de yalnız manifest fixture’ları oluşturuldu, kontrollü relation status değişiklikleri yapıldı ve tamamı silindi.
- Migration history, şema, RLS, Auth ayarları, Storage, Realtime ayarları ve mobil uygulama değiştirilmedi.
- Test için açılan yerel Vite ve yönlendirme süreçleri kapatıldı.

### Nihai karar

`BLOCKED`

İş Paketi 4.1, daily log pozitif yolu ve focus revalidation staging kanıtı tamamlanmadan `COMMIT REVIEW READY` değildir. Aşama 4 `Devam ediyor` kalır ve İş Paketi 4.2 başlatılmaz.

## 29. İş Paketi 4.1 Daily Log Blocker Analizi ve Düzeltme Hazırlığı

### Aktif kod yolu ve sahte fallback kök nedeni

Aktif zincir `App.tsx` içindeki `/clients/:id` route’undan `pages/ClientDetails.tsx` bileşenine, oradan `features/clients/services/clientService.ts` içindeki `fetchClientDailyLogs()` fonksiyonuna ve `public.daily_logs` tablosuna gider.

Servis `id`, `date` ve `water_intake` kolonlarını seçer; `client_id = route UUID` filtresi uygular ve tarihi artan sırada döndürür. Sayfa tüm sonuçların son yedi kaydını kullanır. Önceki sahte `1.0 Lt (Ort.)` değeri sabit JSX değeri değildi: boş günlük listesi yedi adet sıfır bar ile dolduruluyor, pozitif değer sayısı sıfır olduğu için bölüm sonucu geçersiz oluyor ve `|| 1` ifadesi bunu gerçek ortalama gibi `1.0` değerine çeviriyordu. Gerçek sıfır değerleri de `water_intake ? ... : 0` nedeniyle veri yokluğuyla aynı kola düşüyordu.

Hedefli UI düzeltmesi şu durumları ayırır:

| Durum | Yeni davranış |
|---|---|
| Yükleniyor | Mevcut sayfa yükleme görünümü korunur. |
| Sorgu hatası | Alt kaynak hatası mevcut güvenli genel hata görünümüne gider; active/sahte başarı gösterilmez. |
| Daily log satırı yok | `Henüz günlük takip kaydı bulunmuyor.` empty state’i gösterilir; ortalama veya grafik gösterilmez. |
| Satır var, `water_intake` null | `Günlük kayıtlar mevcut ancak su tüketimi bilgisi bulunmuyor.` gösterilir. |
| Gerçek su değeri `0` | Sayısal kayıt ortalamaya dahil edilir ve `0.0 Lt` gösterilebilir. |
| Pozitif gerçek değer | Yalnız DB’den gelen sayısal değerler ortalamaya ve grafiğe dahil edilir. |

### Daily log veri sözleşmesi

| Alan | Doğrulanan sözleşme |
|---|---|
| Tablo | `public.daily_logs` |
| Kimlik/sahiplik | `id uuid` PK; `client_id uuid → profiles.id` |
| Gün | `date date not null`; `(client_id, date)` unique olduğu için danışan başına günde en fazla bir satır |
| Su | `water_intake numeric null`; database seviyesinde ayrıca birim comment/check’i yok |
| Uygulama birimi | Web mevcut değeri `1000` ile bölerek litre gösterir; `daily_water_goal_ml` alanı da aynı dönüşümü kullanır. Repository uygulama sözleşmesi değeri mililitre olarak ele alır, ancak birimin şemada kendiliğinden belgelenmemesi kalan veri modeli riskidir. |
| Tarih kapsamı | Serviste tarih aralığı filtresi yoktur; tüm kayıtlar artan tarih sırasıyla okunur, UI son en fazla 7 kaydı kullanır. |
| Ortalama | Son en fazla 7 kayıttaki numeric `water_intake` değerlerinin aritmetik ortalaması alınır ve sonra litreye çevrilir. Null değerler dışlanır, gerçek sıfırlar paydaya dahildir; yapay padding ortalamaya dahil edilmez. |

UI etiketi tek kayıt için `Son Kayıt`, birden fazla kayıt için gerçek kayıt sayısını içeren `Son N Kayıt Ort.` biçimindedir. Bu değer son yedi takvim gününün değil, en son en fazla yedi günlük kayıt satırının ortalamasıdır.

### Staging RLS sözleşmesi ve kök neden

Hedef ortam CLI proje listesi ve `.env.staging.local` eşleşmesiyle yeniden `DietBridge Staging` olarak doğrulandı; maskeli ref `ezwq…rjkv` production ve GROUNDLESS ref’lerinden farklıdır. Yeni remote link/JIT rolü veya yazabilen SQL oturumu açılmadı. Staging’e uygulanan migration history’nin repository ile `9/9` eşleştiğini kaydeden mevcut salt-okunur katalog raporu, active migration SQL’i ve bu iş paketindeki gerçek diyetisyen oturumunda fixture satırının `0 satır / hata yok` dönmesi birlikte değerlendirildi.

- `daily_logs` üzerinde RLS açıktır.
- Mevcut SELECT policy `Users can view own daily logs`, rol `authenticated`, `USING auth.uid() = client_id` sözleşmesindedir.
- Mevcut INSERT ve UPDATE policy’leri de yalnız client-own kapsamındadır; bu görev onları değiştirmez.
- Active diyetisyen için ayrı SELECT policy yoktur. Kök neden uygulama sorgusu değil, eksik RLS policy’dir.
- Mevcut durumda active, pending, rejected, removed ve unrelated diyetisyenlerin tümü daily log satırında sıfır sonuç alır. Cross-tenant veri açılması gözlenmemiştir.
- Hedef policy yalnız `dietitian_clients.dietitian_id = auth.uid()`, eşleşen `client_id` ve `status = active` birlikte doğruysa SELECT izni verir. Pending, rejected, removed ve unrelated erişimler reddedilmeye devam eder.
- Policy yalnız SELECT içindir; INSERT, UPDATE veya DELETE yetkisini genişletmez ve mevcut client-own SELECT policy’sini korur.
- Alt sorgu `daily_logs` tablosuna geri dönmez; recursive policy döngüsü oluşturmaz. Mevcut `(dietitian_id, client_id)` ve `daily_logs(client_id)` indexleri predicate’i destekler.

### Hazırlanan migration

`supabase/migrations/20260716170620_daily_logs_active_dietitian_select.sql` Supabase CLI `migration new` komutuyla oluşturuldu. Migration:

1. Tabloları, `daily_logs.client_id` tipini, `dietitian_clients.status` enum tipini ve RLS durumunu fail-fast doğrular.
2. Aynı adlı policy varsa sessizce üzerine yazmak yerine durur.
3. `Dietitians can view active client daily logs` adlı, yalnız `authenticated` ve SELECT kapsamlı policy’yi oluşturur.
4. Policy postcondition’ını ve mevcut `Users can view own daily logs` policy’sinin korunmasını doğrular.
5. Şema, Storage, Auth, Realtime veya başka tablo yetkisini değiştirmez.

Migration staging veya production’a uygulanmadı.

Repository dışındaki disposable yerel Supabase çalışma alanında 10 active migration sıfırdan replay edildi. `db reset --local --no-seed` ve `db lint --local --schema public --level warning --fail-on error` başarılı oldu. Yerel metadata sonucu `daily_logs` için RLS `enabled=true`, forced RLS `false`, yeni policy `SELECT/authenticated/USING mevcut`, client-own SELECT policy korunmuş ve tablo satır sayısı `0` olarak doğrulandı. Yerel stack `stop --no-backup` ile kapatıldı; repository içindeki `supabase/.temp/` kullanılmadı.

### Staging preflight ve postflight paketi

Uygulama öncesi salt-okunur kontrol şu metadata’yı birlikte doğrulamalıdır:

```sql
select c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'daily_logs';

select column_name, data_type, udt_schema, udt_name, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('daily_logs', 'dietitian_clients')
  and column_name in ('client_id', 'status');

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'daily_logs'
order by policyname;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'daily_logs'
order by grantee, privilege_type;
```

Postflight metadata kontrolü yeni policy’nin `SELECT`, `authenticated` ve non-null `USING` ifadesiyle tam bir kez bulunduğunu; client-own SELECT policy’sinin kaldığını; diğer komut policy’lerinin değişmediğini doğrulamalıdır. Sentetik staging matrisi ayrıca client own SELECT ve active dietitian SELECT için görünür satır; pending, rejected, removed, unrelated ve cross-tenant için `0 satır` beklemelidir. Bu negatif testler migration uygulama onayı verilmeden çalıştırılmaz.

### Rollback planı

Rollback yalnız yeni eklenen policy’yi kaldırır:

```sql
drop policy "Dietitians can view active client daily logs" on public.daily_logs;
```

Rollback mevcut client-own SELECT/INSERT/UPDATE policy’lerine, tablo RLS durumuna veya verilere dokunmaz. Ayrı staging rollback onayı ve post-rollback policy envanteri gerektirir.

### Focus revalidation incelemesi

- Listener yalnız `viewState.status = active` sonucundaki client UUID’si route UUID’siyle eşleştiğinde kurulur.
- Effect cleanup `window.removeEventListener()` ve `supabase.removeChannel()` çağrılarını yapar; sıradan render duplicate listener oluşturmaz.
- Focus callback’i doğrudan state yazmak yerine aynı `loadData(false)` zincirini çalıştırır; bu zincir UUID, auth, relation ve alt kaynak kapılarını yeniden uygular.
- Her load generation counter’ı artırır; eski async sonuç yeni route/client state’ine yazamaz. Pending/unavailable/error sonucu active veri dizilerini temizler ve effect cleanup kanalın kapanmasını sağlar.

Gerçek masaüstü focus testi için sentetik active ilişki gerekir. Bu görev Auth kullanıcısı/fixture oluşturmayı yasakladığından ve önceki fixture’lar başarıyla temizlendiğinden ilişkiyi `active → removed` yapacak güvenli test önkoşulu yoktur. Simüle DOM event’i gerçek kanıt sayılmadı.

`FOCUS LIVE TEST PENDING`

### Karar

`RLS REMEDIATION PREPARED / STAGING APPLICATION APPROVAL REQUIRED`

`FOCUS LIVE TEST PENDING`

İş Paketi 4.1 `BLOCKED — daily_logs visibility and focus verification` durumunda, Aşama 4 `Devam ediyor` olarak kalır. İş Paketi 4.2 başlatılmaz.

## 30. İş Paketi 4.1 Daily Logs RLS Staging Uygulaması ve Tam Regresyon Sonucu

### Staging kimliği ve migration uygulaması

- Branch `codex/client-management`, başlangıç HEAD `bbdb3f58d01c6d35d2f4a32f1ea4cdc1a189fe62` olarak doğrulandı. Başlangıç çalışma ağacında yalnız İş Paketi 4.1 kapsamındaki dört tracked dosya, hazırlanan migration ve önceden mevcut `supabase/.temp/` dizini vardı. `supabase/.temp/` okunmadı, değiştirilmedi veya stage edilmedi.
- Hedef proje adı ve `.env.staging.local` eşleşmesi `DietBridge Staging` olarak doğrulandı. Maskeli project ref `ezwq…rjkv` olup production ve GROUNDLESS ref’lerinden farklıdır. Repository kökü linklenmedi; repository dışında benzersiz Supabase çalışma alanı kullanıldı.
- Migration SHA-256 değeri `49EAA24BE307BD0A5BC1CC6ABEE62D756B879E57F6D5217AD0C868E89012026E` olarak doğrulandı. Dosya yalnız `public.daily_logs` için active ilişki tabanlı `SELECT TO authenticated` policy’si ekler; INSERT/UPDATE/DELETE, grant, ownership, RLS kapatma, tablo/kolon silme, function, trigger, Auth veya Storage değişikliği içermez.
- Staging preflight sonucu `9/9` remote migration eşleşmesi, `daily_logs` tablosu ve gerekli kolonlar, RLS açık/forced kapalı durumu, nullable numeric `water_intake`, `(client_id, date)` unique sözleşmesi, `dietitian_clients.status` enum değerleri ve mevcut client-own policy’leri doğrulandı. Yeni policy preflight’ta yoktu.
- `db push --linked --dry-run` yalnız `20260716170620_daily_logs_active_dietitian_select.sql` migration’ını pending gösterdi. Ardından migration yalnız doğrulanmış DietBridge Staging projesine uygulandı. CLI’ın dış çalışma alanındaki pg-delta sertifika cache uyarısı uygulamayı etkilemedi; katalog postflight gerçek sonucu doğruladı.
- Postflight sonucu repository ve staging remote history `10/10` eşleşti; yeni version tam bir kez bulundu. `Dietitians can view active client daily logs` policy’si `SELECT`, `authenticated` ve yalnız `dietitian_id = auth.uid()`, eşleşen `client_id` ve `status = active` predicate’iyle tam bir kez bulundu. Client-own SELECT ve mevcut non-SELECT policy’leri korundu.

### Sentetik fixture ve RLS matrisi

- Yalnız staging’de 2 diyetisyen, 5 client, 2 onaylı diyetisyen profili, 5 client profili ve active/pending/rejected/removed/cross-tenant durumlarını kapsayan 5 ilişki oluşturuldu.
- Active-A için `null`, `0`, `1000` ve `2000` ml değerli dört farklı tarihli daily log; pending/rejected/removed ve Active-B için birer daily log oluşturuldu. Active-A için bir explicit measurement oluşturuldu. `client_profiles.current_weight` trigger’ının ürettiği ikinci measurement cleanup öncesinde sentetik kullanıcı bağıyla doğrulanıp manifest kapsamına alındı.
- Client-own Active-A SELECT `4 satır`; Dietitian A → Active-A `4 satır`; pending, rejected, removed, ilişkisiz/cross-tenant A → B `0 satır`; Dietitian B → Active-B `1 satır` sonuçlarıyla geçti.

### Gerçek Chrome UI, Realtime ve route regresyonu

- Dietitian A → Active-A görünümünde daily log ve measurement sorguları `200` döndü; bir Realtime kanalı açıldı. Gerçek `null`, `0`, `1000`, `2000` değerlerinden `(0 + 1000 + 2000) / 3 = 1000 ml` hesaplandı ve UI `1.0 Lt (Son 3 Kayıt Ort.)` gösterdi. `null` ortalamaya katılmadı, gerçek `0` katıldı ve yapay yedi günlük padding ortalamaya dahil edilmedi.
- Empty durumda `Henüz günlük takip kaydı bulunmuyor.`; null-only durumda `Günlük kayıtlar mevcut ancak su tüketimi bilgisi bulunmuyor.`; zero-only durumda `0.0 Lt (Son Kayıt)`; positive durumda `2.0 Lt (Son Kayıt)` doğrulandı. Sabit `1.0 Lt` fallback’i hiçbir empty/null/zero testinde devreye girmedi.
- Geçici, repository dışı gözlem katmanıyla yalnız test oturumunda `daily_logs` GET isteğine güvenli `503` enjekte edildi. UI `Danışan Bilgileri Yüklenemedi` ve güvenli Türkçe açıklamayı gösterdi; sahte veri ve Realtime kanalı oluşmadı. Enjeksiyon repository veya Supabase’i değiştirmedi.
- Pending route yalnız minimum kimlik/ilişki görünümünü gösterdi; `measurements` ve `daily_logs` sorgusu veya Realtime başlatmadı. Rejected ve removed route’ları genel erişilemez görünümü gösterdi; hassas profil ve alt veri sorgusu oluşmadı.
- Dietitian A → Active-B genel erişilemez görünüm ve sıfır kanal verdi. Dietitian B → Active-B active görünümü, gerçek `1.4 Lt` daily log ve bir kanal ile geçti.
- Active-A → Pending-A, Active-A → Rejected-A, Active-A → `not-a-uuid` ve Active-A → `/clients` geçişlerinde eski su/measurement detayları kalmadı; kanal sayısı sıfıra indi. Liste görünümünde client adı kartta doğal olarak bulunurken `Su Tüketimi`, `Vücut Kompozisyonu` ve sentetik measurement notu kalmadı.
- Active-A ilişkisi `active → removed` yapıldıktan sonraki kısa gözlemde Realtime olayı ekranı kendiliğinden kapatmadı; bu sonuç ayrı kaydedildi ve tek başına fail sayılmadı.
- Zorunlu focus fallback’i uzantı tarafından yönetilmeyen normal masaüstü Chrome sekmesinde gerçek Windows pencere geçişiyle test edildi. Test sekmesi foreground iken başka gerçek pencereye geçildi ve aynı Chrome penceresine geri dönüldü. Runtime gözleminde gerçek focus/blur/visibility event sayaçları arttı, ilişki GET sorgusu yeniden `200` ile tamamlandı, active hassas state temizlendi, `Danışana Erişilemiyor` görünümü geldi ve Realtime kanal sayısı `1 → 0` oldu. Manuel `window.dispatchEvent` kullanılmadı.

### Cleanup, güvenlik ve nihai karar

- İlk cleanup kapısı, `client_profiles.current_weight` trigger’ının ürettiği manifest dışı measurement satırını silmeden önce fail-closed yakaladı. Satır yalnız yeni sentetik Active-A kullanıcısına bağlı olduğu doğrulandı ve veritabanında yeni mutation yapılmadan manifest kapsamına alındı.
- İkinci cleanup öncesi manifest dışı bağımlılık `0` bulundu. Cleanup sonrasında Auth users, `profiles`, `dietitian_profiles`, `client_profiles`, `dietitian_clients`, `measurements`, `daily_logs` ve Storage object sayılarının her biri `0` oldu. Global staging sayıları fixture öncesi snapshot ile eşleşti; geçici browser credential dosyası silindi.
- Production ve GROUNDLESS üzerinde data, schema, migration history, Auth, Storage veya policy mutation yapılmadı. Staging’de kalıcı kalan tek değişiklik onaylı daily_logs SELECT migration/policy’sidir; sentetik Auth ve application verileri tamamen temizlendi.
- Yeni P0/P1 uygulama güvenlik bulgusu bulunmadı. Cleanup harness’indeki trigger-bağımlılık manifest boşluğu test sırasında fail-closed yakalanıp geçici harness kapsamında giderildi.
- Node.js 24 ortamında `npm run typecheck` başarılı; lint `0 error, 60 warning` ile mevcut baseline’ı aşmadan başarılı; production build başarılı oldu. Build, mevcut yaklaşık 747 kB ana chunk uyarısını üretmeye devam etti. Repository’de otomatik `test` scripti bulunmadığı için test komutu çalıştırılmadı.
- `git diff --check` ve nihai secret/kapsam kontrolleri görev sonunda ayrıca çalıştırıldı; bu görevde stage, commit, push veya pull request oluşturulmadı.

Nihai karar:

`STAGING PASSED / COMMIT REVIEW READY`

İş Paketi 4.1 tamamlandı; staging doğrulaması geçti. Branch commit ve push kaydı bu görev raporunda tutulacaktır. Aşama 4 `Devam ediyor` kalır. İş Paketi 4.2 başlatılmadı.
