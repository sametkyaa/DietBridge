# DietBridge — Production Pre-Policy Reconciliation Paketi

## 1. Amaç

Production salt-okunur audit ile kanıtlanan kısmi güvenlik drift'ini, active migration sırasını bozmadan ve legacy client UPDATE policy'sini kaldırmadan uzlaştıracak kontrollü paketi hazırlamak.

## 2. Audit kapsamı

Audit migration history, 32 kritik kolon, 30 constraint, 5 index, 10 RLS tablosu, 5 function sözleşmesi, 3 trigger, 41 beklenen policy, 4 ek policy, function execute yetkileri ve default privilege sözleşmelerini kapsadı. Audit salt-okunurdu.

## 3. Migration history durumu

`supabase_migrations` şeması ve `supabase_migrations.schema_migrations` relation'ı production'da bulunmadı. Paket bu şemayı veya history satırlarını oluşturmaz/değiştirmez.

## 4. Kolon sonuçları

Statement 02 toplam 32 sözleşmenin 32'sini `MATCH` buldu; `MISSING` ve `MISMATCH` yoktur.

## 5. Constraint drift'i

Statement 03 toplam 30 sözleşmede 29 `MATCH`, 1 `MISSING` buldu. Sonraki ayrıntılı production preflight, `20260713010100_verification_consistency.sql` sözleşmesinin yalnız constraint değil; `public.sync_dietitian_verification_fields()` function'ı, `trg_sync_dietitian_verification_fields` trigger'ı ve `dietitian_profiles_verification_consistency_check` constraint'iyle birlikte tamamen eksik olduğunu doğruladı. Ana SQL, verification verisi tutarlı değilse hiçbir şema değişikliği yapmadan fail-closed durur. Ayrı remediation tamamlandıktan sonra eksik üç nesneyi canonical migration ile birebir oluşturur; `NOT VALID` kullanılmaz.

## 6. Index sonuçları

Statement 04 toplam 5 index sözleşmesinin tamamını `MATCH` buldu. Paket index değiştirmez.

## 7. RLS drift'i

Statement 05 toplam 10 tabloda 7 `MATCH`, 3 `MISMATCH` buldu. RLS kapalı tablolar `dietitian_profiles`, `appointments` ve `chat_messages`dır. Paket yalnız bu üç tabloda RLS'yi etkinleştirir.

## 8. Function security drift'i

`handle_new_user()`, `protect_profile_system_fields()`, `save_my_current_weight(numeric)` ve `set_profiles_updated_at()` mevcut, owner/security/return sözleşmeleri uygun, fakat search path değerleri canonical `pg_catalog, public` hedefinden farklıdır. Audit tam function gövdesini dışarı çıkarmadığı için preflight `handle_new_user()` üzerinde yalnız iki repository fingerprint'ini güvenli başlangıç sayar: production baseline gövdesi veya `20260713010200` canonical gövdesi; başka gövdede kapı kapanır. Ana SQL `handle_new_user()` gövdesini her durumda `20260713010200` ile yeniden üretir. Diğer üç function için baseline body fingerprint'i zorunlu tutulur ve `20260713010000` kapsamındaki search path/execute hardening uygulanır.

## 9. Trigger sonuçları

`auth.users.on_auth_user_created`, `profiles.trg_profiles_updated_at` ve `profiles.trg_protect_profile_system_fields` sözleşmeleri `MATCH`tır. Ayrıntılı production preflight ayrıca `dietitian_profiles.trg_sync_dietitian_verification_fields` trigger'ının eksik olduğunu doğruladı. Ana SQL mevcut üç trigger'ı precondition olarak korur ve verification sync trigger'ını yalnız eksikse canonical tanımıyla oluşturur; aynı isimde drift varsa fail-fast durur.

## 10. Policy audit yöntemi

Birleşik Statement 08 iki kez `42P01 relation "own" does not exist` hatası verdi. Policy adları/komutları, raw roller ve `USING`/`WITH CHECK` varlığı ayrı ham `pg_policy` sorgularıyla başarıyla doğrulandı. Genel Statement 08 artık expected-policy join, `pg_policies` veya predicate decompile kullanmadan yalnız kritik inventory ve `MANUAL_REVIEW` sonucu döndürür.

## 11. Eksik 11 policy

| Tablo | Eksik policy sayısı |
|---|---:|
| `dietitian_profiles` | 4 |
| `appointments` | 5 |
| `chat_messages` | 2 |

Eksik policy'lerin ad, komut, rol, `USING` ve `WITH CHECK` tanımları yalnız `20260713010300_critical_table_rls.sql` kaynağından alınmıştır. Aynı isimde mevcut policy basic ve semantic fingerprint ile doğrulanır; beklenmeyen drift transaction'ı durdurur.

## 12. Ek dört policy

Şu production policy'leri repository'deki beklenen 41 policy listesinin dışındadır:

