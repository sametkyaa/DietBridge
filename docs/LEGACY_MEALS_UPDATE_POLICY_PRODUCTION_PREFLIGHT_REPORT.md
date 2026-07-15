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

[legacy_client_meals_update_policy_verification.sql](../supabase/verification/legacy_client_meals_update_policy_verification.sql) policy removal pre/post kontrolü için korunur. Production'daki ilk sekiz migration sözleşmesini sınıflandırmak üzere yeni [production_migration_history_reconciliation_verification.sql](../supabase/verification/production_migration_history_reconciliation_verification.sql) hazırlandı. Yeni SQL yalnız salt-okunur katalog sorguları kullanır ve `MATCH`, `MISSING`, `MISMATCH`, `NOT_APPLICABLE`, `MANUAL_REVIEW` durumlarını üretir.

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

Ref/project adı uyuşmazlığı, staging ref eşitliği, GROUNDLESS seçimi, boş/uyuşmayan remote history, migration sözleşmesinde `MISSING`/`MISMATCH`/`MANUAL_REVIEW`, RPC eksikliği, beklenmeyen dry-run veya policy-RPC-RLS farkında production mutation durur.

## 15. Hazırlanan runbook

[LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md](LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md) disposable workdir, identity guards, history, SQL pre/post, dry-run, migration, smoke test, cleanup ve rollback karar kapısını içerir.

## 16. Değiştirilen dosyalar

- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md`
- `supabase/verification/production_migration_history_reconciliation_verification.sql`
- `docs/PRODUCTION_MIGRATION_HISTORY_RECONCILIATION_PLAN.md`
- `docs/PRODUCTION_SCHEMA_DRIFT_PREFLIGHT_REPORT.md`
- `docs/ROADMAP.md`

## 17. Statik doğrulamalar

Verification SQL read-only kontrolü, syntax, saf testler, typecheck, lint, diff, secret taraması ve mobil repository değişmezliği commit öncesi çalıştırılacaktır.

## 18. Uygulanmayan işlemler

Bu 3E-2C-2A görevinde production veya staging’e bağlanılmadı; SQL çalıştırılmadı. Önceki salt-okunur preflight'ta production identity/history ve katalog okunmuştu. Production dry-run, `migration repair`, migration, policy/RPC değişikliği veya veri mutation'ı yapılmadı.

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
Stage 3 complete: NO

NOT READY FOR PRODUCTION MIGRATION
```

Blocker'lar: migration history yok; ilk sekiz migration'ın production sözleşmesi tam doğrulanmadı; meal completion RPC production'da yok; policy removal RPC'ye bağımlı.

## 20. Sonraki aşama

Aşama 3E-2C-2B — Production SQL Editor'da salt-okunur reconciliation verification SQL'ini çalıştır ve ilk sekiz migration'ı `MATCH`/`MISSING`/`MISMATCH`/`MANUAL_REVIEW` olarak sınıflandır.
