# DietBridge — Production Meal Completion RPC Smoke-Test Planı

## 1. Amaç ve mevcut durum

Bu plan, production reconciliation sonrasında `public.set_my_meal_completion(uuid,boolean)` RPC sözleşmesini iki disposable client ve ortak bir disposable diyetisyenle doğrular. İlk iki-client fixture ile production CLI kontrolleri geçti; ilk fiziksel mobil deneme aktif `dietitian_clients` ilişkisi bulunmadığı için uygulamanın beklenen UI kapısında durdu. Eski fixture tamamen temizlendi. Bu revizyonda yalnız mobil uyumlu fixture kodu ve statik kanıtlar hazırlandı; production veya staging bağlantısı kurulmadı, yeni fixture oluşturulmadı ve RPC çağrılmadı.

```text
Production reconciliation: COMPLETED
Production postflight: PASSED
RPC ready for smoke test: YES
Production CLI RPC smoke tests: PASSED
First physical mobile attempt: BLOCKED BY INCOMPLETE FIXTURE
RPC defect observed: NO
Mobile app defect proven: NO
Blocker: missing active dietitian_clients fixture relation
Old fixture cleanup: PASSED
Remaining old fixture records: 0
Legacy policy: PRESENT
Policy removal allowed: NO
Production mobile-ready fixture correction: PREPARED
Physical mobile retry: PENDING
Policy removal: BLOCKED
```

## 2. Araçlar

- `scripts/production-meal-rpc-smoke-fixture.mjs`: production fixture yaşam döngüsü ve smoke kontrolleri.
- `scripts/production-meal-rpc-smoke-fixture.test.mjs`: network kullanmayan statik/unit güvenlik regresyonları.
- Manifest: `%TEMP%\dietbridge-production-meal-rpc-smoke-manifest.json`.

Production manifesti staging manifestinden ayrıdır ve repository dışında tutulur. Credential, UUID ve generated email yalnız manifestte bulunur; terminal veya dokümantasyona yazılmaz.

## 3. Zorunlu environment kapıları

Network kullanan her moddan önce aşağıdaki değişkenler yalnız interaktif terminal environment alanında tanımlanmalıdır:

```text
DIETBRIDGE_TARGET_ENV=production
DIETBRIDGE_PRODUCTION_SMOKE_ACK=I_UNDERSTAND_THIS_WRITES_DISPOSABLE_TEST_DATA
DIETBRIDGE_PRODUCTION_ADMIN_KEY=<terminal environment secret>
```

Production URL ve publishable key repository kökündeki takip edilmeyen `.env` dosyasından okunur. `.env.staging.local` mevcutsa production ve staging URL/project reference ayrımı fail-closed doğrulanır. Service-role/secret key, publishable key olarak kullanılamaz; hiçbir key, URL veya reference çıktıya yazılmaz.

## 4. Desteklenen modlar

```text
preflight
setup
status
own-check
foreign-check
persistence-check
anonymous-check
mobile-confirm
cleanup
```

- `preflight`: Network çağrısı yapmaz; yalnız guard/env/manifest durumunu redacted gösterir.
- `setup`: Bir onaylı disposable diyetisyen, iki disposable client, iki aktif ilişki, iki plan ve iki meal oluşturur.
- `status`: Yalnız manifestteki explicit ID’leri sayar ve kapıları gösterir.
- `own-check`: Client A’nın kendi meal satırında RPC/persistence/kolon izolasyonunu doğrular.
- `foreign-check`: Client A’nın Client B meal satırını değiştiremediğini hata kodu ve admin persistence read ile doğrular.
- `persistence-check`: Client A meal durumunu `true → false → true` yapar ve her RPC sonrasında ayrı read çalıştırır.
- `anonymous-check`: Session olmadan RPC’nin reddedildiğini ve satırın değişmediğini doğrular.
- `mobile-confirm`: Yalnız yerel manifesti okur; bütün CLI kontrolleri ve üç exact manuel `PASS` onayı olmadan değişiklik yapmaz. Network veya admin key kullanmaz.
- `cleanup`: Yalnız manifest explicit ID’lerini doğrulayıp bağımlılık sırasıyla siler.

## 5. Fixture sözleşmesi

Disposable diyetisyen ve iki client Admin Auth API ile `email_confirm=true` kullanılarak oluşturulur; signup e-postası veya invite gönderilmez. Her kullanıcıda fixture type ve run ID metadata’sı bulunur. Diyetisyen metadata’sında `account_type=dietitian`, client metadata’sında `account_type=client` kullanılır.

```text
dietbridge_fixture_type=production_meal_rpc_smoke
dietbridge_fixture_run_id=<random run id>
```

`handle_new_user()` trigger’ının diyetisyen için `profiles` ve `dietitian_profiles`, client’lar için `profiles` ve `client_profiles` satırlarını oluşturduğu doğrulanır. Diyetisyen canonical `verification_status → is_verified` trigger sözleşmesiyle `approved/true` durumuna getirilir; `is_verified` doğrudan yazılmaz. Dietitian D ile Client A ve Client B arasında `status=active` ve `accepted_at` içeren iki explicit ilişki kurulur. Her plan ilgili client’a ve aynı Dietitian D’ye bağlıdır; her planda başlangıçta `is_eaten=false` bir meal bulunur. Fixture hiçbir gerçek production kullanıcısına bağlanmaz.

Setup’ın redacted sayım sözleşmesi:

```text
setup=PASS
fixture_dietitians=1
fixture_clients=2
fixture_active_connections=2
fixture_meal_plans=2
fixture_meals=2
manifest_written=YES
```

