# Davet kodu + GPT-6 Luna import — production rollout runbook

2026-10-05. Bu belge henüz uygulanmamış production işlemlerinin planıdır. Yerel kalite kapısı PASS, feature branch'leri push edildi, production salt okunur preflight **PASS**. Production'da hiçbir mutation, deploy, secret, Vault, cron, flag veya release işlemi yapılmadı. Rollout'u bekleyen engeller şema değil, aşağıdaki yayın girdileri ve onaylardır.

## Hedef ve kanıt

Hedef proje `kagvxhyvxxypspdxcuxz` / `dietbridge_Production`, eu-central-1, ACTIVE_HEALTHY, PostgreSQL 17.6.1.052, bağlantı hedefi `db.kagvxhyvxxypspdxcuxz.supabase.co`. Başka proje (staging, test, GroundLess, eski proje) ile devam edilmez.

Kanıt dosyaları: `INVITE_RECIPE_MIGRATION_RECONCILIATION.md` (62 satırlık versiyon matrisi ve kararlar), `INVITE_RECIPE_PREFLIGHT_EVIDENCE.json` (katalog metadata'sı), `INVITE_RECIPE_FINAL_REPORT.md`.

## Migration history kararı

Remote 58, repo 62, remote-only 0. Matris: MATCH 57, HISTORY_PRESENT_BUT_SCHEMA_DRIFT 1, LOCAL_ONLY_NEW 4.

| Version | Durum | Karar |
|---|---|---|
| `20260817120000_push_registry_outbox_backend` | History yok, objelerinin hiçbiri yok (kısmi iz yok) | **NO_ACTION**: Push 6C.2+ ile bilinçli ertelenmiş; bu yayına dahil edilmez, history adoption yapılmaz |
| `20260713010300_critical_table_rls` | History var; `protect_dietitian_profile_system_fields` + trigger yok | **NO_ACTION**: Koruma `trg_sync_dietitian_verification_fields` ve own-row UPDATE `WITH CHECK` ile eşdeğer; preflight 06 bunu her seferinde doğrular |
| `20261005120859_dietitian_invite_codes` | Yeni | Apply |
| `20261005124951_recipe_import_core` | Yeni | Apply |
| `20261005132107_recipe_import_extraction_metrics` | Yeni | Apply |

Hiçbir tarihsel versiyon için history adoption gerekmiyor.

## Neden `supabase db push` kullanılmaz

`db push` bütün bekleyen dosyaları uygular; production'da bekleyen dört dosyanın biri ertelenmiş push migration'ıdır. Bu yüzden `db push` (her türlü bayrakla) bu yayında **yasak**tır. Supabase MCP `apply_migration` da kullanılmaz: history'ye yeni üretilmiş bir versiyon yazar ve repo dosya adlarıyla yeni bir alias farkı yaratır. Toplu `migration repair` yasaktır.

## Versiyon bazında uygulama prosedürü

Her migration dosyası kendi `begin; … commit;` bloğunu içerir ve önkoşul eksikse kendini durdurur. Onaylı rollout'ta her versiyon için sırayla:

1. Preflight'ı çalıştırın ve 20 satırın tamamının `PASS` olduğunu görün (ilk migration'dan sonra 04/05/12/23/32 gibi "henüz yok" kontrolleri beklendiği gibi değişir; ikinci ve üçüncü dosya öncesinde postflight sonucu esas alınır).
2. Dosyayı tek başına uygulayın.
3. Postflight ile objeleri, grant'leri, RLS'i, trigger'ları ve cron'u doğrulayın.
4. Yalnız postflight geçtiyse, yalnız o versiyonu history'ye kaydedin.
5. `migration list` ile remote'un tam bir versiyon arttığını ve `20260817120000`'ın hâlâ yalnız local olduğunu görün.

```powershell
# Operator değişkeni: production bağlantı dizesi (değeri loglanmaz, rapora yazılmaz)
psql $env:DIETBRIDGE_PROD_DB_URL -v ON_ERROR_STOP=1 -f supabase/preflight/invite_recipe_preflight.sql
psql $env:DIETBRIDGE_PROD_DB_URL -v ON_ERROR_STOP=1 -f supabase/migrations/20261005120859_dietitian_invite_codes.sql
psql $env:DIETBRIDGE_PROD_DB_URL -v ON_ERROR_STOP=1 -f supabase/preflight/invite_recipe_postflight.sql
npx supabase@2.110.0 migration repair --status applied 20261005120859 --linked
npx supabase@2.110.0 migration list --linked
```

Aynı beş adım `20261005124951` ve ardından `20261005132107` için, araya davet smoke'u girdikten sonra tekrarlanır. Uygulama başarısız olursa transaction geri döner; o versiyon için repair çalıştırılmaz. Repair yalnız tek versiyon argümanıyla çalıştırılır.

