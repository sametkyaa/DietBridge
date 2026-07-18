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

## 31. İş Paketi 4.2 — Danışan Listesinde Loading, Empty ve Error Ayrımı

### Aktif route ve import zinciri

Aktif zincir `App.tsx` içindeki `/clients` route'undan `features/clients/pages/ClientsPage.tsx` bileşenine ve oradan `features/clients/services/clientService.ts` içindeki `fetchDietitianClientList()` fonksiyonuna gider. Sayfa doğrudan Supabase sorgusu yapmaz. Ortak UI tipi `shared/types.ts` içindeki `Client` arayüzüdür.

### Önceki davranış ve kök neden

- Sayfa ayrı `clients: Client[]` ve `loading: boolean` state'leri kullanıyordu; açık error state'i yoktu.
- Servis auth kullanıcısı bulunmadığında `[]` döndürüyordu. Sayfa servis exception'ını yakalayıp yine `clients=[]` yapıyordu.
- Bu nedenle auth hatası, Supabase sorgu hatası ve gerçekten boş başarılı sonuç aynı `Henüz danışanınız yok` görünümüne düşüyordu.
- Her yeni yükleme `loading=true` yapsa da eski `clients` state'i istek boyunca korunuyordu. Hata sonunda boşaltılıyor, fakat kullanıcıya hata olduğu açıklanmıyordu.
- Ana liste ile arama sonucu boşluğu yalnız `clients.length` ve `searchTerm` kontrolleriyle ayrılıyordu. Desktop ve mobil için tekrar eden arama-empty blokları vardı.
- Aktif işlevsel filtre state'i yoktur; `Filtrele` düğmesi mevcut tasarımda yalnız görsel kontroldür. Bu görev yeni filtre özelliği eklemedi.
- Retry mekanizması yoktu. Realtime veya otomatik liste refetch aboneliği yoktu; yalnız mount ve başarılı danışan ekleme sonrasında yeniden yükleme yapılıyordu.
- Aktif liste akışında mock/demo danışan fallback'i bulunmadı. `USER_AVATAR` yalnız görsel placeholder'dır; sabit `duration`, `weeklyChange` ve eksik profil varsayılanları ayrı veri doğruluğu riski olarak kalır.

### Uygulanan servis ve state sözleşmesi

Servis sonucu aşağıdaki discriminated union ile ayrıldı:

```ts
type ClientListResult =
  | { status: 'success'; clients: Client[] }
  | { status: 'error'; kind: 'auth' | 'query' | 'unexpected'; userMessage: string };
```

- `supabase.auth.getUser()` hem `error` hem kullanıcı yokluğu için fail-closed `auth` hatası üretir.
- `dietitian_clients` sorgusu `dietitian_id = authenticated user` ve `status in (active, pending)` filtrelerini korur. Rejected ve removed ilişkiler listeye geri getirilmez.
- Sorgu hatası boş diziye çevrilmez. Başarılı sıfır satır ise `success` içinde boş `clients` olarak korunur.
- Supabase hata nesnesi veya teknik mesaj UI'ya aktarılmaz; güvenli Türkçe mesaj kullanılır ve yeni console kaydı eklenmez.
- Liste mapping'i typed satır sözleşmesine alındı; bu akıştaki dört mevcut `any` kaldırıldı. Diğer tüketiciler için mevcut `fetchDietitianClients()` dizi sözleşmesi güvenli wrapper olarak korundu.

Sayfa state'i `loading`, `success` ve `error` durumlarını açıkça ayırır. `success` içindeki listenin dolu/boş olması ve mevcut arama sonucu UI durumlarını türetir:

- İlk yükleme ve retry sırasında yalnız loading görünümü gösterilir; önceki liste ve error görünümü korunmaz.
- Başarılı dolu sonuç gerçek listeyi gösterir.
- Başarılı boş sonuç `Henüz danışanınız bulunmuyor.` görünümünü gösterir.
- Başarılı ana liste dolu, arama sonucu boşsa ayrı arama/filtre-empty mesajı ve `Aramayı Temizle` düğmesi gösterilir.
- Auth, query veya beklenmeyen hata güvenli error görünümü ile `Tekrar Dene` düğmesini gösterir; empty state gösterilmez.
- Retry sırasında in-flight ref ikinci eşzamanlı isteği engeller. Request sequence eski async sonucu geçersiz kılar; unmount cleanup sequence'i artırarak sonradan state yazımını önler.

### Statik senaryo matrisi

| Senaryo | Sonuç | Kod yolu |
|---|---|---|
| İlk yükleme | PASS | Başlangıç `viewState=loading`; yalnız spinner/metin render edilir. |
| Başarılı sorgu, birden fazla danışan | PASS | Typed `success.clients` arama ve active/pending gruplarına ayrılır. |
| Başarılı sorgu, sıfır danışan | PASS | `success` ve `clients.length===0` yalnız genel empty görünümünü üretir. |
| Liste var, arama sonucu yok | PASS | `filteredClients.length===0` ayrı arama/filtre-empty görünümünü üretir. |
| Liste var, filtre sonucu yok | PASS | Ortak `filteredClients` sonuç kapısı search/filter-empty durumunu temsil eder; mevcut UI'da işlevsel filtre state'i olmadığı için canlı filtre eylemi yoktur. |
| Auth hatası | PASS | Servis `error.kind=auth`; sayfa error görünümü gösterir, empty göstermez. |
| Supabase sorgu hatası | PASS | Servis `error.kind=query`; boş başarıya çevrilmez. |
| Hata öncesinde liste vardı | PASS | Yeni istek önce `loading` yapar; liste yalnız `success` state'inden türetildiği için eski liste temizlenir. |
| Retry başarılı | PASS | Aynı `loadClients()` akışı `loading → success` geçişini yapar. |
| Retry başarısız | PASS | Aynı akış yeniden güvenli `error` state'ine gider. |
| Hızlı iki retry | PASS | `requestInFlight` ikinci eşzamanlı başlangıcı engeller; sequence eski sonucu state'e yazdırmaz. |
| Component unmount | PASS | Effect cleanup request sequence'i artırır; tamamlanan eski istek state yazamaz. |
| Başka tenant kaydı | PASS | Sorgu authenticated `dietitian_id` ile sınırlıdır; RLS zorunlu savunma katmanı olmaya devam eder. |
| Pending gösterimi | PASS | Servis yalnız active/pending getirir; mevcut `Onay Bekleyenler` grubu korunur. |
| Rejected/removed gizleme | PASS | Server-side status filtresi rejected/removed ilişkileri dışarıda bırakır. |

### Manuel doğrulama, kalite ve kalan riskler

- Lokal güvenli auth/query error injection için mevcut test mock'u veya uygun harness bulunmadı. `NOT EXECUTED — SAFE ERROR INJECTION UNAVAILABLE`.
- Otomatik test scripti yoktur; test başarılı sayılmadı ve yeni test paketi eklenmedi.
- Node.js `v24.18.0`; `npm run typecheck` başarılı; `npm run lint` başarılı ve `0 error, 56 warning`; `npm run build` başarılıdır.
- Build ana chunk değeri yaklaşık `748.58 kB` olup mevcut büyük chunk uyarısı devam eder. `git diff --check` başarılıdır.
- İşlevsel filtre state'inin bulunmaması ve liste kartlarındaki sabit duration/weekly-change varsayımları bu iş paketinde değiştirilmedi.
- Production veya staging Supabase'e bağlanılmadı; veri, Auth, Storage, RLS veya migration değişikliği yapılmadı. `supabase/.temp/` okunmadı veya değiştirilmedi.
- İş Paketi 4.1 durumu değiştirilmedi. Aşama 4 `Devam ediyor` kalır ve İş Paketi 4.3 başlatılmadı.

Nihai karar:

`WORK PACKAGE 4.2 IMPLEMENTED / REVIEW PENDING`

## 32. İş Paketi 4.2 Kod İncelemesi ve Güvenli Lokal Doğrulama

### İnceleme kapsamı ve aktif zincir

İnceleme `App.tsx → /clients → features/clients/pages/ClientsPage.tsx → features/clients/services/clientService.ts` aktif zincirinde yapıldı. `ClientsPage`, typed `fetchDietitianClientList()` fonksiyonunu doğrudan kullanır. Dizi döndüren uyumluluk wrapper'ı `fetchDietitianClients()` ise aktif olarak `features/dashboard/pages/DashboardPage.tsx` ve `pages/MealPlans.tsx` tarafından kullanılır. Kök `services/`, `src/` ve diğer duplicate akışlar aktif route zinciri değildir ve değiştirilmedi.

### Typed servis sonucu ve wrapper değerlendirmesi

- `ClientListResult`, `success.clients` ile `error.kind = auth | query | unexpected` sonuçlarını açıkça ayırır.
- Auth error veya authenticated kullanıcı yokluğu boş success üretmez. `dietitian_clients` query error sonucu da boş diziye çevrilmez.
- Başarılı sıfır satır `success` içindeki boş liste olarak korunur; teknik Supabase hata nesnesi UI'ya aktarılmaz.
- Sorgu `dietitian_id = auth user` ve `status in (active, pending)` filtrelerini korur. Rejected/removed ve başka tenant ilişkileri uygulama sorgusuna dahil edilmez; RLS zorunlu savunma katmanı olmaya devam eder.
- Beklenmeyen exception güvenli `unexpected` sonucuna dönüşür; yeni `any` veya teknik console kaydı eklenmedi.
- Uyumluluk wrapper'ı typed error'ı sessizce `[]` yapmaz; güvenli genel `Error` fırlatır. Dashboard ve MealPlans exception'ı yakalar ancak ayrı error UI göstermediğinden bu iki tüketicide error/empty görünürlüğü hâlâ ayrı bir feature riski olarak kalır. Bu görevde başka feature ekranları yeniden yazılmadı.

### Bulunan sorunlar ve uygulanan dar düzeltmeler

1. **P1 — React Strict Mode in-flight kilidi:** İlk effect isteği başlattıktan sonra development Strict Mode cleanup sequence'i artırıyor ancak `requestInFlight` değerini bırakmıyordu. İkinci effect bu kilit nedeniyle yeni istek başlatamıyor; ilk promise stale olduğunda `finally` de sequence eşleşmediği için kilidi açamıyordu. Sonuç kalıcı loading olabilirdi. Cleanup artık sequence'i artırırken in-flight kilidini de bırakır. Eski ilk istek yeni sequence ile eşleşmediğinden ikinci isteğin state veya kilidini değiştiremez.
2. **P2 — Gerçekte olmayan filtre ifadesi:** Search-empty mesajı işlevsel filtre state'i olmamasına rağmen “arama veya filtre” diyordu. Metin `Arama ölçütüne uygun danışan bulunamadı.` olarak daraltıldı; placeholder `İsme göre ara...` oldu.
3. **P2 — Arama whitespace/locale davranışı:** Arama değeri `trim()` ve Türkçe locale lowercase ile normalize edildi. Yalnız boşluk içeren arama ana listeyi korur; baş/son boşluk gerçek eşleşmeyi bozmaz.

### In-flight, sequence ve UI değerlendirmesi

- In-flight kilidi istek başlangıcında kurulur ve current request başarı/error sonucunda `finally` ile bırakılır. Cleanup kilidi bırakıp sequence'i artırır; Strict Mode ikinci effect'i yeni istek başlatabilir.
- Hızlı çift retry sırasında ilk çağrı kilidi kurar; ikinci çağrı Supabase isteği başlatmadan döner. Retry tıklanınca state `loading` olur ve retry butonu error görünümüyle birlikte kaldırılarak yeniden etkileşim engellenir.
- Liste yalnız `success` state'inden türetilir. Loading veya error state'inde önceki liste görünmez; error mesajı loading başında temizlenir.
- Stale request yalnız kendi request ID'si current sequence ile eşleşirse state yazabilir veya kilidi bırakabilir. Unmount cleanup eski promise sonucunu geçersiz kılar.
- Authenticated kullanıcı değişiminde mevcut `ProtectedRoute` erişimi yeniden değerlendirirken sayfayı unmount eder; cleanup eski liste isteğini geçersiz kılar. Bu sayfada ayrıca auth-change subscription eklenmedi.
- General empty yalnız `success.clients.length === 0`; search empty yalnız ana success listesi dolu ve normalize arama sonucu boşken oluşur. `Aramayı Temizle` gerçek button'dır, yalnız search state'ini temizler ve yeni DB sorgusu başlatmaz.

