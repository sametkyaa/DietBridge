# DietBridge — Supabase Güvenlik Mimari Kararları

> [!CAUTION]
> Bu belge ve bağlantılı SQL dosyaları taslaktır. Production Supabase projesinde uygulanmamıştır. Staging doğrulaması ve açık production onayı olmadan çalıştırılamaz.

## Amaç ve karar durumu

Bu belge Aşama 3A denetiminde production uygulamasını engelleyen üç mimari kararı kapatır. Kararlar **önerildi** durumundadır; **staging doğrulaması bekliyor** ve **production onayı bekliyor**.

| Karar | Durum | Bağlı taslak |
|---|---|---|
| Verification alanlarının tek kaynağı | Önerildi; staging doğrulaması bekliyor | `202607130006_verification_consistency.sql` |
| Güvenli auth/onboarding | Önerildi; staging doğrulaması bekliyor | `202607130007_auth_onboarding_hardening.sql` |
| Client meal completion RPC | Önerildi; staging doğrulaması bekliyor | `202607130008_meal_completion_rpc.sql` |

## Mevcut doğrulanmış durum

- `dietitian_profiles.verification_status` yalnızca `pending`, `approved` ve `rejected` değerlerini kabul eder; `is_verified` ise ayrı, nullable bir boolean alandır.
- Salt-okunur aggregate kontrolünde approved, pending, rejected, null ve other dağılımı ile iki alanın tutarlılığı ölçüldü. **1** tutarsız kayıt bulundu; satır, kimlik veya kullanıcı verisi okunmadı.
- `on_auth_user_created` tetikleyicisi `public.handle_new_user()` çağırır. Mevcut function yalnızca `client` metadata’sını düşük yetkili role dönüştürür; dietitian metadata’sını işlemeyip role için boş değer bırakabilir.
- `meals` tablosundaki mevcut `Clients can update own meal completion` policy’si client’ın kendi planındaki satırın tüm güncellenebilir alanlarına UPDATE verebilir; RLS tek başına kolon bazlı UPDATE sınırı koymaz.

## Mimari karar 1 — Verification tutarlılığı

### Durum

Mevcut iki alan birbiriyle çelişebilir. Web auth resolver’ı çelişkiyi fail-closed ele alsa da veritabanı düzeyinde bunu sürekli koruyan bir model yoktur.

### Karar

`verification_status` kanonik alandır. `is_verified` yalnızca geçiş ve eski istemci uyumluluğu için tutulan türetilmiş mirror alandır:

| `verification_status` | `is_verified` |
|---|---:|
| `approved` | `true` |
| `pending` | `false` |
| `rejected` | `false` |
| null veya tanımsız | kabul edilmez; erişim verilmez |

`202607130006_verification_consistency.sql`, izinli durumları tekrar kontrol eder, mevcut tutarsızlık varken fail-closed durur, ardından mirror trigger ve consistency constraint modelini ekler. Browser’daki normal diyetisyen kendi verification alanlarını değiştiremez. Yönetim veya güvenilir backend dışındaki hiçbir yol approval veremez.

### Gerekçe

Kanonik bir durum alanı, approval/pending/rejection akışını açık tutar. Boolean mirror eski istemcilerin geçici uyumluluğunu korur; yetkilendirme kararı yalnız boolean’a dayanmaz. Bilinmeyen veya eksik durum hiçbir zaman approved sayılmaz.

### Etkilenen nesneler

- `public.dietitian_profiles.verification_status`
- `public.dietitian_profiles.is_verified`
- `public.trg_sync_dietitian_verification_fields`
- `public.dietitian_profiles_verification_consistency_check`
- `features/auth/services/authService.ts`
- `features/dietitians/services/dietitianService.ts`

### Web etkisi

Web tarafındaki `resolveVerificationStatus` geçiş süresince iki alanı fail-closed okumaya devam etmelidir. Yeni veya güncellenmiş diyetisyen profilinde browser yalnız başvuru alanlarını göndermeli; `verification_status`, `is_verified`, `verified_at` ve `rejection_reason` göndermemelidir. Yönetim onayı ayrı bir güvenilir server-side akışa taşınmalıdır.

### Mobil etkisi

Mobil repository bu çalışma alanında değildir. Mobil uygulama approval durumunu okuyorsa kanonik `verification_status` sözleşmesine uyum kontrolü gerekir; mobil istemcinin bu alanları yazmaması zorunludur. Dosya adı varsayılmamıştır.

### Migration etkisi