Manifest `clients.a`, `clients.b`, `dietitian.d`; kullanıcı, subtype profil, ilişki, plan ve meal explicit ID’leri ile connection/client/dietitian, plan/client/dietitian ve meal/plan/title sahiplik haritalarını tutar. Credential ve kimlikler yalnız `%TEMP%` manifestindedir.

Setup sonrasındaki `status` yalnız explicit kayıtları okuyarak şu mobil hazır olma kanıtlarını da üretir:

```text
dietitian_auth_users_present_count=1
dietitian_profiles_present_count=1
active_connections_present_count=2
meal_plans_with_expected_dietitian_count=2
mobile_fixture_ready=YES
```

## 6. Çalıştırma sırası

Komutlar yalnız ayrı manuel production onayı ve doğru interaktif environment sonrasında sırayla çalıştırılmalıdır:

```powershell
node .\scripts\production-meal-rpc-smoke-fixture.mjs preflight
node .\scripts\production-meal-rpc-smoke-fixture.mjs setup
node .\scripts\production-meal-rpc-smoke-fixture.mjs status
node .\scripts\production-meal-rpc-smoke-fixture.mjs own-check
node .\scripts\production-meal-rpc-smoke-fixture.mjs foreign-check
node .\scripts\production-meal-rpc-smoke-fixture.mjs persistence-check
node .\scripts\production-meal-rpc-smoke-fixture.mjs anonymous-check
node .\scripts\production-meal-rpc-smoke-fixture.mjs status
## Fiziksel mobil doğrulama tamamlandıktan sonra, ayrı ağsız terminal adımı:
$env:DIETBRIDGE_MOBILE_OWN_TOGGLE_ACK='PASS'
$env:DIETBRIDGE_MOBILE_PERSISTENCE_ACK='PASS'
$env:DIETBRIDGE_MOBILE_FOREIGN_NOT_EXPOSED_ACK='PASS'
node .\scripts\production-meal-rpc-smoke-fixture.mjs mobile-confirm
node .\scripts\production-meal-rpc-smoke-fixture.mjs status
node .\scripts\production-meal-rpc-smoke-fixture.mjs cleanup
node .\scripts\production-meal-rpc-smoke-fixture.mjs status
```

Manifest `foreign-check` öncesinde `own-check`, `persistence-check` öncesinde own/foreign ve `anonymous-check` öncesinde own/foreign/persistence sonuçlarını zorunlu tutar. `cleanup` güvenlik amacıyla her aşamada çalıştırılabilir.

## 7. Beklenen redacted sonuçlar

Own:

```text
own_rpc_return=PASS
own_persistence=PASS
unrelated_columns_unchanged=PASS
foreign_row_unchanged=PASS
```

Foreign:

```text
foreign_rpc_rejected=PASS
foreign_persistence_unchanged=PASS
```

Persistence:

```text
toggle_false_persisted=PASS
toggle_true_persisted=PASS
```

Anonymous:

```text
anonymous_rpc_rejected=PASS
anonymous_persistence_unchanged=PASS
```

## 8. Cleanup modeli

Silme öncesinde her Auth kullanıcısının fixture type/run ID metadata’sı; subtype profillerin fixture Auth sahipliği; ilişkilerin beklenen diyetisyen/client/status sözleşmesi; planların client/diyetisyen/not marker’ı ve meal’ların plan/title marker’ı doğrulanır. Uyuşmazlıkta kayıt silinmeden fail-closed durulur.

```text
meals
meal_plans
dietitian_clients
client_profiles
dietitian_profiles
profiles
auth users
manifest
```

Broad delete veya metadata aramasıyla toplu silme yoktur. Silme ve son sayımlar yalnız manifestteki explicit ID’lerle yapılır.

## 9. Mobil ve legacy policy kapısı

Manifestteki mobil alanlar varsayılan `false` değerindedir ve CLI modları bunları `true` yapamaz. Fiziksel cihazda Client A için kendi meal toggle, restart sonrası persistence ve Client B meal’ının görünmemesi doğrulanır. Ağsız `mobile-confirm` yalnız şu üç exact environment onayının tamamında manifesti günceller:

```text
DIETBRIDGE_MOBILE_OWN_TOGGLE_ACK=PASS
DIETBRIDGE_MOBILE_PERSISTENCE_ACK=PASS
DIETBRIDGE_MOBILE_FOREIGN_NOT_EXPOSED_ACK=PASS
```

`status` şu birleşik kapıları üretir:

```text
RPC_SMOKE_TESTS_PASSED=YES/NO
MOBILE_PRODUCTION_TEST_PENDING=YES/NO
POLICY_REMOVAL_ALLOWED=YES/NO
```

`POLICY_REMOVAL_ALLOWED=YES` yalnız dört CLI kontrolü, üç manuel mobil kontrol ve canlı fixture database state doğrulaması birlikte geçtiğinde mümkündür. Bu çıktı policy kaldırmaz; cleanup öncesinde dahi SQL veya migration otomatik çalıştırılmaz. Fiziksel mobil production retry tamamlanmadan legacy `Clients can update own meal completion` policy’si kaldırılamaz.

## 10. Fail-closed ve operasyon notları

- Eksik/yanlış production guard’da network client oluşturulmaz.
- Mevcut production manifesti yeni setup’ı engeller.
- Kısmi setup hatasında kaydedilmiş explicit ID’ler için cleanup denenir; cleanup başarısızlığı manifesti korur.
- Hata çıktıları URL, key, token, email ve UUID için redact edilir.
- Production veya staging SQL, migration, policy değişikliği ve deployment bu paketin kapsamı dışındadır.

## 11. Bu görevde uygulanmayan işlemler

```text
Production veya staging’e bağlanılmadı.
Fixture oluşturulmadı.
RPC çağrılmadı.
Legacy policy kaldırılmadı.
Production verisi değiştirilmedi.
```