### Statik kabul matrisi

| Senaryo | Sonuç | Kod yolu |
|---|---|---|
| İlk render | PASS | Başlangıç view state'i `loading`. |
| Success + data | PASS | `success.clients` gerçek listeyi render eder. |
| Success + [] | PASS | Yalnız general empty render edilir. |
| Liste var + arama sonucu yok | PASS | Normalize arama sonrası `filteredClients.length === 0` search empty üretir. |
| Auth failure | PASS | `error.kind=auth`; empty yolu kullanılmaz. |
| Query failure | PASS | `error.kind=query`; boş success üretilmez. |
| Önceden liste varken query failure | PASS | Yeni istek önce `loading`; liste yalnız success state'inden türetilir. |
| Retry failure | PASS | `error → loading → error`. |
| Retry success | PASS | `error → loading → success/empty`. |
| Hızlı çift retry | PASS | In-flight guard yalnız ilk isteği başlatır. |
| Eski request geç tamamlanır | PASS | Request ID/sequence eşleşmesi yoksa state yazılmaz. |
| Unmount | PASS | Cleanup sequence'i artırır ve kilidi bırakır. |
| Strict Mode effect tekrarı | PASS | Cleanup sonrası ikinci effect yeni request başlatır; ilk stale promise etkisizdir. |
| Pending | PASS | Active ilişkilerden ayrı mevcut pending grubunda görünür. |
| Rejected/removed | PASS | Server-side status filtresiyle görünmez. |
| Cross-tenant | PASS | Authenticated `dietitian_id` filtresi ve RLS ile sınırlandırılır. |

### Güvenli canlı doğrulama sonucu

- Yalnız `.env.staging.local` içinde tanımlı hedef kullanıldı; maskeli ref mevcut DietBridge Staging audit kaydıyla eşleşti. Production veya GROUNDLESS hedefi kullanılmadı.
- Yerel Vite sunucusu `--mode staging` ile `127.0.0.1:3000` üzerinde başlatıldı. Tarayıcıda mevcut staging oturumu bulunmadığından `/clients` korumalı route tarafından giriş ekranına yönlendirildi; yeni hesap veya fixture oluşturulmadı.
- Kullanılabilir tarayıcı kontrol yüzeyinde request blocking/network interception desteği bulunmadı. Secret, cookie, token veya Authorization header okunmadı.
- Loading, success-with-data, search-empty, query-error, retry-failure, retry-success ve hızlı-retry canlı senaryoları: `NOT EXECUTED — SAFE AUTHENTICATED REQUEST-BLOCKING SESSION UNAVAILABLE`.
- Auth-error injection: `NOT EXECUTED — SAFE AUTH ERROR INJECTION UNAVAILABLE`.
- General-empty: `GENERAL EMPTY LIVE TEST NOT EXECUTED — SAFE EMPTY ACCOUNT UNAVAILABLE`.
- Oturumsuz korumalı-route davranışı canlı olarak fail-closed bulundu; bu sonuç `fetchDietitianClientList()` auth-error UI testi yerine geçirilmedi.

### Kalite ve karar

- Node.js `v24.18.0`; typecheck başarılı; lint `0 error, 56 warning`; production build başarılıdır.
- Build yaklaşık `748.62 kB` ana chunk uyarısını üretir; bu görevde bundle optimizasyonu yapılmadı.
- Otomatik test scripti yoktur. `git diff --check` başarılıdır.
- Production ve staging verisine mutation yapılmadı; migration, RLS, Storage veya Auth değişikliği yapılmadı.
- İş Paketi 4.1 durumu değiştirilmedi. Aşama 4 `Devam ediyor` kalır ve İş Paketi 4.3 başlatılmadı.

Nihai karar:

`WORK PACKAGE 4.2 REVIEW PASSED / LIVE VALIDATION PENDING`

## 33. İş Paketi 4.2 Staging Auth Oturum Blokajı Analizi

### Staging kimliği ve aktif zincir

- `.env.staging.local` içindeki maskeli proje ref'i `ezwq…rjkv` olarak mevcut DietBridge Staging kaydıyla eşleşti. URL ve anon key tanımlıydı; production veya GROUNDLESS hedefi kullanılmadı.
- Yerel Vite süreci `--mode staging --host 127.0.0.1 --port 3000` ile, environment dosyasının mevcut sürümünden sonra başlatılmış durumdaydı.
- Aktif zincir `App.tsx → LoginPage → AuthContext.signIn() → supabase.auth.signInWithPassword() → onAuthStateChange/getSession → resolveAuthAccess() → ProtectedRoute → /clients` olarak doğrulandı.
- Tek aktif Supabase client `lib/supabaseClient.ts` içindeki module-scope `createClient(env.supabaseUrl, env.supabaseAnonKey)` instance'ıdır. `persistSession: false`, özel storage, `process.env`, Expo fallback veya render başına yeniden client oluşturma bulunmadı.

### Tarayıcı ve auth isteği sonucu

- Normal masaüstü Chrome kullanıldı. İlk kullanıcı sekmesinde kaynak koddan farklılaşmış metinler ve ardından React `removeChild` exception'ı görüldü; DOM tamamen boşaldı. Bu beyaz ekran Chrome sayfa çevirisi veya metin düğümlerini değiştiren benzer bir eklentinin React tarafından yönetilen DOM'u değiştirmesiyle sınıflandırıldı.
- Temiz ve çevrilmemiş yeni Chrome sekmesinde giriş formu doğru render edildi. Kullanıcı giriş bilgilerini yalnız tarayıcı formuna manuel girdi; parola, token, cookie veya Authorization header okunmadı ve kaydedilmedi.
- Temiz sekmede kullanıcıya güvenli `E-posta veya şifre hatalı.` mesajı gösterildi. Bu mesaj aktif auth servisinde Supabase `invalid login credentials` hata sınıfına karşılık gelir.
- Password grant isteği session üretmedi. `/clients` yeni sekmede tekrar `/login` route'una yönlendi; reload veya yeni sekme session restore sonucu oluşmadı.
- Role/profile/verification resolver veya sign-out hata logu oluşmadı. Bu sorgulara geçildiğine dair kanıt bulunmadığından `profiles`, `dietitian_profiles` ve verification durumu değerlendirilemedi.
- Codex in-app browser tekrarında `/auth/v1/token` isteğinin gerçekten gönderildiği, React `removeChild` çökmesinin oluşmadığı ve aynı güvenli `invalid credentials` sonucunun döndüğü doğrulandı. Staging Auth logunda son password grant denemesi de `invalid_credentials` olarak kaydedildi; secret veya kullanıcı kimliği okunmadı.

### Kök neden ve manuel işlem

- Beyaz ekranın doğrudan nedeni uygulama auth guard'ı değil, kullanıcı sekmesindeki sayfa çevirisi/DOM değiştiren eklenti davranışıydı. Temiz sekme bu UI çökmesini ortadan kaldırdı.
- Kalan auth blokajı uygulama kodundan önce, staging password login aşamasındadır: kullanıcı DietBridge Staging projesinde kayıtlı bir diyetisyen hesabı bulunmadığını doğruladı. Supabase bu durumda güvenlik amacıyla aynı `invalid credentials` sınıfını döndürür ve session üretmez.
- Kullanıcı tarafından DietBridge Staging üzerinde bir test diyetisyeni oluşturulmalı veya onaylı onboarding akışıyla kaydedilmelidir. Auth kullanıcı kaydına ek olarak `profiles.role = dietitian`, ilgili `dietitian_profiles` kaydı ve web erişimine uygun verification/onay durumu bulunmalıdır. Email confirmation ve ban/disabled durumu da kontrol edilmelidir. Production veya GROUNDLESS hesabı staging login için kullanılamaz.
- Auth kullanıcısı, parola, profile, role veya verification verisi Codex tarafından oluşturulmadı ya da değiştirilmedi. Eksik veya hatalı profile/role/verification kaydı ancak password login başarıyla session ürettikten sonra salt okunur doğrulanabilir.

### İş Paketi 4.2 canlı doğrulama durumu

- `STAGING AUTH SESSION: FAIL — STAGING DIETITIAN ACCOUNT NOT PRESENT / NO SESSION`.
- Loading, success/general-empty, search-empty, query-error, retry-failure, rapid-retry, retry-success ve unmount/return testleri authenticated `/clients` route'u açılamadığı için çalıştırılmadı.
- Production veya staging üzerinde DML/RPC, Auth mutation, migration, RLS, Storage veya fixture işlemi yapılmadı.
- İş Paketi 4.2 durumu `Kod incelemesi geçti / staging auth blokajı nedeniyle canlı doğrulama bekliyor` olarak tutuldu. Aşama 4 `Devam ediyor`; İş Paketi 4.3 başlatılmadı.

### Kullanıcı remediation'ı ve authenticated yeniden test

- Kullanıcı DietBridge Staging üzerinde web erişimine uygun diyetisyen hesabını oluşturup giriş yaptı. Dashboard'un açılması session, `profiles.role = dietitian`, `dietitian_profiles` kaydı ve verification/onay kapılarının başarılı geçtiğini doğruladı.
- `/clients` doğrudan açıldı; reload sonrasında session korundu ve yeni Codex tarayıcı sekmesinde `/clients` session restore ile tekrar açıldı. `/login` yönlendirmesi veya auth loop oluşmadı.
- `STAGING AUTH SESSION: PASS`. Aktif session, role/profile/verification kapılarından geçerek korumalı route'u açtı; istemsiz sign-out veya redirect loop gözlenmedi.
- SPA route geçişinde danışan listesi `loading` görünümü canlı yakalandı; eski liste, empty veya error aynı anda görünmedi. Sorgu tamamlandığında hesapta danışan bulunmadığı için güvenli `general_empty` görünümüne geçildi.
- Hesapta danışan bulunmadığından search-empty testi güvenli veri yokluğu nedeniyle uygulanmadı.
- Normal masaüstü Chrome DevTools'ta yalnız `*/rest/v1/dietitian_clients*` isteği engellendi. Query-error testi `loading → güvenli error` üretti; empty veya eski liste görünmedi, teknik Supabase ayrıntısı gösterilmedi ve `Tekrar Dene` sunuldu.
- Blocking açıkken retry `loading → error` sonucuna döndü ve kalıcı kilit oluşmadı. Loading sırasında retry düğmesi DOM'dan kaldırıldığı için ikinci eşzamanlı etkileşim engellendi; statik in-flight guard incelemesiyle birlikte rapid-retry sonucu PASS olarak kaydedildi.
- Blocking kaldırıldıktan sonra kullanıcı sayfayı yenilemeden `Tekrar Dene` düğmesine bastı; error temizlendi ve gerçek `general_empty` görünümü geldi. Retry-success PASS'tir.
- `/clients` fetch'i loading durumundayken `/appointments` route'una geçildi; eski loading UI unmount oldu. `/clients` route'una dönüşte yeni loading/fetch başladı ve güvenli `general_empty` ile tamamlandı. Kalıcı in-flight kilidi veya görünür unmounted-state-update hatası oluşmadı.
- Production veya staging üzerinde DML/RPC, Auth mutation, migration, RLS, Storage veya fixture işlemi yapılmadı; test hesabı kullanıcı tarafından görev dışı manuel işlemle hazırlandı.
- Secret, parola, cookie, token, Authorization header, tam URL veya tam project ref repository ya da audit belgesine yazılmadı.

Nihai karar:

`WORK PACKAGE 4.2 LIVE VALIDATION PASSED / COMMIT REVIEW READY`

## 34. İş Paketi 4.3 — Danışan Listesi Arama, Durum Filtresi ve Sıralama

### Aktif zincir ve önceki davranış

