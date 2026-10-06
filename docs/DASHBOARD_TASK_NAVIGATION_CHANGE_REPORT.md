# Dashboard görev ve menü düzeltmeleri — 6 Ekim 2026

Bu rapor geliştirme aşamasının doğrulama kaydıdır. Kullanıcı sonrasında “tamamdır şimdi kontrollü şekilde production'a al” talimatıyla bu değişikliklerin commit, push, PR, merge, hedef migration ve production yayınına geçişini onayladı. Release aşamasında üç korumalı GitHub kapısı tamamlanmadan merge yapılmayacak; yalnızca yeni tercih migration'ı uygulanacak. Son yayın sonucu ayrıca kapanış kaydında raporlanacaktır.

1. **Amaç:** Otomatik görevlere normal görevlerdeki gibi silme düğmesi/onay penceresi eklemek; bekleyen görev sayısına otomatik görevleri katmak; danışan bildirim ikonunu ortalamak; beslenme planını **Danışan yönetimi** grubuna almak.
2. **Branch:** `codex/dashboard-task-navigation`. Ayrı yönetilen worktree: `C:/Users/drsam/.codex/worktrees/dashboard-task-navigation/DietBridge-Web`. Başlangıç commit'i: `1c2cf1a2a5b5537128f7239cbb2b43b486671474` (merge edilmiş PR #55).
3. **Değiştirilen dosyalar:** Aşağıdaki dosya listesi.
4. **Değişiklikler:** Otomatik satırlara mevcut `IconButton` ile X/sil eylemi ve mevcut `ConfirmDialog` ile görev adını gösteren onay eklendi. Başarısız yazmada görev kaybolmaz, onay açık kalır ve tekrar denenebilir; eşzamanlı tekrar gönderim engellenir. Silme tercihi diyetisyen hesabında saklanır ve sayfa yenileme/odaklanma/mevcut 5 dakikalık yenilemede diğer cihazlarda da okunur. Otomatik görev üretme servisine ve mevcut üretim koşullarına dokunulmadı; plan, işaretlenen öğün veya sonuçlandırılan talep ile çözülme davranışı korunur. Otomatik görevlerde tamamlanma kutusu eklenmedi. Sayı bugün/geciken manuel görevler + görünür otomatik görevlerdir; tamamlanan/yaklaşan manuel görevler dahil değildir.
5. **Çalıştırılan komutlar:** `git status --short --branch`, `git diff --check`, `git diff --exit-code -- features/dashboard/services/automaticTaskService.ts`, `npm ci --ignore-scripts`, `npx --yes supabase@2.110.0 migration new automatic_task_dismissals`, `npm run typecheck`, `npm run lint`, `npm run test:daily-tasks`, `npm run test`, `npm run build`, `npm run test:e2e:features`, `npx playwright test -c playwright.features.config.ts --timeout=60000`, `npx playwright test -c playwright.features.config.ts dashboard-tasks.spec.ts --timeout=60000`, `npm run test:notification-ui`, `npm run test:faz2:runtime`, yalnızca ikinci reseti atlayan geçici kopya ile `node scripts/.dashboard-runtime-validation.mjs`, `Start-Process` ile Docker Desktop (Hidden), iki değişen migration yardımcı betiğinde `node --check`, `docker info --format '{{.ServerVersion}}'`. Build/contract testlerde loopback Supabase URL ve secretsiz test placeholder'ı kullanıldı. Paylaşılan mobil sözleşme kontrolü için `DIETBRIDGE_MOBILE_REPO=C:/dev/DietBridge-Mobile-UI` salt okunur kullanıldı.
6. **Build:** Başarılı. Mevcut büyük bundle uyarısı devam ediyor; bağımlılıklar değiştirilmedi.
7. **Typecheck:** Başarılı.
8. **Lint:** Başarılı, 0 hata / mevcut 5 uyarı (AuthContext, AppointmentContext ve dietitianService).
9. **Test:** İlgili 32 görev sözleşmesi başarılı. Genel contract kapısı başarılı: `WEB_CONTRACT_TEST_GATE_PASS`. Tüm özellik tarayıcı seti: 14 başarılı / 1 koşullu atlanan. Son dashboard seti: 4 başarılı. Gerçek sayfa/hook/servis zinciri, yalnızca `.invalid` test adresine yönlendirilmiş API cevaplarıyla denendi: silme onayı, vazgeçme, yenilemede kalıcılık, sayaç güncelleme, başarısız yazmada korunma/tekrar deneme, mevcut otomatik çözülme, sidebar grubu ve 390px genişlik. Bildirim ikonu gerçek danışan sayfasında 1280px'de merkezde, 390px'de gizli doğrulandı.
10. **Kontrol sınırları ve runtime sonucu:** Docker başlangıçta kapalıydı; kurulu Docker Desktop arka planda başlatıldı. `npm run test:faz2:runtime` yeni migration dahil 70 dosyayı yerel DB başlangıcında uyguladı, ancak ikinci `db reset` adımında Windows Supabase CLI bootstrap hatasıyla durdu. Asıl betik korunarak geçici bir kopyada yalnızca bu ikinci reset atlandı; yeni/benzersiz disposable proje, 70 migration history kaydı ve loopback URL doğrulandı. Aynı SQL yetki matrisi ve gerçek REST akışları başarılı: `SQL_CONTRACT_MATRIX_PASS`, iki gerçek preference upsert, hesap izolasyonu, client yazma reddi ve `FAZ2_RUNTIME_HARNESS_PASS`. Geçici betik, DB ve kendi test konteynerleri temizlendi. Normal reset içeren komutun baştan sona başarılı olduğu iddia edilmiyor. Docker gerektiren tam backend paketi ve kritik gerçek tarayıcı E2E çalıştırılmadı. Invite-code testi varsayılan legacy modu nedeniyle atlandı. İlk tarayıcı koşusundaki soğuk yükleme 30 saniyeyi aştı; 60 saniyelik koşu geçti. Eski menü adı ve flex sınıfını sabitleyen test beklentileri yeni istenen UI ile güncellendi.
11. **Supabase / production yazması:** Production yazması yok. Production üzerinde yalnızca şema, constraint, policy ve mevcut onaylı diyetisyen helper salt okunur incelendi; kullanıcı verisi sorgulanmadı. Production INSERT/UPDATE/DELETE/RPC, migration, seed veya Storage işlemi yapılmadı. Yerel migration ve gerçek fixture yazmaları yalnızca geçici loopback test DB ortamında gerçekleşti; SQL matrisi transaction sonunda rollback yaptı, REST testleri disposable stack ile temizlendi. Özellik tarayıcı testleri yalnızca `.invalid` intercept cevapları kullanır.
12. **Migration oluşturma:** Kullanıcının hesapta/tüm cihazlarda saklama ve migration dosyası hazırlama onayıyla CLI tarafından `20261006193739_automatic_task_dismissals.sql` üretildi. Yeni tablo additive bir web tercih tablosudur; manuel görev/plan/öğün/ölçüm şemaları ve mobil repository değişmedi. UUID profile FK'leri, diyetisyen + görev anahtarı PK, client FK index'i ve approved-owner RLS eklendi. Insert/update aktif danışan ilişkisi gerektirir. Anon erişimi yoktur; authenticated tablo DELETE yetkisi yoktur. Upsert için yalnızca payload kolonlarına INSERT/UPDATE yetkisi verilir.
13. **Migration çalıştırma:** Production migration çalıştırılmadı. Yeni migration iki benzersiz geçici yerel proje başlangıcında uygulandı; ikinci projede history sayısı, SQL RLS matrisi ve gerçek PostgREST upsert akışı da doğrulandı. Dosya tek transaction içindedir; önceden var olan tabloya sessizce uyarlama yapmaz, preflight aşamasında durur. Tekrar doğrudan uygulamadan önce migration history incelenmelidir.
14. **Git durumu:** Değişiklikler worktree'de commit edilmeden bırakıldı; bu görev için commit/push/PR/merge yapılmadı. Kullanıcının özgün checkout'u `codex/weight-rpc-production-smoke` branch'inde ve mevcut untracked dosyaları korunuyor.
15. **Kalan riskler:** Yeni frontend tabloya ihtiyaç duyar; production migration onaylanıp uygulanmadan yayınlanmamalıdır. Windows CLI ikinci reset hatası nedeniyle normal disposable komutu CI/Linux ortamında ayrıca doğrulanmalıdır; yerel fresh-start SQL/RLS/REST kontrolleri geçti. Aynı koşulun silme kaydı geçen günlerle değişmez; farklı ölçüm/plan bitiş tarihi/talep kimliği veya bağlantı tarihi revizyonu tekrar görünür. Önceki npm audit sonucu 11 mevcut bağımlılık uyarısıdır; kapsam dışı paket güncellemesi yapılmadı.
16. **Manuel kontrol:** İzin verilen test ortamında iki fiziksel cihazda aynı hesapla silme/yenileme kontrolü yapılmalı. Gerçek DB hesabı, client, anonim ve onaysız diyetisyen izolasyonu SQL/REST testinde geçti; production geçişinde mevcut RLS/grants postflight tekrar kontrol edilmeli. Plan oluşturulması/öğün işaretlenmesi/talep sonuçlandırılmasıyla otomatik çözülme ve yeni revizyon görünümü release smoke kontrolüne dahil edilmeli.
17. **Önerilen sonraki aşama:** Bu dar değişiklik için release-preparation: istenirse ayrı commit/PR, CI üzerinde normal disposable Faz 2 runtime ve kritik E2E kapıları; ayrıca onaylandıktan sonra yalnızca yeni production migration ve frontend yayınlama. Commit/push/PR ve production migration bu görevde yapılmadı.