- `meal_plans.Users can select own meal plans`
- `meal_plans.Dietitians can view own meal plans`
- `meals.Users can select own meal rows`
- `meals.Dietitians can update own meal rows`

Sınıflandırma `EXTRA_POLICY_MANUAL_REVIEW`dır. Production predicate'leri güvenli biçimde decompile edilmediği için canonical policy'lerle erişimi genişletip genişletmediği kesinleştirilmemiştir. Paket bu policy'lerin adını, komutunu veya predicate'ini değiştirmez.

## 13. Function execute grants

`save_my_current_weight(numeric)` için authenticated/service_role açık, anon/PUBLIC kapalı sözleşmesi 4/4 `MATCH`tır. Meal completion RPC eksik olduğu için ona ait dört grant kontrolü `MISSING`dir. Paket RPC sonrası authenticated/service_role execute verir, anon/PUBLIC execute yetkisini kaldırır.

## 14. Default privileges

Statement 10 sonucu iki `MATCH`, bir `NOT_APPLICABLE`dır. Paket default privilege değiştirmez.

## 15. Meal completion RPC blocker

`public.set_my_meal_completion(uuid,boolean)` production'da eksiktir ve `RPC_READY_FOR_POLICY_REMOVAL=NO`dur. Paket canonical RPC'yi `20260713010400` kaynağından hazırlar; bu görevde RPC çağrılmaz. Production mutation smoke testi ayrı aşamadır.

## 16. Reconciliation kapsamı

- Dört mevcut function için canonical security/search path/execute sözleşmesi
- Eksik verification sync function'ı, `SECURITY INVOKER`, canonical search path ve PUBLIC/anon/authenticated execute revoke sözleşmesi
- Eksik verification sync trigger'ı ve verification consistency CHECK constraint'i
- Üç kritik tabloda RLS
- Eksik 11 canonical policy
- Meal completion RPC ve canonical execute grants

## 17. Reconciliation dışında bırakılanlar

Migration history, active migration timestamp'leri, legacy `Clients can update own meal completion` policy'si, dört ek policy, application/auth satırları, Storage ve Realtime kapsam dışıdır. Normal migration oluşturulmamıştır.

## 18. Transaction ve fail-fast tasarımı

Ana SQL tek transaction içinde `lock_timeout='5s'` ve `statement_timeout='60s'` kullanır. PostgreSQL'in transaction-local timeout ve RLS davranışına göre her beklenmeyen katalog/data aggregate farkında exception ile rollback olur. Kısa lock timeout üretim trafiğinde uzun DDL beklemesini sınırlar; statement timeout her statement için üst sınırdır.

## 19. Preflight SQL

`supabase/verification/production_pre_policy_removal_reconciliation_preflight.sql` yalnız `WITH ... SELECT` kullanır. Başlangıç nesnelerini, verification function/trigger/constraint sözleşmesini, function fingerprint/search path drift'ini, aggregate consistency sayımlarını, RLS/policy/RPC/legacy/extra policy ve history durumunu kontrol eder. Kişisel veri veya satır içeriği döndürmez. `DATA_REMEDIATION_READY` yalnız doğrulanan tek `true + pending` drift'i için `YES`; `RECONCILIATION_READY` ise veri tutarlılığı sağlanana kadar `NO` üretir.

## 20. Ana reconciliation SQL

`supabase/reconciliation/production_pre_policy_removal_reconciliation.sql` yalnız ayrı onayla production SQL Editor'da manuel çalıştırılmak üzere hazırlanmıştır. Precondition, canonical DDL ve postcondition aynı transaction'dadır. Stored function gövdelerindeki canonical runtime DML reconciliation sırasında çağrılmaz; paket application satırı mutate eden top-level DML içermez.

## 21. Postflight SQL

`supabase/verification/production_pre_policy_removal_reconciliation_postflight.sql` yalnız katalog ve aggregate veri sayımları okur; RPC'yi çağırmaz. Beklenen kapılar: `VERIFICATION_CONSISTENCY_CONTRACT=YES`, `RECONCILIATION_APPLIED_SUCCESSFULLY=YES`, `RPC_READY_FOR_PRODUCTION_SMOKE_TEST=YES`, `LEGACY_POLICY_STILL_PRESENT=YES`, `POLICY_REMOVAL_ALLOWED=NO`.

## 22. Legacy policy koruma garantisi

Ana SQL legacy policy'yi başlangıç ve bitiş pre/postcondition olarak doğrular. Policy mevcut ve temel sözleşmesi eşleşmeden reconciliation ilerlemez. Paket legacy policy için kaldırma veya değiştirme DDL'i içermez.

## 23. Migration history adoption riski

History boşluğu nedeniyle hiçbir version toplu `applied` kabul edilmez. Reconciliation sonrası bile `migration repair` otomatik değildir. Her version bütün kalıcı sözleşmesi ve dependency sırası üzerinden yeniden postflight sınıflandırmasına tabidir.