- Aktif akış `App.tsx → /clients → features/clients/pages/ClientsPage.tsx → features/clients/services/clientService.ts` olarak doğrulandı.
- Önceki arama yalnız ada uygulanıyor, e-postayı kapsamıyor ve sonuçlar deterministik olarak sıralanmıyordu.
- Liste aktif ve bekleyen ilişkileri ayrı gruplarda gösteriyordu; ancak görünür `Filtrele` kontrolü işlevsel değildi. Durum sayacı veya gerçek durum filtresi yoktu.
- Servis `active` ve `pending` durumlarını sunucu tarafında sınırlandırıyor, authenticated diyetisyenin `dietitian_id` değeriyle tenant filtresi uyguluyordu. Rejected/removed ilişkiler listeye alınmıyordu.
- Loading, query/auth error, retry ve stale request koruması İş Paketi 4.2 sözleşmesiyle mevcuttu. Bu öncelik ve hata davranışı korunmuştur.
- Null ad/e-posta değerleri serviste güvenli boş metne dönüştürülüyordu. Bilinmeyen durumların `Pasif` olarak gösterilebilme ihtimali bu pakette fail-closed davranışla kaldırıldı.

### Değişiklik öncesi 20 soruluk denetim

| # | Sonuç |
|---:|---|
| 1 | Arama yalnız ad alanında çalışıyordu. |
| 2 | E-posta aramaya dahil değildi. |
| 3 | Arama metni trim ediliyordu. |
| 4 | Türkçe locale küçük harf dönüşümü kullanılıyordu. |
| 5 | `İ/I/ı/i/Ş/Ğ/Ü/Ö/Ç` dönüşümü browser'ın `tr-TR` locale davranışına dayanıyordu ve aynı normalize fonksiyonu kullanılıyordu. |
| 6 | Açık sıralama olmadığı için DB dönüş sırasına bağlı kart yeri değişikliği mümkündü. |
| 7 | Active ve pending kayıtlar ayrı bölümlerde render ediliyordu. |
| 8 | Gerçek durum filtresi yoktu; görünür filtre kontrolü işlevsel değildi. |
| 9 | Rejected/removed servis sorgusundaki izinli status filtresiyle dışlanıyor; UI yalnız dönen active/pending kayıtları grupluyordu. |
| 10 | Durum sayacı yoktu. |
| 11 | Gerçek durum filtresi olmadığından arama/status kesişimi uygulanmıyordu. |
| 12 | Status state'i bulunmadığından arama temizlerken filtre koruma davranışı uygulanabilir değildi. |
| 13 | Status-filter empty durumu yoktu. |
| 14 | İş Paketi 4.2 error görünümü liste/empty dallarından önce değerlendirildiği için arama tarafından gizlenmiyordu. |
| 15 | Arama client-side çalışıyor ve yeni Supabase isteği başlatmıyordu. |
| 16 | Liste authenticated `dietitian_id` ve izinli status ile sunucuda sınırlandığından client-side arama başka tenant satırı fetch etmiyordu; RLS ayrıca korunuyordu. |
| 17 | Servis yalnız `active` ve `pending` ilişkileri getiriyordu. |
| 18 | Beklenmeyen bir raw status map aşamasına ulaşırsa `Pasif` fallback'i oluşabiliyordu. |
| 19 | Null ad/e-posta servis map'inde boş metne dönüştürüldüğünden arama exception üretmiyordu. |
| 20 | Null-safe ve deterministik bir sıralama uygulanmıyordu. |

### Uygulanan filtre modeli

- Durum filtresi `all | active | pending` tipli state olarak tanımlandı; varsayılan değer `all`dır.
- Görünür kontrol `Tümü`, `Aktif` ve `Bekleyen` yerel button grubudur. `role="group"`, açıklayıcı `aria-label` ve her düğmede `aria-pressed` kullanılır; native button semantiği klavye etkileşimini korur.
- Sayaç eklenmedi. Bu iş paketi ek sorgu veya görsel kalabalık üretmeden arama/filtre davranışını düzeltmekle sınırlandırıldı.
- Arama ad ve e-posta alanlarında çalışır. Girdi ile alanlar trim edilir ve `tr-TR` locale ile küçük harfe çevrilir; null değerler boş metin olarak güvenle ele alınır.
- İşlem sırası desteklenen ilişkiler → seçili durum filtresi → normalize ad/e-posta araması → kopya üzerinde deterministik sıralamadır.
- Sıralama ad → e-posta → ilişki ID sırasındadır ve Türkçe locale karşılaştırması kullanır. Kaynak array mutate edilmez.
- URL veya localStorage kalıcılığı önceki akışta yoktu; bu dar kapsamlı pakette eklenmedi. Filtre değişimi arama metnini, aramayı temizleme ise durum filtresini korur.

### Boş durumlar ve güvenlik sınırı

- Desteklenen kaynak liste boşsa genel boş durum gösterilir.
- Kaynakta veri varken seçili durumda kayıt yoksa duruma özel boş mesaj ve yalnız durum filtresini sıfırlayan `Tümünü Göster` eylemi sunulur.
- Durum filtresinden geçen kayıt varken arama eşleşmiyorsa arama boş durumu ve yalnız aramayı temizleyen eylem sunulur.
- Error ve loading durumları filtrelenmiş listenin önünde değerlendirilir; hata hiçbir zaman empty state olarak maskelenmez.
- Tenant izolasyonu değiştirilmedi: servis authenticated kullanıcının ID’siyle `.eq('dietitian_id', user.id)` ve izinli durumlarla `.in('status', ['active', 'pending'])` kullanmaya devam eder; Supabase RLS savunma katmanı olmaya devam eder.
- Filtreleme yalnız servis tarafından güvenle dönen sonuçlar üzerinde client-side yapılır; yeni Supabase sorgusu veya doğrudan sayfa-level veri erişimi eklenmedi.
- Aktif listede mock veri fallback’i yoktur. `USER_AVATAR` görsel fallback’i ile mevcut kartlardaki süre/haftalık sabit gösterimler bu paketin kapsamı dışında bırakılmış mevcut risklerdir.

### Statik kabul matrisi

| Senaryo | Sonuç | Kanıt |
|---|---|---|
| Başarılı liste, filtre `all` | PASS | Desteklenen active/pending kayıtlar birlikte filtre zincirine girer. |
| Filtre `active` | PASS | Yalnız `Aktif` UI durumu kalır. |
| Filtre `pending` | PASS | Yalnız `Onay Bekliyor` UI durumu kalır. |
| Rejected satır | PASS | Server-side `.in()` kapsamı dışındadır. |
| Removed satır | PASS | Server-side `.in()` kapsamı dışındadır. |
| Bilinmeyen status | PASS | Servis mapping aşamasında fail-closed dışlanır. |
| Ad ile tam arama | PASS | Normalize substring eşleşmesi tam değeri de eşleştirir. |
| Ad ile kısmi arama | PASS | Normalize ad üzerinde `includes()` kullanılır. |
| E-posta ile arama | PASS | Normalize e-posta üzerinde `includes()` kullanılır. |
| Büyük/küçük harf farkı | PASS | Sorgu ve alanlar aynı locale yöntemiyle normalize edilir. |
| Türkçe `İ/i/ı/I` | PASS | Her iki taraf `toLocaleLowerCase('tr-TR')` ile normalize edilir. |
| Baştaki/sondaki boşluk | PASS | Sorgu trim edilir. |
| Yalnız boşluk araması | PASS | Trim sonrası boş arama tüm seçili durum sonucunu korur. |
| Null full_name | PASS | Null değer boş metin olarak normalize edilir. |
| Null email | PASS | Null değer boş metin olarak normalize edilir. |
| `active` + eşleşmeyen arama | PASS | Status sonucu doluysa search empty render edilir. |
| `pending` + eşleşmeyen arama | PASS | Status sonucu doluysa search empty render edilir. |
| `active` filtresinde hiç kayıt yok | PASS | Active-filter empty mesajı render edilir. |
| `pending` filtresinde hiç kayıt yok | PASS | Pending-filter empty mesajı render edilir. |
| Ana liste tamamen boş | PASS | General empty diğer filtre/arama boşluklarından önce gelir. |
| Error state + search metni | PASS | Error görünümü empty/list dallarından önce render edilir. |
| Loading state + status filtresi | PASS | Yalnız loading render edilir. |
| Aramayı temizle | PASS | Yalnız search state sıfırlanır; status korunur. |
| Tümünü göster | PASS | Yalnız status `all` yapılır; arama korunur. |
| Aynı isimli iki kayıt | PASS | E-posta, ardından ID tie-breaker olarak kullanılır. |
| Yeniden render | PASS | Kaynak mutate edilmez ve aynı comparator tekrar uygulanır. |
| Retry sonrası success | PASS | Filtreler güncel `success.clients` kaynağına uygulanır. |
| Unmount | PASS | İş Paketi 4.2 request sequence cleanup'ı değiştirilmedi. |
| Cross-tenant kayıt | PASS | Authenticated `dietitian_id` filtresi ve RLS sınırı değişmedi. |

### Güvenli manuel lokal doğrulama

- Yerel uygulama `--mode staging` ile açıldı ve mevcut authenticated staging oturumu kullanıldı; secret, cookie, token veya Authorization header okunmadı.
- `/clients` üzerinde loading sonrasında güvenli genel boş durum, gerçek `Tümü/Aktif/Bekleyen` filtre seçimi ve `aria-pressed` değişimi doğrulandı.
- Üç boşluktan oluşan aramanın trim edilerek arama-empty üretmediği ve seçili durum filtresini koruduğu doğrulandı.
- `390 × 844` mobil viewport’ta üç filtre düğmesinin görünür olduğu ve grubun yatay taşma üretmediği doğrulandı.
- Test hesabında danışan bulunmadığından ad/e-posta eşleşmesi, active veri, pending veri, durum-empty ve search-empty senaryoları gerçek satırlarla çalıştırılmadı: `LIVE DATA SCENARIOS NOT EXECUTED — SAFE CLIENT FIXTURE UNAVAILABLE`.
- Yeni kullanıcı, danışan, ilişki veya fixture oluşturulmadı; staging ya da production verisine mutation yapılmadı.

### Kalite, riskler ve karar

- Node.js `v24.18.0`; typecheck başarılı; lint `0 error, 56 warning`; production build başarılıdır. Otomatik test scripti mevcut değildir.
- Production build ana chunk'ı `749.43 kB` (`196.18 kB` gzip) ölçülmüş ve 500 kB eşiği uyarısı üretmiştir. Tailwind CDN production uyarısı da canlı tarayıcı kontrolünde devam etmiştir; bu görevde Tailwind migrasyonu veya code splitting yapılmadı.
- Dashboard/MealPlans içindeki mevcut wrapper ve danışan kartlarındaki sabit gösterim riskleri değiştirilmedi.
- Migration, RLS, Auth, Storage, paket veya mobil uygulama değişikliği yapılmadı. İş Paketi 4.1 ve 4.2 durumları değiştirilmedi; Aşama 4 `Devam ediyor` kalır.

Nihai karar:

`WORK PACKAGE 4.3 IMPLEMENTED / REVIEW PENDING`

### Staging canlı doğrulama ve fixture cleanup

