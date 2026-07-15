# DietBridge — Legacy Meals UPDATE Policy Production Preflight Raporu

## 1. Amaç

Production’a migration uygulamadan önce hedef kimlik, migration history, policy/RPC preflight, dry-run, stop ve rollback kararlarını tanımlamak.

## 2. Repository durumu

Branch `codex/supabase-security`, 3E-2C-2A başlangıç commit’i `0c90883` ve çalışma ağacı temiz olarak doğrulandı.

## 3. Staging rollout kanıtı

Staging migration uygulandı; 9 local/9 remote history eşleşti. Security harness 17/17 PASS, P0/P1 `0`, P2 `0`, fiziksel Android rollback/own RPC/persistence/foreign RPC PASS ve final cleanup `0/0/0` oldu.

## 4. Production hedef kaynağı

Production Supabase URL kaynağı `.env` içindeki `VITE_SUPABASE_URL`; staging kaynağı `.env.staging.local` içindeki aynı değişken adıdır. Project ref, URL’den çalışma anında türetilecektir.

## 5. Production/staging ayrımı

```text
Production ref loaded: YES
Staging ref loaded: YES
Production ref differs from staging: YES
Production environment identity source verified: YES
Remote production identity verified: YES
Production project linked temporarily: YES
Disposable workspace cleanup: PASS
```

Remote kimlik disposable workdir’deki 3E-2C-2 salt-okunur preflight sırasında doğrulandı. Linked ref production environment ile eşleşti, staging ref'ten farklı kaldı ve GROUNDLESS seçilmedi. Disposable alan işlem sonunda silindi.

## 6. Local migration durumu

Local active migration sayısı `9`dur. Hedef migration `20260714010000_remove_legacy_client_meals_update_policy.sql`dır.

## 7. Remote migration history sonucu

Production salt-okunur preflight sonucu local migration sayısı `9`, remote migration sayısı `0` oldu. SQL Editor doğrulamasında `supabase_migrations` şeması ve `supabase_migrations.schema_migrations` relation'ı bulunmadı. İlk sekiz migration'ın production sözleşmesi birebir doğrulanmadan history adoption, dry-run veya push yapılmayacaktır.

## 8. Preflight SQL

[legacy_client_meals_update_policy_verification.sql](../supabase/verification/legacy_client_meals_update_policy_verification.sql) policy removal pre/post kontrolü için korunur. İlk sekiz migration contract audit'i tamamlandı ve production `NOT READY` bulundu. Reconciliation başlangıç koşullarını yeniden doğrulayan [production_pre_policy_removal_reconciliation_preflight.sql](../supabase/verification/production_pre_policy_removal_reconciliation_preflight.sql) yalnız salt-okunur katalog ve aggregate kontrolleri içerir; yalnız bütün güvenlik kapıları geçtiğinde `RECONCILIATION_READY=YES` üretir.

## 9. Dry-run karar kapısı

`db push --linked --dry-run` çalıştırılmadı. Remote history'nin boş ve RPC'nin eksik olması nedeniyle dry-run/push kapısı kapalıdır.

## 10. Production mutation kapsamı

3E-2C-2 sırasında production'a disposable alandan geçici link yalnız identity/history okumak için kuruldu ve salt-okunur SQL Editor kontrolleri kullanıcı tarafından çalıştırıldı. Production dry-run, migration, history repair ve veri mutation'ı yapılmadı. 3E-2C-2A hazırlığında Supabase'e bağlanılmadı.

## 11. Smoke test yaklaşımı

Postflight’ta yalnız okuma/normal erişim kontrolleri yapılır: web, dietitian login, client web erişim engeli, client meal listesi, dietitian meal plan sayfası ve genel uygulama sağlığı. Test hesabı ayrı onayla tanımlanmadıkça production completion mutation testi yapılmaz.

## 12. Production test verisi kararı

Fixture, sentetik kullanıcı ve gerçek kullanıcı verisi üzerinde completion mutation kullanılmayacaktır.

## 13. Rollback riski

Rollback eski geniş client direct UPDATE erişimini yeniden açar ve `is_eaten` dışındaki kolonları da writable kılabilir. Yalnız kanıtlanmış kritik kesinti/RPC-grant kaybı için, ayrı manuel onayla değerlendirilir.

## 14. STOP koşulları

Ref/project adı uyuşmazlığı, staging ref eşitliği, GROUNDLESS seçimi, history durumunun değişmesi, `RECONCILIATION_READY=NO`, beklenmeyen function/constraint/policy/RLS drift'i veya legacy/ek policy envanter farkında production mutation durur. Paket hazırlığı production bağlantısı veya SQL çalıştırma yetkisi vermez.

## 15. Hazırlanan runbook

[LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md](LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md) disposable workdir, identity guards, history, SQL pre/post, dry-run, migration, smoke test, cleanup ve rollback karar kapısını içerir.

## 16. Değiştirilen dosyalar

- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md`
- `supabase/reconciliation/production_pre_policy_removal_reconciliation.sql`
- `supabase/verification/production_pre_policy_removal_reconciliation_preflight.sql`
- `supabase/verification/production_pre_policy_removal_reconciliation_postflight.sql`
- `scripts/production-reconciliation-validator.test.mjs`
- `docs/PRODUCTION_SCHEMA_DRIFT_PREFLIGHT_REPORT.md`
- `docs/PRODUCTION_PRE_POLICY_RECONCILIATION_PACKAGE_REPORT.md`
- `docs/ROADMAP.md`

## 17. Statik doğrulamalar

Birleşik Statement 08 salt-okunur SQL runtime/catalog deparse hatası verdi:

```text
ERROR: 42P01: relation "own" does not exist
```

Production şeması veya verisi değişmedi. Ayrıştırılmış ham `pg_policy` katalog sorguları başarıyla tamamlandı: beklenen 41 policy'nin 30'u mevcut, 11'i eksik ve 4 ek policy `EXTRA_POLICY_MANUAL_REVIEW` durumunda. Statement 08 expected-policy join ve predicate decompile içermeyen inventory sorgusuna dönüştürüldü.

Reconciliation preflight/postflight read-only, ana SQL kapsam, Statement 08 marker/statement, syntax, saf testler, typecheck, lint, diff ve secret kontrolleri commit öncesi çalıştırılacaktır.

## 18. Uygulanmayan işlemler

Bu 3E-2C-2C paket hazırlığında production veya staging’e bağlanılmadı ve SQL çalıştırılmadı. Production dry-run, `migration repair`, reconciliation, migration, policy/RPC değişikliği veya veri mutation'ı yapılmadı. Legacy policy ve dört ek policy korunmuştur.

## 19. Production readiness kararı

```text
Staging rollout: PASS
Production project identity: PASS
Production/staging separation: PASS
Production project linked temporarily: YES
Production remote migration history: EMPTY
supabase_migrations schema: MISSING
Legacy client UPDATE policy: PRESENT
public.meals RLS: ENABLED
set_my_meal_completion RPC: MISSING
Production dry-run executed: NO
Production migration applied: NO
Production postflight executed: NO
migration repair executed: NO
Disposable workspace cleanup: PASS
Production contract audit: COMPLETED / NOT READY
Production reconciliation package: PREPARED
Production reconciliation applied: NO
Stage 3 complete: NO

NOT READY FOR PRODUCTION MIGRATION
```

Blocker'lar: migration history yok; verification sync function, trigger ve consistency constraint eksik; bir verification satırı `true + pending` biçiminde tutarsız; üç kritik tabloda RLS kapalı; 11 kritik policy eksik; dört function search path drift'i var; meal completion RPC eksik; dört ek policy manual review bekliyor; production RPC smoke testi yapılmadı.

## 20. Sonraki aşama

Verification data remediation daha önce başarıyla uygulanmış ve korunmuştur. Function validator düzeltmesinden sonraki retry 2 verification consistency constraint postcondition aşamasında fail-closed durdu ve transaction tamamen rollback oldu. Constraint, sync function/trigger, meal RPC, RLS ve yeni policy değişiklikleri kalıcılaşmadı; yeni policy sayısı `0`, legacy policy `PRESENT` kaldı.

```text
Production reconciliation retry 2: FAILED CLOSED
Failure point: verification consistency constraint postcondition
Transaction: ROLLED BACK
Constraint persisted: NO
Sync function/trigger persisted: NO
Meal RPC persisted: NO
RLS changes persisted: NO
New policy count persisted: 0
Legacy policy: PRESENT
Data remediation: VALID

3E-2C-2E reconciliation application: BLOCKED BY CONSTRAINT VALIDATOR
3E-2C-2E-1 function validator correction: COMPLETED
3E-2C-2E-2 constraint validator correction: PREPARED
Production reconciliation retry 3: PENDING
```

Production reconciliation retry 3 ve salt-okunur postflight kullanıcı tarafından başarıyla tamamlandı. RPC production smoke testine hazırdır; smoke test henüz çalıştırılmamış, legacy policy korunmuş ve policy removal kapısı kapalı kalmıştır.

```text
Production reconciliation: COMPLETED
Production postflight: PASSED
RPC ready for smoke test: YES
Production RPC smoke test: NOT RUN
Legacy policy: PRESENT
Policy removal allowed: NO
```

Production’a özel iki-client fixture lifecycle, own/foreign/persistence/anonymous kontrolleri, explicit-ID cleanup ve mobil fail-closed kapısı [PRODUCTION_MEAL_RPC_SMOKE_TEST_PLAN.md](PRODUCTION_MEAL_RPC_SMOKE_TEST_PLAN.md) içinde hazırlandı. Production veya staging’e bağlanılmadı; fixture/RPC çalıştırılmadı.

Sonraki adım ayrı manuel onayla production smoke-test planını çalıştırmak, fixture cleanup’ını doğrulamak ve ardından fiziksel mobil production testini yürütmektir. Bu iki doğrulama tamamlanmadan legacy policy kaldırılamaz.