## 24. Değiştirilen dosyalar

- `supabase/reconciliation/production_pre_policy_removal_reconciliation.sql`
- `supabase/reconciliation/production_verification_consistency_data_remediation.sql`
- `supabase/verification/production_pre_policy_removal_reconciliation_preflight.sql`
- `supabase/verification/production_pre_policy_removal_reconciliation_postflight.sql`
- `supabase/verification/production_verification_consistency_data_remediation_postflight.sql`
- `docs/PRODUCTION_MIGRATION_HISTORY_RECONCILIATION_PLAN.md`
- `docs/PRODUCTION_SCHEMA_DRIFT_PREFLIGHT_REPORT.md`
- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md`
- `docs/PRODUCTION_PRE_POLICY_RECONCILIATION_PACKAGE_REPORT.md`
- `docs/ROADMAP.md`

## 25. Statik kontroller

```text
Node.js: v24.18.0
npm: 11.6.2
git diff --check: PASS
Preflight: 1 statement; yalnız WITH/SELECT; mutation/DDL token 0
Reconciliation postflight: 1 statement; yalnız WITH/SELECT; mutation/DDL token 0
Data remediation postflight: 1 statement; yalnız WITH/SELECT; mutation/DDL token 0
Data remediation: tam 1 hedefli `UPDATE public.dietitian_profiles`; yalnız `is_verified`; forbidden DML/kolon/auth/storage/history mutation 0
Verification sync function canonical body MD5: 62139839251ae664d44b4f325a1737c3; byte match
Ana SQL canonical function body hash: 3/3 MATCH
Ana SQL canonical policy text: 11/11 MATCH
Ana SQL canonical constraint text: MATCH
Ana SQL user-data UPDATE outside canonical stored function bodies: 0
Ana SQL legacy/ek policy DROP veya ALTER: 0
Ana SQL migration history mutation: 0
General verification: 11 statement / 11 marker / 11 statement_id; yalnız WITH/SELECT
Secret scan: 0
package.json/package-lock.json diff: 0
node --check staging-security-tests.mjs: PASS
staging-security-tests.test.mjs: 8/8 PASS
staging-mobile-meal-test-fixture.test.mjs: 5/5 PASS
typecheck: PASS
lint: 0 error, 71 mevcut warning
Mobil repository: codex/meal-completion-rpc-cutover @ 73009da; temiz
```

Ana SQL'deki `INSERT`/`UPDATE` metinleri yalnız canonical stored function gövdelerindedir; reconciliation sırasında function çağrılmaz. Function gövdeleri çıkarıldıktan sonra executable top-level forbidden DML sayısı sıfırdır.

## 26. Uygulanmayan işlemler

Production veya staging'e bağlanılmadı. SQL çalıştırılmadı. Reconciliation, migration, history repair, policy removal, RPC çağrısı, veri mutation'ı, fixture, kullanıcı veya deployment yapılmadı.

## 27. Sonuç

```text
PRODUCTION RECONCILIATION PACKAGE PREPARED
PRODUCTION RECONCILIATION NOT APPLIED
LEGACY POLICY NOT REMOVED
```

## 28. Yeni verification drift bulgusu

```text
Verification sync function: MISSING
Verification sync trigger: MISSING
Verification consistency constraint: MISSING
Verification inconsistent rows: 1
Drift combination: true + pending
Canonical source-of-truth: verification_status
Canonical remediation result: false + pending
DATA_REMEDIATION_REQUIRED: YES
Production reconciliation application: BLOCKED
```

Ana reconciliation kullanıcı verisini sessizce düzeltmez. Ayrı remediation SQL'i yalnız doğrulanmış tek satırın `is_verified` mirror alanını canonical `verification_status` değerine getirir; beklenmeyen sayım veya kombinasyonda transaction rollback olur.

## 29. Zorunlu production uygulama sırası

1. Güncellenmiş salt-okunur preflight çalıştırılır.
2. `DATA_REMEDIATION_READY=YES` doğrulanır.
3. Ayrı data remediation SQL'i için manuel onay alınır.
4. Data remediation SQL'i uygulanır.
5. Salt-okunur data remediation postflight çalıştırılır.
6. Güncellenmiş reconciliation preflight yeniden çalıştırılır.
7. `RECONCILIATION_READY=YES` doğrulanır.
8. Ana pre-policy reconciliation SQL'i uygulanır.
9. Reconciliation postflight çalıştırılır.
10. Production RPC smoke testi yapılır.
11. Legacy policy removal değerlendirilir.

Ana reconciliation SQL'i data remediation başarıyla tamamlanmadan çalışamaz.

## 30. Sonraki aşama

Güncellenmiş production preflight SQL'ini salt-okunur çalıştır. Data remediation ve ana reconciliation ayrı açık onay olmadan uygulanmaz.
