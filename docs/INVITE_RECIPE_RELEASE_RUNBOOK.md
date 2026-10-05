# Davet kodu + GPT-6 Luna import — production rollout runbook

2026-10-05. Bu belge uygulanmamış production işlemlerinin planıdır. Yerel kalite ve branch push tamamlandı; salt okunur preflight çalıştı. **Readiness BLOCKED; production mutation/deploy/secrets/flags/release yapılmadı.**

## Kanıt ve kesin history farkı

Final rapor `INVITE_RECIPE_FINAL_REPORT.md`; safe katalog kanıtı `INVITE_RECIPE_PREFLIGHT_EVIDENCE.json`. Hedef `kagvxhyvxxypspdxcuxz` / `dietbridge_Production`, ACTIVE_HEALTHY, eu-central-1. Prepared preflight ve iki ek JSON catalog sorgusu read-only transaction/rollback ile çalıştı; yalnız metadata okundu.

Remote58/repo62. Remote-only0. Repo-only:

| Dosya | Bu yayındaki işlem |
| --- | --- |
| 20260817120000_push_registry_outbox_backend.sql | Eski deferred dosya. Bu feature'ın prerequisite'i değil. Kendiliğinden uygulanmaz; ayrı explicit history/scope kararı gerekir. |
| 20261005120859_dietitian_invite_codes.sql | Invite için onaylı ilk feature migration. |
| 20261005124951_recipe_import_core.sql | Import için onaylı ikinci feature migration. |
| 20261005132107_recipe_import_extraction_metrics.sql | Core'dan sonra üçüncü feature migration. |

Remote sonversion20260901200413. Kapasite/approval/CSPRNG/relationship unique index, capacity/transition/notification trigger'ları; recipe constraints/RLS; private avatars/recipe-images ve pgcrypto/pg_cron/pg_net/Vault mevcut. Yeni feature tabloları/bucket/Edge/cron/secret/Vault girdileri henüz yok.

**Körlemesine db push, bulk migration-history repair veya eski deferred migration'ı bu üçdosyayla birlikte uygulama yok.** Backup/restore kanıtı, migration scope ve diğer production izinleri alınmadan aşağıdaki yazma adımları başlatılmaz.

## Canonical 24 adım