- Aktif manifest, tamamlanmış kurulum durumunu; 10 sentetik Auth kullanıcısını, 1 sentetik diyetisyeni, 9 sentetik danışanı, 9 ilişkiyi, `5 active / 2 pending / 1 rejected / 1 removed` başlangıç dağılımını ve sıfır Storage nesnesini doğruladı. Manifestte secret alanı bulunmadı.
- Normal masaüstü Chrome'da authenticated Dietitian A oturumuyla `/clients` açıldı; sayfa yenilemesi oturumu korudu ve istemsiz logout veya yönlendirme gözlenmedi.
- `Tümü`, `Aktif` ve `Bekleyen` filtreleri; ad/e-posta araması, Türkçe `İ/i` ve `I/ı` karşılaştırması, trim, yalnız boşluk sorgusu, null adın e-posta ile bulunması ve arama–filtre kesişimleri sentetik kayıtlarla doğrulandı. Rejected, removed ve cross-tenant kayıtlar hiçbir listede veya arama sonucunda görünmedi.
- Aynı isimli iki kayıt için ad → e-posta → ilişki kimliği sıralaması reload, route dönüşü ve filtre geçişlerinde sabit kaldı. Kaynak array mutate edilmedi ve duplicate kart oluşmadı.
- Search-empty, yalnız aramayı temizleme ve `Tümünü Göster` davranışları doğrulandı. Sentetik active ilişkiler geçici olarak `removed` yapıldığında active-filter empty; pending ilişkiler geçici olarak `removed` yapıldığında pending-filter empty doğru mesaj ve eylemle göründü. Her iki geçici durum da cleanup öncesinde eski değerlerine geri yüklendi.
- `390 × 844` görünümünde filtre düğmelerinin sayfa sınırını aştığı saptandı. `ClientsPage.tsx` kök kapsayıcısına mobil genişliği sınırlayan `max-w-[calc(100vw-2rem)]` eklendi; düzeltme sonrasında üç filtre görünür, grup taşmasız, Tab/Enter/Space ile erişilebilir ve seçili düğme `aria-pressed=true` idi.
- Arama ve filtre state'leri yalnız `useMemo` zincirini günceller. Liste sorgusu yalnız mount/retry yolundaki `loadClients()` çağrısından gelir; arama, filtre, temizleme ve `Tümü` seçimi için yeni `dietitian_clients` sorgusu eklenmemiştir. Kontrollü Chrome arayüzü ağ paneli kaydını sunmadığından bu kanıt kaynak ve canlı etkileşim birlikte incelenerek kaydedildi; header, cookie veya token okunmadı.
- Cleanup komutu `FIXTURE_CLEANUP_VERIFIED` ve `WP43_FIXTURE_CLEANUP_COMMAND_COMPLETE` ile tamamlandı. Aktif manifestin final aggregate değeri Auth users, profiles, client profiles, dietitian profiles, relations, measurements, daily logs, meal plans, meals, appointments, chat messages ve Storage nesnelerinin her biri için `0` oldu.
- Cleanup sonrası `/clients` genel boş durumu canlı olarak göründü. Böylece fixture dışı ilişki olmadığı da doğrulandı; önceki tablo sayımındaki ek satırın grup başlığı olduğu anlaşıldı.
- Production'a bağlantı veya mutation yapılmadı. Staging mutation'ları kullanıcı tarafından interaktif terminalde yalnız manifestteki sentetik fixture kayıtları için gerçekleştirildi. Migration, RLS, Auth ayarı, Storage policy, paket veya mobil uygulama değişikliği yapılmadı.
- Node.js `v24.18.0` altında typecheck başarılı; lint `0 error, 56 warning` ile mevcut baseline'ı aşmadı; production build başarılı oldu. Build ana chunk'ı `749.46 kB` (`196.21 kB` gzip) ve 500 kB uyarısı üretmeye devam ediyor. Otomatik test scripti tanımlı değildir.

Nihai karar:

`WORK PACKAGE 4.3 REVIEW PASSED / COMMIT REVIEW READY`

## 28. WP4.4A — Danışan ilişkilendirme güvenlik sözleşmesi

### Kök neden ve daraltılmış profil erişimi

- P0 kök neden: Baseline içindeki `Dietitians can view client profiles for linking` SELECT policy'si, yalnız caller'ın diyetisyen rolünü kontrol ediyor ve ilişki durumunu kontrol etmiyordu. Bu nedenle ilişkisiz bir diyetisyen, client rolündeki `profiles` satırlarını listeleyebilirdi.
- Yeni migration bu policy'yi kaldırır. Mevcut `Users can view own profile` self-profile policy'si korunur.
- Yeni `Relationship parties can view counterpart profiles` policy'si, yalnız taraflardan biri authenticated caller olduğunda ve aynı `dietitian_clients` satırı `pending` veya `active` ise karşı tarafın temel `profiles` satırına SELECT izni verir.
- `client_profiles`, ölçüm ve diğer sağlık tablolarının active-relationship RLS sözleşmesi değiştirilmez. `profiles` satırı kolon bazında PII koruması sağlamadığından ilişki içindeki karşı taraf temel profil satırının tamamını okuyabilir; daha dar kolon projeksiyonu ihtiyacı ayrı bir privacy kararıdır. Sağlık verisi `profiles` tablosuna taşınmaz.

### Davet RPC sözleşmesi

- Yeni RPC: `public.request_client_connection_by_email(text)`.
- RPC yalnız `authenticated` rolüne EXECUTE verir; `PUBLIC` ve `anon` izinleri kaldırılır. `SECURITY DEFINER` function owner'ı `postgres`, search path'i `pg_catalog, public` olarak sabitlenir; dinamik SQL kullanmaz.
- Caller kimliği yalnız `auth.uid()` ile alınır. `public.is_current_user_dietitian()` ile role ek olarak `verification_status = approved` ve `is_verified = true` kontrol edilir; caller parametresiyle diyetisyen veya danışan UUID'si gönderilemez.
- Girdi e-posta değeri `lower(btrim(...))` ile normalize edilir. Hedef yalnız mevcut `profiles` tablosundaki `client` rolü olabilir; RPC profil, sağlık verisi veya kullanıcı kimliği döndürmez ve Auth kullanıcısı oluşturmaz.
- Sınırlı sonuç sözleşmesi: `requested`, `already_pending`, `already_active`, `unavailable`. Bulunmayan, client olmayan ve başka aktif/bekleyen ilişkiyle uygun olmayan hedefler aynı `unavailable` sonucunu döndürür; hesap enumeration yapılmaz.
- Eski `dietitians_create_pending_client_request` RLS INSERT policy'si kaldırılır. Böylece ham browser INSERT yolu ile caller-controlled client UUID üzerinden davet üretilemez; staging uygulaması ancak WP4.4B RPC entegrasyonuyla cutover edilmelidir.
- Aynı client için transaction-scoped advisory lock, çift unique index kontrolü ve `unique_violation` yakalama birlikte kullanılır. Aynı çiftte `pending`/`active` sonuç idempotenttir; `rejected` ve `removed` kayıtlar aynı çift için güvenli biçimde tekrar `pending` olur.

### Status transition ve timestamp sözleşmesi

| Başlangıç | Hedef | Server-side sonuç |
|---|---|---|
| yok | pending | `requested_at` ve `updated_at` şimdi; diğer lifecycle timestamp'leri boş |
| pending | active | `accepted_at` şimdi; `requested_at` korunur |
| pending | rejected | `rejected_at` şimdi; `requested_at` korunur |
| pending | removed | `removed_at` şimdi; `requested_at` korunur |
| active | removed | `removed_at` şimdi; kabul tarihinin tarihsel kanıtı olarak `accepted_at` korunur |
| rejected / removed | pending | yeni `requested_at` şimdi; eski accepted/rejected/removed timestamp'leri temizlenir |

- Bu matris dışındaki doğrudan status geçişleri fail-closed `23514` exception ile reddedilir.
- Status değişmeden yapılan güvenli kolon update'leri reddedilmez; lifecycle timestamp alanları eski değere geri alınır ve `updated_at` server-side yenilenir.
- Trigger, mevcut mobil `pending → active/rejected` ve web `pending/active → removed` akışlarını korur. RLS'nin yerine geçmez; yalnızca izinli update sonrasında state/timestamp bütünlüğünü uygular.
- Mevcut satırlar için backfill yapılmaz. Güvenilir tarih kaynağı olmayan eksik geçmiş timestamp'lere sahte kesin zaman atamak yerine bu durum staging/prod testlerinde kalan risk olarak ele alınmalıdır.

### Staging matrisi, rollback ve uygulama sınırı

- Staging negatif matris: ilişkisiz diyetisyen profile SELECT reddi; self profile PASS; pending counterpart profile PASS; pending health data reddi; active health erişimi korunur; anon/PUBLIC RPC reddi; unverified veya client caller RPC reddi; nonexistent/client-olmayan/uygun olmayan e-posta için aynı `unavailable`; duplicate/race; rejected/removed reopen; tüm izinli ve izinsiz status geçişleri; timestamp server-side postcondition; direct INSERT RLS reddi.
- Staging doğrulaması, migration uygulanmadan önce web RPC cutover bağımlılığını ve mobile accept/reject regresyonunu da kapsamalıdır. Uygulama yalnız staging için ayrıca onaylanan bir görevde yapılabilir.
- Yerel kalite: `npm run typecheck` başarılı; `npm run lint` `0 error, 56 warning` ile mevcut warning baseline'ını aşmadı; `npm run build` başarılı oldu. Migration sırası CLI ile görüldü. Yerel Supabase stack çalışmadığı için `db lint --local` PostgreSQL bağlantısı kuramadı; bu sonuç lint başarısı sayılmaz ve staging uygulama doğrulamasında tekrar çalıştırılmalıdır.
- Rollback, yeni RPC EXECUTE iznini kaldırıp function/trigger/policy'yi geri almak ve onaylı önceki sınırlı policy setini ayrı, ileri tarihli rollback migration ile yeniden kurmaktır. Baseline veya migration geçmişi yeniden yazılmaz; rollback production'da ayrıca onay gerektirir.
- Bu görevde migration staging veya production'a uygulanmadı; uzaktan SQL/RPC/Auth/fixture mutation yapılmadı.

### Yerel init ve güvenlik doğrulaması — 2026-07-17

- Supabase CLI `2.109.1` tarafından üretilen `supabase/config.toml` ve `supabase/.gitignore` resmî init çıktısı olarak kabul edildi. `.branches`, `.temp`, `.env.keys`, `.env.local` ve `.env.*.local` dışlandı; config, migration ve dokümantasyon Git görünürlüğünü korudu. `supabase/.temp/` okunmadı veya değiştirilmedi.
- `config.toml` geçerli TOML olarak parse edildi. Yapılandırma yalnız yerel hedefleri kullanıyor; remote proje referansı, remote URL, access token, API key, JWT, service-role anahtarı veya veritabanı parolası içermiyor. Yerel portlar API `54321`, DB `54322`, Studio `54323` ve local SMTP `54324` olarak doğrulandı.
- Docker Client/Server `29.6.1` ve Supabase CLI `2.109.1` ile yerel stack başlatıldı. `db reset --local`, `20260713000000`–`20260717100000` active migration zincirini sıfırdan ve sırasıyla uyguladı; WP4.4A migration'ı başarıyla replay edildi. İlk kurulumda bulunmayan policy/trigger için beklenen idempotent notice'lar dışında hata oluşmadı.
- `db lint --local --schema public --level warning --fail-on error` sıfır error ve sıfır warning ile geçti. Böylece önceki yerel stack bağlantı blokajı kapandı; o kayıt yalnız ilk denemenin tarihsel sonucudur.

#### Yerel güvenlik kabul matrisi