Taslak önce staging’de aggregate kapısı ile denenir. Tutarsızlık varsa trigger/constraint kurulumu durur. Ayrı, açık onaylı veri onarımı yalnız `is_verified` değerini kanonik status’tan türetir; yeni status veya approval üretmez.

### Rollback

Staging kanıtı olmadan production rollback yapılmaz. Gerekirse önce constraint ve trigger hedefli olarak geri alınır; mevcut kayıtlar otomatik değiştirilmez. RLS kapatma rollback değildir.

### Açık risk

Mevcut tutarsız kaydın iş kuralına uygun değerlendirilmesi için veri sahibi/yönetim onayı gerekir. Bu görevde hiçbir verification kaydı değiştirilmemiştir.

## Mimari karar 2 — Güvenli dietitian onboarding ve `profiles.role`

### Durum

Mevcut web kaydı `registerDietitian()` içinde auth signup sonrasında browser’dan `profiles.role = dietitian` upsert’i ve `dietitian_profiles` upsert’i deniyor. Mevcut auth trigger ise user metadata içinden yalnız `client` talebini işler. Bu iki yol parçalı başarı, e-posta onayı sonrası eksik profil ve rol yükseltme riski doğurur.

### Karar

Tek onboarding yolu `auth.users` INSERT tetikleyicisi `public.handle_new_user()` olur. `raw_user_meta_data` kullanıcı kontrollüdür; yalnız başvuru tipini seçmekte kullanılır, yetkilendirme iddiası değildir.

- Kabul edilen başlangıç türleri yalnız `client` ve `dietitian`dır; diğer değerler güvenli hata ile reddedilir.
- Client kaydında `profiles.role = client` ve `client_profiles` satırı oluşturulur.
- Public dietitian başvurusunda `profiles.role = dietitian`, `dietitian_profiles.verification_status = pending`, `is_verified = false` oluşturulur.
- `role = dietitian` tek başına web dashboard erişimi vermez. Aşama 2 auth akışı diyetisyen profilini ve approved durumunu ayrıca kontrol eder.
- Var olan client hesabı metadata veya browser profile update ile dietitian’a yükseltilemez. Browser doğrudan role INSERT/UPDATE yapamaz.
- Service role, admin rolü veya ayrıcalıklı backend kavramı browser’a taşınmaz.

Public dietitian signup, yalnız pending başvuru oluşturduğu ve hassas erişim/ön-onay vermediği sürece kabul edilebilir bir modeldir. Daha güçlü alternatifler Edge Function/backend onayı, admin tarafından davet veya yalnız yönetimli başvurudur; bu alternatifler bu görevde oluşturulmaz.

### Gerekçe

Auth kullanıcısı ile profil satırları aynı transaction içinde oluşturulur. Browser’ın ikinci bir profile/role yazmasına ihtiyaç kalmaz. Bilinmeyen metadata fail-closed olur; mevcut client hesabı role yükseltmesi için güvenilir yönetim kanalı gerekir.

### Etkilenen nesneler

- `auth.users`
- `public.on_auth_user_created`
- `public.handle_new_user()`
- `public.profiles`
- `public.client_profiles`
- `public.dietitian_profiles`
- `features/dietitians/services/dietitianService.ts`
- `features/auth/services/authService.ts`
- `features/auth/context/AuthContext.tsx`

### Web etkisi

`features/dietitians/services/dietitianService.ts` içindeki browser `profiles` upsert’i ve sistem alanlı `dietitian_profiles` upsert’i kaldırılmalı veya yalnız güvenli başvuru alanlarını yöneten uyumlu bir akışa dönüştürülmelidir. Dietitian akışında browser `client_profiles` insert’i de yapılmamalıdır; bunu yalnız trigger client signup için oluşturur. E-posta doğrulaması etkinse, kullanıcı ilk session’ı almadan önce de trigger profilini oluşturur; istemci bunu eksik profil olarak yanlış göstermemelidir. Diploma upload başarısızlığı ve tekrar deneme için açık, idempotent başvuru akışı ayrıca tasarlanmalıdır.

`authService.resolveAuthAccess` ve `AuthContext`, mevcut pending/rejected/approved fail-closed davranışını korumalıdır. Bu karar uygulama kodu değişikliği yapmaz.

### Mobil etkisi

Mobil client signup’ın `account_type` veya `role` metadata sözleşmesi staging’de tekrar doğrulanmalıdır. Mobil taraf mevcut client profilini browser dışından dietitian’a çevirememelidir. Mobil kaynak bu repository’de olmadığından dosya veya çağrı yolu varsayılmamıştır.

### Migration etkisi