## Uygulama ve geri dönüş sırası

- Önce izin verilen disposable/test DB'de `npm run test:faz2:runtime` çalıştırın. Yeni migration 70 dosyalık disposable zincire eklenir; eski Faz 2 segmenti korunur.
- Production'a geçiş ayrıca onaylandıktan sonra migration history ve mevcut onaylı-diyetisyen helper'ı tekrar kontrol edilir; yalnızca bu migration hedeflenir. Tüm bekleyen geçmiş migration'ları topluca uygulamak bu görevin kapsamı değildir.
- Tablo/kolon/constraint, RLS ve grants postflight kontrolü tamamlandıktan sonra frontend yayınlanır. Normal görev CRUD'u ile danışan kaynak kayıtları değişmez.
- Uygulama geri dönüşü önceki frontend sürümünü yayınlamaktır; additive tercih tablosu korunabilir. Tercih tablosunu/verilerini silmek ayrı onay gerektirir.

## Dosya listesi

Tüm yollar yukarıdaki ayrı worktree köküne göredir.

- `features/clients/pages/ClientsPage.tsx`
- `features/dashboard/components/DashboardTaskPanel.tsx`
- `features/dashboard/hooks/useAutomaticTasks.ts`
- `features/dashboard/pages/DashboardPage.tsx`
- `features/dashboard/services/automaticTaskDismissalService.ts` (yeni)
- `features/dashboard/utils/automaticTaskContract.ts`
- `features/dashboard/utils/dashboardContract.ts`
- `shared/components/Sidebar.tsx`
- `supabase/migrations/20261006202442_automatic_task_dismissals.sql` (yeni; production history ile eşleşen son sürüm)
- `scripts/addCurrentIsolatedMigrations.mjs`
- `scripts/runCriticalE2E.mjs`
- `scripts/runDisposableFaz2RuntimeHarness.mjs`
- `scripts/runDisposableSupabaseLocalReplay.mjs`
- `scripts/runMealPlanContractTests.mjs`
- `supabase/tests/faz2_backend_contract.sql`
- `playwright.features.config.ts`
- `tests/browser/feature-fixture.tsx`
- `tests/automaticTaskDismissalContracts.test.cjs` (yeni)
- `tests/dashboardClosureContracts.test.cjs`
- `tests/dashboardTaskContracts.test.cjs`
- `tests/designSystemContracts.test.cjs`
- `tests/e2e/dashboard-tasks.spec.ts` (yeni)
- `tests/e2e/invite-sharing.spec.ts`
- `tests/faz2BackendContracts.test.cjs`
- `tests/notificationUiContracts.test.cjs`
- `docs/DASHBOARD_TASK_NAVIGATION_CHANGE_REPORT.md` (bu rapor)