1. **DONE/PASS**: Web npm ci/typecheck/lint/full test/build;508counted tests+custom gates;72focused;35invite/30import disposable. Mobile443tests,Doctor18/18,exportsPASS. Water static failure kapalı.
2. **DONE**: Web `codex/invite-recipe-regression` ve Mobile `codex/invite-code-mobile` commit/push; local/remote eşit. Water ayrı commit; preflight/report ayrı docs commit. Main merge/PR yok.
3. **DONE/BLOCKED**: Production identity/history salt okunur doğrulandı. Yukarıdaki exact4version farkına scope kararı ve ileri migration tracking planı alın; metadata preflight yayın anında tekrarlansın.
4. **PENDING**: Açık production rollout onayı ve backup/PITR/Storage geri yükleme/deneme restore kanıtı. DB backup'ın Storage payload'ını tek başına kapsadığını varsaymayın.
5. Yalnız onaylı `20261005120859_dietitian_invite_codes.sql` artifact'ını uygulayın; yeni tablolar/RPC privileges, identity guard, attempt cleanup cron ve legacy uyumluluğunu postflight ile doğrulayın.
6. `preview-dietitian-invite` Edge'i JWT doğrulaması açık yayınlayın.
7. Gerçek Android release SHA-256 fingerprint(s), Apple Team ID ve iki platform `com.dietbridge.app` kimlik doğrulaması. Association generator'ını yalnız bu değerlerle çalıştırın; placeholder yayınlamayın.
8. Mobil feature branch'i onaylı signed release/store sürecine alın.
9. Fiziksel Android/iOS HTTPS association smoke: cold/warm start, logout→login/signup→preview, restart/session restore, explicit connect ve stale response koruması. Custom scheme fallback tek başına verified HTTPS kanıtı değildir.
10. Mobil sürüm dağıtılıp9geçince ayrı onayla web `VITE_CLIENT_INVITE_MODE=invite_code` build/deploy. Default/rollback `legacy_email`.
11. Ayrı izinli production-safe invite smoke: preview→explicit connect, same idempotency, other dietitian, capacity/rate, leave/notification ve legacy pending. Test account/relationship oluşturma bu smoke onayında açıkça yer almalı.
12. Yalnız onaylı `20261005124951_recipe_import_core.sql` artifact'ını uygulayın.
13. Ardından `20261005132107_recipe_import_extraction_metrics.sql` artifact'ını uygulayın; model metric constraint `gpt-6-luna` ve service-only finish'i doğrulayın.
14. `process-recipe-import` Edge'i JWT açık yayınlayın.
15. `cleanup-recipe-imports` Edge'i gateway JWT kapalı, handler dedicated-token kontrolü açık yayınlayın.
16. Server-only `OPENAI_API_KEY`, `OPENAI_RECIPE_MODEL=gpt-6-luna` yapılandırın. Anahtar Vite/Expo/client/source/log'a konmaz. API key bu kapanışta istenmedi/üretilmedi.
17. Dedicated `RECIPE_IMPORT_CLEANUP_TOKEN` ile Vault `recipe_import_cleanup_url` (tam güvenilir endpoint) ve `recipe_import_cleanup_token` eşleşmesini hazırlayın. Core migration'ın `recipe-import-cleanup` */15 ve invite migration'ın `cleanup-invite-code-attempts` hourly17 cron metadata'sını kontrol edin; duplicate cron oluşturmayın.
18. Cleanup health: gerçek HTTP response, Storage delete→DB ack sırası, cleanup_pending/overdue/orphan backlog ve hata alarmı doğrulansın. Secret/Vault yokken dispatcher false döner. Scheduler çalışması cleanup başarısı değildir.
19. Explicit izinli, kişisel veri içermeyen synthetic CSV/XLS/XLSX deterministic preview/edit/selection/save/cleanup smoke. Invalid nutrition/save transaction/owner isolation negatifleri yalnız onaylı test kapsamındadır.
20. **OPTIONAL**: Ayrı ücretli çağrı onayıyla GPT-6 Luna PDF/DOC/DOCX/JPG/PNG smoke ve gerçek hesapta model/document/vision desteğini doğrulama. Mock provider sonucu canlı extraction doğruluğu değildir.
21. Cleanup health18 ve smoke19geçince ayrı onayla `VITE_RECIPE_IMPORT_ENABLED=true` build/deploy.
22. `supabase/preflight/invite_recipe_postflight.sql` ve catalog preflight'ı tekrarlayın. Yeni actual migration version/name mapping'ini repo canonical history ile kontrol edin; deployment öncesi/sonrası SHAs ve artifacts kaydedilsin.
23. Cron HTTP failures, stale processing, failed cleanup, overdue objects, provider token/attempt/duration ve cost izlemesi. Raw documents/prompts/responses loglanmaz.
24. Legacy email removal daha sonraki ayrı görev/migration: backend/mobile/device/web cutover ve pending population değerlendirmesi+yeniden explicit onay. Mevcut email RPC bu yayında korunur.

## Tek artifact uygulama ve Edge komutları — yalnız ayrı onaylı rollout için

Bu kapanışta **hiçbiri çalıştırılmadı**. SQL için Supabase `apply_migration` operasyonuna aşağıdaki sabit project/name ve ilgili dosyanın **tam, gözden geçirilmiş SQL bytes** girdisi verilir. Tool SQL migration'ını ve history kaydını yönetir; gerçek atanan versiyonu sonuçtan/list_migrations'dan kaydedin. Production'da atanacak versiyon hazırlanmış dosya timestamp'inden farklıysa mapping ve canonical source filename'i kontrollü release commit'inde hizalayın; eski58kayda bulk repair yapmayın. Bu history yöntemi ve scope ilk migration'dan önce açıkça onaylanmalı.