| Alan | Senaryo | Sonuç | Kanıt |
|---|---|---|---|
| Introspection | `profiles` ve `dietitian_clients` RLS açık | PASS | Katalog sorguları iki tabloda da RLS'nin etkin olduğunu doğruladı. |
| Introspection | Geniş linking policy kaldırıldı | PASS | Eski tüm-client profil SELECT policy'si bulunmadı. |
| Introspection | Self ve relationship-scoped profil policy'leri mevcut | PASS | Self erişimi ile pending/active counterpart erişimi ayrı policy'lerle bulundu. |
| RPC | Function güvenlik sözleşmesi | PASS | `request_client_connection_by_email(text)` mevcut, `SECURITY DEFINER`, sabit search path ve `postgres` owner doğrulandı. |
| Grant | RPC execute kapsamı | PASS | `authenticated` izinli; `PUBLIC` ve `anon` reddedildi. |
| Profil | Kullanıcının kendi profili | PASS | Authenticated kullanıcı yalnız kendi self satırını okuyabildi. |
| Profil | İlişkisiz client profili | PASS | İlişkisiz diyetisyen hedef profil satırını göremedi. |
| Profil | Pending counterpart profili | PASS | Pending ilişkinin diyetisyeni temel counterpart profilini okuyabildi. |
| Sağlık verisi | Pending ilişki | PASS | Pending diyetisyen client health satırını okuyamadı. |
| Sağlık verisi | Active ilişki | PASS | Active diyetisyen yetkili client health satırını okuyabildi. |
| Cross-tenant | Başka tenant ilişki SELECT/UPDATE | PASS | Satır görünmedi ve mutation uygulanmadı. |
| RPC auth | `anon`, client ve onaysız diyetisyen | PASS | Üç caller sınıfı da fail-closed reddedildi. |
| RPC sonuç | Yeni davet | PASS | İlk uygun çağrı yalnız `requested` döndürdü. |
| RPC sonuç | Tekrar pending davet | PASS | Tekrar çağrı yalnız `already_pending` döndürdü. |
| RPC sonuç | Active ilişki | PASS | Active çift yalnız `already_active` döndürdü. |
| Enumeration | Olmayan, client olmayan ve uygun olmayan hedef | PASS | Üç sınıf da aynı `unavailable` sonucunu verdi; kimlik/profil verisi dönmedi. |
| Duplicate | Aynı çift için tekrar davet | PASS | Unique koruması ikinci ilişki satırını engelledi. |
| Race | İki gerçek eşzamanlı davet | PASS | Ayrı PostgreSQL oturumlarında bir `requested`, bir `already_pending` ve toplam tek ilişki oluştu. |
| Transition | `pending → active` | PASS | Geçiş kabul edildi; `accepted_at` server-side üretildi. |
| Transition | `pending → rejected` | PASS | Geçiş kabul edildi; `rejected_at` server-side üretildi. |
| Transition | `pending → removed` | PASS | Geçiş kabul edildi; `removed_at` server-side üretildi. |
| Transition | `active → removed` | PASS | Geçiş kabul edildi; tarihsel `accepted_at` korundu. |
| Transition | `rejected → pending` | PASS | Yeniden davet kabul edildi; lifecycle timestamp'leri normalize edildi. |
| Transition | `removed → pending` | PASS | Yeniden davet kabul edildi; lifecycle timestamp'leri normalize edildi. |
| Transition | `active → pending` | PASS | Geçersiz geçiş reddedildi. |
| Transition | `rejected → active` | PASS | Geçersiz geçiş reddedildi. |
| Transition | `removed → active` | PASS | Geçersiz geçiş reddedildi. |
| Timestamp | Aynı status ile sahte lifecycle zamanı | PASS | Caller değeri yok sayıldı; server-side değer korundu. |
| Timestamp | INSERT sırasında sahte lifecycle zamanları | PASS | Trigger alanları sözleşmeye göre normalize etti. |

#### Sonuç, cleanup ve kalan riskler

- Yerel testler repository dışındaki sentetik SQL harness'lerinde yürütüldü. Ana matris transaction rollback ile, gerçek concurrency fixture'ı ise açık cleanup ile kapatıldı. Final aggregate; Auth users, profiles, dietitian profiles, client profiles, relations, ilişkili uygulama satırları ve Storage nesnelerinin her biri için `0` oldu.
- Migration veya policy düzeltmesi gerekmedi. `npm run typecheck` geçti; `npm run lint` `0 error, 56 warning` ile baseline'ı aşmadı; `npm run build` geçti. Ana chunk `749.46 kB` (`196.21 kB` gzip) ve 500 kB uyarısı kalan risk olarak sürüyor.
- Staging, production veya GROUNDLESS projesine bağlanılmadı; remote SQL, RPC, Auth, Storage, fixture veya migration history mutation yapılmadı. ROADMAP'te Aşama 4 `Devam ediyor` kaldı.
- Staging uygulaması ve web RPC cutover doğrulaması hâlâ bekliyor. Mevcut web doğrudan INSERT akışı WP4.4B kapsamında RPC'ye taşınmadan migration remote ortama uygulanmamalıdır. Relationship-scoped `profiles` policy'si satır düzeyindedir; kolon düzeyinde daha dar PII projeksiyonu ayrı privacy kararıdır.

Nihai yerel karar:

`WP4.4A LOCAL VALIDATION PASSED / STAGING APPROVAL PENDING`

## 29. WP4.4B — Web danışan davet akışının güvenli RPC'ye geçirilmesi

### Çağrı zinciri ve güvenlik sözleşmesi

- Eski aktif web akışı, diyetisyen tarayıcısından `profiles` tablosunda e-posta/rol araması yapıyor; mevcut ilişkiyi sorguluyor ve `dietitian_clients` tablosuna doğrudan `INSERT` veya yeniden `pending` `UPDATE` gönderiyordu. Bu lookup ve doğrudan yazma zinciri kaldırıldı; başarısız RPC için eski yola fallback bırakılmadı.
- Yeni aktif zincir `ClientsPage → addClientByEmail → supabase.rpc('request_client_connection_by_email', { p_email })` biçimindedir. Servis mevcut authenticated anon client'ı kullanır; admin veya service-role client kullanmaz.
- Migration sözleşmesi `p_email text` parametreli, scalar `text` döndüren `public.request_client_connection_by_email` function'ıdır. Yalnız `requested`, `already_pending`, `already_active` ve `unavailable` sonuçları kabul edilir. Runtime parser bilinmeyen, null veya bozuk dönüşü fail-closed `error` sonucuna indirger.
- Function `SECURITY DEFINER` ve sabit `search_path` kullanır; `PUBLIC`/`anon` EXECUTE kaldırılmış, yalnız `authenticated` rolüne verilmiştir. Yetkisiz caller exception'ı teknik ayrıntı sızdırmadan genel davet hatasına çevrilir.

### UI, enumeration ve state davranışı

- `requested` gerçek pending isteğini bildirir ve danışanın mobil uygulamadan kabul etmesi gerektiğini açıklar. `already_pending` yanıt bekleme, `already_active` mevcut aktif bağlantı bilgisini verir. `unavailable`; hesabın bulunmaması, rolü veya başka ilişki durumu ayrımını açıklamayan tek genel mesaj kullanır.
- Buton `Danışan Davet Et`, modal `Danışana Bağlantı İsteği Gönder`, alan `Danışanın kayıtlı e-posta adresi` ve submit `Bağlantı İsteği Gönder` olarak güncellendi. Anında aktif ekleme izlenimi veren metinler kaldırıldı.
- Form e-postayı trim eder ve geçersiz/boş girdide remote çağrı yapmaz. Submit sırasında butonlar kilitlenir; Enter submit'i korunur. Hata ve bilgilendirme sonuçlarında e-posta korunur, yalnız `requested` sonucunda temizlenir.
- Yalnız `requested` sonrasında liste refetch edilir. Refetch mevcut arama ve durum filtresi state'lerini değiştirmez; başarısız refetch RPC başarısını geri almaz, mevcut listeyi korur ve kontrollü bilgi verir. Modal kapanışı feedback/e-posta state'ini temizler; request sequence ve mounted guard geç async state yazımını engeller.
- Modal `dialog`, `aria-modal`, başlık ilişkisi, etiket/input ilişkisi, açıklama ilişkisi, autofocus, durum/alert live semantics ve erişilebilir kapatma etiketiyle güncellendi. Mevcut responsive sınıflar, liste filtreleri, Türkçe normalizasyon ve deterministik sıralama korunmuştur.

### İlişki kaldırma ve veri sınırları

- Eski `removeClient(clientId)` yalnız client UUID ve dietitian UUID filtresiyle update yapıyor, frontend'den `removed_at` gönderiyor ve `0 row / error yok` sonucunu başarı sayıyordu.
- Detay erişim kapısı artık ilişkinin UUID'sini de okur. `removeClient(relationId)` yalnız authenticated diyetisyenin kendi relation UUID'sini ve yalnız `pending`/`active` statülerini hedefler; `status='removed'` dışında lifecycle timestamp göndermez.
- Mutation `.select('id').maybeSingle()` ile etkilenen satırı açıkça doğrular. Satır dönmezse stale, yanlış tenant veya RLS sonucu güvenli `unavailable/error` alanına iner ve başarı mesajı gösterilmez. Gerçek başarıdan sonra liste route'una dönüş yeni liste sorgusunu başlatır; başarısızlık mevcut detay state'ini korur.
- Pending detay yine yalnız minimum profil özetini yükler. Sağlık, ölçüm ve daily log sorguları yalnız active ilişki kapısından sonra çalışır. Web tarafına pending kabul veya red mutation'ı eklenmedi.

### Yerel doğrulama ve kalite

- Çalışan disposable yerel Supabase stack'inde repository dışındaki sentetik transaction harness'i tekrar çalıştırıldı. `requested`, `already_pending`, `already_active` ve bulunmayan/client olmayan/başka uygun ilişkili hedefler için ortak `unavailable` sonuçları geçti; cross-tenant update sıfır satır döndürdü.
- WP4.4B'ye özel transaction testinde relation-ID ve authenticated owner/status filtreli başarılı kaldırma tek relation UUID'sini döndürdü; `removed_at` trigger tarafından üretildi. Aynı stale kaldırma tekrarında etkilenen satır sayısı `0` oldu ve başarı sayılmaması gereken postcondition doğrulandı.
- Tüm yerel fixture işlemleri transaction rollback ile kapandı. Son aggregate; sentetik Auth user, profile ve relation kayıtları için `0` olarak doğrulandı. Storage nesnesi oluşturulmadı.
- Parser'ın dört allowlist sonucu ve default fail-closed dalı kaynak düzeyinde incelendi; TypeScript union ve exhaustive UI switch'i `npm run typecheck` ile doğrulandı.
- `npm run typecheck`: başarılı. `npm run lint`: başarılı, `0 error, 54 warning`; 56 warning baseline'ı aşılmadı. `npm run build`: başarılı; ana chunk `749.59 kB` (`196.47 kB` gzip) ve 500 kB büyük chunk uyarısı devam ediyor.
- Repository'de otomatik `test` scripti yoktur; test başarılı sayılmadı ve yeni test paketi eklenmedi. Yerel SQL sözleşme testleri ayrıca yukarıda raporlandı.

### Staging canlı regresyon matrisi ve görev sınırı

| Senaryo | Beklenen canlı sonuç |
|---|---|
| Uygun mobil client daveti | `requested`; pending liste refetch'i ve doğru davet mesajı |
| Aynı pending davet | `already_pending`; yeni relation yok, enumeration yok |
| Active danışan daveti | `already_active`; yeni relation yok |
| Bulunmayan/client olmayan/başka uygun ilişkili hedef | Her biri aynı `unavailable` mesajı |
| Pending ilişki kaldırma | Tek owned relation `removed`; liste dönüşünde gizli |
| Active ilişki kaldırma | Tek owned relation `removed`; sağlık erişimi fail-closed |
| Stale veya başka tenant relation | Başarı mesajı yok; mevcut detay/list state'i korunur |
| Reload, arama, active/pending filtre ve 390×844 görünüm | Mevcut WP4.1–4.3 davranışları korunur |

- Bu uygulama görevinde staging, production veya GROUNDLESS projesine bağlanılmadı; remote SQL, RPC, Auth, Storage, fixture, `INSERT`, `UPDATE` veya `DELETE` çalıştırılmadı. WP4.4A migration'ı, baseline migration'ları, RLS/function/trigger/grant, `supabase/config.toml`, `supabase/.gitignore` ve mobil repository değiştirilmedi.
- Aşama 4 `Devam ediyor` kalır. WP4.4B kod incelemesi ve ayrıca açık onaylı staging canlı regresyon testi beklenmektedir; WP4.4C veya İş Paketi 4.5 başlatılmamıştır.

Nihai uygulama kararı:

`WP4.4B IMPLEMENTED / REVIEW PENDING`

### Davet modalı klavye ve odak blocker kapanışı — 2026-07-17

