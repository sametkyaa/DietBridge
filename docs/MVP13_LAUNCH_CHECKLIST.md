# DietBridge MVP-13 Controlled Launch Checklist

Status: `NOT STARTED`

Bu liste MVP-12 Production Release Candidate kapanışından sonraki insan ve teknik karar kapılarını tanımlar. Bu belgenin oluşturulması deployment, public launch, Production mutation, kullanıcı daveti, App Store/Google Play yayını veya Push 6C.2+ başlangıcı değildir.

## 1. RC kimliği ve değişiklik dondurma

- [ ] Final rapordaki `WEB_RC_SHA` ve `MOBILE_RC_SHA` değerlerini canonical GitHub `main` ile birebir doğrula.
- [ ] Web için `Web Quality Gate`, `Backend Integration Gate`, `Critical E2E Gate`; Mobile için `Mobile Quality Gate` aynı SHA'larda başarılı olmalı.
- [ ] İki `main` branch'i temiz ve protected olmalı; required checks, strict mode, PR zorunluluğu ve admin enforcement korunmalı.
- [ ] RC sonrasında gelen her değişikliği yeni PR ve yeniden tam kalite kapısıyla değerlendir; RC SHA'larını sessizce ilerletme.

## 2. Production backup ve geri dönüş hazırlığı

- [ ] Launch öncesinde yeni bir private logical database backup al, hash manifesti oluştur ve disposable restore ile doğrula; Production Free plan üzerinde managed restore/PITR erişimini varsayma.
- [ ] Gerekirse plan yükseltmesi/PITR için ayrı maliyet ve insan onayı al. Supabase'in [Database Backups](https://supabase.com/docs/guides/platform/backups) ve [PITR](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery) prosedürlerini launch kaydına bağla.
- [ ] Database backup'ın Storage object payload'larını, Edge Function kod/secret'larını ve Auth proje ayarlarını içermediğini kabul et; private bucket envanteri, function sürümleri ve gerekli ayar/secret adları için ayrı geri dönüş manifesti hazırla.
- [ ] Son doğrulanmış restore kanıtını `docs/MVP_EXECUTION_STATE.md` içindeki MVP-5 logical restore kaydıyla karşılaştır.
- [ ] Rollback sahibini, karar süresini, uygulama rollback yöntemini ve database restore gerektiren koşulları yazılı olarak ata.

## 3. Environment ve public erişim kapıları

- [ ] Web deploy ortamında yalnız doğru Production `VITE_SUPABASE_URL` ve publishable/anon key tanımla; service-role, database password veya provider secret istemciye koyma.
- [ ] Mobile build ortamında doğru `EXPO_PUBLIC_SUPABASE_URL`, publishable/anon key ve password-reset Web URL'sini doğrula.
- [ ] `VITE_ENABLE_CHAT_IMAGES` / `EXPO_PUBLIC_ENABLE_CHAT_IMAGES` kararını bilinçli ver; varsayılan `false` durumunu launch kararı olmadan değiştirme.
- [ ] Domain, HTTPS, SPA route fallback, reset-password redirect allowlist, CORS ve Supabase Auth Site URL/redirect URL ayarlarını kontrollü public endpoint üzerinde doğrula.
- [ ] Test endpoint, debug auth bypass, gerçek token içeren log veya temporary env dosyası olmadığını yeniden tara.

## 4. Production migration karar kapısı

- [ ] Canonical 48 migration ile Production history'yi yeniden salt-okunur karşılaştır.
- [ ] `20260817120000_push_registry_outbox_backend.sql` yalnız Push 6C.2+ gerçekten başlatılırsa launch-required kabul edilebilir. Uygulama öncesinde exact Production preflight, backup ve açık kullanıcı onayı gerekir.
- [ ] Push devre dışı ve Mobile EAS `projectId` eksikken Push 6C.1'in `configuration_missing` ile RPC/token öncesinde fail-closed kaldığını yeniden doğrula.
- [ ] Başka migration/object drift'i çıkarsa launch'ı durdur; otomatik repair, history rewrite veya toplu `db push` yapma.

## 5. Controlled smoke ve ilk kullanıcı

- [ ] Salt-okunur health/migration/RLS/RPC/cron/Storage/Auth metadata kontrolünü tekrarla.
- [ ] Ayrı onaylı launch penceresinde Web Auth, rol/onay kapısı, client list/detail, meal plan, appointment, Chat, subscription, notification ve logout akışlarını kontrollü test hesabıyla doğrula.
- [ ] Mobile Auth/session restore, meal/water/measurement, Chat, appointment read, notification ve logout akışlarını fiziksel Android/iOS kapsam kararına göre doğrula.
- [ ] İlk kullanıcı onboarding sahibini, erişim kapsamını, destek kanalını ve başarısız onboarding geri alma adımlarını tanımla; geniş kullanıcı daveti yapma.
- [ ] Küçük kontrollü cohort sonrası hata oranı, cron başarısı, Auth hata sınıfları ve Storage/Edge Function sonuçlarını değerlendirerek devam/dur kararını kaydet.

## 6. Observability ve incident readiness

- [ ] GitHub Actions, Supabase API/Postgres/Auth/Storage/Realtime/Edge Function logları ve cron run history için sorumlu kişi ile kontrol sıklığını ata.
- [ ] P0/P1 incident iletişim zinciri, launch durdurma ölçütleri, read-only teşhis yolu ve rollback yetkisini yazılı hale getir.
- [ ] Leaked-password protection, `set_updated_at` search-path hardening, `pg_net` schema konumu ve performance advisor borçlarını ayrı onaylı hardening/backlog işlerine bağla.
- [ ] Web 500 kB chunk uyarısı, Mobile 44/Web 21 lint warning ve Expo SDK 54 build-time advisories için takip aşaması ata; bunları launch anında broad refactor'a dönüştürme.

## 7. App stores ve Push sınırı

- [ ] App Store/Google Play yayını seçilirse bundle/package identifiers, EAS project/credentials, signing, privacy metadata ve store review ayrı kapsam/insan onayıyla hazırlanmalı.
- [ ] Apple/Google developer account, Firebase, FCM, APNs veya gerçek Expo Push token MVP-12 RC önkoşulu değildir.
- [ ] Push 6C.2+, provider/dispatcher, delivery/receipt worker ve notification preferences `PAUSED` kalır; ayrı görev ve onay olmadan başlatılmaz.

## 8. MVP-13 kapanış kanıtı

- [ ] Exact deployed SHA'lar, deployment IDs/URLs, backup manifesti, onay kayıtları, smoke sonuçları, incident/rollback sonucu ve Production mutation sayaçlarını kaydet.
- [ ] Public launch yalnız tüm launch-required kapılar başarılı ve release blocker sayısı 0 olduğunda ayrıca ilan edilebilir.

MVP-13 bu checklist maddeleri uygulanmaya başlanana kadar `NOT STARTED` kalır.
