# DietBridge — Legacy Meals UPDATE Policy Production Preflight Raporu

## 1. Amaç

Production’a migration uygulamadan önce hedef kimlik, migration history, policy/RPC preflight, dry-run, stop ve rollback kararlarını tanımlamak.

## 2. Repository durumu

Branch `codex/supabase-security`, başlangıç commit’i `2736124` ve çalışma ağacı temiz olarak doğrulandı.

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
Remote production identity verified: NO
```

Remote kimlik doğrulaması yalnız disposable workdir’deki 3E-2C-2 salt-okunur preflight sırasında yapılacaktır. GROUNDLESS guard’ı hem ref guard hem de proje adı kontrolüyle zorunludur.

## 6. Local migration durumu

Local active migration sayısı `9`dur. Hedef migration `20260714010000_remove_legacy_client_meals_update_policy.sql`dır.

## 7. Beklenen remote migration durumu

Production’da ilk sekiz migration’ın mevcut, hedef migration’ın yalnız local/pending olması beklenir. Remote history bu görevde sorgulanmadı. History geride/ileride/farklıysa veya birden fazla pending migration varsa push yapılmaz; `migration repair` kullanılmaz.

## 8. Preflight SQL

[legacy_client_meals_update_policy_verification.sql](../supabase/verification/legacy_client_meals_update_policy_verification.sql) yeterlidir: yalnız `SELECT` içerir; legacy policy sözleşmesini, UPDATE/SELECT policy inventory’sini, RPC signature/security/grant’lerini ve `public.meals` RLS durumunu pre/post karşılaştırmaya sunar. Sonuçları otomatik fail etmediği için runbook’taki kabul kontrol listesi manuel olarak uygulanmalıdır.

## 9. Dry-run karar kapısı

`db push --linked --dry-run` yalnız hedef migration’ı göstermelidir. Bu koşul sağlanmadan production `db push` çalıştırılmaz.

## 10. Production mutation kapsamı

Bu preflight yalnız runbook ve karar kaydıdır. Production/staging bağlantısı, link, SQL, dry-run, migration ve veri mutation’ı yapılmadı.

## 11. Smoke test yaklaşımı

Postflight’ta yalnız okuma/normal erişim kontrolleri yapılır: web, dietitian login, client web erişim engeli, client meal listesi, dietitian meal plan sayfası ve genel uygulama sağlığı. Test hesabı ayrı onayla tanımlanmadıkça production completion mutation testi yapılmaz.

## 12. Production test verisi kararı

Fixture, sentetik kullanıcı ve gerçek kullanıcı verisi üzerinde completion mutation kullanılmayacaktır.

## 13. Rollback riski

Rollback eski geniş client direct UPDATE erişimini yeniden açar ve `is_eaten` dışındaki kolonları da writable kılabilir. Yalnız kanıtlanmış kritik kesinti/RPC-grant kaybı için, ayrı manuel onayla değerlendirilir.

## 14. STOP koşulları

Ref/project adı uyuşmazlığı, staging ref eşitliği, GROUNDLESS seçimi, remote history drift’i, birden fazla pending migration, beklenmeyen dry-run, pre/post policy-RPC-RLS farkı veya 9/9 postflight history uyuşmazlığında production mutation durur.

## 15. Hazırlanan runbook

[LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md](LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md) disposable workdir, identity guards, history, SQL pre/post, dry-run, migration, smoke test, cleanup ve rollback karar kapısını içerir.

## 16. Değiştirilen dosyalar

- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_ROLLOUT_RUNBOOK.md`
- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md`
- `docs/ROADMAP.md`

## 17. Statik doğrulamalar

Syntax, saf testler, typecheck, lint, diff, secret taraması ve mobil repository değişmezliği commit öncesi çalıştırılacaktır.

## 18. Uygulanmayan işlemler

Production veya staging’e bağlanılmadı. Production remote history, dry-run, SQL preflight/postflight ve migration çalıştırılmadı. Production verisi değiştirilmedi.

## 19. Production readiness kararı

```text
Staging rollout: PASS
Production project linked: NO
Production remote history checked: NO
Production dry-run executed: NO
Production migration applied: NO
Production postflight executed: NO
Stage 3 complete: NO

READY FOR PRODUCTION READ-ONLY PREFLIGHT
```

Bu karar `READY FOR PRODUCTION MIGRATION` anlamına gelmez.

## 20. Sonraki aşama

Aşama 3E-2C-2 — Disposable çalışma alanında yalnız production kimliğini, remote migration history’yi, preflight SQL’i ve dry-run sonucunu doğrula.