- Önceki kod incelemesi, davet modalında Escape handler, focus trap ve modal kapandıktan sonra opener focus-return bulunmadığı için staging fixture onay kapısını blokladı. Bu görev yalnız `ClientsPage.tsx` içindeki erişilebilirlik davranışını tamamladı; RPC, relation removal veya Supabase sözleşmesi değiştirilmedi.
- `Danışan Davet Et` opener butonu, dialog container ve e-posta input'u typed React ref'lerle izlenir. Modal açıldığında mevcut `autoFocus` davranışı korunur; render sonrası input aktif değilse input, input kullanılamıyorsa `tabIndex={-1}` taşıyan dialog fallback olarak focus alır. Aynı hedef zaten aktifse ikinci focus çağrısı yapılmaz.
- Modal açıkken tek document `keydown` listener'ı kurulur. Normal Escape ortak güvenli close handler'ı çalıştırır. `isAdding` veya senkron request ref kilidi aktifken handler olayı sayfaya bırakmaz ancak close işlemi etkisiz kalır; devam eden request iptal edilmiş veya tamamlanmış gibi gösterilmez.
- Tab focus trap, her keydown anında dialog içindeki güncel ve görünür `button`, `input`, `select`, `textarea`, link ve uygun `tabindex` öğelerini yeniden hesaplar. Son öğede Tab ilk öğeye, ilk öğede Shift+Tab son öğeye döner. Focus dialog dışındaysa ilk öğe, focusable öğe yoksa dialog container focus alır. Disabled ve `aria-hidden=true` öğeler listeye girmez.
- Listener effect cleanup'ında kesin olarak kaldırılır. Açılış ve focus-return animation frame'leri cleanup sırasında iptal edilir; Strict Mode yeniden çalışması duplicate listener veya stale focus üretmez. `wasAddModalOpen` transition ref'i, sayfa ilk mount olduğunda opener'a gereksiz focus verilmesini engeller.
- X ve İptal butonları aynı close handler'ı kullanır. Güvenli kapanış feedback, e-posta, loading ve stale request ref state'ini temizler. Modal DOM'dan çıktıktan sonraki animation frame'de, sayfa hâlâ mounted ve buton mevcutsa focus opener'a döner.
- Dialog `role=dialog`, `aria-modal`, `aria-labelledby`, `aria-describedby` ve label/input ilişkisini korur. Başarı/bilgi mesajları `status`, hata mesajları `alert` live semantics kullanır; modal kontrollerine görünür `focus-visible` ring eklendi.
- `390×844` statik görünüm için dialog yüksekliği viewport içinde sınırlandı ve dikey scroll etkinleştirildi. Mobilde form aksiyonları dikey, geniş ekranlarda yatay dizilir; uzun feedback metni güvenli biçimde kırılır. Close butonu ve form aksiyonları scroll içinde erişilebilir kalır.
- RPC regresyon taramasında davet yalnız `request_client_connection_by_email` çağrısını kullanmaya devam eder; geniş e-posta lookup, doğrudan relation INSERT, fallback mutation veya “başarıyla eklendi” metni yoktur. Relation-ID tabanlı removal, `.select('id').maybeSingle()` sıfır-satır postcondition'ı ve server-side `removed_at` davranışı korunmuştur.
- `npm run typecheck` başarılıdır. `npm run lint` `0 error, 54 warning` ile baseline'ı aşmadı. `npm run build` başarılıdır; ana chunk `751.39 kB` (`197.06 kB` gzip) ve 500 kB uyarısı sürer. `git diff --check` başarılıdır. Repository'de otomatik `test` scripti yoktur.
- Staging canlı regresyonunda mouse açma/kapatma, input ilk focus, Tab ve Shift+Tab çevrimi, dialog dışı focus geri alma, submit sırasında Escape/X/İptal kilidi, işlem sonrası Escape, opener focus-return, Enter submit, live feedback ve `390×844` taşma ayrıca doğrulanacaktır.
- Bu görevde staging, production veya GROUNDLESS'a bağlanılmadı; remote SQL/RPC/Auth/Storage/veri mutation'ı veya fixture işlemi yapılmadı. Migration, config, paket ve mobil repository değiştirilmedi. Aşama 4 `Devam ediyor`; WP4.4C veya İş Paketi 4.5 başlatılmadı.

Nihai erişilebilirlik kararı:

`WP4.4B ACCESSIBILITY FIX PASSED / STAGING REGRESSION APPROVAL REQUIRED`

## 30. WP4.4B — Staging canlı regresyonu ve fixture cleanup kapanışı

### Hedef, fixture ve güvenlik kapıları

- Testler yalnız maskeli referansı `ezwq…rjkv` ile doğrulanan DietBridge Staging projesinde yürütüldü. Production ve GROUNDLESS hedefleri linklenmedi veya kullanılmadı.
- Remote migration history `11/11` eşleşti; pending veya remote-only migration bulunmadı. WP4.4A ilişki güvenlik sözleşmesinin RLS, scoped profile policy, güvenli davet RPC'si, grant/revoke, transition function ve trigger bileşenleri preflight sırasında doğrulandı.
- Repository dışında oluşturulan sentetik fixture seti `11` Auth user, `11` profile, `3` dietitian profile, `8` client profile ve başlangıçta `7` relation içerdi. Davet testiyle yalnız bir yeni pending relation oluştu; toplam izlenen relation sayısı `8` oldu. Storage veya başka uygulama kaydı oluşturulmadı.
- Admin anahtarı yalnız interaktif PowerShell sürecinde environment üzerinden kullanıldı; repository, manifest, rapor ve console çıktısına yazılmadı.

### Canlı davet ve enumeration sonuçları

- Uygun mobil client daveti `requested` sonucu verdi; doğru Türkçe bilgilendirme gösterildi, e-posta alanı temizlendi, mevcut arama ve `pending` filtresi korunarak liste yenilendi.
- Mevcut pending ilişki `already_pending`, mevcut active ilişki `already_active` sonucunu verdi; yeni relation oluşmadı ve giriş değeri korundu.
- Başka tenant'a bağlı client, bulunmayan sentetik hesap ve uygun olmayan hedef aynı genel `unavailable` mesajını verdi. Teknik Supabase, token veya session ayrıntısı gösterilmedi; enumeration mesaj eşitliği geçti.
- Browser kontrol yüzeyi kesin request ledger veya çağrı sayacı sunmadığından RPC/refetch adetleri canlı network kaydı olarak ileri sürülmedi. Aktif kaynak zincirinde geniş profile lookup, doğrudan relation `INSERT` veya fallback mutation bulunmadığı statik olarak doğrulandı; çift submit sonrasında admin postcondition kontrolü yalnız bir yeni relation bulunduğunu doğruladı.

### State, erişilebilirlik ve responsive regresyonu

- `requested` sonrasında liste verisi yenilendi; arama ve durum filtresi korundu. Aramayı temizleme yalnız arama değerini sıfırladı. Ad, e-posta, Türkçe küçük/büyük harf, trim, boş arama ve deterministik sıralama senaryoları doğrulandı.
- Modal açılışında ilk focus e-posta alanına geçti. Escape kapanışı, Tab/Shift+Tab focus trap sınırları, X/İptal/Escape sonrasında opener focus-return ve submit sürerken X/İptal/Escape close engeli geçti.
- `390×844` görünümünde modal ve danışan listesi yatay taşma üretmedi; dialog viewport içinde scroll edilebilir, input ve kapatma kontrolleri erişilebilir kaldı; tablo yerine kart görünümü kullanıldı.
- İstek engellemesi açıkken yükleme durumu hata ve `Tekrar Dene` akışına geçti; engel açıkken retry tekrar kontrollü hataya döndü. Engel kaldırılınca danışan listesi canlı veriyi yeniden yükledi.

### Veri sınırı ve ilişki kaldırma regresyonu

- Pending detay yalnız minimum profil özeti ve bekleme/kaldırma durumunu gösterdi; sağlık, ölçüm ve günlük verileri açılmadı. Active detay yetkili sağlık, yaşam tarzı, ölçüm ve günlük bölümlerini yükledi.
- Pending ve active relation kaldırma işlemleri yalnız hedef relation'ı `removed` yaptı; her ikisi liste dönüşünde gizlendi ve `removed_at` değerlerinin server tarafından üretildiği postcondition ile doğrulandı.
- Stale relation kullanıcı kapsamlı mutation'ı sıfır satır döndürdü ve ilişki `removed` kaldı. Cross-tenant mutation sıfır satır döndürdü ve diğer tenant relation'ı `active` kaldı. Hiçbir yetkisiz başarı mesajı gösterilmedi.
- Rejected/removed kayıtlar listede görünmedi. WP4.1 loading/error/empty ayrımı, WP4.2 canlı error/retry ve WP4.3 arama/filtre/sıralama davranışlarında blocker regresyon görülmedi.

### Cleanup, kalite ve kapanış

- Cleanup marker'ları `FIXTURE_CLEANUP_VERIFIED` ve `WP44B_FIXTURE_CLEANUP_COMMAND_COMPLETE` alındı. Final aggregate; Auth user, profile, dietitian profile, client profile, relation, measurement, daily log, meal plan, meal, appointment, message, diğer uygulama kaydı ve Storage object kategorilerinin tamamında `0` olarak doğrulandı.
- Sentetik credential dosyası arşiv öncesinde kaldırıldı. Kalan dört kanıt dosyası repository dışındaki zaman damgalı `%TEMP%` arşivine taşındı; credential bulunmadığı ve secret değer taramasının `0` sonuç verdiği doğrulandı.
- `npm run typecheck` başarılıdır. `npm run lint` `0 error, 54 warning` ile baseline'ı aşmadı. `npm run build` başarılıdır; ana chunk `751.39 kB` (`197.06 kB` gzip) ve 500 kB büyük chunk uyarısı sürer. Repository'de otomatik `test` scripti yoktur ve test başarılı sayılmadı.
- Production ve GROUNDLESS üzerinde bağlantı, veri mutation'ı, Auth, Storage veya migration işlemi yapılmadı. Staging mutation'ları yalnız açıkça onaylanan sentetik fixture setup, davet/removal güvenlik senaryoları ve manifest tabanlı cleanup ile sınırlı kaldı.
- Geçici staging secret key cleanup tamamlandıktan sonra Supabase Dashboard'dan silinmelidir. Aşama 4 `Devam ediyor`; WP4.4C veya İş Paketi 4.5 başlatılmadı.

Nihai staging kararı:

`WP4.4B REVIEW PASSED / COMMIT REVIEW READY`

## 31. WP4.4C — Danışan profil ve yaşam tarzı canonical read-model normalizasyonu

### Önceki drift ve canonical sözleşme

- Detay servisi daha önce `client_profiles.goal`, `activity_level`, `blood_type`, `sleep_hours`, `chronic_conditions` ve `medications` legacy alanlarını doğrudan UI modeline taşıyor; boolean `smoking_status` ve `alcohol_use` alanlarını string gibi ele alıyordu. Liste ise kan grubunda canonical join kullanırken hedef ve aktivitede legacy değer kullandığı için liste–detay drift'i oluşabiliyordu.
- Baseline migration'da `client_profiles.goal_id → client_goals(label)`, `activity_level_id → activity_levels(label)`, `blood_type_id → blood_types(code)`, `alcohol_status_id → alcohol_statuses(label)` ve `nutrition_type_id → nutrition_types(label)` FK'leri doğrulandı. Katalogların primary key'i `id`, code/name alanlarında unique constraint'leri ve authenticated SELECT RLS policy'leri vardır.
- Sağlık ilişkileri `client_medical_conditions(client_id, condition_id) → medical_conditions(name)` ve `client_medications(client_id, medication_id) → medications_catalog(name)` zinciridir. Her junction çifti unique'tir; client kendi satırlarını yönetebilir, diyetisyen yalnız `active` ilişkiyle SELECT yapabilir. `client_profiles` için de active-dietitian SELECT ve client-own SELECT policy'leri doğrulandı.
- Food intolerance için canonical junction bulunmadı; `food_intolerances` typed legacy array olarak korunur. `disliked_foods`, `sleep_hours_min`, `sleep_hours_max`, `smoking_status` ve `alcohol_use` mevcut canonical kolonlardan okunur.

### Typed read-model ve öncelik politikası