## Preflight kapısı

`supabase/preflight/invite_recipe_preflight.sql` tek bir read-only transaction içinde tek sonuç kümesi döndürür ve rollback eder; yalnız katalog/metadata okur. 2026-10-05 sonucu: **20/20 PASS**.

| Alan | Check | Sonuç |
|---|---|---|
| Güvenlik | 01 read-only transaction | PASS |
| History | 02 remote history birebir 58 versiyon; 03 ertelenmiş push yok; 04 feature versiyonları yok; 05 yarım feature objesi yok; 06 doğrulama koruması eşdeğer | PASS |
| Davet | 10 onay/kapasite/kullanım/bildirim/legacy RPC/CSPRNG; 11 tek pending/active index; 12 üç ilişki trigger'ı; 13 ortak advisory kapasite kilidi + active+pending sayımı + helper'lar tarayıcıya kapalı; 14 enum'lar; 15 `private` şeması | PASS |
| Tarif | 20 kolonlar; 21 constraint'ler; 22 RLS + dört owner policy; 23 `recipe-images` private, `recipe-imports` henüz yok; 24 `extensions.digest` | PASS |
| Altyapı | 30 pgcrypto 1.3, pg_cron 1.6.4, pg_net 0.19.5, supabase_vault 0.3.1; 31 `cron.schedule/unschedule`, `vault.decrypted_secrets`, `net.http_post`; 32 feature cron'ları henüz yok | PASS |

`recipe-imports` bucket'ı ve iki Storage policy'si core migration tarafından oluşturulur; manuel önkoşul gerekmez. Cron işleri migration'lar tarafından oluşturulur (`cleanup-invite-code-attempts` saatlik :17, `recipe-import-cleanup` */15). Vault değerleri yokken dispatcher hiçbir şey göndermez.

## Edge Function hazırlığı

