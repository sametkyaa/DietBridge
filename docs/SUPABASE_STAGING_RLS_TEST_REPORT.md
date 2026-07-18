# DietBridge — Staging Onboarding ve Negatif RLS Test Raporu

> [!IMPORTANT]
> Bu rapor yalnız staging için tasarlanmış sentetik test harness çıktısıdır. Secret, URL, token, UUID ve email değerleri maskelenir.

## Amaç ve ortam

- Test run: `dbse…1481`
- Staging referansı: `ezwq…rjkv`
- Production ve GROUNDLESS: kullanılmadı.
- Harness: `scripts/staging-security-tests.mjs`

## Test özeti

- Toplam: 39
- PASS: 39
- FAIL: 0
- Harness / fixture failures: 0
- RLS assertions: 7/7
- RLS assertion failures: 0
- RPC assertions: 2/2
- RPC assertion failures: 0
- Measurement RPC tests: 19/19
- Measurement assertion failures: 0
- Measurement validation failures: 0
- Measurement cleanup failures: 0
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
| ONB-Pending Relationship Dietitian | Onboarding assertion | Onboarding | Pending Relationship Dietitian | profile | profile exists | profile exists | PASS |  |
| ONB-Pending Relationship Client | Onboarding assertion | Onboarding | Pending Relationship Client | profile | profile exists | profile exists | PASS |  |
| ONB-Unverified Dietitian Client | Onboarding assertion | Onboarding | Unverified Dietitian Client | profile | profile exists | profile exists | PASS |  |
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

## Measurement RPC tests

- Measurement RPC tests: 19/19
- Measurement assertion failures: 0
- Measurement validation failures: 0
- Measurement cleanup failures: 0

| ID | Sınıf | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |
|---|---|---|---|---|---|---|---|---|
| MEASUREMENT-PENDING-DIETITIAN-DENIED | Measurement assertion | Measurement RPC | Pending Relationship Dietitian | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-UNVERIFIED-DIETITIAN-DENIED | Measurement assertion | Measurement RPC | Unverified Dietitian | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-CROSS-TENANT-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-CLIENT-CALLER-DENIED | Measurement assertion | Measurement RPC | Client A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-ANON-DENIED | Measurement assertion | Measurement RPC | Anon | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-ALL-NULL-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-WEIGHT-ZERO-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-WEIGHT-BELOW-MIN-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-WEIGHT-ABOVE-MAX-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-NEGATIVE-CIRCUMFERENCE-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-OVERSIZED-CIRCUMFERENCE-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-FUTURE-DATE-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-LONG-NOTES-DENIED | Measurement assertion | Measurement RPC | Dietitian A | denied write and physical re-read | RPC error; row/profile unchanged | denied; physical state unchanged | PASS | P1 |
| MEASUREMENT-ACTIVE-INSERT | Measurement assertion | Measurement RPC | Dietitian A | active client insert and physical re-read | canonical row persisted | canonical row verified | PASS | P2 |
| MEASUREMENT-SAME-DAY-UPSERT | Measurement assertion | Measurement RPC | Dietitian A | same client/date canonical upsert | same ID; one canonical row | same ID and canonical row verified | PASS | P2 |
| MEASUREMENT-NOTES-NORMALIZED | Measurement assertion | Measurement RPC | Dietitian A | whitespace notes normalization | notes = null | notes normalized to null | PASS | P2 |
| MEASUREMENT-TODAY-WEIGHT-SYNC | Measurement assertion | Measurement RPC | Dietitian A | today weight synchronization | current_weight = 79.4 | current_weight synchronized | PASS | P2 |
| MEASUREMENT-PAST-WEIGHT-NO-SYNC | Measurement assertion | Measurement RPC | Dietitian A | past weight insert and profile re-read | measurement saved; current_weight unchanged | past row saved; current_weight unchanged | PASS | P2 |
| MEASUREMENT-CLIENT-WEIGHT-REGRESSION | Measurement assertion | Measurement RPC | Client A | save_my_current_weight and physical re-read | current weight and daily row synchronized; circumference preserved | client RPC and trigger preservation verified | PASS | P2 |

## Cleanup verification

Cleanup explicit measurement ID, fixture client/date aralığı ve fixture marker notlarını hedefler. Trigger tarafından üretilen measurement satırları fixture client/date kapsamında silinir. Migration, Storage ve Realtime değişikliği yapılmaz.

- Final Auth users: 0
- Final public rows: 0
- Final Storage buckets: 0
- Final measurement fixture rows: 0

## Environment integrity verification

- Runtime migration catalog check: NOT EXECUTED
- Reason: Live migration catalog is not accessible through the runtime test client.
- Separate staging migration history check: local/remote `12/12`, pending `0`.

Runtime istemcisi migration katalogunu sorgulamaz. Migration history gerektiğinde ayrı staging-only CLI/catalog kontrolüyle doğrulanır. Bu gözlemlenebilirlik sınırı harness güvenlik, fonksiyonel veya cleanup sonucunu değiştirmez.