- Ham Supabase satır tipleri ile UI modeli ayrıldı. `ClientLifestyleReadModel`; nullable katalog etiketleri, `boolean | null` sigara/alkol değerleri, nullable numeric uyku sınırları, türetilmiş uyku etiketi ve daima normalize `string[]` listeler taşır. Yeni `any`, `@ts-ignore` veya kontrolsüz UI assertion eklenmedi.
- Canonical FK doluysa yalnız nested katalog gösterim değeri kullanılır. FK dolu fakat katalog satırı yoksa stale legacy text'e dönülmez ve UI `Yok` gösterir. FK null ise trim edilmiş, geçerli legacy text kontrollü fallback olabilir.
- Canonical junction satırı varsa yalnız katalog adları kullanılır; junction sonucu başarıyla boşsa legacy array fallback uygulanır. Junction veya katalog sorgu hatası tüm detay okumasını kontrollü genel hataya indirir, yanlış legacy veri başarı gibi gösterilmez.
- String listeleri kaynak array'i mutate etmeden trim edilir, boş/teknik placeholder değerlerden arındırılır, Türkçe case-insensitive duplicate'lerden temizlenir ve deterministik Türkçe locale sırasına konur.
- `smoking_status` ve `alcohol_use` boolean olarak korunur. UI sigarada `Kullanıyor/Kullanmıyor/Yok`, alkol boolean fallback'inde `Tüketiyor/Tüketmiyor/Yok` gösterir. Canonical `alcohol_status_id` etiketi varsa boolean fallback'ten önce gelir; `false` hiçbir zaman eksik veri sayılmaz.
- Uyku için canonical min/max legacy `sleep_hours` değerinden önce gelir. Eşit sınır `X saat`, aralık `X–Y saat`, tek sınır `En az/En fazla X saat` gösterir. İki canonical kolon da null ise geçerli legacy sayı fallback olabilir; `0`, negatif, 24 üstü, NaN veya ters aralık fail-closed `Yok` olur.
- UI hedef, aktivite, kan grubu, beslenme tipi, alkol/sigara durumu, uyku düzeni, sağlık listeleri, intoleranslar ve sevilmeyen besinlerde yalnız normalize servis modelini kullanır. Eksik scalar ve listelerde ortak metin `Yok`tur; pending görünümüne hassas alan eklenmedi.

### Veri sınırı ve yerel doğrulama

- Aktif zincir `ClientDetails → fetchClientDetails → dietitian_clients relation gate → active-only profiles/client_profiles/catalog/junction reads → normalized read-model` biçimindedir. Pending dalı relation kapısından hemen sonra yalnız `profiles(full_name, avatar_url, email)` okur. İlişki yoksa veya başka tenant client'i ise hassas sorgular başlamaz.
- Canonical kataloglar `client_profiles` sorgusunda tekil FK join'leriyle; junction'lar client UUID açık filtresiyle ayrı, hedefli SELECT'lerle okunur. Sayfaya yeni Supabase sorgusu veya veri normalizasyonu eklenmedi.
- Repository dışı geçici saf helper harness'i Fixture A–E eşdeğerini doğruladı: canonical-only, legacy-only, mixed conflict, null/empty, boolean false, bozuk FK, geçersiz uyku, duplicate/Türkçe sıralama ve kaynak array değişmezliği geçti. Son marker `WP44C_LOCAL_READ_MODEL_MATRIX_PASS` oldu; iki geçici test dosyası silindi. Remote fixture kurulmadı; local/remote uygulama satırı oluşturulmadığı için cleanup aggregate'i başlangıç ve sonuçta `0` kaldı.
- Fixture F/G eşdeğeri kaynak zinciriyle doğrulandı: pending dalında canonical hassas sorgu yoktur; relation bulunmadan veya `active` olmadan canonical okuma başlamaz. Canlı RLS sonucu bu uygulama görevinde remote ortama bağlanılmadan sonraki staging preflight'ına bırakıldı.

### Kalite, staging matrisi ve görev sınırı

- `npm run typecheck` başarılıdır. `npm run lint` `0 error, 53 warning` ile 54 warning baseline'ını aşmadı. `npm run build` başarılıdır; ana chunk `755.30 kB` (`198.07 kB` gzip) ve 500 kB büyük chunk uyarısı non-blocker olarak sürer. Repository'de otomatik `test` scripti yoktur; test başarılı sayılmadı.
- Staging canlı matrisi canonical-only, legacy-only, mixed conflict, null/empty, boolean false, min/max uyku, bozuk FK fail-closed, junction/legacy fallback, pending minimum görünüm, removed/unavailable ve cross-tenant ret senaryolarını içermelidir. Bu görevde staging testi veya fixture mutation'ı yapılmadı.
- WP4.1 invalid UUID/pending/active/unavailable gate'i, WP4.2 loading-error-empty-retry state'leri, WP4.3 arama/filtre/Türkçe normalizasyon/deterministik sıralama ve WP4.4B davet RPC/relation-ID removal/modal davranışı hedefli kaynak incelemesinde korunmuştur. `ClientsPage.tsx` yeniden yazılmadı; liste adapter'ında yalnız ortak canonical goal/activity/blood normalizasyonu kullanıldı.
- Bu görevde migration, RLS, RPC, trigger, function, grant, Storage policy, Supabase config, paket/lockfile veya mobil repository değiştirilmedi. Staging, production veya GROUNDLESS'a bağlanılmadı; SQL, Auth, Storage, fixture veya veri mutation'ı yapılmadı. Aşama 4 `Devam ediyor` kalır; İş Paketi 4.5 başlatılmadı.

Nihai uygulama kararı:

`WP4.4C IMPLEMENTED / REVIEW PENDING`

## 32. WP4.4C — Mobil yatay taşma düzeltmesi

### Staging bulgusu ve gerçek taşma kaynağı

- DietBridge Staging üzerinde tamamlanan canonical read-model canlı matrisi; canonical katalog değerleri, legacy fallback, canonical precedence, null/empty, boolean `false`, junction fallback, pending minimum veri sınırı ve cross-tenant RLS reddini doğruladı. Browser console error sayısı `0` oldu ve bütün sentetik fixture kayıtları manifest tabanlı cleanup ile sıfırlandı.
- Aynı canlı kontrolde `390×844` görünümünde active ve pending detay sayfalarının `main` flex child'ı yaklaşık `500 px` min-content genişliğine büyüdü. Cross-tenant `Danışana Erişilemiyor` görünümünde aynı taşma oluşmadı.
- Repository dışındaki sentetik render harness'inde neden ayrı ayrı ölçüldü. Active görünümde tek satır aksiyon grubu `340 px`, kırılmayan e-posta rozeti `381 px` intrinsic genişlik üretti; iki kat `p-8` yatay padding ile `main/document scrollWidth` `510 px` oldu. Pending görünümde kırılmayan uzun ad/e-posta zinciri `429 px` intrinsic genişlik üretti ve `main` `559 px` oldu. Test browser'ındaki dikey scrollbar nedeniyle `390 px` requested viewport için `documentElement.clientWidth` `375 px` ölçüldü.
- Taşan DOM zincirleri active için sayfa root'u → profil kartı → `flex-1` profil içeriği → `flex gap-3` aksiyon grubu ve e-posta/hedef rozetleri; pending için sayfa root'u → profil kartı → `flex-1` özet içeriği → uzun ad ve e-posta rozeti olarak doğrulandı. Cross-tenant görünümünde bu min-content zincirleri bulunmadığından `main` viewport genişliğinde kaldı.

### Minimal responsive düzeltme

- Değişiklik yalnız `pages/ClientDetails.tsx` içindeki active ve pending render sözleşmesine uygulandı. Sayfa root ve kartlarda `w-full min-w-0`, mobilde `p-4`, genişleyen breakpoint'lerde mevcut padding'i koruyan `sm:p-6 lg:p-8` / `sm:p-8` sınıfları kullanıldı.
- Profil flex child'larına ve grid kolonlarına `min-w-0` eklendi. Active aksiyon grubu `flex-wrap` oldu; buton padding ve touch target değerleri korunarak dar ekranda güvenli satır kırılımı sağlandı.
- Uzun ad, e-posta, telefon, hedef/katalog değerleri ve sağlık/ilaç/intolerans chip'leri `max-w-full`, `break-words` ve yalnız ilgili metin alanında `overflow-wrap:anywhere` ile okunabilir biçimde sarılır. İkonlar `shrink-0` kaldı. İçerik kesilmedi ve global `overflow-x-hidden` veya başka clipping çözümü eklenmedi.
- Grafik grid'i, orta kolon ve kart zinciri `min-w-0` ile gerçek kullanılabilir genişliğe küçülebilir hale getirildi; chart bar container'ları ve mevcut dikey scroll davranışı korunmuştur.

### Önce/sonra metrikleri ve regresyon matrisi

- Baseline sentetik ölçüm (`390×844`, `clientWidth=375`): active `main/scrollWidth=510`, pending `main≈559` ve cross-tenant viewport genişliğindeydi. Düzeltme eşdeğeri harness ölçümünde active, pending ve cross-tenant için `mainWidth=375`, `documentElement.scrollWidth=375`, `body.scrollWidth=375` ve taşan element sayısı `0` oldu.
- `360×800`, `375×812`, `390×844`, `393×852`, `412×915`, `768×1024` ve `1280×800` viewport'larında active, pending ve cross-tenant görünümleri ayrı ayrı ölçüldü. Toplam `21/21` kombinasyonda `scrollWidth <= clientWidth + 1`, `mainWidth <= innerWidth + 1` ve taşan DOM element sayısı `0` koşulları geçti.
- Uzun ad/e-posta/telefon/katalog etiketleri, kronik rahatsızlık, ilaç, intolerans ve sevilmeyen besin chip'leri kırpılmadan wrap oldu. Profil header, pending bilgilendirmesi, relation removal kontrolleri, ölçüm grafiği ve günlük takip alanları viewport'u genişletmedi. Tablet ve desktop grid/flex breakpoint'leri korunmuştur.
- Klavye focus sırası veya DOM sırası değiştirilmedi; butonlar küçültülmedi, touch padding'leri korundu ve active/pending detay kontrollerine görünür `focus-visible` ring eklendi. Metinlerin screen-reader sırası değişmedi; yeni yatay scroll container veya focus'u viewport dışına taşıyan bir kontrol eklenmedi.

### Güvenlik, kapsam ve sonraki kapı

- Responsive değişiklik Supabase sorgusu, mutation, servis/read-model normalizasyonu, pending minimum profil kapısı, active-only hassas okuma, cross-tenant fail-closed davranışı, canonical precedence, legacy fallback, boolean/sleep/junction normalizasyonu, relation-ID removal veya Realtime/refetch zincirini değiştirmez.
- Bu görevde staging, production veya GROUNDLESS'a bağlanılmadı; remote SQL, RPC, Auth, Storage, fixture veya veri mutation'ı yapılmadı. Migration, RLS, Supabase config, package/lockfile ve mobil repository değiştirilmedi.
- Aşama 4 `Devam ediyor` kalır. WP4.4C responsive ve touch-target kontrolleri tamamlanmıştır; final staging güvenlik harness sonucu aşağıdaki kapanış kaydında ayrıca belgelenir. İş Paketi 4.5 başlatılmadı.

Nihai responsive uygulama kararı:

`WP4.4C RESPONSIVE AND TOUCH-TARGET CHECKS PASSED`

## 33. WP4.4C — Minimum touch target düzeltmesi

