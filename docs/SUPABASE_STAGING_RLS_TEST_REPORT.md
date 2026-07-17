# DietBridge — Staging Onboarding ve Negatif RLS Test Raporu

> [!IMPORTANT]
> Bu rapor yalnız staging için tasarlanmış sentetik test harness çıktısıdır. Secret, URL, token, UUID ve email değerleri maskelenir.

## Amaç ve ortam

- Test run: `dbse…3cdd`
- Staging referansı: `ezwq…rjkv`
- Production ve GROUNDLESS: kullanılmadı.
- Harness: `scripts/staging-security-tests.mjs`

## Test özeti

- Toplam: 17
- PASS: 17
- FAIL: 0
- Harness / fixture failures: 0
- RLS assertions: 7/7
- RLS assertion failures: 0
- RPC assertions: 2/2
- RPC assertion failures: 0
- Functional failures: 0
- Security failures P0/P1: 0
- Deferred P1 blockers: 0
- P2 functional blockers: 0
- Cleanup failures: 0
- Cleanup: PASS
- Exit code: 0

| ID | Sınıf | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |
|---|---|---|---|---|---|---|---|---|
| ONB-Dietitian A | Onboarding assertion | Onboarding | Dietitian A | profile | profile exists | profile exists | PASS |  |
| ONB-Client A | Onboarding assertion | Onboarding | Client A | profile | profile exists | profile exists | PASS |  |
| ONB-Dietitian B | Onboarding assertion | Onboarding | Dietitian B | profile | profile exists | profile exists | PASS |  |
| ONB-Client B | Onboarding assertion | Onboarding | Client B | profile | profile exists | profile exists | PASS |  |
| ONB-Elevation Attempt Dietitian | Onboarding assertion | Onboarding | Elevation Attempt Dietitian | profile | profile exists | profile exists | PASS |  |
| ONB-ELEVATION | Onboarding assertion | Onboarding | Elevation Attempt Dietitian | verification escalation | pending/false | checked | PASS | P0 |
| ONB-INVALID | Onboarding assertion | Onboarding | Invalid Role Attempt | allowlist | rejected or safe role | rejected | PASS | P0 |
| MEALS-SELECT-OWN | RLS assertion | Meals | Client A | own and foreign meal select | own visible; foreign hidden | own meal visible; foreign meal hidden; admin fixtures verified | PASS | P2 |
| MEALS-SELECT-CROSS | RLS assertion | Meals | Client A | foreign meal select | 0 rows | 0 rows; foreign fixture unchanged by admin verification | PASS | P0 |
| RLS-OWN-PLAN | RLS assertion | Meals | Client A | own select | 1 row | 1 row | PASS | P2 |
| RLS-CROSS-PLAN | RLS assertion | Meals | Client A | cross-tenant select | 0 rows | 0 row | PASS | P0 |
| RLS-ANON | RLS assertion | Anonymous | Anon | profiles select | 0 rows | 0 row | PASS | P0 |
| RLS-SPOOF | RLS assertion | Chat | Client A | sender spoofing | denied/0 | denied | PASS | P1 |
| LEGACY-UPDATE | RLS assertion | Meals | Client A | direct non-is_eaten update | denied | stored row unchanged | PASS |  |
| DIETITIAN-MEAL-UPDATE | Functional failure | Meals | Dietitian A | own plan meal title update and restore | persisted and restored | dietitian update persisted; original title restored and verified | PASS | P2 |
| RPC-OWN | RPC assertion | RPC | Client A | own meal completion | success | success | PASS | P2 |
| RPC-CROSS | RPC assertion | RPC | Client A | foreign meal completion | denied | denied | PASS | P1 |

## Cleanup verification

Cleanup yalnız runtime sırasında kaydedilen explicit ID’leri hedefler. Migration, Storage ve Realtime değişikliği yapılmaz.

- Final Auth users: 0
- Final public rows: 0
- Final Storage buckets: 0

## Environment integrity verification

- Runtime migration catalog check: NOT EXECUTED
- Reason: Live migration catalog is not accessible through the runtime test client.

Runtime istemcisi migration katalogunu sorgulamaz. Migration history gerektiğinde ayrı staging-only CLI/catalog kontrolüyle doğrulanır. Bu gözlemlenebilirlik sınırı harness güvenlik, fonksiyonel veya cleanup sonucunu değiştirmez.
