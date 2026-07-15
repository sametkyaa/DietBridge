# DietBridge — Production Meal Completion RPC Smoke-Test Planı

## 1. Amaç ve mevcut durum

Bu plan, production reconciliation sonrasında `public.set_my_meal_completion(uuid,boolean)` RPC sözleşmesini iki disposable client ile doğrulamak için hazırlanmıştır. Paket bu görevde yalnız statik olarak hazırlanmıştır; production veya staging bağlantısı kurulmamış, fixture oluşturulmamış ve RPC çağrılmamıştır.

```text
Production reconciliation: COMPLETED
Production postflight: PASSED
RPC ready for smoke test: YES
Production RPC smoke test: NOT RUN
Legacy policy: PRESENT
Policy removal allowed: NO
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
cleanup
```

- `preflight`: Network çağrısı yapmaz; yalnız guard/env/manifest durumunu redacted gösterir.
- `setup`: İki disposable client, onboarding satırları, iki plan ve iki meal oluşturur.
- `status`: Yalnız manifestteki explicit ID’leri sayar ve kapıları gösterir.
- `own-check`: Client A’nın kendi meal satırında RPC/persistence/kolon izolasyonunu doğrular.
- `foreign-check`: Client A’nın Client B meal satırını değiştiremediğini hata kodu ve admin persistence read ile doğrular.
- `persistence-check`: Client A meal durumunu `true → false → true` yapar ve her RPC sonrasında ayrı read çalıştırır.
- `anonymous-check`: Session olmadan RPC’nin reddedildiğini ve satırın değişmediğini doğrular.
- `cleanup`: Yalnız manifest explicit ID’lerini doğrulayıp bağımlılık sırasıyla siler.

## 5. Fixture sözleşmesi

Her iki client Admin Auth API ile `email_confirm=true` kullanılarak oluşturulur; signup e-postası veya invite gönderilmez. Auth metadata:

```text
account_type=client
dietbridge_fixture_type=production_meal_rpc_smoke
dietbridge_fixture_run_id=<random run id>
```

`handle_new_user()` trigger’ının `profiles.role=client` ve `client_profiles` satırı oluşturduğu doğrulanır. Her client için `dietitian_id=null` olan bağımsız bir `meal_plan` ve başlangıçta `is_eaten=false` bir `meal` oluşturulur. Böylece fixture hiçbir gerçek production diyetisyenine veya kullanıcı ilişkisine bağlanmaz.

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

Silme öncesinde her Auth kullanıcısının fixture type/run ID metadata’sı; her planın client ID/not marker’ı ve her meal’ın plan ID/title marker’ı doğrulanır. Uyuşmazlıkta kayıt silinmeden fail-closed durulur.

```text
meals
meal_plans
client_profiles
profiles
auth users
manifest
```

Broad delete veya metadata aramasıyla toplu silme yoktur. Silme ve son sayımlar yalnız manifestteki explicit ID’lerle yapılır.

## 9. Mobil ve legacy policy kapısı

Manifestteki mobil alanlar varsayılan `false` değerindedir ve CLI modları bunları `true` yapamaz. Otomatik smoke kontrolleri tam geçse bile araç yalnız:

```text
RPC_SMOKE_TESTS_PASSED=YES/NO
MOBILE_PRODUCTION_TEST_PENDING=YES
POLICY_REMOVAL_ALLOWED=NO
```

üretir. Fiziksel mobil production testi ayrı tamamlanmadan legacy `Clients can update own meal completion` policy’si kaldırılamaz.

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