- Önceki responsive ön incelemesi, pending `İsteği İptal Et` düğmesinin `px-4 py-2` ve temel satır yüksekliğiyle yaklaşık `40 px` yüksekliğe düştüğünü; active ve pending `Listeye Dön` düğmelerinin ise açık bir minimum boyut sözleşmesine sahip olmadığını belirledi.
- Yalnız bu üç yerel `<button>` için `min-h-11 min-w-11` (`44×44 px`) eklendi. Metinli kontroller sabit genişlik verilmeden `inline-flex items-center justify-center` ile hizalandı; mevcut yatay padding, görsel hiyerarşi, DOM/tab sırası ve `focus-visible` ring sınıfları korundu.
- Repository dışı yerel responsive harness ile `360×800`, `375×812`, `390×844`, `393×852`, `412×915`, `768×1024` ve `1280×800` viewport'larında active, pending ve cross-tenant görünümleri yeniden ölçüldü. Toplam `21/21` kombinasyonda `scrollWidth <= clientWidth + 1`, `body.scrollWidth <= clientWidth + 1`, `mainWidth <= innerWidth + 1` ve taşan DOM öğesi sayısı `0` oldu; önceki yatay taşma geri dönmedi.
- `390×844` ölçümünde active `Listeye Dön` `106.19×44 px`, pending `Listeye Dön` `106.19×44 px` ve pending `İsteği İptal Et` `146.16×44 px` oldu. Her kontrol gerçek, etkin `<button>` olarak kaldı; `focus-visible:ring-2` sınıfı korunmuştur. Native button semantiği nedeniyle Tab erişimi ile Enter/Space aktivasyonu korunur; pending iptal düğmesi yalnız mevcut işlem sürerken `disabled` olur ve bu durumda aktivasyon güvenli biçimde engellenir.
- Düzeltme yalnız sunum sınıflarındadır: pending minimum profil sınırı, active-only hassas okuma, cross-tenant fail-closed davranışı, canonical read-model, relation removal ve Supabase/RLS zinciri değişmez. Bu görevde staging, production veya GROUNDLESS'a bağlanılmadı; remote mutation, fixture, migration veya credential işlemi yapılmadı.

## 34. WP4.4C — Final staging güvenlik ve cleanup kapanışı

- Canonical profil/sağlık/yaşam tarzı read-model'i tamamlandı. Liste ve detay akışları canonical katalog/junction önceliğini, typed boolean ve uyku aralığı sözleşmesini, kontrollü legacy fallback'i ve fail-closed hassas veri kapısını kullanır.
- Responsive matris `21/21` geçti; active, pending ve cross-tenant görünümlerinde yatay taşma kalmadı. Active/pending geri dönüş ve pending iptal kontrollerinin minimum `44×44 px` touch target, klavye semantiği ve görünür focus ring kontrolleri tamamlandı.
- DietBridge Staging güvenlik harness sonucu: Preflight `PASS`, Onboarding `7/7`, Harness/fixture failure `0`, RLS `7/7`, RPC `2/2`, functional failure `0`, P0/P1 security failure `0` ve Cleanup `PASS`.
- Cleanup sonrası fiziksel aggregate doğrulaması Auth users `0`, public rows `0` ve Storage buckets `0` sonucunu verdi. Sentetik fixture kalmadı.
- Runtime Node harness migration kataloguna erişemediğinden migration history kontrolü bu harness içinde `NOT EXECUTED` kaldı. Bu sınır başarı gibi raporlanmaz; gerektiğinde ayrı, salt-okunur staging CLI/catalog kontrolüyle ele alınmalıdır.
- Final commit kapısında `npm run typecheck` geçti; `npm run lint` `0 error, 53 warning` ile mevcut baseline seviyesinde geçti; `npm run build` başarılı oldu. Ana chunk `757.52 kB` (`198.32 kB` gzip) ve mevcut 500 kB chunk uyarısı non-blocker olarak sürer. `node --check scripts/staging-security-tests.mjs` ve `git diff --check` geçti.
- Aşama 4'te ölçüm mutation akışları, avatar upload/Storage güvenliği ve detay bölümlerinin kendi error/empty/retry sözleşmeleri açıktır. Bu nedenle Aşama 4 `Devam ediyor` kalır; Aşama 5 başlatılmadı.

Nihai WP4.4C kararı:

`WP4.4C COMPLETE / STAGE 4 CONTINUES`

## 35. WP4.5A — Güvenli ölçüm RPC ve servis sözleşmesi

- WP4.5A uygulandı: active ve doğrulanmış diyetisyen, yalnız kendi active danışanı için hedefli `save_active_client_measurement` RPC'si üzerinden günlük canonical ölçüm kaydedebilir. Geniş bir diyetisyen tablo-write policy'si eklenmedi.
- Ölçüm bütünlük kontrolleri ve RPC migration'ı local Supabase reset, DB lint ve rollback edilen yerel güvenlik matrisine ek olarak DietBridge Staging'de doğrulandı. Ayrı migration history kontrolünde local/remote `12/12` eşleşti ve pending migration `0` oldu. Runtime Node harness migration kataloguna erişemediği için bu kontrol harness içinde `NOT EXECUTED` kalır; ayrı staging-only kontrolün sonucu olarak belgelenir.
- Staging security harness sonucu Measurement RPC `19/19`, RLS `7/7`, RPC `2/2`, güvenlik ve fonksiyonel hata `0`, Cleanup `PASS` oldu. Cleanup sonrasında Auth users `0`, public rows `0`, Storage buckets `0` ve measurement fixture rows `0` doğrulandı.
- Web servis mutation sözleşmesi tamamlandı ve measurement read-model gerçek nullable DB kolonlarıyla eşlendi. Ölçüm ekleme/düzenleme UI formu henüz uygulanmadı.
- Limitsiz measurement history okuması, measurement UI ve UI bölüm bazlı loading/error/empty/retry sözleşmeleri sonraki iş olarak açıktır. Aşama 4 `Devam ediyor` kalır; Aşama 5 başlatılmadı.

## 36. WP4.5B — Measurement UI ve bölüm durumları

- Active danışan detayına mevcut `saveClientMeasurement` servisini kullanan tarih, kilo, bel, kalça, kol, göğüs, uyluk, baldır, boyun ve not alanları eklendi. En az bir sayısal değer zorunludur; boş sayısal alanlar `null` gönderilir. Kilo `20–500 kg`, çevre ölçümleri `> 0` ve `<= 500 cm`, not uzunluğu en fazla `1000` karakterdir; gelecek tarih hem input sınırı hem submit validasyonuyla reddedilir.
- Aynı tarihteki mevcut kayıt tarih seçimi veya geçmiş listesindeki `Düzenle` kontrolüyle forma yüklenir ve aynı RPC upsert sözleşmesi üzerinden güncellenir. Submit sırasında tekrar gönderim engellenir. RPC hatasında form değerleri korunur ve başarı mesajı gösterilmez; başarılı RPC sonrasında measurements tablosu yeniden okunur.
- Measurement fetch profil erişim kapısından ayrıldı. Bölüm kendi `loading`, `error`, `empty` ve `retry` durumlarını kullanır; measurement hatası active profil, sağlık/yaşam tarzı ve günlük takip alanlarını kapatmaz. Exact boş durum metni `Henüz ölçüm kaydı yok` olarak gösterilir.
- Kilo grafiği yalnız `weight !== null` ölçümlerinden ve son iki gerçek kilo kaydının farkından üretilir. Ölçüm yokken profil kilosundan sahte bar oluşturulmaz; kilo içermeyen measurement seti ayrı boş grafik mesajı gösterir. Measurement geçmişi gerçek canonical değerleri ve notları listeler.
- Client detail read-model'indeki kullanılmayan hardcoded `1 Ay` ve `weeklyChange: 0` alanları kaldırıldı. Koşulsuz `Harika İş!` metni nötr, kayıtlı uyum oranı görünümüne çevrildi. Form/grid/kart zinciri `min-w-0`, tek kolon mobil kırılımı ve wrap davranışını korur; bütün form kontrolleri ve butonlar en az `44 px` dokunma alanına sahiptir.
- Pending/active/invalid/unavailable tenant kapıları, relation-ID removal, avatar davranışı ve RLS/RPC/migration sözleşmesi değiştirilmedi. Uygulama geliştirme adımında Supabase remote işlemi, fixture, harness, migration uygulaması, Production/GROUNDLESS bağlantısı, commit veya push yapılmadı.
- DietBridge Staging Chrome runtime doğrulamasında formun boş/geçersiz sınır/gelecek tarih validasyonları, geçerli ölçüm ekleme, liste ve grafiğe yansıma, reload sonrası kalıcılık ve aynı tarihli kaydın yeni satır oluşturmadan güncellenmesi geçti. RPC hata enjeksiyonunda sahte başarı gösterilmedi ve form değerleri korundu.
- Measurement bölümünün `loading`, `error`, `empty` ve `retry` durumları profil ile diğer bölümlerden izole çalıştı. Null kilo grafiğe alınmadı; ölçüm yokken sahte grafik üretilmedi. Liste ve detay read-model'lerindeki hardcoded `1 Ay` ve `weeklyChange: 0` kaldırıldı; gerçek değer yokken nötr `Veri yok` durumu kullanıldı.
- Responsive runtime matrisi `1440×900`, `1024×768` ve `390×844` viewport'larında yatay taşma olmadığını doğruladı. Mobil başlangıçta desktop sidebar kapalı kaldı. Gerçek disposable staging satırında göz butonu ve satır tıklaması aynı `/clients/{clientId}` detay route'una birer SPA navigation üretti; göz butonunun danışana özgü erişilebilir label'ı ve her üç viewport'ta `44×44 px` hit area'sı doğrulandı.
- Runtime fixture cleanup sonucu `PASS` oldu: Final Auth users `0`, public rows `0`, Storage buckets `0` ve measurement fixture rows `0`. Sentetik fixture kalmadı; migration uygulanmadı ve Production/GROUNDLESS'a bağlanılmadı.
- Aşama 4 `Devam ediyor` kalır. Avatar upload/Storage güvenliği ve measurement history için sayfalama/sınırlandırma sonraki işlerdir; Aşama 5 başlatılmadı.

## 37. WP4.6 — Private avatar ve Storage güvenliği kapanışı

- `avatars` bucket private olarak yapılandırıldı. Uygulama canonical `<owner-user-id>/avatar.<jpg|jpeg|png|webp>` path değerini public URL'ye çevirmiyor; private path için yalnız `300 saniye` (`5 dakika`) geçerli signed URL üretiyor. Tam ve güvenilir HTTPS public URL değerleri geriye dönük uyumluluk için korunuyor.
- Storage sözleşmesi owner'ın yalnız kendi canonical path'inde `INSERT`, `UPDATE` ve `DELETE` yapmasına izin verir. Dosya boyutu en fazla `5 MiB`; MIME türleri JPEG, PNG ve WebP ile sınırlıdır. Active ilişkili diyetisyen yalnız danışan profilinde kayıtlı canonical avatar path'ini okuyabilir.
- DietBridge Staging runtime doğrulamasında owner upload/read ve active diyetisyen signed read geçti. Pending diyetisyen, cross-tenant diyetisyen ve anon erişimi reddedildi; foreign canonical path, invalid path, desteklenmeyen MIME ve `5 MiB` üstü dosya kontrolleri geçti.
- Boş, bozuk veya okunamayan avatar değeri initials fallback'e iner. Avatar görseli yükleme hatası yalnız ilgili avatarı fallback'e geçirir; danışan listesini kapatmaz. Runtime doğrulamasında signed URL üretimi, initials fallback ve avatar error isolation geçti.
- Runtime cleanup sonrasında Auth users `0`, public rows `0`, Storage objects `0` ve measurement fixture rows `0` doğrulandı.
- Silme işleminden önce üretilmiş kısa süreli signed URL, Storage object silinmiş olsa bile kalan TTL veya CDN cache süresince geçici olarak okunabilir. Anında signed URL revocation doğrulanmış değildir. Bu, yeni bir yetkisiz erişim veya tenant sınırı kaçağı değil; süreli capability URL/cache yaşam döngüsü limitasyonudur ve **P2 — non-blocking deferred limitation** olarak izlenir. Web avatar upload/delete UI mevcut kapsamda değildir; bu limitasyon Aşama 4 MVP blocker'ı değildir.
- Aşama 4 `Devam ediyor` kalır. Measurement history için limit/pagination hâlâ açık iştir; Aşama 5 başlatılmadı.

Nihai WP4.6 kararı:

`WP4.6 COMPLETE / P2 SIGNED URL CACHE LIMITATION DEFERRED / STAGE 4 CONTINUES`