| Function | JWT | Gerekli env | DB/RPC | Storage |
|---|---|---|---|---|
| `preview-dietitian-invite` | açık | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (platform sağlar, PRESENT) | `preview_dietitian_invite_code` (davet migration'ı) | `avatars` (mevcut, kısa süreli signed URL) |
| `process-recipe-import` | açık | platform env + `OPENAI_API_KEY`, `OPENAI_RECIPE_MODEL=gpt-6-luna` | `recipe_import_limits`, `claim_recipe_import`, `finish_recipe_import`, `ack_recipe_import_cleanup` | `recipe-imports` |
| `cleanup-recipe-imports` | kapalı, handler token kontrolü | platform env + `RECIPE_IMPORT_CLEANUP_TOKEN` | `recipe_import_cleanup_candidates`, `ack_recipe_import_cleanup` | `recipe-imports` |

Production'da şu an yalnız dört eski Edge Function var; üç yeni function deploy edilmedi.

## Sunucu yapılandırması (yalnız ad/varlık)

| Ad | Yer | Durum |
|---|---|---|
| `OPENAI_API_KEY` | Edge secret | MISSING |
| `OPENAI_RECIPE_MODEL` (= `gpt-6-luna`) | Edge secret | MISSING |
| `RECIPE_IMPORT_CLEANUP_TOKEN` | Edge secret | MISSING |
| `recipe_import_cleanup_url` | Vault | MISSING |
| `recipe_import_cleanup_token` | Vault (Edge token ile aynı değer) | MISSING |

Model sözleşmesi tutarlı: kod sabiti, metrics migration constraint'i, `.env.example` ve testler yalnız `gpt-6-luna` kullanıyor; fallback yok, `store:false`.

## Yedekleme kapısı: BACKUP/PITR VERIFIED

İlk production mutation'dan önce zorunludur ve bu görevde doğrulanmadı. Migration'lar additive olsa da: PITR veya güncel fiziksel yedeğin varlığı ve geri dönüş noktası kaydedilmeli, mümkünse ayrı bir projeye deneme restore yapılmalıdır. Veritabanı yedeği Storage nesnelerini kapsamaz; `recipe-imports` geçici yüklemeler içerir ve geri yükleme planına dahil edilmez. Sorun durumunda tercih, destructive rollback yerine hedefli forward-fix migration'ıdır.

## Yayın sırası

1. **DONE** Tam kalite kapısı PASS.
2. **DONE** Production kimlik doğrulaması.
3. **DONE** Migration history mutabakatı (yukarıdaki karar).
4. **PENDING** BACKUP/PITR VERIFIED.
5. **NONE** Tarihsel versiyon bazlı mutabakat: gerekli değil (iki NO_ACTION kararı).
6. Davet migration'ı `20261005120859` (prosedür yukarıda).
7. Davet postflight + tek versiyon kaydı.
8. `preview-dietitian-invite` deploy (JWT açık).
9. Mobile release hazırlığı (`codex/invite-code-mobile` inceleme/merge onayı).
10. Gerçek Android SHA-256 ve Apple Team ID ile `.well-known` dosyaları.
11. Mobile release.
12. Fiziksel cihaz deep-link smoke (cold/warm start, login/signup sonrası preview, restart restore).
13. Web `VITE_CLIENT_INVITE_MODE=invite_code` (geri dönüş `legacy_email`).
14. Onaylı davet production smoke.
15. Import core migration `20261005124951`.
16. Extraction metrics migration `20261005132107`.
17. Import postflight + tek versiyon kayıtları.
18. `process-recipe-import` deploy (JWT açık).
19. `cleanup-recipe-imports` deploy (`--no-verify-jwt`, handler token kontrolü).
20. `OPENAI_API_KEY`, `OPENAI_RECIPE_MODEL=gpt-6-luna`, `RECIPE_IMPORT_CLEANUP_TOKEN`.
21. Vault `recipe_import_cleanup_url` ve `recipe_import_cleanup_token`.
22. Cron: migration'ın oluşturduğu `recipe-import-cleanup` işinin aktif olduğunu doğrulayın; ikinci bir iş oluşturmayın.
23. Cleanup health: gerçek HTTP yanıtı, Storage silme → DB ack, `cleanup_pending`/gecikmiş birikim, alarm.
24. Kişisel veri içermeyen deterministic CSV/XLS/XLSX smoke (onaylı).
25. İsteğe bağlı, ayrıca onaylı ücretli GPT-6 Luna smoke.
26. `VITE_RECIPE_IMPORT_ENABLED=true`.
27. İzleme: cron HTTP hataları, takılı işler, cleanup gecikmesi, token/deneme/süre ve maliyet.
28. Legacy e-posta davetinin kaldırılması: ayrı görev ve ayrı onay.

Edge deploy komutları (yalnız onaylı rollout'ta):

```powershell
npx supabase@2.110.0 functions deploy preview-dietitian-invite --project-ref kagvxhyvxxypspdxcuxz
npx supabase@2.110.0 functions deploy process-recipe-import --project-ref kagvxhyvxxypspdxcuxz
npx supabase@2.110.0 functions deploy cleanup-recipe-imports --project-ref kagvxhyvxxypspdxcuxz --no-verify-jwt
node scripts/createInviteDomainAssociations.mjs --android-sha256=$env:DIETBRIDGE_ANDROID_RELEASE_SHA256 --apple-team-id=$env:DIETBRIDGE_APPLE_TEAM_ID
```

## Rollout engelleri

Şema veya history engeli yok. Kalan engeller: BACKUP/PITR VERIFIED; her production adımı için açık onay (migration, Edge deploy, secret/Vault, web flag'leri, smoke kayıtları); üç Edge secret ve iki Vault değeri; gerçek Android release SHA-256 ve Apple Team ID; mobile release ve fiziksel cihaz smoke'u.

Ayrı risk: Mobile `app.json` Eylül'den beri EAS proje kimliği içeriyor ve push istemcisi `register_push_installation` RPC'sini çağırıyor; bu RPC production'da yok (push migration ertelenmiş). Bu mevcut bir durumdur, davet/import'u etkilemez; eski belgelerdeki "Mobile'da EAS kimliği yok" varsayımı artık geçerli değil ve Push kapsamında ele alınmalıdır.

## Geri dönüş ve forward-fix

Önce flag'ler: `VITE_CLIENT_INVITE_MODE=legacy_email`, `VITE_RECIPE_IMPORT_ENABLED=false`. Gerekirse Edge function çağrıları durdurulur, cleanup çalışmaya devam eder. Mevcut ilişkiler, kaydedilmiş tarifler, import metadata'sı ve bucket destructive drop ile silinmez. Bir migration sonrası sorun çıkarsa yeni, küçük bir forward-fix migration'ı hazırlanır ve aynı versiyon bazlı prosedürle uygulanır. Kaydedilmiş batch'ler için undo yoktur; kullanımdaki tariflere cascade delete yapılmaz.

Runtime sözleşmesi: OpenAI Responses API, `gpt-6-luna`, fallback yok, `store:false`, strict JSON schema, en fazla 1 semantic onarım ve toplam 2 transport retry. Limitler `recipe_import_limits()`: 5 MiB, 20 tarif, 200 satır, 50 sütun, 20 MiB açılmış boyut, 24 saat. Gerçek OpenAI smoke çalıştırılmadı.