| API operasyonu | project_id | name | query kaynağı |
| --- | --- | --- | --- |
| apply_migration (adım5) | kagvxhyvxxypspdxcuxz | dietitian_invite_codes | supabase/migrations/20261005120859_dietitian_invite_codes.sql |
| apply_migration (adım12) | kagvxhyvxxypspdxcuxz | recipe_import_core | supabase/migrations/20261005124951_recipe_import_core.sql |
| apply_migration (adım13) | kagvxhyvxxypspdxcuxz | recipe_import_extraction_metrics | supabase/migrations/20261005132107_recipe_import_extraction_metrics.sql |

Her artifact önce approved staging/disposable'da yeniden uygulanıp SQL+RLS/Storage matrix'ini geçmeli. Prod operation sonrası migration history ve obje/grant/trigger postflight eşleşmeden sonraki adım yok. Scalar count tek başına history eşleşmesi değildir.

Onaylı Edge adımlarının PowerShell komutları (CLI2.110.0 help ile flags doğrulandı; yalnız help çalıştı):

```powershell
npx supabase@2.110.0 functions deploy preview-dietitian-invite --project-ref kagvxhyvxxypspdxcuxz
npx supabase@2.110.0 functions deploy process-recipe-import --project-ref kagvxhyvxxypspdxcuxz
npx supabase@2.110.0 functions deploy cleanup-recipe-imports --project-ref kagvxhyvxxypspdxcuxz --no-verify-jwt
```

Gerçek association input'ları güvenli operator değişkenlerinde mevcut olduktan sonra (bu görevde çalıştırılmadı):

```powershell
node scripts/createInviteDomainAssociations.mjs --android-sha256=$env:DIETBRIDGE_ANDROID_RELEASE_SHA256 --apple-team-id=$env:DIETBRIDGE_APPLE_TEAM_ID
```

Bu generator yalnız dosya üretir. `https://app.dietbridge.com.tr/.well-known/assetlinks.json` ve `/.well-known/apple-app-site-association` HTTPS/Content-Type/redirect davranışı ayrıca yayın ve cihazda doğrulanmalı.

## Import sözleşmesi ve geri dönüş

Runtime yalnız OpenAI Responses API **gpt-6-luna**, fallback NONE, `store:false`, strict JSON schema, max1semantic repair+2total transport retry. Gerçek OpenAI smoke NOT RUN. `store:false` provider/account düzeyinde zero-retention garantisi değildir. Ürün uyarısı belgeyi gerçek redaksiyondan geçirmez.

`recipe_import_limits()` authority:5MiB input,20recipes,200data rows,50columns,20MiB expanded,24hTTL. Bucket file_size_limit birlikte koordine edilir. XLSX !ref absolute bounds conversion'dan önce korunur; dış parser'ın bütün davranışına güvenlik garantisi verilmez. Eksik kcal/macros null kalır, tamamlanmadan save olmaz; extraction doğrudan recipe yazmaz; batch tek transaction'dır.

Normal worker completion hemen raw delete→ack. Hata durable queue; expiry+15min retry outage/backlog altında fiziksel24h hard deadline garantisi değildir.18başarısızsa import flag açılmaz; alarm/operator cleanup planı gerekir.

Rollback önce flags `legacy_email` / import disabled. Worker girişleri gerekirse durdurulur; mevcut cleanup çalışır tutulur. İlişkiler, kaydedilmiş tarifler, metadata/bucket destructive drop ile silinmez; targeted forward-fix tercih edilir. Saved IDs receipt'tir; batch undo yok, kullanımdaki tariflere cascade delete yapılmaz.

Kalan gerçek girdiler final report matrix'inde. Bir sonraki aşama **ayrı onaylı release-preparation**, ardından post-release-validation.
