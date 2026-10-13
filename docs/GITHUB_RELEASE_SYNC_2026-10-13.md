# GitHub sürüm eşitleme — 13 Ekim 2026

Amaç, canlı web ile Android 1.0.3 (5) kaynaklarını GitHub'a aktarmak ve doğrulanan PR'ları main'e birleştirmektir. Kullanıcı commit/push ve ayrıca main'e birleştirmeyi açıkça istedi.

Branch: `codex/release-sync-20261013-web`; taban `56ef9bd35901852d441c7ea714f907a63db06b88`. Mobil eş branch `codex/release-sync-20261013-mobile`. Diğer kullanıcı çalışma alanlarındaki değişiklikler korunur.

Son web yayınının mobil e-posta doğrulama sayfası ve kısa davet kodları; eski kod uyumluluğu; production'a önceki açık onayla uygulanan `20261013121103_short_dietitian_invite_codes.sql` aynı içerikle aktarılır. Migration tarihçesiyle dosya kimliği eşleşir; tekrar production migration çalıştırılmaz.

İncelemede eksik CI kapsamı tamamlandı: doğrulama sayfası, kısa kod paylaşımı ve eski e-posta davet modu tarayıcı testleri critical-e2e job'una eklendi. Ayrı Short Invite PostgreSQL Gate, geçici dizinde sabitlenmiş PGlite 0.5.8 ile asıl SQL'i test eder; uygulama bağımlılığı, production URL/anahtarı veya Docker gerektirmez. Mevcut backend/sağlık kontrolleri korunur. Canonical mobil sözleşme checkout'u main olarak kalır; bu nedenle mobil PR önce birleştirilir.

Yerel doğrulama: typecheck ve lint (0 hata/5 mevcut uyarı), tüm web sözleşmeleri ve Vite production build quality komutuyla kontrol edilir. Sonuç logu `C:/dev/dietbridge-github-sync-web-quality.log` içindedir. Playwright kısa kod ve e-posta doğrulama 10 başarılı/1 eski mod testi atlandı; eski mod ayrı koşuda 1 başarılı. PostgreSQL migration tekrarı, eski kod/zaman/durum, yeni kod, auth/RLS, preview/redeem, rotation/pause, ortak deneme sınırı, kontenjan ve zorlanmış çakışma dahil 14 kontrol başarılı. Workflow YAML parse ve `git diff --check` başarılı.

Gönderilecek kaynaklar kimlik bilgisi taramasından geçti; sonuç bulgusuzdur, kapsamlı güvenlik denetimi olarak sunulmaz. `.env`, Firebase config, native credentials, node_modules, build çıktıları ve Vercel bağlantı metadatası gönderilmez.

Bu görevde production DB/Auth/Storage yazması veya yeni migration/RLS değişikliği yapılmadı. Tam yerel Docker tabanlı Auth/PostgREST/backend replay motor sorunu nedeniyle çalıştırılamaz; mevcut GitHub Backend Integration, Critical E2E ve sağlık runtime job'ları bu kontrolleri izole runner'da çalıştırır. GitHub sonuçları PR kontrolünden okunur. Fiziksel mobil klavye/pano ve gerçek e-posta kontrolleri manuel kalır. Önceki Vite büyük chunk, dependency advisory ve Supabase advisor uyarıları bu görevin kapsamı dışındadır.

Kaynak dosyalar: App.tsx, lib/supabaseClient.ts, auth doğrulama sayfası/servisi/parser ve testleri, clients davet utils/servis/landing ve testleri, migration/preflight/postflight SQL, migration replay envanterleri, PostgreSQL doğrulama script'i, quality workflow, .gitignore ve yayın raporları. Yeni branch'in tam dosya listesi PR diff'inde; önceki kısa kod görevi listesi `SHORT_INVITE_CODES_CHANGED_FILES_2026-10-13.json` içindedir.

Sonraki aşama: `codex/post-release-validation`. Önceki hazırlık/yayın raporları tarihsel durumu anlatır; son GitHub eşitleme durumu bu görev ve PR kayıtlarıyla değerlendirilir.

GitHub critical gate ilk koşusu, mocked e-posta doğrulama spec'inin gerçek Supabase paketine de dahil edildiğini yakaladı. Spec `playwright.config.ts` testIgnore listesine eklendi; kendi mocked feature config'i ve workflow adımı üzerinden çalışmayı sürdürür. Gerçek Auth kontrolü, başarı şartları veya test beklemeleri gevşetilmedi. İki config'in gerçek test envanteri `playwright test --list` ile ayrı doğrulanır; düzeltilmiş head'in GitHub kontrolleri yeniden çalışır.
