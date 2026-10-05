# Davet kodu + GPT-6 Luna import — production rollout runbook

2026-10-06. **GPT-6 LUNA SMOKE: PASS.** Real gpt-6-luna extraction on synthetic PDF+PNG: exact explicit nutrition, missing values null, document instruction ignored, canonical save and cleanup PASS, residue 0. Synthetic smoke PASS. Feature flag OFF; next separate gate APPROVE_RECIPE_IMPORT_FLAG. Invite/legacy ACTIVE, mobile signing-blocked/cutover DEFERRED. Latest report X/evidence.

## Hedef ve kanıt

Hedef proje `kagvxhyvxxypspdxcuxz` / `dietbridge_Production`, eu-central-1, ACTIVE_HEALTHY, PostgreSQL 17.6.1.052, bağlantı hedefi `db.kagvxhyvxxypspdxcuxz.supabase.co`. Başka proje (staging, test, GroundLess, eski proje) ile devam edilmez.

Kanıt dosyaları: `INVITE_RECIPE_MIGRATION_RECONCILIATION.md` (62 satırlık versiyon matrisi ve kararlar), `INVITE_RECIPE_PREFLIGHT_EVIDENCE.json` (katalog metadata'sı), `INVITE_RECIPE_FINAL_REPORT.md`.

## Migration history kararı

Pre-rollout reconciliation snapshot tarihsel remote58/repo62. P1 sonrası59, şimdi P2/P3 sonrası **remote61/repo62/remote-only0**. Local-only yalnız intentionally deferred push20260817120000. Invite/core/metrics exact history present; iki NO_ACTION kararı değişmedi.

| Version | Durum | Karar |
|---|---|---|
| `20260817120000_push_registry_outbox_backend` | History yok, objelerinin hiçbiri yok (kısmi iz yok) | **NO_ACTION**: Push 6C.2+ ile bilinçli ertelenmiş; bu yayına dahil edilmez, history adoption yapılmaz |
| `20260713010300_critical_table_rls` | History var; `protect_dietitian_profile_system_fields` + trigger yok | **NO_ACTION**: Koruma `trg_sync_dietitian_verification_fields` ve own-row UPDATE `WITH CHECK` ile eşdeğer; preflight 06 bunu her seferinde doğrular |
| `20261005120859_dietitian_invite_codes` | DEPLOYED; history exact version present; postflight 21/21 PASS | DONE — reapply/repair yapma |
| `20261005124951_recipe_import_core` | DEPLOYED / PASS; core20/20/exact receipt | DONE — reapply/repair yapma |
| `20261005132107_recipe_import_extraction_metrics` | DEPLOYED / PASS; metrics21/21/exact receipt | DONE — reapply/repair yapma |

Hiçbir tarihsel versiyon için history adoption gerekmiyor.

## Neden `supabase db push` kullanılmaz

`db push` bütün bekleyen dosyaları uygular; başlangıçtaki dört pending dosyadan biri deferred push’tı; şimdi yalnız push pending. Bu yüzden `db push` (her türlü bayrakla) bu yayında **yasak**tır. Supabase MCP `apply_migration` da kullanılmaz: history'ye yeni üretilmiş bir versiyon yazar ve repo dosya adlarıyla yeni bir alias farkı yaratır. Toplu `migration repair` yasaktır.

## Versiyon bazında uygulama prosedürü

Her migration dosyası kendi `begin; … commit;` bloğunu içerir ve önkoşul eksikse kendini durdurur. Onaylı rollout'ta her versiyon için sırayla:

1. İlgili aşamanın preflight’ını çalıştırın: tarihsel P1 için20, güncel P2 core için recipe_core_preflight.sql13 kontrolün tümü PASS. Metrics öncesinde core postflight20/20 ve exact core receipt gereklidir.
2. Dosyayı tek başına uygulayın.
3. Postflight ile objeleri, grant'leri, RLS'i, trigger'ları ve cron'u doğrulayın.
4. Yalnız postflight geçtiyse, yalnız o versiyonu history'ye kaydedin.
5. `migration list` ve postflight ile remote'un tam bir versiyon arttığını ve `20260817120000`'ın hâlâ yalnız local olduğunu görün.

```powershell
# Yalnız exact P1 onayı + target identity/ref/hash/backup uygunluğu tekrar doğrulandıktan sonra
npx --offline supabase@2.110.0 db query --linked --file supabase/preflight/invite_recipe_preflight.sql
npx --offline supabase@2.110.0 db query --linked --file supabase/migrations/20261005120859_dietitian_invite_codes.sql
npx --offline supabase@2.110.0 db query --linked --file supabase/preflight/invite_postflight.sql
npx supabase@2.110.0 migration repair --status applied 20261005120859 --linked
npx supabase@2.110.0 migration list --linked
```

Son kullanıcı talimatı önceki full invite checkpoint → Recipe bağımlılığını kaldırır. Recipe kendi gate’leriyle devam eder; eksik mobile signing, association, release, physical-device smoke ve Web cutover Recipe için prerequisite değildir. Invite checkpoint yalnız Web invite-code cutover için korunur. SQL başarısızsa history repair yapılmaz; her repair tek exact versiyondur.

`invite_postflight.sql` P1 için tek sonuç kümesi döndüren salt okunur katalog kontrolüdür; recipe tablolarına veya recipe RPC'lerine bağımlı değildir. 20 schema/history sınırı kontrolü PASS olmadan history repair yapılmaz. Receipt `PASS_WITH_HISTORY_PENDING` ise yalnız başarılı SQL + 20 PASS sonrasında `20261005120859` repair edilir; tekrar kontrolde receipt PASS ve remote toplam 59 olmalıdır. `invite_recipe_preflight.sql` başlangıçtaki 58 versiyon/feature yokluğu içindir, P1 sonrası tekrar tümünün PASS olması beklenmez. Mevcut `invite_recipe_postflight.sql` recipe öncesinde çalıştırılmaz; recipe tranche'ları için ayrı focused schema kontrolü hazırlanıp doğrulanmalıdır.

Supabase CLI **2.110.0** `db query --linked --file` mekanizması salt okunur preflight ile doğrulanır; explicit SQL çalıştırır ve otomatik history versiyonu yaratmaz. Onaylı P1'de dosya SHA-256'sı ve linked ref tekrar kontrol edilerek yalnız `20261005120859_dietitian_invite_codes.sql` çalıştırılabilir. `db push`, MCP `apply_migration` ve çok versiyonlu repair kullanılmaz.

## P2 Recipe için sürüm bazlı doğrulama

Uygulama öncesi recipe_core_preflight.sql13/13 PASS, exact history59/Recipe yok. Core SQL +19 schema PASS → exact receipt20/20, ardından metrics SQL +20 schema PASS → exact receipt21/21. Şimdi history61. Absence preflight13 tamamlanmış P2’nin tarihsel kanıtıdır, live61 ortamında PASS beklenerek tekrar kullanılmaz. recipe_core_postflight.sql core’dan sonra **19 schema +1 receipt**, recipe_metrics_postflight.sql metrics’den sonra **20 schema +1 receipt** kontrol eder. Bunlar izole runtime harness içinde çalıştırılır; grant/constraint negatif kontrolleri ayrıca test edilir. Her production mutation öncesi target identity, reviewed file SHA, linked ref ve backup yeterliliği yeniden doğrulanır. History repair yalnız başarılı SQL ve ilgili schema kontrollerinin tümü PASS sonrası; metrics core’dan önce başlamaz.

P1-only invite_postflight.sql, Recipe core sonrası “recipe_not_started” ve history59 sınırı nedeniyle bütünüyle PASS beklenerek çalıştırılmaz. Recipe checker’ları legacy/invite objeleri ve invite attempt cron’unun korunduğunu ayrıca doğrular. Backup15:43:39 UTC pre-invite noktasıdır; sonradan oluşan yazmaları geri almaz. Integrity10/10 yeniden doğrulandı, PITR OFF/off-site unverified. Additive forward-fix tercih edilir; production restore ayrı onaylıdır.

## Preflight kapısı

`supabase/preflight/invite_recipe_preflight.sql` tek bir read-only transaction içinde tek sonuç kümesi döndürür ve rollback eder; yalnız katalog/metadata okur. 2026-10-05 sonucu: **20/20 PASS**.

| Alan | Check | Sonuç |
|---|---|---|
| Güvenlik | 01 read-only transaction | PASS |
| History | 02 remote history birebir 58 versiyon; 03 ertelenmiş push yok; 04 feature versiyonları yok; 05 yarım feature objesi yok; 06 doğrulama koruması eşdeğer | PASS |
| Davet | 10 onay/kapasite/kullanım/bildirim/legacy RPC/CSPRNG; 11 tek pending/active index; 12 üç ilişki trigger'ı; 13 ortak advisory kapasite kilidi + active+pending sayımı + helper'lar tarayıcıya kapalı; 14 enum'lar; 15 `private` şeması | PASS |
| Tarif | 20 kolonlar; 21 constraint'ler; 22 RLS + dört owner policy; 23 `recipe-images` private, `recipe-imports` henüz yok; 24 `extensions.digest` | PASS |
| Altyapı | 30 pgcrypto 1.3, pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1; 31 `cron.schedule/unschedule`, `vault.decrypted_secrets`, `net.http_post`; 32 feature cron'ları henüz yok | PASS |

`recipe-imports` private bucket ve iki Storage policy core migration kapsamındadır. Invite’ın saatlik :17 cleanup işi korunur. **RECIPE SCHEDULER CONTRACT: LOCALLY RESOLVED.** Henüz uygulanmamış core dosyasından cron scheduling çıkarıldı. Ayrı `supabase/rollout/enable_recipe_import_cleanup.sql`, Edge + secrets + Vault PASS ve **APPROVE_RECIPE_CLEANUP_CRON** sonrasında */15 işi oluşturur. Vault eksik/uyumsuzsa fail-closed; beklenen mevcut job varsa idempotent; farklı job varsa değiştirmeden durur. Core reapply mevcut cron’u değiştirmez. Düzeltilmiş core ve metrics production’da uygulandı; Recipe cron hâlâ yok. Ayrı operational activation SQL production’da çalıştırılmadı.

## Edge Function hazırlığı

| Function | JWT | Gerekli env | DB/RPC | Storage |
|---|---|---|---|---|
| `preview-dietitian-invite` | açık | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (platform sağlar, PRESENT) | `preview_dietitian_invite_code` (davet migration'ı) | `avatars` (mevcut, kısa süreli signed URL) |
| `process-recipe-import` | açık | platform env + `OPENAI_API_KEY`, `OPENAI_RECIPE_MODEL=gpt-6-luna` | `recipe_import_limits`, `claim_recipe_import`, `finish_recipe_import`, `ack_recipe_import_cleanup` | `recipe-imports` |
| `cleanup-recipe-imports` | kapalı, handler token kontrolü | platform env + `RECIPE_IMPORT_CLEANUP_TOKEN` | `recipe_import_cleanup_candidates`, `ack_recipe_import_cleanup` | `recipe-imports` |

Production’da eski4 +preview +iki Recipe function ACTIVE. Server-secret update tüm7 version’ı bir artırdı; preview/process/cleanup artık version2. Process/preview JWT ON, cleanup JWT OFF/handler token required. ID/kod bundle hash/JWT ayarları korunuyor.

## Sunucu yapılandırması (yalnız ad/varlık)

| Ad | Yer | Durum |
|---|---|---|
| `OPENAI_API_KEY` | Edge secret | PRESENT / DIGEST MATCH PASS |
| `OPENAI_RECIPE_MODEL` (= `gpt-6-luna`) | Edge secret | PRESENT / DIGEST MATCH PASS |
| `RECIPE_IMPORT_CLEANUP_TOKEN` | Edge secret | PRESENT / DIGEST MATCH PASS |
| `recipe_import_cleanup_url` | Vault | PRESENT / UNIQUE1 / MATCH PASS |
| `recipe_import_cleanup_token` | Vault (Edge token ile aynı değer) | PRESENT / UNIQUE1 / MATCH PASS |

Model sözleşmesi tutarlı: kod sabiti, metrics migration constraint'i, `.env.example` ve testler yalnız `gpt-6-luna` kullanıyor; fallback yok, `store:false`.

## Yedekleme kapısı: BACKUP/PITR VERIFIED

**BACKUP/PITR VERIFIED: PASS — P0 pre-invite private logical snapshot ve önceki temiz disposable restore kanıtı. PITR etkin değildir; bu tur snapshot tazelenmedi.** Free plan için Management API backup list `null`, `pitr_enabled=false`, fiziksel backup metadata boş; seçilebilir managed restore timestamp/window ve managed retention kanıtı yok. `walg_enabled=true` tek başına restore point kanıtı sayılmadı.

Yedek `C:/dev/DietBridge-Backups/2026-10-05-before-invite-recipe-rollout` içinde, Git dışında ve yalnız mevcut kullanıcı ACL'iyle tutuluyor. Data dump tamamlanma noktası **2026-10-05 15:43:39 UTC / 18:43:39 Europe/Istanbul**; history 15:43:53 UTC. Ayrı dump çağrıları tek ortak PostgreSQL snapshot değildir. 9 SQL + restore notes dosyası non-empty, SHA-256 manifest tekrar doğrulandı. Otomatik silinme/expiration yok; yalnız yerel kopya var, off-site redundancy doğrulanmadı.

Temiz disposable PostgreSQL 17.6.1.052 üzerinde actual restore başarılı. Auth 82 migration production ile eşit; Storage platform 74 local / 73 production (uyumluluk sınırı açıkça kayıtlı). 72 public/private/Auth/Storage tablosunda satır sayısı farkı 0; 39 uygulama tablosu/375 satır, 13 Auth user, 6 bucket/49 object metadata ve 58 history kaydı geri yüklendi. Kolon/default, index, RLS, function definition + effective ACL, custom Auth trigger, public/private trigger ve 21 Storage policy eşleşti. Tek CHECK farkı eşdeğer AND ifadesindeki parser parantez düzeni. Private şemanın null ACL'i production owner-only ACL'iyle etki bakımından eşdeğer.

Standart CLI dump tek başına yeterli değildi: custom Auth trigger ve Storage policies ile inherited local grant'leri kapatan exact table/function/default ACL supplements yedeğe eklendi ve temiz replay ile doğrulandı. Reserved `supabase_admin` role ayarı local `postgres` ile restore edilemedi; başarılı final rehearsal platform administrator ile yapıldı. Geri yükleme sırası private `RESTORE_NOTES.md`, integrity `SHA256_MANIFEST.json`, güvenli kanıt `INVITE_RECIPE_ROLLOUT_EVIDENCE.json` içindedir. Production restore başlatılmadı; local catalog rehearsal gerçek müşteri hesabıyla RPC/smoke yapmadı.

Bu recovery point, sonrasındaki yazmaları korumaz. Önce flag rollback ve additive forward-fix; production restore ancak ayrıca açık onay, downtime ve sonraki veri reconciliation planıyla yapılabilir. Storage metadata actual object bytes değildir: DB restore silinen dosyaları geri getirmez. Storage bytes, Edge secrets/deployment, Vault, mevcut cron işleri, Auth/project/realtime ayarları ayrı kurtarma gerektirir; bu snapshot komple platform backup değildir. Production recipe-imports private bucket artık var, payload object0; snapshot bu yeni metadata’yı kapsamaz. Onay gecikmesi veya recovery gereksinimi bu noktayı yetersiz kılarsa mutation öncesi yedek tazelenir ve gate yeniden değerlendirilir. Resmî dayanak: [Database Backups](https://supabase.com/docs/guides/platform/backups), [CLI Backup/Restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Exact onay kapıları

Controller talimatı gereği genel `devam`, `tamam`, `yap` sonraki production mutation onayı sayılmaz. Her mutation öncesi target identity yeniden doğrulanır; yalnız ilgili token'ın kapsadığı işlem yapılır.

| İşlem | Token |
|---|---|
| Invite SQL + başarılı postflight sonrası exact version receipt | `APPROVE_INVITE_DB_PRODUCTION` |
| Synthetic invite fixture + smoke + ownership manifest cleanup | `APPROVE_INVITE_SYNTHETIC_SMOKE` |
| Preview Edge, JWT ON | `APPROVE_INVITE_EDGE_DEPLOY` |
| Gerçek signing public inputs ile association publish | `APPROVE_ASSOCIATION_FILES_DEPLOY` |
| Canonical mobile release build/release | `APPROVE_MOBILE_RELEASE` |
| Physical links PASS sonrası Web invite flag/deploy | `APPROVE_WEB_INVITE_CODE_FLAG` |
| Bağımsız Recipe core → schema/history verify → metrics → schema/history verify | `APPROVE_RECIPE_DB_PRODUCTION` |
| Process/cleanup Edge | `APPROVE_RECIPE_EDGE_DEPLOY` |
| Gerekli server-only secrets | `APPROVE_RECIPE_SERVER_SECRETS` |
| Cleanup URL/token Vault entries | `APPROVE_RECIPE_VAULT_CONFIG` |
| Edge + secrets + Vault hazırken cleanup cron | `APPROVE_RECIPE_CLEANUP_CRON` |
| Synthetic CSV/XLSX fixture/smoke/cleanup | `APPROVE_RECIPE_SYNTHETIC_SMOKE` |
| Ücretli gerçek Luna call | `APPROVE_GPT6_LUNA_SMOKE` |
| Bütün recipe kapıları PASS sonrası Web import flag/deploy | `APPROVE_RECIPE_IMPORT_FLAG` |

## Güncellenmiş yayın sırası

1. **DONE / RETAIN** Backup rehearsal, invite DB/history, synthetic DB smoke/cleanup, preview Edge PASS. Bu receipt’ler tekrar uygulanmaz.
2. **ACTIVE / RETAIN** Legacy email; production env’de invite mode override yok, canlı bundle legacy email RPC içeriyor ve invite-code runtime ref içermiyor. Env değiştirilmedi.
3. **BLOCKED_BY_RELEASE_SIGNING_INPUTS / DEFERRED** Android/iOS verified links, association files, mobile release, physical-device invite smoke. Kullanıcı final signing’in mevcut olmadığını doğruladı; bu aşamalar Recipe’yi bloke etmez.
4. **DEFERRED** Web invite-code cutover; gerçek signing + mobile release + verified links + physical-device smoke PASS ve kendi onayı sonrası.
5. **DONE / PASS: APPROVE_RECIPE_DB_PRODUCTION** P2 preflight13/13 → core20261005124951 → core postflight19 schema PASS → exact core history receipt →20/20 PASS.
6. **DONE / PASS** Aynı DB onayı altında, önceki adım PASS sonrası metrics20261005132107 → metrics postflight20 schema PASS → exact metrics receipt →21/21 PASS. History59→60→61; push ve verification NO_ACTION korunur. Cron etkinleşmez.
7. **DONE / PASS: APPROVE_RECIPE_EDGE_DEPLOY** process JWT ON + cleanup handler token kontrolüyle JWT OFF.
8. **DONE / PRESENCE_READINESS_PASS: APPROVE_RECIPE_SERVER_SECRETS** üç server secret PRESENT/digest match; model=gpt-6-luna, token secure generated/DPAPI protected. User isteğiyle burada STOP.
9. **DONE / PRESENCE_READINESS_PASS: APPROVE_RECIPE_VAULT_CONFIG** exact production URL/aynı DPAPI token; unique1+1/boolean matches PASS; unrelated4 korundu. User isteğiyle burada STOP.
10. **DONE / SCHEDULED_DISPATCH_PASS: APPROVE_RECIPE_CLEANUP_CRON** reviewed operational SQL ile enabled */15; gerçek scheduled pg_cron/pg_net HTTP/Edge auth PASS; unrelated4 cron korundu. User isteğiyle burada STOP.
11. **NEXT SEPARATE GATE / NOT EXECUTED: APPROVE_RECIPE_SYNTHETIC_SMOKE** kişisel veri içermeyen deterministic CSV/XLS/XLSX smoke + owned fixture cleanup + cleanup health.
12. **APPROVE_GPT6_LUNA_SMOKE** gerçek Responses API smoke; gpt-6-luna/store:false/fallback yok, ücretli çağrı henüz yapılmadı.
13. **APPROVE_RECIPE_IMPORT_FLAG** önceki Recipe gate’leri PASS sonrası Web import flag/deploy. Bu gelecek deploy’da VITE_CLIENT_INVITE_MODE=legacy_email açıkça korunmalı; invite_code’a geçilmez. Production’daki mevcut invite mode env override yokluğu explicit configured value olarak raporlanmaz.
14. Recipe cleanup/gecikme/hata/token/deneme/süre/maliyet izlenir; legacy email kaldırılmaz.

Edge deploy komutları (yalnız onaylı rollout'ta):

```powershell
npx supabase@2.110.0 functions deploy preview-dietitian-invite --project-ref kagvxhyvxxypspdxcuxz
npx supabase@2.110.0 functions deploy process-recipe-import --project-ref kagvxhyvxxypspdxcuxz
npx supabase@2.110.0 functions deploy cleanup-recipe-imports --project-ref kagvxhyvxxypspdxcuxz --no-verify-jwt
node scripts/createInviteDomainAssociations.mjs --android-sha256=$env:DIETBRIDGE_ANDROID_RELEASE_SHA256 --apple-team-id=$env:DIETBRIDGE_APPLE_TEAM_ID
```

## Rollout engelleri

Mobil aşamaların blokajı **BLOCKED_BY_RELEASE_SIGNING_INPUTS** olarak kaydedildi; final public signing bilgileri bu aşamada istenmiyor ve release/association çalıştırılmıyor. Recipe **MAY PROCEED**, kendi DB/Edge/secret/Vault/cron/smoke/flag onaylarını bekliyor. Early-cron blocker yerelde çözüldü. Sunucu secret/model erişimi ve cleanup health sonraki gate’lerde doğrulanır. Production Web, Vercel env metadata’sı ve canlı bundle ile legacy olarak doğrulandı; mevcut deploy değiştirilmedi.

## Tamamlanan synthetic invite smoke — ownership planı ve receipt

**EXECUTED / PASS / CLEANUP PASS.** Exact approval kullanıcıdan alındı. 2026-10-05 18:07:55–18:12:49 UTC, target `kagvxhyvxxypspdxcuxz`. `scripts/runProductionInviteSmoke.mjs` exit0, 9 PASS receipt, 17 Auth fixture, 106 immediate identity check. Plan `docs/INVITE_PRODUCTION_SMOKE_PLAN.json`, safe evidence `docs/INVITE_RECIPE_ROLLOUT_EVIDENCE.json`. Private ownership manifest `C:/dev/DietBridge-Backups/invite-smoke-6213164e-eb3e-4e65-93d1-db8bfce1272e/ownership.json` current-user-only ACL altında korunuyor; parola/token/code içermez. Manifest instance yeniden kullanılmaz.

En fazla **17 Auth fixture**: 3 synthetic dietitian (yalnız 2'si own-ID admin setup ile approved), 14 synthetic client. Per-run UUID marker ve `example.invalid` email; Auth Admin createUser + email_confirm ile dışarı email gönderilmez. Yalnız owned profiles/subscriptions/kodlar/relationships/notifications/attempts üzerinde setup ve işlemler. Capacity için yalnız own Core subscription ve 9 dolu synthetic slot + 2-client last-slot race. Core plan'ın mevcut limitinin 10 olduğu setup öncesi read-only doğrulanır; shared plan kaydı değiştirilmez. Profil/role provisioning ve mevcut Auth trigger sözleşmesi tekrar kontrol edilir.

Akış: valid/invalid/closed preview, connect, same-code idempotency, other-dietitian denial, capacity, combined failure rate limit, leave, notification actor/recipient ve unapproved management denial. Login JWT'leri yalnız yeni synthetic actors'a aittir; gerçek kullanıcı/ilişki testte kullanılmaz. DB smoke doğrudan authenticated RPC contract'ını sınar; deploy edilmemiş Edge için PASS vermez.

Private current-user ACL altında, Git dışındaki ownership manifest önce creation intent'i, API cevabından sonra owned UUID'leri atomik kaydeder. Manifest password/token/davet kodu içermez. Hata durumunda dependent rollout durur ve manifest saklanır. Cleanup owned sessions revoke/signout, yalnız manifest-owned business rows/Auth kullanıcılarının silinmesi ve Auth/profile/subscription/relationship/notification/code/attempt residue toplamlarının **0** kanıtını içerir. Temizlenmeyen fixture varsa PASS verilmez; mevcut customer rows'a geniş filtreli delete/cascade/rollback yapılmaz. Admin credential değerleri loglanmaz. Edge/Storage/OpenAI/flag/mobile/recipe/push işlemleri bu gate'in kapsamı dışındadır.

Executed cleanup sonucu: Auth users/sessions/identities/refresh_tokens; profiles/client_profiles/dietitian_profiles/subscriptions; relationships/notifications/invite_codes; private attempts; verification audit **13/13 grup0**. MCP ile bağımsız count teyidi ve owned Auth audit-log count0. Final invite-only catalog **21/21 PASS**; history59; legacy email available; excluded push ve verification NO_ACTION korunuyor. Build/typecheck/lint PASS (lint mevcut17 warning), handler3/3 PASS. Bu turn migration/cron/history/Edge/Storage/secrets/Vault/flags değişikliği yok; production mutation yalnız temizlenmiş owned smoke fixtures.

## Tamamlanan gate — Invite preview Edge deploy

**DEPLOYED / PASS.** Exact **APPROVE_INVITE_EDGE_DEPLOY** kullanıcıdan alındı. 2026-10-05 18:38:41 UTC, target `kagvxhyvxxypspdxcuxz`, function `preview-dietitian-invite` **ACTIVE/version1/verify_jwt=true**. Config JWT ON; source `getUser()` ile authenticated kullanıcıyı ayrıca doğruluyor. Handler tests3/3 tekrar PASS; pre/final invite DB postflight21/21 PASS. Index SHA-256 `5829F538D2307BEB2A3F45352631A7482ACE98DC5DEDA18AD3785AE4CF45E3FE`, handler `AEDC4F74A86B4315838C0330C857C7B4571323C32D62CA47938ADA398A304041`; deployed iki kaynak tam eşleşti (yalnız CRLF/LF normalize). Bundle hash `828b4caa161298b81c17f3bc16872f8030cedb1082eebbafed3ebbe9578838e3`.

Target identity/hash mutation'dan hemen önce tekrar doğrulandı; pinned CLI2.110.0 tek-function `functions deploy preview-dietitian-invite --project-ref kagvxhyvxxypspdxcuxz --use-api` exit0. JWT disabling/all-functions/prune kullanılmadı. Diğer4 Edge function değişmedi. Live HTTP7/7: missing/invalid auth401, anon JWT authenticated user sağlamıyor400, bozuk JSON400, oversize413, GET405, OPTIONS204. Handler errors yalnız result:error/no-store, raw backend/key sızıntısı yok. Yeni fixture veya business RPC yok; authenticated client valid-preview/avatar live success henüz NOT RUN ve mobile end-to-end testinde ayrıca doğrulanacak.

Rollback/forward-fix: Web cutover kapısı açılmaz; sorunlu yeni Edge çağrıları kullanılmaz, küçük source forward-fix veya ayrıca onaylı function removal planlanır. Invite DB schema/customer relationships destructive rollback ile silinmez. Smoke approval Edge deploy yetkisi değildir; genel “devam” bu gate'i açmaz.

## Ertelenen invite release — BLOCKED_BY_RELEASE_SIGNING_INPUTS

**BLOCKED_BY_RELEASE_SIGNING_INPUTS.** Kullanıcı Android/iOS final signing bilgilerinin henüz mevcut olmadığını ve mobil uygulamanın mağazalarda yayınlanmadığını doğruladı. Verified links, association publish, mobile release ve physical-device invite smoke ertelendi. Package/bundle com.dietbridge.app, host app.dietbridge.com.tr; önceki EAS public metadata lookup başarısızlığı tarihsel kanıttır, yeni lookup veya credential üretimi yapılmaz.

Gelecekte gerçek release signing sağlandığında lokal association doğrulaması, APPROVE_ASSOCIATION_FILES_DEPLOY, APPROVE_MOBILE_RELEASE ve fiziksel cold/warm/auth/session-restore smoke tamamlanır; ardından APPROVE_WEB_INVITE_CODE_FLAG değerlendirilir. Bu sırada legacy email aktif kalır. Recipe bu bekleyişten bağımsızdır; DYBRK başvurusu başlatılmaz.

Ayrı risk: Mobile `app.json` Eylül'den beri EAS proje kimliği içeriyor ve push istemcisi `register_push_installation` RPC'sini çağırıyor; bu RPC production'da yok (push migration ertelenmiş). Bu mevcut bir durumdur, davet/import'u etkilemez; eski belgelerdeki "Mobile'da EAS kimliği yok" varsayımı artık geçerli değil ve Push kapsamında ele alınmalıdır.

## Geri dönüş ve forward-fix

Önce flag'ler: `VITE_CLIENT_INVITE_MODE=legacy_email`, `VITE_RECIPE_IMPORT_ENABLED=false`. Gerekirse Edge function çağrıları durdurulur, cleanup çalışmaya devam eder. Mevcut ilişkiler, kaydedilmiş tarifler, import metadata'sı ve bucket destructive drop ile silinmez. Bir migration sonrası sorun çıkarsa yeni, küçük bir forward-fix migration'ı hazırlanır ve aynı versiyon bazlı prosedürle uygulanır. Kaydedilmiş batch'ler için undo yoktur; kullanımdaki tariflere cascade delete yapılmaz.

Runtime sözleşmesi: OpenAI Responses API, `gpt-6-luna`, fallback yok, `store:false`, strict JSON schema, en fazla 1 semantic onarım ve toplam 2 transport retry. Limitler `recipe_import_limits()`: 5 MiB, 20 tarif, 200 satır, 50 sütun, 20 MiB açılmış boyut, 24 saat. Gerçek OpenAI smoke çalıştırılmadı.


## Recipe DB receipt / tamamlanan Edge hazırlığı (tarihsel P)

2026-10-05 **19:26:08–19:27:46 UTC** approved core/metrics SQL/history mutations.4 ayrı mutation öncesi full MCP project identity ve linked ref/branch/hash guard. Her explicit single-file CLI2.110.0 SQL exit0; history repair yalnız schema PASS sonrası exact version/repairAll=false. Genel invite_recipe_postflight.sql read-only exit0; final aggregate history61/jobs0/items0/Storage objects0/Recipe cron0/invite cron1. Invite scoped19/19 PASS: P1-only02 history/20 recipe-not-started çıkarıldı,61 boundary metrics checker’da. Customer/Auth/fixture/business RPC yazması yok; bucket metadata yazıldı, payload yok.

Advisor’ın authenticated GraphQL table notices33→35 ve authenticated SECURITY DEFINER RPC notices38→41. Yeni2 tablo/3 RPC approved API ile uyumlu; owner RLS/approved role/function body/private-service grants PASS. Zero-warning iddia edilmez; mevcut6 kategori ve unrelated notices korunur. Delta/remediation final report P/evidence.

Next Edge gate yalnız process-recipe-import firstversion1/JWT ON ve cleanup-recipe-imports firstversion1/gateway JWT OFF + zorunlu handler token. İki Recipe function live list’te yok;9 transitive source hash + pinned npm/HTTPS imports evidence manifest. CLI2.110.0 --use-api ile tek isimli2 sequential deploy; --no-verify-jwt yalnız cleanup, prune/all-functions yok. Her mutation öncesi identity/hash; sonra ACTIVE/version/JWT/source match, unauthorized safe HTTP probes ve mevcut5 function preservation. Secrets/Vault/cron/fixtures/OpenAI/Web/mobile bu token kapsamında değil. Hata halinde dependent gates durur, küçük Edge forward-fix hazırlanır; mevcut DB/invite/customer korunur, Web import flag OFF kalır.


## Recipe Edge gate — tarihsel Q receipt; sonraki server-secret kapısı R’de tamamlandı

2026-10-05 process deploy19:40:00UTC, cleanup19:41:02UTC; iki explicit single-function CLI2.110.0 --use-api exit0. Her mutation hemen öncesi full target identity/ref/branch/reviewed9 hash. ACTIVE/version1/JWT ON-OFF doğru; process6 runtime source/cleanup2 source CRLF normalization ile tam match, upload edilen type-only recipeExtractionProvider runtime download’dan omitted. Safe live HTTP10/10, existing5 ID/version/JWT/status/updated_at/bundle unchanged. Final DB21/21/history61, jobs/items/payload0/recipe cron0/invite cron1.

Yalnız Edge deploy production mutation; DB/history/Storage payload/secret/Vault/cron/fixture/OpenAI/Web/mobile değişikliği yok. Gateway401 yanıtları handler’a girmez;8 handler probe no-store. Real authenticated upload/process/save ve authorized cleanup health NOT RUN; kendi server-config/fixture gate’lerinde. Source unchanged; previous O build/typecheck/lint/test33+runtime40 reuse, bu turn yeniden çalışmış sayılmaz.

Server secret readiness isim/varlık kontrolü: platform3 PRESENT, OPENAI_API_KEY/OPENAI_RECIPE_MODEL/RECIPE_IMPORT_CLEANUP_TOKEN MISSING. Vault2 named count0. Scoped process/user/machine OPENAI_API_KEY ve task .env dosyalarında mevcut key bulunmadı; broad filesystem credential scan yok. Sonraki gate APPROVE_RECIPE_SERVER_SECRETS, ayrıca kullanıcıdan Git dışındaki server-only mevcut OpenAI key dosya yolu gerekir. Sadece3 required secret set edilir: mevcut key, model=gpt-6-luna/no fallback, approval sonrası cryptographic32-byte cleanup token. Env-file Git dışında current-user-only temporary file; değerler argv/stdout/rapor/client env’e konmaz. Vault eşleştirmesi ayrı onaylıdır; bu gate Vault/cron/smoke/paid call/flag/mobile içermez. Hata halinde dependent gates durur, unrelated/platform secrets overwrite/rotate edilmez.

## Recipe server-secret gate — CONFIGURED / PRESENCE_READINESS_PASS; STOP

2026-10-05T20:03:47.9681543Z: CLI exit0, üç secret presence/SHA256 match3/3; unrelated9 digest/timestamp preserved. API key user-designated server-only file’dan, model exact gpt-6-luna; token32 cryptographically random bytes. Private current-user-only protected env-file kullanıldı ve silindi; token DPAPI CurrentUser encrypted handoff roundtrip PASS. Values/digests stdout/log/report/Git/client env’e yazılmadı. Secret set tüm7 Edge version’ını bir artırdı; ID/status/JWT/updated_at/kod hashleri unchanged.

Readiness yalnız control-plane presence/digest; OpenAI key validity/model entitlement ve actual processing/cleanup NOT RUN. DB read-only: history61/payload0/cron0/Vault2 entries0. Feature flag OFF; user isteğiyle bu aşamada STOP. Vault gate henüz onaylanmadı/uygulanmadı; sonraki ayrı onayda evidence.recipeServerSecrets.handoffFile içindeki aynı şifreli token kullanılmalı. DPAPI çözme aynı Windows account gerektirir; token değerini tool argument/SQL log/argv/Git/report’a koyma.

## Recipe Vault gate — CONFIGURED / PRESENCE_READINESS_PASS; STOP

2026-10-05T20:15:48.7846813Z: Unique URL1/token1, expected production URL and previous Edge token equality booleans PASS. Token önceki encrypted DPAPI handoff’tan reuse edildi; no new token, no plaintext returned/logged/Git. Official Management API separate parameters; existing session logging guards inspected without changes. Two rows atomic create only; unrelated4 counts/timestamps preserved. Read-only-role verification failed after commit; SELECT-only admin verification recovered without repeating writes.

Final metadata history61/payload0/Recipe cron0/invite cron1. Feature flag OFF; actual cleanup/import/OpenAI smoke NOT RUN. User isteğiyle STOP. Sonraki ayrı token APPROVE_RECIPE_CLEANUP_CRON; yalnız reviewed operational SQL/hash ve immediate full project identity guard sonrası schedule.

## Recipe cleanup cron — LIVE / SCHEDULED_DISPATCH_PASS; STOP

2026-10-05T20:31:42.704Z: Job5 enabled */15/GMT, private Vault-backed dispatcher. Natural cron run49867 succeeded; pg_net request35610 HTTP200/no timeout/error, Edge request/execution correlation and POST200/auth PASS, removed0/failed0. Unrelated4 complete-row fingerprint preserved. Pending/overdue0 and operational postflight8 PASS. No fixture/manual dispatch/OpenAI/flag mutation.

Observe cleanup_pending and eligible/overdue counts, cron.job_run_details, sanitized net._http_response status + request/execution IDs, and filtered function_edge_logs. Never dump request headers/Vault values/raw payloads. Prior recipe_metrics_postflight check17 expects cron absent and is historical after activation; use remaining20 catalog checks plus recipe_cleanup_cron_postflight.sql8. User isteğiyle STOP; next separate gate APPROVE_RECIPE_SYNTHETIC_SMOKE.

## Recipe synthetic smoke — FAIL_XLSX / CLEANUP_PASS; STOP

Exact APPROVE_RECIPE_SYNTHETIC_SMOKE executed. CSV full live dialog→begin/upload→deterministic worker→preview/edit/select→explicit save→canonical receipt→source remove/ack PASS, including a real rejected save/no fake success and incomplete nutrition/selection checks. XLSX valid local inspection→production worker POST422/job failed/extraction_failed, no draft, source ack true. Root cause not confirmed; inspect hosted workbook dependency/runtime, prepare narrow local fix and request separate reviewed Edge redeploy authorization before another production attempt. Current process/cleanup Edge sources untouched.

All three attempt manifests have residue0; total6 Auth actors,3 jobs,2 canonical recipes cleaned. One initial closure CLI failure recovered with cleanup-only exact manifest scope; no provider call. Unrelated public business/Auth user/Storage rows and cron definitions pre/post equal. Final jobs/items/source0/pending0/overdue0/history61, existing recipe/invite cron retained, process/cleanup/preview ACTIVE/v2 unchanged. Private Storage acceptance FAIL means direct foreign/anonymous source negatives were NOT RUN, not an observed exposure. Immediate cleanup lifecycle PASS; nonempty canceled-source cron scenario NOT RUN. Other remaining negative scenarios listed in report U are not counted PASS.

Feature flag remains OFF / legacy_email ACTIVE. APPROVE_GPT6_LUNA_SMOKE and APPROVE_RECIPE_IMPORT_FLAG blocked by failed synthetic gate, neither executed. Do not proceed from initial deployed metadata alone; hosted XLSX must produce a ready preview and the full repeated smoke must PASS first. Manifests under C:/dev/DietBridge-Backups/recipe-smoke-20261005-01..03; never store browser auth state, keys/JWT/Vault values in Git/log/report.

## Process Edge redeploy + synthetic smoke rerun — PASS; STOP

Root cause of XLSX extraction_failed: the runtime import() of the SheetJS CDN URL was not embedded by the --use-api server bundle. Fixed with a static import; redeployed only process-recipe-import (v3, JWT ON, local Docker bundle). The live eszip is byte-identical to the offline-tested bundle and contains SheetJS. Before future deploys of this function, confirm the deployed body contains SheetJS code (sheet_to_json present, no remote import() left). Rerun smoke PASS with Storage overwrite/delete/signed URL negatives; manifest C:/dev/DietBridge-Backups/recipe-smoke-20261006-04. Flag OFF; Luna smoke awaits APPROVE_GPT6_LUNA_SMOKE.

## GPT-6 Luna production smoke — PASS; STOP

scripts/runProductionLunaSmoke.mjs with APPROVE_GPT6_LUNA_SMOKE: one owned synthetic dietitian, synthetic PDF (2 recipes) and PNG (1 recipe) containing a prompt-injection line. Both jobs ready on gpt-6-luna with 1 call each; explicit nutrition exact, missing nutrition and meal type null, injection ignored, source cleanup ack, selected draft saved canonically. Residue 0, unrelated fingerprints unchanged. Manifest C:/dev/DietBridge-Backups/luna-smoke-20261006-01. Flag remains OFF until APPROVE_RECIPE_IMPORT_FLAG.
