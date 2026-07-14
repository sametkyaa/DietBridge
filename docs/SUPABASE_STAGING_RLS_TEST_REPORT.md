# DietBridge — Staging Onboarding ve Negatif RLS Test Raporu

> [!IMPORTANT]
> Bu rapor yalnız staging için tasarlanmış sentetik test harness çıktısıdır. Secret, URL, token, UUID ve email değerleri maskelenir.

## Amaç ve ortam

- Test run: `dbse…1877`
- Staging referansı: `ezwq…rjkv`
- Production ve GROUNDLESS: kullanılmadı.
- Harness: `scripts/staging-security-tests.mjs`

## Test özeti

- Toplam: 17
- PASS: 17
- FAIL: 0
- Security failures P0/P1: 0
- Deferred P1 blockers: 0
- P2 functional blockers: 0
- Cleanup: PASS
- Exit code: 0

| ID | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |
|---|---|---|---|---|---|---|---|
| ONB-Dietitian A | Onboarding | Dietitian A | profile | profile exists | profile exists | PASS |  |
| ONB-Client A | Onboarding | Client A | profile | profile exists | profile exists | PASS |  |
| ONB-Dietitian B | Onboarding | Dietitian B | profile | profile exists | profile exists | PASS |  |
| ONB-Client B | Onboarding | Client B | profile | profile exists | profile exists | PASS |  |
| ONB-Elevation Attempt Dietitian | Onboarding | Elevation Attempt Dietitian | profile | profile exists | profile exists | PASS |  |
| ONB-ELEVATION | Onboarding | Elevation Attempt Dietitian | verification escalation | pending/false | checked | PASS | P0 |
| ONB-INVALID | Onboarding | Invalid Role Attempt | allowlist | rejected or safe role | rejected | PASS | P0 |
| MEALS-SELECT-OWN | Meals | Client A | own and foreign meal select | own visible; foreign hidden | own meal visible; foreign meal hidden; admin fixtures verified | PASS | P2 |
| MEALS-SELECT-CROSS | Meals | Client A | foreign meal select | 0 rows | 0 rows; foreign fixture unchanged by admin verification | PASS | P0 |
| RLS-OWN-PLAN | Meals | Client A | own select | 1 row | 1 row | PASS | P2 |
| RLS-CROSS-PLAN | Meals | Client A | cross-tenant select | 0 rows | 0 row | PASS | P0 |
| RLS-ANON | Anonymous | Anon | profiles select | 0 rows | 0 row | PASS | P0 |
| RLS-SPOOF | Chat | Client A | sender spoofing | denied/0 | denied | PASS | P1 |
| LEGACY-UPDATE | Meals | Client A | direct non-is_eaten update | denied | stored row unchanged | PASS |  |
| DIETITIAN-MEAL-UPDATE | Meals | Dietitian A | own plan meal title update and restore | persisted and restored | dietitian update persisted; original title restored and verified | PASS | P2 |
| RPC-OWN | RPC | Client A | own meal completion | success | success | PASS | P2 |
| RPC-CROSS | RPC | Client A | foreign meal completion | denied | denied | PASS | P1 |

## Cleanup verification

Cleanup yalnız runtime sırasında kaydedilen explicit ID’leri hedefler. Migration, Storage ve Realtime değişikliği yapılmaz.

- Final Auth users: 0
- Final public rows: 0
- Final Storage buckets: 0

## Environment integrity verification

- Runtime migration catalog check: NOT EXECUTED
- Reason: Live migration catalog is not accessible through the runtime test client.
- Separate staging-only Supabase CLI check: PASS
- Local active migrations: 9
- Remote active migrations: 9
- `20260714010000` remote history entry: confirmed

Runtime harness migration history sorgulamadı. Ayrı staging-only Supabase CLI/catalog kontrolünde 9 local ve 9 remote migration eşleşti; `20260714010000` staging remote history’de doğrulandı. Bu gözlemlenebilirlik sınırı harness güvenlik, fonksiyonel veya cleanup sonucunu değiştirmez.

## Güvenlik sonucu

Legacy client direct `meals` UPDATE erişimi staging’de kaldırıldı. Client direct UPDATE testi reddedildi ve admin readback ile fiziksel database değişmezliği doğrulandı. Client SELECT, dietitian UPDATE ve completion RPC akışları korunmuştur. Staging RLS ve mobil regresyon matrisi geçmiştir.

## Fiziksel Android mobil regresyonu

Emülatör kabul kanıtı olarak kullanılmadı. Fiziksel Android telefonda aşağıdaki sonuçlar doğrulandı:

| Senaryo | Sonuç |
|---|---|
| Network rollback | İnternet kapalıyken kontrollü Türkçe hata gösterildi, UI geri döndü ve database `is_eaten` değeri `false` kaldı — PASS |
| Own-meal RPC | Online completion başarılı oldu, UI `Geri Al` durumuna geçti ve database `is_eaten` değeri `true` oldu — PASS |
| Persistence | Uygulama tamamen kapatılıp açıldıktan sonra completion durumu korundu — PASS |
| Foreign-meal RPC | Reddedildi, foreign meal değişmedi; bağımsız güvenlik testi exit code `10` — PASS |
| Mobile fixture cleanup | Final Auth/public/Storage sonucu `0/0/0`, exit code `0` — PASS |

`10` foreign-check senaryosunun beklenen güvenlik başarı kodudur. Genel staging security harness sonucu ayrı olarak exit code `0` ile tamamlanmıştır.