## Production hazırlık kaydı — kullanıcı onayından sonra

- PR #57 açıldı. İlk commit: 47e76ce101b1f840992bd5bd8a7e79e10a14a5f2. Web Quality Gate geçti. Kritik koşudaki dört gerçek erişim testi geçti; dört mock dashboard testi yanlışlıkla bu sette de çalıştığı için kapı başarısız oldu. playwright.config.ts testIgnore listesine dashboard-tasks.spec.ts eklendi. Mock dashboard seti doğru yapılandırmayla yeniden 4/4 geçti; gerçek kritik setin listesi 4 erişim testi olarak doğrulandı. Korumalı kapı atlanmadı.
- Kullanıcının production yayın talimatı kapsamında, izole ortamda doğrulanan tek additive tercih migration'ı Supabase apply_migration ile kagvxhyvxxypspdxcuxz projesine uygulandı. Production migration servisi 20261006202442 sürümünü verdi. SQL değişmeden dosya adı ve üç test/helper referansı bu sürüme taşındı; migration history onarımı veya eski migration uygulaması yapılmadı. İlk yerel oluşturma sürümü 20261006193739 tarihsel geliştirme kaydıdır.
- Production postflight PASS: RLS etkin, üç approved-owner policy, beş constraint (iki profile FK, PK ve iki check), iki index; anon SELECT ve authenticated DELETE yok; authenticated INSERT/UPDATE yalnız dört payload kolonunda. Mevcut klinik kayıtlar ve Storage değişmedi; production test kullanıcısı veya fixture oluşturulmadı.
- Vercel projesi diet-bridge / prj_sZayHPl8Ww6dqX7ftKU4aXvdWAy5, scope team_cXgPpNvrowL8un8Y2WdbagaS, production branch main ve app.dietbridge.com.tr domain doğrulandı. MCP listeleme erişimi vermediği için aynı scope ile Vercel CLI okuma kullanıldı. Önceki READY production dağıtımı dpl_iFMzoS48o6PSVpzuxz5rc3XRiwes, SHA 1c2cf1a2a5b5537128f7239cbb2b43b486671474 geri dönüş referansı olarak kaydedildi.
- Mevcut production sürümünde 1280px ve 390px oturumsuz tarayıcı kontrolü geçti: HTTP 200, /clients -> /login, yatay taşma yok, sayfa hatası ve başarısız uygulama isteği yok. Yeni sürüm yayından sonra ayrıca kontrol edilecek. Gerçek görev silme veya sağlık verisi yazması production smoke testine dahil değildir.
- Migration sürüm eşleştirmesi sonrası 32 görev sözleşmesi ve git diff --check geçti. Son commit için Web Quality Gate, Backend Integration Gate ve Critical E2E Gate tamamlanmadan merge yapılmayacak. Ayrıntılı kapanış kanıtı C:/Users/drsam/.codex/pr-reviews/DietBridge-pr57-20261006 altında tutulacak.