`202607130007_auth_onboarding_hardening.sql`, gerçek mevcut `handle_new_user()` signature’ını `CREATE OR REPLACE` ile korur; yeni veya ikinci bir auth trigger oluşturmaz. Mevcut trigger adı staging’de tekrar doğrulanmalıdır. Sonraki relationship policy taslağı, browser self-profile INSERT politikasını ancak bu onboarding yolu ve web/mobil uyumluluğu doğrulandıktan sonra kaldırabilir.

### Rollback

Uygulamadan önce function definition, trigger definition ve execute grant envanteri saklanır. Sorunda önce önceki function tanımı hedefli geri alınır; kullanıcı rolleri veya auth kullanıcıları otomatik değiştirilmez.

### Açık risk

Dietitian diploma/yükleme başvurusu auth profili oluşturulduktan sonra başarısız olabilir. Başvuru tamamlama ve yönetim incelemesi için güvenilir bir server-side süreç ayrı görevde netleştirilmelidir.

## Mimari karar 3 — Client meal completion

### Durum

Client’ın kendi planındaki öğün için mevcut geniş UPDATE policy’si, yalnız `is_eaten` alanını değil satırın diğer güncellenebilir alanlarını da değiştirmeye izin verir.

### Karar

Client completion yazması `public.set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)` RPC’si üzerinden yapılır. Function:

- çağıran kimliği yalnız `auth.uid()` ile alır;
- client veya plan kimliği parametresi kabul etmez;
- `meals` ile `meal_plans` join’i üzerinden öğünün çağıranın kendi planına aitliğini doğrular;
- yalnız `is_eaten` alanını günceller;
- bulunamadı ve yetkisiz durumlarını aynı güvenli hata ile döndürür;
- sabit `search_path`, `SECURITY DEFINER`, `PUBLIC`/`anon` execute revoke ve yalnız `authenticated` grant içerir.

`SECURITY DEFINER`, eski geniş policy kapatıldıktan sonra dar update yolunun RLS tarafından engellenmemesi için gereklidir; function içindeki sahiplik doğrulaması bu nedenle zorunludur. Yeni RPC doğrulanmadan ve istemciler geçmeden eski policy kaldırılmaz.

### Gerekçe

Postgres RLS policy’si UPDATE için satır izinlerini belirler, kolon bazlı yazma sözleşmesi oluşturmaz. Dar RPC, işlevi tek bir boolean değişikliğine ve çağıranın kendi planına bağlar.

### Etkilenen nesneler

- `public.meals`
- `public.meal_plans`
- `public.set_my_meal_completion(uuid, boolean)`
- `Clients can update own meal completion` policy’si
- Mobil client meal completion akışı

### Web etkisi

Bu web repository’sinde diyetisyen plan yönetimi `features/meal-plans/services/mealPlanService.ts` üzerinden plan/öğün CRUD yapar; client completion RPC’sine çağrı yapmaz. Gereksiz web kodu değişikliği yapılmamalıdır. Diyetisyen meal update policy’leri, client RPC geçişinden bağımsız olarak staging’de kontrol edilir.

### Mobil etkisi

Mobil repository bu çalışma alanında değildir. Mobil client tamamlanma akışı, geniş UPDATE yerine yalnız bu RPC’yi çağıracak şekilde ayrı görevde incelenmeli ve değiştirilmelidir. RPC’ye geçiş doğrulanmadan eski policy kaldırılmaz.

### Migration etkisi

`202607130008_meal_completion_rpc.sql` function/grant taslağını ekler fakat eski geniş policy’yi kaldırmaz. `202607130002_relationship_policy_hardening.sql` içindeki kaldırma, yalnız mobil uyumluluğu ve staging negatif testlerinden sonra etkinleştirilecek ayrı bir adım olarak işaretlenmiştir.

### Rollback

RPC kullanımında sorun olursa eski policy’yi açmak otomatik rollback değildir. Önce function definition ve istemci çağrısı staging’de düzeltilir. Production’da policy/grant geri dönüşü ayrı açık onay ister.

### Açık risk

Mobil istemcinin gerçek çağrı yolu bu repository’de incelenemedi. Staging’de yetkili client, ilişkisiz client, dietitian ve anon ile hem RPC hem doğrudan UPDATE negatif testleri zorunludur.

## Uygulama sınırı

Bu kararlar uygulama, commit veya push değildir. Staging projesi bulunamadığı için otomatik proje oluşturulmamıştır. Sonraki güvenli adım, `docs/SUPABASE_STAGING_RUNBOOK.md` içindeki kullanıcı kontrollü staging kurulumu ve sentetik hesaplarla kanıt toplamaktır.
