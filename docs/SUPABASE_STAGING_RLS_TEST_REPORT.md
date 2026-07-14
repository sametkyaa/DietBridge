# DietBridge — Staging Onboarding ve Negatif RLS Test Raporu

> [!IMPORTANT]
> Bu rapor yalnız staging için tasarlanmış sentetik test harness çıktısıdır. Secret, URL, token, UUID ve email değerleri maskelenir.

## Amaç ve ortam

- Test run: `dbse…1b5a`
- Staging referansı: `ezwq…rjkv`
- Production ve GROUNDLESS: kullanılmadı.
- Harness: `scripts/staging-security-tests.mjs`

## Test özeti

- Toplam: 14
- Onboarding: 7/7
- RLS tests: 13/14
- PASS: 13
- FAIL: 0
- Security failures P0/P1: 0
- Deferred P1 blockers: 1
- P2 functional blockers: 0
- Cleanup: PASS
- Exit code: 10

| ID | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |
|---|---|---|---|---|---|---|---|
| ONB-Dietitian A | Onboarding | Dietitian A | profile | profile exists | profile exists | PASS |  |
| ONB-Client A | Onboarding | Client A | profile | profile exists | profile exists | PASS |  |
| ONB-Dietitian B | Onboarding | Dietitian B | profile | profile exists | profile exists | PASS |  |
| ONB-Client B | Onboarding | Client B | profile | profile exists | profile exists | PASS |  |
| ONB-Elevation Attempt Dietitian | Onboarding | Elevation Attempt Dietitian | profile | profile exists | profile exists | PASS |  |
| ONB-ELEVATION | Onboarding | Elevation Attempt Dietitian | verification escalation | pending/false | checked | PASS | P0 |
| ONB-INVALID | Onboarding | Invalid Role Attempt | allowlist | rejected or safe role | rejected | PASS | P0 |
| RLS-OWN-PLAN | Meals | Client A | own select | 1 row | 1 row | PASS | P2 |
| RLS-CROSS-PLAN | Meals | Client A | cross-tenant select | 0 rows | 0 row | PASS | P0 |
| RLS-ANON | Anonymous | Anon | profiles select | 0 rows | 0 row | PASS | P0 |
| RLS-SPOOF | Chat | Client A | sender spoofing | denied/0 | denied | PASS | P1 |
| RPC-OWN | RPC | Client A | own meal completion | success | success | PASS | P2 |
| RPC-CROSS | RPC | Client A | foreign meal completion | denied | denied | PASS | P1 |
| LEGACY-UPDATE | Meals | Client A | direct non-is_eaten update | denied | admin verification confirmed stored title changed; restored | KNOWN DEFERRED GAP | P1 |

## Legacy direct UPDATE sonucu

- Durum: KNOWN DEFERRED GAP
- Severity: P1
- Production blocker: Evet
- Cross-tenant: Hayır
- Admin re-read ile fiziksel `title` değişimi doğrulandı.
- Orijinal `title` geri yüklendi ve restore doğrulandı.

Bu legacy policy, mobil RPC cutover ve policy kaldırma tamamlanana kadar production rollout’u bloklar.

## Cleanup verification

Cleanup yalnız runtime sırasında kaydedilen explicit ID’leri hedefler. Migration, Storage ve Realtime değişikliği yapmaz.

- Cleanup: PASS
- Final Auth users: 0
- Final public rows: 0
- Final Storage buckets: 0
- Secret ve staging mutation-onay environment değişkenleri PowerShell `finally` bloğunda temizlendi.

## Environment integrity verification

- Migration history unchanged: YES
- Remote active migrations: 8
- Repository active migrations: 8
- Local/remote history match: YES
- Verification method: DietBridge Staging’e yönelik ayrı, salt-okunur Supabase CLI migration history kontrolü.

Runtime harness içinde migration history sorgusu hiç uygulanmamıştı; `NOT EXECUTED` sabit bir gözlemlenebilirlik sınırıydı, erişim hatası veya cleanup başarısızlığı değildi. Runtime Supabase istemcisi internal migration catalog’una erişmeye çalışmaz. Canlı doğrulama, ayrı staging-only CLI kontrolüyle tamamlandı.

## Güvenlik sonucu

Gerçek P0/P1 güvenlik ihlali bulunmadı. Legacy direct `meals` UPDATE policy’si bir P1 deferred production blocker’dır. Mobil uygulama `set_my_meal_completion` RPC kullanımına tamamen geçmeden ve legacy direct UPDATE policy kaldırılmadan production rollout yapılmamalıdır.
