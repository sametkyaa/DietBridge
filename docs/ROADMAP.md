# DietBridge — MVP Closure Roadmap

> Son uzlaştırma: 2026-08-25. Bu bölüm bundan sonraki aktif çalışma planıdır. Aşağıdaki `Historical Production Roadmap` bölümü geçmiş yürütme kaydını korur; tarihsel durum cümleleri güncel görev seçimi veya release kararı değildir.

## 1. MVP-0 sonucu ve kapsam dondurma kararı

MVP-0 repository gerçekleriyle roadmap'i uzlaştırır, public launch öncesi çalışma modelini kaydeder ve MVP kapsamını dondurur. Bu uzlaştırmada uygulama kodu, dependency, Supabase schema/data, migration veya production değiştirilmemiştir.

**Durum:** `COMPLETED — 2026-08-07`

### MVP'de zorunlu

1. Authentication
2. Role / dietitian verification
3. Dietitian profile
4. Client management
5. Client profile / lifestyle data
6. Measurements
7. Daily logs / günlük takip
8. Weekly meal plans
9. Meal CRUD
10. Meal time / sort / notes / image
11. Recipes
12. Chat + image
13. Appointments
14. Dashboard
15. Persistent Dashboard Daily Tasks
16. Real-data Analytics
17. Subscription / plans / client limits
18. Web/mobile shared database contract
19. Automated quality gates
20. Release preparation
21. Production validation / launch

### MVP dışında

- advanced AI analytics, AI clinical interpretation, AI risk scoring, AI recommendations ve AI prediction;
- AI-generated client report ve automatic AI meal-plan generation;
- advanced Notes system;
- recurring task engine, AI-generated tasks ve team task assignment;
- advanced notification automation;
- comprehensive Settings ve advanced reporting;
- large-scale repository cleanup ve non-critical bundle optimization.

Bu alanlar public launch sonrasına bırakılabilir ve MVP blocker değildir. MVP dışı bir alan kullanıcıya gerçek, kalıcı ve production-ready bir özellikmiş gibi sunulamaz.

## 2. Pre-Launch Production-First Strategy

DietBridge public launch öncesindedir. Production ortamında aktif gerçek müşteri/diyetisyen verisi bulunmadığı, yalnız geliştirme/test hesapları bulunduğu ürün sahibi beyanı bu operasyon modelinin ön koşuludur. Bu beyan değişirse strateji yeniden değerlendirilir.

MVP closure sürecinde ayrı staging deployment/parity kontrolü zorunlu release kapısı değildir. Database/backend değişiklikleri şu sırayla yürütülür:

1. Repository ve production project identity doğrulaması
2. Local/disposable ortamda migration ve test
3. Production read-only preflight
4. Production migration-history/schema doğrulaması
5. Değişikliğin riskine uygun backup/restore point
6. Küçük ve forward-only production mutation
7. Production postflight
8. Yalnız geliştirme/test hesaplarıyla pozitif ve negatif smoke test
9. `PASS` olmadan sonraki bağımlı göreve geçmeme

Kalıcı korumalar:

- Doğrulanmamış migration production'a uygulanmaz.
- Project identity doğrulanmadan mutation yapılmaz.
- Destructive schema/data değişikliği otomatik yapılmaz.
- Riskli değişiklik rollback/restore yaklaşımı olmadan uygulanmaz.
- Migration history toplu ve kontrolsüz repair edilmez.
- Web/mobile shared database contract bozulmaz.
- Production mutation görevi ile preparation/read-only audit görevleri gerektiğinde ayrı tutulur.
- Repository kökündeki `AGENTS.md` production-write onay kuralları aynen geçerlidir; production-first yaklaşımı onay yetkisi vermez.

Public launch ve gerçek kullanıcı alımı başladıktan sonra production doğrudan geliştirme/test ortamı olarak kullanılmaz. Staging/release-environment ayrımı yeniden değerlendirilir ve zorunlu hale getirilir.

## 3. Current MVP Closure Status

Bu tablo 2026-08-07 tarihli repository kanıtına dayanır. Runtime veya production kanıtı olmayan alanlar `COMPLETED` değildir.

| Alan | Güncel durum | Repository kanıtı / açık kapı |
|---|---|---|
| Auth | `IMPLEMENTED / RELEASE HARDENING PENDING` | Fail-closed access-state akışı mevcut; final production security ve RC matrisi açık |
| Dietitian Profile | `MOSTLY READY` | Gerçek service/Storage akışı mevcut; release doğrulaması açık |
| Client Management | `MOSTLY READY` | Gerçek ilişki, profil ve ölçüm akışları mevcut; final RC açık |
| Measurements | `MOSTLY READY` | Gerçek read/write ve migration contract mevcut; final RC açık |
| Daily Logs | `PARTIAL — DIETITIAN ACCESS PENDING` | Web read-model sorgusu var; active-dietitian SELECT yalnız tarihsel staging kanıtına sahip, canonical production migration zincirinde yok |
| Meal Plans | `IMPLEMENTED / RELEASE VERIFICATION PENDING` | Atomik RPC, web/mobile read ve completion akışları mevcut; session lifecycle ve image cleanup kapanışı açık |
| Meal CRUD / Image | `IMPLEMENTED / RELEASE VERIFICATION PENDING` | CRUD, time/sort/notes ve private image akışı mevcut; failure/orphan kapanışı açık |
| Recipes | `IMPLEMENTED / RELEASE VERIFICATION PENDING` | Supabase CRUD/image servisi ve canonical migrations mevcut; `RecipeDetails` route'u hâlâ legacy `RECIPES` sabitini okuyor |
| Chat + Image | `IMPLEMENTED` | Web/mobile service, realtime, private image migrations ve kapanış kanıtı mevcut |
| Appointments | `IN PROGRESS — FAKE SUCCESS BLOCKER` | Backend create/delete var; DB hatasında local ekleme/silme fallback'i devam ediyor, update kapanışı yok |
| Dashboard | `PARTIAL` | Client ve appointment bölümleri gerçek veriye bağlı; görevler local ve tüm closure özetleri tamam değil |
| Daily Tasks | `MVP / PERSISTENT IMPLEMENTATION NOT STARTED` | `TASKS` sabiti ve component state kullanılıyor; schema/service/RLS yok |
| Analytics | `MVP / REAL-DATA IMPLEMENTATION NOT STARTED` | Aktif web route hardcoded seriler ve sahte loading kullanıyor |
| Subscription | `NOT STARTED` | Product/provider/schema/enforcement/checkout akışı yok |
| Web/Mobile Contract | `PARTIAL` | Meal, measurement, recipe ve chat contract çalışmaları var; tek migration authority kararı henüz resmileştirilmedi |
| CI | `COMPLETED — 2026-08-23` | Web/Mobile GitHub Actions, disposable backend/browser katmanları ve protected required checks gerçek PR koşularında PASS |
| Release | `MVP-12 CLOSED — MVP-13 NOT STARTED` | Web/Mobile RC kaynakları protected PR/main CI ile doğrulandı; deployment/public launch ve Push 6C.2+ başlatılmadı |

### Repository uzlaştırma notları

- Aktif zincir `index.html → index.tsx → App.tsx`; dashboard, clients, analytics, meal plans, messages, recipes, appointments ve profile route'ları buradan yüklenir.
- Eski roadmap'in chat'i sabit `CONVERSATIONS` ile bekliyor göstermesi güncel değildir. Chat + image uygulanmış ve tarihsel Aşama 6 kapanış kaydı da bunu doğrular.
- Eski roadmap'in Recipes alanını tümüyle mock göstermesi güncel değildir. Liste/CRUD/image gerçek backend'e geçmiştir; legacy detail route nedeniyle release verification açık tutulur.
- Eski roadmap'in “yalnız dev/build/preview var; lockfile/lint/test veya CI yok” envanteri güncel değildir. Web ve Mobile canonical kalite scriptlerine, lockfile'lara, GitHub Actions workflow'larına ve protected required checks'e sahiptir.
- Aşama 5 satırının `Bekliyor` olması güncel değildir. Implementation tamamlanmış, release verification beklemektedir.
- Production security bütünü geçmiş Aşama 3 kapanışıyla otomatik olarak tamam sayılmaz; güncel Security Advisor bulguları ayrıca yeniden sınıflandırılacaktır.

## 4. Dashboard Daily Tasks MVP sözleşmesi

Dashboard, diyetisyenin bugün ne yapması gerektiğini gördüğü operasyon merkezidir. Daily Tasks kaldırılacak/gizlenecek demo alanı değil, çekirdek MVP özelliğidir.

### Minimum veri sözleşmesi

- unique id;
- dietitian ownership;
- optional client relation;
- title ve optional description;
- due date ve optional due time;
- priority;
- status;
- completed_at;
- created_at ve updated_at.

Nihai tablo ve enum adları ayrı tasarım/migration görevinde belirlenir.

### MVP davranışı

Diyetisyen görev oluşturabilir, düzenleyebilir, silebilir, tamamlayabilir, tekrar açabilir ve opsiyonel olarak kendi aktif danışanıyla ilişkilendirebilir. Geciken, bugünkü ve tamamlanan görevleri görebilir; refresh sonrası aynı kalıcı veriyi görür. Tenant isolation RLS ile zorunludur. DB işlemi başarısızsa UI başarılı davranmaz.

Recurring tasks, team assignment, kanban, AI-generated tasks, automatic reminder engine ve push/email task automation MVP dışıdır.

## 5. Real Analytics MVP sözleşmesi

Analytics, diyetisyenin danışanın zaman içindeki ilerlemesini gerçek DietBridge verileriyle değerlendirdiği alandır. Aktif hardcoded sayfa production-ready değildir; ancak özellik MVP'den çıkarılmaz veya gizlenmez.

### MVP kapsamı

- **Danışan seçimi:** Diyetisyen yalnız kendi aktif danışanlarını seçer.
- **KPI:** Veri varsa current weight, başlangıca göre weight change, target-weight gap, last measurement date, meal-plan adherence ve water tracking summary.
- **Measurements:** Gerçek `measurements` üzerinden weight history ve DB'de gerçekten bulunan body measurement trendleri.
- **Meal adherence:** Gerçek meal plan/meals üzerinden completed/planned meals, günlük ve haftalık uyum ile dönem trendi.
- **Daily logs / water:** Gerçek `daily_logs` üzerinden daily water, water goal, goal achievement ve dönem ortalaması/trendi.
- **Planned nutrition:** Güvenilir meal alanları varsa planned calories/protein/carbohydrate/fat. Bunlar gerçek tüketim diye adlandırılmaz; `is_eaten=true` gerçek gram tüketimi veya enerji alımı kanıtı değildir.
- **Tarih filtreleri:** En az 7 gün, 30 gün, 3 ay ve tüm zamanlar.
- **Edge states:** No measurements, no daily logs, no meal plan, incomplete macro data ve newly added client durumları doğru empty/error state üretir.

AI interpretation, clinical recommendation, risk score, prediction, natural-language AI report ve AI intervention recommendation MVP dışıdır.

## 6. MVP Closure Roadmap

### MVP-0 — Scope Freeze / Roadmap Reconciliation

- **Durum:** `COMPLETED — 2026-08-07`
- **Amaç:** Repository durumunu roadmap ile eşitlemek, MVP kapsamını dondurmak ve pre-launch production-first stratejisini kaydetmek.

### MVP-1 — Production Security Advisor Read-Only Triage

- **Amaç:** Güncel production Supabase Security Advisor bulgularını mutation yapmadan sınıflandırmak.
- **İncelenecekler:** anon executable `SECURITY DEFINER` functions, anon table grants, GraphQL exposure, authenticated function grants, mutable `search_path`, RLS/no-policy ve leaked-password protection bulguları.
- **Çıktı sınıfları:** `MUST FIX BEFORE MVP`, `INTENTIONAL`, `LOW RISK / POST-MVP HARDENING`, `FALSE POSITIVE / NOT APPLICABLE`.

### MVP-2 — Production Security Hardening + Daily Logs Access

- **MVP-2A:** Hardening + `daily_logs` migration preparation
- **MVP-2B:** Local/disposable validation
- **MVP-2C:** Production read-only preflight
- **MVP-2D:** Backup/restore point + controlled production application
- **MVP-2E:** Production postflight + negative security smoke
- **Kabul özeti:** Diyetisyen kendi aktif danışanının `daily_logs` verisini okuyabilir; başka diyetisyenin danışanına erişemez. Bu, Analytics'in ön koşuludur.

### MVP-3 — Meal Plans Release Closure

Yeni feature yerine mevcut implementasyonun release kapanışıdır. Web plan persistence, mobile same-plan visibility, meal completion RPC, restart persistence, session refresh, background/foreground, image upload failure, failed-save rollback ve meal-photo orphan cleanup doğrulanır. Hedef sonuç: `MEAL PLANS MVP DONE`.

### MVP-4 — Appointment Reliability

Mevcut backend CRUD korunur. DB başarısızlığındaki local fallback/fake success kaldırılır. Create, update, delete, ownership, client relation, date/time validation, loading, error, retry ve refresh persistence doğrulanır.

### MVP-5 — Persistent Dashboard Daily Tasks

- **MVP-5A:** Schema / migration / RLS
- **MVP-5B:** Task service
- **MVP-5C:** Dashboard UI integration
- **MVP-5D:** Production smoke / tenant isolation / persistence

Mevcut mock `TASKS` gerçek backend ile değiştirilir.

### MVP-6 — Real Analytics

- **MVP-6A:** Real data contract inventory
- **MVP-6B:** Analytics service
- **MVP-6C:** KPI summary
- **MVP-6D:** Measurement / weight trends
- **MVP-6E:** Water / daily-log trends
- **MVP-6F:** Meal adherence
- **MVP-6G:** Date filters + empty/error states

Hardcoded/fake analytics kaldırılır; advanced AI analysis yapılmaz.

### MVP-7 — Subscription / Plans / Client Limits

- **MVP-7A:** Commercial/product contract — tiers, client limits, monthly/yearly, trial, cancellation, renewal, failed payment ve downgrade/upgrade kuralları
- **MVP-7B:** Payment provider decision
- **MVP-7C:** Subscription schema
- **MVP-7D:** Server-side client-limit enforcement
- **MVP-7E:** Checkout / webhook / lifecycle
- **MVP-7F:** Subscription UI

Provider kararı verilmeden provider-specific kod başlanmaz. Client limiti yalnız frontend kontrolü olamaz.

### MVP-8 — Dashboard Closure

Dashboard'un ana sorusu “Bugün ne yapmalıyım?”dır. Client summary, today's appointments, overdue tasks, today's tasks ve relevant quick actions gerçek veriden gelir. Dashboard ayrı Analytics sayfasına dönüştürülmez.

### MVP-9 — MVP Mock / Local Cleanup

Gerçek hale gelen Analytics ve Daily Tasks gizlenmez. MVP dışında kalan Notes, fake/local Settings, eski mock arrays, demo fallbacks ve kullanılmayan hardcoded analytics/tasks/recipes artefact'ları kaldırılır veya navigation/route'tan çıkarılır. Fake success/persistence bırakılmaz.

### MVP-10 — Web/Mobile Shared Contract Closure

Schema ownership, migration authority, table/RPC contracts, Storage paths, `daily_logs`, `measurements`, meal plans, meals ve chat doğrulanır.

**Repository kanıtı:** Web reposunda production baseline, security, meal completion, recipe, chat/image ve measurement zincirini kapsayan çok sayıda canonical migration ile production history/reconciliation runbook'ları vardır. Mobil repoda yalnız üç dar uyumluluk migration'ı bulunur; mobil dokümanları meal completion RPC için aktif Web migration kaynağına referans verir.

**Önerilen karar:** Resmî governance kararı ve iki repo history karşılaştırması tamamlanana kadar shared production schema için Web repository canonical migration authority kabul edilmelidir. Mobil repository shared schema'ya bağımsız migration push etmemeli; mevcut mobil migration'lar Web zinciriyle version/hash/contract bazında uzlaştırılmadan production'a uygulanmamalıdır. İki repository'nin aynı production database'e bağımsız migration push etme yolu kapatılmalıdır.

### MVP-11 — CI / Automated Quality Gate

**Durum:** `COMPLETED — 2026-08-23`. Web PR #17 üzerinde `Web Quality Gate`, `Backend Integration Gate` ve `Critical E2E Gate`; Mobile protected PR'larında `Mobile Quality Gate` gerçek GitHub Actions runner'larında geçmiştir. İki `main` branch'i strict required checks ve PR zorunluluğuyla korunur; başarısız veya pending check merge'i engeller.

Canonical Web sıra:

```text
npm ci → typecheck → lint → test → build
```

CI kritik test kapsamı auth, ownership, appointments, tasks, analytics calculations, meals, chat ve subscription limits alanlarını içerir.

Browser E2E, unauthenticated access, client-role rejection, pending/rejected dietitian, approved login/session restore, persisted client/profile read ve logout akışlarını disposable Supabase üzerinde doğrular. Daha geniş plan/meal, appointment, Chat/image, subscription/limit, reminder ve Push matrisi deterministic backend/service katmanında tutulur. CI Production secret/verisi kullanmaz ve Production'a yazmaz.

### MVP-12 — Production Release Candidate

**Durum:** `CLOSED — 2026-08-25`.

Production read-only schema/RLS/RPC/Storage/Auth/cron/log/advisor denetimi, Web/Mobile dependency triage, tüm local kalite kapıları, protected PR check'leri ve final `main` CI koşuları PASS. P0/P1 blocker sayısı 0; Production DB/Auth/Storage/migration yazması, synthetic Production kullanıcı ve deployment sayısı 0'dır. Exact RC commit'leri repository başına `mvp-12-rc` tag'iyle kilitlenir.

Canonical 48 migration ile Production 47-history farkının tek substantive kuyruğu Push registry/outbox migration'ıdır. Mobile EAS project ID olmadan token/RPC öncesi fail-closed kaldığından bu fark `INTENTIONALLY DEFERRED WITH PUSH 6C.2+` olarak kabul edilmiştir. Push 6C.2+, provider/dispatcher, App Store/Google Play ve public launch başlatılmamıştır.

Kontrollü launch önkoşulları `docs/MVP13_LAUNCH_CHECKLIST.md` içindedir. Free plan restore/PITR varsayılmaz; launch öncesi fresh private logical backup + disposable restore veya ayrı onaylı recovery planı gerekir.

### MVP-13 — Public Launch / Post-Launch Validation

**Durum:** `NOT STARTED`. Push 6C.2+ `PAUSED`.

Public launch öncesinde backup/restore readiness, migration parity, Auth configuration, RLS, Storage, Edge Functions, payment webhook, environment variables, domain/redirects, monitoring ve rollback runbook son kez kontrol edilir. Ardından public user acquisition açılır. Launch sonrasında production doğrudan geliştirme/test ortamı olarak kullanılmaz.

## 7. Kritik bağımlılık zinciri

```text
Scope
→ Security
→ Daily Logs
→ Meal Release Closure
→ Appointments
→ Daily Tasks
→ Analytics
→ Subscription
→ Dashboard Closure
→ Mock Cleanup
→ Web/Mobile Contract
→ CI
→ Release Candidate
→ Public Launch
```

- Analytics, dietitian `daily_logs` access çözülmeden release-ready olamaz.
- Daily Tasks, Dashboard MVP closure'ın ön koşuludur.
- Subscription provider kararı verilmeden provider-specific payment kodu başlanmaz.
- Security hardening tamamlanmadan public launch yapılmaz.
- Analytics ve Tasks mock cleanup sırasında gizlenmez.
- Production migration local/disposable validation yapılmadan uygulanmaz.

## 8. MVP Definition of Done

DietBridge MVP ancak aşağıdaki koşullar birlikte sağlandığında tamamlanır:

- Yalnız doğru role/onaya sahip dietitian web'e erişir; client web erişimi engellenir.
- Dietitian yalnız kendi clients/data alanına erişir.
- Client management ve measurements kalıcıdır.
- `daily_logs` doğru sahiplik ve tenant isolation ile çalışır.
- Meal plan ve meal CRUD web/mobile ortak contract ile çalışır.
- Recipes gerçek backend kullanır ve tüm aktif recipe route'ları aynı canonical kaynağı okur.
- Chat + image kalıcıdır.
- Appointments fake success üretmez.
- Daily Tasks gerçek backend ve RLS kullanır; refresh sonrasında kaybolmaz.
- Analytics tamamen gerçek data kullanır; hardcoded veri veya fake loading içermez.
- Subscription backend tarafından doğrulanır; client limits server-side enforce edilir.
- Production'da kullanıcıya fake persistence gösterilmez.
- MVP dışı mock özellikler gerçek feature gibi gösterilmez.
- `npm ci`, typecheck, lint, test ve build kalite kapıları çalışır.
- Kritik E2E/RC senaryoları geçer.
- Production security blocker kalmaz.
- Backup/rollback/release runbook hazırdır.

---

# DietBridge Web — Historical Production Roadmap

> Aşağıdaki Aşama 0–13 içeriği tarihsel çalışma ve karar kaydıdır. İçindeki “mevcut”, “bekliyor”, mock listeleri, staging zorunluluğu veya sonraki aşama ifadeleri 2026-08-07 itibarıyla aktif yönlendirme değildir. Güncel kapsam, durum, environment stratejisi, bağımlılıklar ve Definition of Done yukarıdaki `MVP Closure Roadmap` bölümündedir.

## 1. Amaç ve yürütme modeli

Bu yol haritası DietBridge Web’i sıfırdan yeniden yazmadan, mevcut çalışan uygulamayı koruyarak production seviyesine ulaştırır. Teknik borç küçük ve geri alınabilir adımlarla azaltılır. Her aşama ayrı görev ve ayrı `codex/` branch’inde yürütülür; bir aşamanın kabul kriterleri tamamlanmadan bağımlı aşamaya geçilmez.

Öncelik sırası güvenlik ve veri bütünlüğü, tekrarlanabilir kurulum, çekirdek MVP özellikleri, mock temizliği, kalite kapıları ve yayın hazırlığıdır. Production’da çalışıyor izlenimi veren sahte işlem bırakılmaz. Bu belge yaşayan bir plandır; her aşama tamamlandığında durum, tarih ve doğrulama kanıtları güncellenir.

Kalıcı çalışma ve güvenlik kuralları repository kökündeki `AGENTS.md` dosyasındadır.

## 2. Mevcut proje durumu

### 2.1. Uygulama çekirdeği

- React 19, TypeScript ve Vite 6 tabanlı SPA.
- Router ve provider bileşimi `App.tsx` içinde.
- Başlangıç zinciri `index.html` → `index.tsx` → `App.tsx`.
- Public auth route’ları ile `shared/components/ProtectedRoute.tsx` arkasındaki dashboard route’ları ayrılmıştır.
- Aktif geliştirme yapısı ağırlıklı olarak `features/`, `pages/`, `shared/` ve `lib/` dizinleridir.
- `src/`, kök `components/`, `context/` ve `services/` tekrar eden veya eski alternatifler içerir; import analizi yapılmadan silinemez.
- `package.json` yalnızca `dev`, `build` ve `preview` scriptlerini içerir. Lockfile, lint, test ve CI yoktur.
- `index.html`, mevcut olmayan `/index.css` dosyasına referans verir; stil sistemi Tailwind CDN ve Google Fonts’a dış ağ üzerinden bağlıdır.

### 2.2. Supabase kullanımı

- Aktif client: `lib/supabaseClient.ts`.
- Hedef environment isimleri: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Aktif kodda ayrıca `EXPO_PUBLIC_*` fallback’leri ve tarayıcı açısından riskli `process.env` erişimleri bulunur.
- `lib/supabaseClient.ts` hardcoded Supabase URL/anon key fallback’i içerir.
- `.env.example` yalnızca `VITE_ENABLE_MOCK_DATA` değerini belgeler; `.env` boş olmasına rağmen Git tarafından takip edilir.

Kullanılan temel tablolar:

```text
profiles
dietitian_profiles
client_profiles
dietitian_clients
appointments
meal_plans
meals
measurements
daily_logs
```

Kullanılan Storage bucket’ları:

```text
avatars
dietitian-diplomas
meal-photos
```

`supabase/migrations/` altında yalnızca `20260706_add_sort_order.sql` bulunur. Repository’de kapsamlı tablo şeması, RLS veya Storage policy migration’ları görünmez; production Supabase durumu ayrıca salt okunur denetlenmelidir.

### 2.3. Gerçek veri kullanan alanlar

- Diyetisyen profili: `features/dietitians/services/dietitianService.ts`.
- Danışan listesi, ilişkilendirme ve detay: `features/clients/services/clientService.ts`.
- Ölçümler ve günlük loglar: aynı client servisi üzerinden `measurements` ve `daily_logs`.
- Beslenme planı ve öğünler: `features/meal-plans/services/mealPlanService.ts` ile `meal_plans` ve `meals`.
- Randevular: `features/appointments/services/appointmentService.ts`; gerçek CRUD vardır ancak veri izolasyonu ve fallback davranışı risklidir.
- Dashboard: danışan ve randevu bölümleri gerçek servislerden beslenir.
- Profil, öğün fotoğrafı ve diploma süreçleri Supabase Storage kullanır.

### 2.4. Mock veya yerel veri kullanan alanlar

- Mesajlaşma: `pages/Messages.tsx`, sabit `CONVERSATIONS`.
- Tarifler: `pages/Recipes.tsx` ve `pages/RecipeDetails.tsx`, sabit `RECIPES`.
- Analiz: `pages/Analytics.tsx`, sabit danışan ve grafik serileri; sahte loading.
- Notlar: `pages/Notes.tsx`, `INITIAL_NOTES` ve yalnızca component state.
- Dashboard görevleri: `features/dashboard/pages/DashboardPage.tsx`, sabit `TASKS`.
- Ayarlar: `features/settings/pages/SettingsPage.tsx`, yerel toggle’lar ve simüle edilmiş kaydetme.
- Randevu: DB kaydı başarısızsa yalnızca local state’e eklenebilen fallback.
- Sabit veri kaynakları: `constants.ts` ve `shared/constants.ts`.

### 2.5. Başlangıç teknik riskleri

1. `shared/components/ProtectedRoute.tsx`, rol null veya okunamamışken fail-open davranabilir.
2. `features/dietitians/services/dietitianService.ts`, kayıt sırasında bazı profil RLS hatalarını yutup başarı döndürebilir.
3. RLS ve Storage policy tanımları repository’de görünmez.
4. Randevu listeleme sahiplik filtresi uygulamaz; güvenlik tamamen uzaktaki RLS’ye bağlıdır.
5. `lib/supabaseClient.ts` ve appointment servisi `process.env`/`import.meta.env` kullanımını karıştırır.
6. Supabase fallback URL ve anon key kaynakta ve yardımcı betiklerde sabittir.
7. `.env.example` eksik, `.env` ise takip edilmektedir.
8. Lockfile, typecheck/lint/test scriptleri ve CI yoktur.
9. Aktif ve eski dizinler ile iki ayrı constants/types kaynağı drift riski taşır.
10. Mock ve gerçek veriler aynı kullanıcı deneyiminde karışır.
11. `test_insert.js` gerçek DB’ye yazabilir; kökte çok sayıda patch/check betiği vardır.
12. `cookies.txt`, `openapi.json`, prompt geçmişleri ve geçici araçlar repository hijyeni riski oluşturur.
13. Sayfa seviyesinde doğrudan Supabase erişimleri `pages/ClientDetails.tsx` ve `pages/MealPlans.tsx` içinde devam etmektedir.

## 3. MVP kapsamı

İlk production sürümü için zorunlu kapsam:

1. Diyetisyen kayıt, giriş ve şifre sıfırlama
2. Fail-closed rol kontrolü ve diyetisyen onay durumu
3. Diyetisyen profil ve oturum yönetimi
4. Danışan listesi, ekleme ve ilişkilendirme
5. Danışan profil, ölçüm ve yaşam tarzı bilgileri
6. Haftalık beslenme planı
7. Öğün ekleme, düzenleme, silme, saat, sıralama ve görsel
8. Diyetisyen–danışan mesajlaşması ve görsel gönderimi
9. Randevu oluşturma, güncelleme ve silme
10. Aylık/yıllık abonelik, paket ve danışan limiti
11. Gerçek veriye dayanan temel dashboard

MVP kapsamı Aşama 0 sonunda dondurulmalıdır. Sonraki kapsam değişiklikleri yol haritasına, bağımlılıklara ve kabul kriterlerine açıkça işlenir.

## 4. MVP dışında tutulabilecek alanlar

- gelişmiş veya görsel AI analizleri;
- ileri istatistik ve raporlama panelleri;
- kapsamlı tarif yönetimi;
- otomatik görev motoru;
- gelişmiş not yönetimi;
- otomatik beslenme planı üretimi;
- ileri bildirim otomasyonu;
- kapsamlı kişiselleştirme ayarları.

Bu alanlar gerçek veriyle çalışmıyorsa production kapsamından çıkarılmalı veya menüden gizlenmelidir. Kullanıcıya çalışan özellik gibi görünen sahte işlem bırakılamaz.

## 5. Yol haritası aşamaları

### Aşama 0 — Proje yönetimi ve geliştirme kuralları

- **Amaç:** Kalıcı Codex kurallarını, doğrulanmış başlangıç durumunu ve production planını sabitlemek.
- **Kapsam:** `AGENTS.md`, `docs/ROADMAP.md`, MVP sınırı, Definition of Done ve aşama bağımlılıkları.
- **Kapsam dışı:** Uygulama kodu, bağımlılık, build, DB, migration ve deployment değişiklikleri.
- **Bağımlılıklar:** Salt okunur repository incelemesi.
- **Branch:** `codex/project-governance`
- **Yapılacak işler:** İki belgeyi oluşturmak; repository gerçekleriyle tutarlılık ve Git diff kontrolü yapmak.
- **Teknik riskler:** Yol haritasının mevcut olmayan özellikleri tamamlanmış gibi göstermesi; belgeler arası çelişki.
- **Kabul kriterleri:** İki belge mevcut ve Türkçe; sonraki aşama belli; başka dosya, kod veya production verisi değişmemiş.
- **Manuel doğrulama:** Başlıklar, yollar, MVP kapsamı ve branch durumunu gözden geçirmek.
- **Teslim çıktıları:** `AGENTS.md`, `docs/ROADMAP.md`.
- **Durum:** Tamamlandı.

### Aşama 1 — Teknik temel ve tekrarlanabilir kurulum

- **Amaç:** Her geliştiricide ve CI’da aynı sonucu veren güvenli geliştirme tabanı kurmak.
- **Kapsam:** npm/lockfile, `typecheck`, lint, `.env.example`, `.gitignore`, Vite env standardı, eksik CSS/build referansları ve production build.
- **Kapsam dışı:** Auth davranışı, feature geliştirme, DB yazma.
- **Bağımlılıklar:** Aşama 0.
- **Branch:** `codex/project-foundation`
- **Yapılacak işler:** Paket yöneticisini npm olarak sabitlemek; lockfile üretmek; kalite scriptlerini eklemek; hardcoded fallback’leri kaldırmak; `import.meta.env` standardına geçmek; README kurulumunu düzeltmek; `/index.css` ve CDN stratejisini doğrulamak.
- **Teknik riskler:** Lockfile üretiminde sürüm farkı; env olmadan build; stil davranışı değişimi.
- **Kabul kriterleri:** Temiz kurulum tekrarlanabilir; `npm ci`, typecheck, lint ve build başarılı; güvenli env örneği mevcut; production DB’ye yazılmamış.
- **Manuel doğrulama:** Login ekranı ve temel route’ları lokal ortamda açmak; stil ve font yüklenmesini kontrol etmek.
- **Teslim çıktıları:** Lockfile, kalite yapılandırmaları, env/README iyileştirmeleri ve doğrulama raporu.
- **Durum:** Tamamlandı.

### Aşama 2 — Authentication ve rol güvenliği

- **Amaç:** Yalnızca doğru role ve onaya sahip diyetisyenlerin web paneline erişebilmesini sağlamak.
- **Kapsam:** Session restore, loading/error durumları, fail-closed guard, client rolü reddi, eksik profil, onay/red durumu, kayıt kısmi başarısı, password recovery ve logout.
- **Kapsam dışı:** RLS politika dağıtımı ve genel UI yenilemesi.
- **Bağımlılıklar:** Aşama 1.
- **Branch:** `codex/auth-hardening`
- **Yapılacak işler:** Auth state modelini açık durumlara ayırmak; role/profile sorgu hatasını erişim reddi yapmak; profil insert hatasını başarıdan ayırmak; manuel senaryo matrisi hazırlamak.
- **Teknik riskler:** Mevcut onaylı kullanıcıların yanlış engellenmesi; Auth ve profil kayıtlarının tutarsız olması.
- **Kabul kriterleri:** Oturumsuz kullanıcı korunur; client web’e giremez; rol okunamazsa erişim kapalıdır; eksik/onaysız profil kontrollüdür; kayıt hatası başarılı görünmez.
- **Manuel doğrulama:** Oturumsuz, client, rolü eksik, profili eksik, pending, rejected ve approved kullanıcı senaryoları.
- **Teslim çıktıları:** Hedefli auth değişiklikleri ve senaryo doğrulama raporu.
- **Durum:** Tamamlandı.

### Aşama 3 — Supabase şeması, migration ve RLS güvenliği

- **Amaç:** Veri sahipliği, ilişkiler ve Storage erişimini server tarafında güvenceye almak.
- **Kapsam:** Temel tabloların kolon/tip/FK/constraint/index/trigger/RLS envanteri, Storage policy’leri, migration disiplini ve şema dokümantasyonu.
- **Kapsam dışı:** Kullanıcı onayı olmadan production migration uygulamak; mesaj/abonelik feature’ını geliştirmek.
- **Bağımlılıklar:** Aşama 1–2.
- **Branch:** `codex/supabase-security`
- **Yapılacak işler:** Salt okunur şema denetimi; sahiplik matrisi; diyetisyen–danışan izolasyon test planı; eksik politika/migration önerileri; mobil uyumluluk analizi.
- **Teknik riskler:** Uzaktaki şema ile repo migration’larının ayrışması; mevcut kullanıcıları kilitleyen politika; mobil istemci uyumsuzluğu.
- **Kabul kriterleri:** Her tablonun sahiplik modeli açık; başka diyetisyen verisi okunamaz/değiştirilemez; Storage ilişkisel olarak sınırlandırılır; migration uygulaması için ayrı onay kapısı vardır.
- **Manuel doğrulama:** İki diyetisyen ve ilişkili/ilişkisiz danışanlarla negatif yetki senaryoları; Storage erişim denemeleri.
- **Teslim çıktıları:** Şema/RLS envanteri, migration planı, doğrulama ve rollback planı.
- **İlerleme notu:** Aşama 3D-4A kapsamında güvenlik migration taslakları bağımlılık sırasına göre active migration zincirine dönüştürüldü ve repository dışındaki disposable yerel Supabase ortamında sıfırdan uygulanarak doğrulandı. Staging, production ve GROUNDLESS projelerine güvenlik migration’ı uygulanmadı. Aşama 3D-4B-0 kapsamında staging ortamında eksik olduğu doğrulanan `auth.users` onboarding trigger’ı için ileri yönlü, idempotent ve fail-fast migration hazırlandı. Migration disposable yerel Supabase ortamında temiz replay, metadata, idempotency ve lint kontrolleriyle doğrulandı. Staging, production ve GROUNDLESS değiştirilmedi. Aşama 3D-4B kapsamında yerel ortamda doğrulanan güvenlik ve onboarding migration zinciri yalnız DietBridge Staging projesine dry-run sonrasında kontrollü olarak uygulandı. Migration history ve hedef metadata sonuçları doğrulandı. Production ve GROUNDLESS değiştirilmedi.
- **Aşama 3D-4C tamamlanan işler:**
  - Sentetik DietBridge Staging kullanıcılarıyla onboarding ve rol ayrımı doğrulandı; onboarding testleri 7/7 başarılı tamamlandı.
  - Cross-tenant erişim, sender spoofing, role escalation ve verification escalation engellendi.
  - `set_my_meal_completion` RPC’sinin yalnız ilgili danışanın meal kaydında çalıştığı doğrulandı.
  - Sentetik kullanıcılar ve fixture verileri tamamen temizlendi; final Auth user, public row ve Storage bucket sayıları sıfır olarak doğrulandı.
  - Repository ve staging migration history sekiz active migration ile birebir eşleşti.
  - Legacy `meals` UPDATE policy’sinin `is_eaten` dışındaki alanları da güncellemeye izin verdiği doğrulandı; bulgu P1 deferred production blocker olarak kaydedildi.
- **Aşama 3E-0 — Mobil Meal Completion RPC Cutover Denetimi:** Bu salt-okunur denetim, sonraki mobil cutover öncesindeki direct UPDATE yolunu kaydetti. Aşama 3E-1C’de aktif mobil service’in `set_my_meal_completion` RPC’sine geçtiği, rollback/persistence ve foreign-meal korumasının fiziksel cihaz staging testiyle doğrulandığı kaydedildi.
- **Aşama 3E-1C tamamlanan mobil doğrulama:** Aşama 3E-1C-2 rollback kod düzeltmesi (`73009da`) PASS’tir. Fiziksel Android telefonda network database rollback, mobil UI rollback, kontrollü Türkçe hata, own-meal `set_my_meal_completion` RPC, restart sonrası persistence ve foreign-meal reddi PASS’tir. Foreign-check exit code `10` beklenen güvenlik başarısıdır. Final cleanup aggregate sonucu Auth users `0`, public rows `0`, Storage buckets `0` ve exit code `0` olarak doğrulandı.
- **Cleanup bulgusu ve düzeltmesi:** İlk cleanup PARTIAL oldu; mobil kullanımının oluşturduğu manifest dışı `daily_logs.client_id` satırı `ON DELETE NO ACTION` bağıyla fixture Auth silmesini engelledi. Fixture cleanup scripti düzeltildi: yalnız manifest kullanıcılarına ait günlük logları Auth silmeden önce temizler, dar 404 `user_not_found` idempotency ve sınırlı retry uygular. `daily_logs` foreign key davranışı ayrı şema kararı/riskidir.
- **Emülatör notu:** Network-offline davranışı emülatörde güvenilir kabul edilmedi; kabul sonucu fiziksel Android telefon testidir.
- **Aşama 3E-2A — Migration hazırlığı:** Kullanıcı beyanına göre legacy mobile compatibility gerekli değildir; eski build dış dağıtıma çıkmadı. Exact `Clients can update own meal completion` policy’sini kaldıran fail-fast migration, salt-okunur catalog verification SQL’i ve staging regresyon runbook’u hazırlandı.
- **Aşama durumları (kapanış öncesi tarihsel kayıt):** 3E-2C-2A COMPLETED; 3E-2C-2B production read-only contract audit COMPLETED / NOT READY; 3E-2C-2C pre-policy reconciliation package PREPARED; 3E-2C-2D preflight execution COMPLETED; 3E-2C-2D-1 verification data remediation package PREPARED; 3E-2C-2D-2 data remediation application COMPLETED; 3E-2C-2E reconciliation application COMPLETED; 3E-2C-2E-1 function validator correction COMPLETED; 3E-2C-2E-2 constraint validator correction COMPLETED; production reconciliation retry 3 COMPLETED; production postflight PASSED; 3E-2C-2F production CLI RPC smoke tests PASSED; physical Android production smoke PASSED; fixture cleanup PASSED / remaining `0`; migration history adoption package PREPARED; 3E-2C-3 legacy policy removal BLOCKED BY HISTORY ADOPTION. Güncel tamamlanma durumu aşağıdaki kapanış kaydındadır.
- **Staging sonucu:** Legacy policy staging’de kaldırıldı. Staging security harness 17/17 geçti. Fiziksel Android mobil regresyonu geçti. Staging cleanup Auth/public/Storage `0/0/0` tamamlandı.
- **Production mobil ilk deneme:** Production CLI RPC smoke kontrolleri geçti; RPC defekti gözlenmedi. İlk fiziksel mobil deneme, eski fixture’da aktif `dietitian_clients` ilişkisi bulunmadığı için beklenen UI kapısında durdu; mobil uygulama defekti kanıtlanmadı. Eski fixture cleanup `PASS`, kalan kayıt `0` ve legacy policy `PRESENT` durumundadır.
- **Production rollout blocker (kapanış öncesi tarihsel kayıt):** Production reconciliation, CLI RPC ve fiziksel Android own/persistence/foreign-not-exposed kontrolleri geçti; fixture cleanup `PASS`, kalan kayıt `0` ve functional policy-removal gate test öncesinde `YES` oldu. Legacy policy hâlâ mevcuttu. Tek kalan blocker, boş remote history’ye ilk sekiz migration’ın version bazlı adoption’ıydı; `20260713000000` ayrı tarihsel risk acceptance gerektiriyordu.
- **Kapanış öncesi sıradaki işlem (tarihsel kayıt):** Ayrı production mutation görevinde backup/restore point ve her version için ayrı manuel approval ile history adoption runbook’unu uygulamak; remote ilk sekiz version birebir eşleşmeden policy-removal dry-run/push çalıştırmamak ve `20260714010000` sürümünü gerçek migration push için pending bırakmak planlanmıştı.
- **Aşama 3 kapanışı — 2026-07-16:**
  - History adoption blocker kapatıldı. Production migration history, dokuz active local migration ile `9/9 Local–Remote` eşleşecek şekilde doğrulandı; ilk sekiz migration için kontrollü history adoption tamamlandı.
  - `20260714010000_remove_legacy_client_meals_update_policy.sql` production’a history adoption olarak değil gerçek migration olarak uygulandı. Eski `Clients can update own meal completion` policy’si kaldırıldı ve legacy policy kaldırma kontrolü `PASS` oldu.
  - `set_my_meal_completion` RPC güvenlik sözleşmesi `PASS` oldu: owner `postgres`, `security_definer = true`, authenticated execute `true`, anon execute `false`, service_role execute `true`, `search_path = pg_catalog, public`.
  - Kritik RLS sözleşmesi `PASS` oldu; `appointments`, `chat_messages`, `dietitian_profiles`, `meal_plans` ve `meals` tablolarında RLS’nin açık olduğu doğrulandı.
  - Fiziksel Android production testi geçti. Production fixture cleanup sonucu `PASS`, kalan fixture kayıt sayısı `0` oldu.
  - Gerçek production danışanına beslenme planı başarıyla kaydedildi ve plan mobil uygulamada görünür oldu. Mobilde `Öğünü yedim → Geri Al` ile `Geri Al → Öğünü yedim` geçişleri başarılı, kalıcı ve yeniden açılış sonrasında tutarlı bulundu.
  - Plan kaydındaki `meals.recipe_id = "1"` UUID hatası giderildi.
  - Kalite doğrulamaları: typecheck başarılı; lint `0 error, 61 warning`; production build başarılı.
  - PR #1 `main` branch’ine merge edildi. Merge commit: `a9f0a5874b7b367656a09736de682403aeabb149`.
- **Durum:** Tamamlandı.

### Aşama 4 — Danışan yönetimi

- **Amaç:** Diyetisyenin yalnızca kendi danışanlarını güvenli ve kalıcı biçimde yönetmesini sağlamak.
- **Kapsam:** Liste, arama, filtre, ilişkilendirme, detay, profil, ölçümler, günlük/yaşam tarzı bilgileri, fotoğraf ve hata/boş durumları.
- **Kapsam dışı:** Beslenme planı, mesaj ve abonelik geliştirmesi.
- **Bağımlılıklar:** Aşama 2–3.
- **Branch:** `codex/client-management`
- **Yapılacak işler:** Servis sorgularını ve ilişki durumlarını doğrulamak; sayfa-level veri erişimini azaltmak; kalıcı mutasyonları ve geri bildirimleri düzeltmek; yetkisiz ID erişimini test etmek.
- **Teknik riskler:** `profiles`/`client_profiles` join ayrışması; pending/active ilişki karışması; hassas sağlık verisi sızıntısı.
- **Kabul kriterleri:** Diyetisyen yalnızca kendi danışanını görür; ekleme ve ölçüm verisi kalıcıdır; yenilemede kaybolmaz; hata sahte başarı üretmez.
- **Manuel doğrulama:** Boş liste, arama, pending/active ilişki, yetkisiz URL, profil fotoğrafı ve ölçüm geçmişi.
- **Teslim çıktıları:** Güvenli danışan akışı ve test kanıtları.
- **Başlangıç tarihi:** 2026-07-16.
- **İş Paketi 4.1 durumu:** İş Paketi 4.1 tamamlandı; staging doğrulaması geçti. Branch commit ve push kaydı bu görev raporunda tutulacaktır.
- **İş Paketi 4.2 durumu:** İş Paketi 4.2 tamamlandı — kod incelemesi ve staging canlı error-retry doğrulaması geçti / commit incelemesine hazır.
- **İş Paketi 4.3 durumu:** İş Paketi 4.3 tamamlandı — kod incelemesi ve staging canlı doğrulaması geçti.
- **İş Paketi 4.4A durumu:** Tamamlandı — ilişki güvenlik sözleşmesi, migration replay, DB lint, RLS/RPC matrisi ve staging lifecycle doğrulaması geçti.
- **İş Paketi 4.4C durumu:** Tamamlandı — canonical profil/yaşam tarzı read-model'i, responsive ve 44 px touch-target kontrolleri ile staging güvenlik harness'i geçti. Cleanup Auth/public/Storage sonucu `0/0/0`; runtime harness migration history kontrolü yapamadı.
- **İş Paketi 4.4B durumu:** WP4.4B tamamlandı — kod incelemesi ve staging canlı regresyonu geçti.
- **İş Paketi 4.5A/4.5B durumu:** Tamamlandı — güvenli measurement persistence, ayrıştırılmış bölüm durumları, bağımsız kilo/vücut ölçüsü formları, same-day upsert, responsive UI ve staging runtime matrisi geçti.
- **İş Paketi 4.6 durumu:** Tamamlandı — `avatars` bucket private, private path okumaları 5 dakikalık signed URL ile sınırlandırılmıştır. Owner ve active ilişkili diyetisyen erişimi; pending/cross-tenant/anon retleri; canonical path, JPEG/PNG/WebP ve 5 MiB sınırları; initials fallback, avatar error isolation ve sıfır cleanup doğrulandı. Silme öncesi üretilmiş signed URL'nin TTL/CDN cache süresince okunabilmesi P2 non-blocking deferred limitasyondur; anında revocation doğrulanmış değildir.
- **İş Paketi 4.7 durumu:** Tamamlandı — measurement history ilk `4`, sonraki `8` kayıtlık cursor pagination, load-more hata/retry izolasyonu ve canonical merge davranışıyla sınırlandırıldı.
- **İş Paketi 4.8 durumu:** Tamamlandı — ayrık measurement patch RPC'leri, `4 + 1` / `8 + 1` cursor pagination, senkron load-more kilidi, canonical satır merge'ü, veri koruma matrisi, responsive/touch-target kontrolleri ve sıfır cleanup DietBridge Staging'de geçti.
- **Deferred P2:** Silme öncesi üretilmiş avatar signed URL'si kalan 5 dakikalık TTL/CDN cache süresince okunabilir; anında revocation doğrulanmış değildir. Bu sınırlama Aşama 4 MVP blocker'ı değildir.
- **Bitiş tarihi:** 2026-07-18.
- **Durum:** Tamamlandı.

### Aşama 5 — Beslenme planı ve öğün yönetimi

- **Amaç:** Web ve mobilin ortak okuyabildiği kalıcı haftalık plan/öğün akışı sağlamak.
- **Kapsam:** Haftalık plan, öğün CRUD, saat, sıralama, not, fotoğraf, kaynak/recipe ilişkisi ve son seçilen danışan davranışı.
- **Kapsam dışı:** Kapsamlı tarif sistemi ve otomatik AI plan üretimi.
- **Bağımlılıklar:** Aşama 3–4.
- **Branch:** `codex/meal-plans`
- **Yapılacak işler:** Mevcut delete/reinsert davranışını ve transaction ihtiyacını incelemek; sort/time şemasını doğrulamak; servis katmanını tamamlamak; Storage validasyonu ve mobil uyumu test etmek.
- **Teknik riskler:** Kısmi yazma ile plan kaybı; fallback şemaların belirsizliği; public fotoğraf URL’leri; saat/sıra drift’i.
- **Kabul kriterleri:** Plan ve öğünler yenileme sonrası kalıcı; web/mobil aynı veriyi okur; silme onaylı; fotoğraf kontrollü; başarısız işlem başarı göstermez.
- **Manuel doğrulama:** Farklı hafta/danışan, öğün ekle-düzenle-sil, sıra/saat, görsel ve mobil okuma senaryoları.
- **Teslim çıktıları:** Güvenilir plan servisi, şema/mobil uyum notu ve doğrulama raporu.
- **İş Paketi 5.1 durumu:** Tamamlandı — haftalık plan tek `save_weekly_meal_plan` RPC çağrısıyla atomik kaydediliyor; plan/meal ID, `is_eaten`, ekleme-düzenleme-silme-sıralama, rollback, concurrent save, reload, active/pending/unverified/cross-tenant/client/anon sınırları ve geçersiz payload retleri DietBridge Staging'de doğrulandı. Final fixture cleanup sonucu Auth/public/meal plan/meal/Storage `0/0/0/0/0`, cleanup failure `0` oldu.
- **WP5.1 recipe persistence sınırı:** Canonical `recipes` tablosu ve `meals.recipe_id` foreign key'i bulunmadığı için MVP yazma sözleşmesi fail-closed olarak yalnız `source = 'manual'` ve `recipe_id IS NULL` kabul eder. Mock/AI önerileri manual öğün olarak kaydedilir; tarif persistence ancak ayrı, hedefli bir recipes/FK migration'ı ve web–mobil uyumluluk doğrulaması sonrasında yeniden açılacaktır.
- **İş Paketi 5.2B durumu:** Tamamlandı — `meal-photos` bucket private tutuluyor; canonical object path, en fazla 5 dakikalık signed read, JPEG/PNG/WebP ve 5 MiB sınırları, tenant/RLS izolasyonu, fotoğraf değiştirme ve meal silme cleanup queue üretimi, object mevcutken completion reddi ve orphan direct-delete başarılı akışı DietBridge Staging'de doğrulandı. Plan başarı durumu ile cleanup uyarısı UI'da ayrı gösteriliyor; final fixture Auth/public/relationship/plan/meal/queue/Storage değerleri `0`, cleanup failure `0` oldu.
- **WP5.2B deferred P2 limitation:** Queue-owner dietitian'ın browser Storage delete isteği staging'de kabul edilmesine rağmen object'i kaldırmıyor. Eski object referanssız, private ve pending cleanup queue ile takipli kalıyor; client, anon, pending, unverified ve cross-tenant erişimleri reddediliyor. Geçici operasyonel fallback yalnız service-role/admin fixture cleanup'tır. Bu non-blocking P2, WP5.3 veya Aşama 5 kapanışında yeniden ele alınacaktır.
- **WP5.3A durumu:** Tamamlandı (statik/yerel doğrulama) — MealPlans yalnız active ilişkiye sahip danışanları sorgular; son danışan seçimi dietitian ID ile namespace edilen localStorage anahtarında tutulur ve güncel active listeye karşı doğrulanır. Hafta başlangıcı yerel takvimde pazartesiye normalize edilir; plan/meal read-model'i `plan_date` ve `sort_order → time → id` ile deterministik eşlenir; duplicate response fail-closed reddedilir. Danışan ve plan okuma akışlarında loading/error/empty/retry ayrımı, stale request sequence koruması ve canonical save response'un doğrudan state'e uygulanması tamamlandı.
- **WP5.3B durumu:** Tamamlandı (DietBridge Staging servis/doğrulama) — MealPlans'tan hardcoded danışan ayrıntıları, mock recipe akışı ve AI önerisi kaldırıldı. Gerçek danışan ayrıntıları `fetchClientDetails()` read modelinden loading/error/empty durumlarıyla okunur. Geçen haftayı kopyalama yalnız editor state'ini hazırlar; gerçek plan notu, type/title/makro/saat/sıra korunurken plan/meal ID'leri, `is_eaten`, fotoğraf yolu ve recipe ID taşınmaz. Hedef hafta yalnız kullanıcı save akışında tek atomik RPC ile oluşur. Active client read, year-boundary tarih hesabı, copy no-mutation, target reload, prior-week koruması, manual-only sözleşmesi ve fixture cleanup Staging'de doğrulandı; Auth/public/relationship/plan/meal/Storage/queue `0`, cleanup failure `0`.
- **WP5.4B web checkpoint durumu:** Tamamlandı — PostgREST `HH:MM:SS` saatleri web editörü, copy akışı ve save payload'ında canonical `HH:MM` biçimine normalize edildi. Gerçek tarayıcıda danışan seçimi, pazartesi tabanlı hafta geçişi, read/add/edit/delete, tek atomik RPC save, reload persistence ve önceki haftayı yalnız editör state'ine kopyalayıp explicit save etme akışları geçti. Private `meal-photos` görseli kısa süreli signed URL ile HTTP `200` açıldı; `/object/public/` kullanılmadı. `1280×720` ve `1440×900` kontrollerinde yatay taşma veya erişilemeyen ana kontrol görülmedi; disposable fixture Auth/profil/ilişki/plan/meal/Storage/queue sayaçları `0` doğrulandı.
- **WP5.4B Aşama 5 kapanış browser kontrolleri:** Tamamlandı — ilk plan isteğinde loading görünürlüğü; kontrollü ağ hatasında editör verisinin korunması ve error/retry ayrımı; aynı danışan ve haftada başarılı retry; geciktirilmiş hafta ve danışan cevaplarının yeni state'i ezmemesi; hızlı çift tıklamada tek `save_weekly_meal_plan` POST, save kilidi ve başarısız save'de editör verisinin korunması gerçek tarayıcıda doğrulandı. Loading/error/retry katmanları `1280×720` ve `1440×900` viewport'larında yatay taşma üretmedi ve hafta/retry kontrollerini kapatmadı. Disposable fixture Auth/profil/ilişki/plan/meal/Storage/queue sayaçları `0` doğrulandı; WP5.4B web browser kabulü tamamlandı.
- **Aşama 5 kapanış kapsamı:** `save_weekly_meal_plan` ile atomik haftalık plan kaydı; plan/meal RLS; canonical meal macro sözleşmesi; web read/edit/save/copy akışı; mobil canonical read modeli; yalnız RPC üzerinden meal completion; private signed meal photos; `HH:MM` saat normalizasyonu; responsive web browser kabulü; auth session lifecycle yarış düzeltmesi; web `main` (`ad5ded8e8b141fb60914cb334037cd9e8a286aaa`) ve mobil `main` (`d5c869c183117c3b3bc6944a580f15daa0b26196`) merge'leri tamamlandı. Web ve mobil fixture cleanup sayaçları `0`; production ortamına dokunulmadı.
- **Açık release blocker / teknik borç:** Kimlik doğrulanmış gerçek Android cihazda 8+ dakikalık refresh/background/reload kabulü yapılmadı. `Invalid Refresh Token / Response status 0` düzeltmesinin gerçek runtime doğrulaması bekliyor. Browser Storage delete işlemi object'i doğrudan silemediğinde cleanup queue için service-role worker gerekiyor.
- **Durum:** Implementation complete, release verification pending — Aşama 5 uygulama ve entegrasyon açısından tamamlandı; yukarıdaki release verification blocker'ları kapatılmadan release tamamlanmış sayılmaz. Aşama 6 başlatılmadı ve içeriği değiştirilmedi.

### Aşama 6 — Mesajlaşma ve görsel gönderimi

- **Amaç:** İlişkili diyetisyen ve danışan arasında güvenli, kalıcı ve gerçek zamanlı iletişim kurmak.
- **Kapsam:** Conversation/message modeli, listeleme, gönderme, realtime, okunma, unread count, görsel upload/görüntüleme, sayfalama ve retry.
- **Kapsam dışı:** Sesli/görüntülü görüşme ve gelişmiş medya düzenleme.
- **Bağımlılıklar:** Aşama 3–4; mesaj şeması ve Storage modeli onaylanmış olmalı.
- **Branch:** `codex/chat`
- **Yapılacak işler:** Şema ve RLS tasarımı; servis/context akışı; MIME/boyut kontrolü; realtime aboneliği; mock `CONVERSATIONS` geçiş planı; hacim analizi.
- **Teknik riskler:** Yetkisiz konuşma erişimi, duplicate mesaj, realtime kaçakları, büyük medya maliyeti ve orphan dosyalar.
- **Kabul kriterleri:** Yalnızca ilişkili taraflar konuşur; mesaj/görsel kalıcıdır; iki taraf güncellemeyi görür; yetkisiz okuma reddedilir; başarısız gönderim başarı göstermez.
- **Manuel doğrulama:** İki taraflı mesaj, reconnect, duplicate gönderme, görsel limitleri, yetkisiz kullanıcı ve sayfalama.
- **Teslim çıktıları:** Mesaj şeması/migration’ı, servis ve UI entegrasyonu, güvenlik test raporu.
- **Kapanış notu — 2026-08-01:** Private görselli mesajlaşma tamamlandı. Web ve mobil gönderim akışları, Production validator/cleanup altyapısı ve beş dakikalık cleanup scheduler aktif durumda. Web → mobil ve mobil → web gerçek cihaz/tarayıcı E2E akışları; realtime, restart persistence, duplicate kontrolü ve Production canary doğrulaması geçti. Web image decode fallback ve mobil picker lifecycle hataları giderildi.
- **Durum:** `COMPLETED`.

### Aşama 7 — Randevu yönetimi

- **Amaç:** Randevuları gerçek, kalıcı ve sahiplik kontrollü hale getirmek.
- **Kapsam:** Liste, oluşturma, güncelleme, silme, durum, tarih/saat validasyonu, danışan ilişkisi ve RLS.
- **Kapsam dışı:** Takvim sağlayıcı entegrasyonu ve kapsam dışı bildirim otomasyonu.
- **Bağımlılıklar:** Aşama 3–4.
- **Branch:** `codex/appointments`
- **Yapılacak işler:** Liste/silme sahiplik filtresi; gerçek danışan seçimi; update akışı; local-only fallback’in kaldırılması; hata ve silme onayı.
- **Teknik riskler:** Başka diyetisyen randevusu, kaybolan local kayıt, saat dilimi ve çakışma davranışı.
- **Kabul kriterleri:** Randevu kalıcı; yenilemede kaybolmaz; başka diyetisyen verisi görünmez; başarısız kayıt UI’da başarılı olmaz; silme onaylıdır.
- **Manuel doğrulama:** Oluştur/güncelle/sil, geçmiş/gelecek tarih, timezone, ilişkisiz danışan ve DB hata senaryoları.
- **Teslim çıktıları:** Güvenli randevu CRUD ve doğrulama raporu.
- **Durum:** Bekliyor.

### Aşama 8 — Abonelik, paket ve danışan limitleri

- **Amaç:** Aylık/yıllık planları ve 10/30/50 danışan limitlerini backend doğrulamalı hale getirmek.
- **Kapsam:** Deneme, subscription durumu, ödeme sağlayıcı, webhook, iptal/yenileme, başarısız ödeme, limit ve işlem geçmişi modeli.
- **Kapsam dışı:** Kullanıcı onayı olmadan ödeme sağlayıcı hesabı veya production webhook’u oluşturmak.
- **Bağımlılıklar:** Aşama 1–4; kullanıcı/sahiplik modeli kararlı olmalı.
- **Branch:** `codex/subscriptions`
- **Yapılacak işler:** Sağlayıcı seçimi; server-side/Edge Function tasarımı; imzalı webhook; idempotency; limit enforcement; fiyat/plan config ayrımı.
- **Teknik riskler:** Frontend’e güvenme, webhook replay, double charge, gecikmiş ödeme olayı ve kişisel/finansal veri uyumu.
- **Kabul kriterleri:** Abonelik backend’den doğrulanır; aylık/yıllık ayrımı doğru; webhook imzası kontrol edilir; ödeme olmadan aktif gösterilmez; limit server tarafında uygulanır.
- **Manuel doğrulama:** Başarılı/başarısız ödeme, iptal, yenileme, webhook retry ve limit aşımı.
- **Teslim çıktıları:** Abonelik veri modeli, güvenli entegrasyon, operasyon ve test dokümanı.
- **Durum:** Bekliyor.

### Aşama 9 — Mock veri kaldırma veya özellik gizleme

- **Amaç:** Production’da yanıltıcı demo davranışı bırakmamak.
- **Kapsam:** Mesajlar, tarifler, analiz, notlar, görevler, ayarlar, sabit grafikler, local state ve appointment fallback.
- **Kapsam dışı:** Aynı görevde yeni büyük feature geliştirmek.
- **Bağımlılıklar:** Aşama 4–8 ve dondurulmuş MVP kararı.
- **Branch:** `codex/mock-cleanup`
- **Yapılacak işler:** Her modül için “gerçek veriye geçir / MVP dışında bırak / menüden gizle” kararı; sabit demo kullanıcılarını ayırmak; sahte success/loading’i kaldırmak.
- **Teknik riskler:** Menü/route kırılması, üretim kapsamının sessiz değişmesi, kullanıcının beklediği prototip ekranın kaybolması.
- **Kabul kriterleri:** Production’da sahte başarı yok; yenilemede kaybolan veri kalıcı görünmüyor; demo kullanıcılar gerçek listede değil; MVP dışı alanlar yanıltmıyor.
- **Manuel doğrulama:** Tüm route ve menüler; her butonun gerçek etkisi; yenileme sonrası durum.
- **Teslim çıktıları:** Modül karar matrisi ve hedefli mock temizliği.
- **Durum:** Bekliyor.

### Aşama 10 — Repository temizliği ve mimari sadeleştirme

- **Amaç:** Davranışı değiştirmeden tekrarları ve hassas/geçici artefact’ları kaldırmak.
- **Kapsam:** Import haritası; eski dizinler; tekrar eden constants/types; patch/check/test betikleri; prompt geçmişleri; `cookies.txt`; takip edilen `.env`; `openapi.json` ve repository boyutu.
- **Kapsam dışı:** Yeni özellik ve UI değişikliği.
- **Bağımlılıklar:** Aşama 9; aktif üretim kapsamı netleşmiş olmalı.
- **Branch:** `codex/repository-cleanup`
- **Yapılacak işler:** Her aday için kullanım ve Git geçmişi analizi; secret taraması; `.gitignore`; güvenli silme planı; küçük gruplar halinde doğrulama.
- **Teknik riskler:** Gizli aktif import, geçmiş araç bağımlılığı ve yanlış secret rotasyonu varsayımı.
- **Kabul kriterleri:** Her silme kanıtlı; build başarılı; davranış değişmiyor; gereksiz hassas/geçici dosya kalmıyor.
- **Manuel doğrulama:** Route smoke test, asset yükleme ve repo secret taraması.
- **Teslim çıktıları:** Temiz repository, import envanteri ve silinen dosya gerekçeleri.
- **Durum:** Bekliyor.

### Aşama 11 — Test, CI ve kalite güvence

- **Amaç:** Kritik davranışları otomatik kalite kapılarıyla korumak.
- **Kapsam:** Typecheck, lint, unit/service/auth testleri, temel E2E, CI ve PR kapıları.
- **Kapsam dışı:** Production verisiyle test ve feature geliştirme.
- **Bağımlılıklar:** Aşama 1–10’daki MVP özellikleri.
- **Branch:** `codex/quality-baseline`
- **Yapılacak işler:** Test runner ve browser E2E seçimi; Supabase test ortamı/mocking stratejisi; CI workflow; kritik senaryolar.
- **Teknik riskler:** Flaky E2E, production’a yanlış bağlantı, test verisi izolasyonu ve uzun CI süresi.
- **Kabul kriterleri:** `npm ci`, typecheck, lint, test ve build başarılı; CI başarısızsa merge engellenir; production secret/veri kullanılmaz.
- **Manuel doğrulama:** CI logları ve kritik E2E tekrarları.
- **Teslim çıktıları:** Test paketleri, CI pipeline ve kalite raporu.
- **Durum:** Tamamlandı — 2026-08-23. Web/Mobile required checks, disposable backend/browser matrisi ve merge-blocking branch protection gerçek GitHub PR'larında PASS.

Kritik browser E2E senaryoları: unauthenticated redirect; client rol reddi; pending/rejected diyetisyen; approved login/session restore; persisted danışan/profil okuma; logout. Plan/öğün, mesaj/görsel, randevu, abonelik/paket limiti, reminder ve Push davranışları disposable backend/service matrisindedir.

### Aşama 12 — Production yayın hazırlığı

- **Amaç:** Kontrollü, gözlemlenebilir ve geri alınabilir production yayını hazırlamak.
- **Kapsam:** Production env, Supabase ayar/migration sırası, Storage/RLS, domain/redirect/callback, webhook, hata izleme, log, yedek, hukuki doküman, checklist ve rollback.
- **Kapsam dışı:** Bu aşamada kullanıcı onayı olmadan deployment veya migration çalıştırmak.
- **Bağımlılıklar:** Aşama 11 kalite kapıları.
- **Branch:** `codex/release-preparation`
- **Yapılacak işler:** Env matrisi; release/migration runbook; backup/restore; auth redirect ve webhook URL doğrulaması; release adayı build’i.
- **Teknik riskler:** Yanlış env/proje, callback uyuşmazlığı, geri döndürülemez migration ve gözlemlenmeyen hata.
- **Kabul kriterleri:** Build başarılı; env ve migration planı onaylı; RLS test edilmiş; backup/rollback mevcut; kritik güvenlik açığı yok.
- **Manuel doğrulama:** Staging smoke, redirect, webhook sandbox, restore provası ve release checklist.
- **Teslim çıktıları:** Release runbook, checklist, rollback ve onay kaydı.
- **Durum:** Bekliyor.

### Aşama 13 — Deployment ve yayın sonrası doğrulama

- **Amaç:** Onaylı release’i yayınlamak ve canlı davranışı kanıtlamak.
- **Kapsam:** Deployment, smoke test, kritik akışlar, log/performance, web–mobil veri uyumu, ilk geri bildirim ve acil düzeltme süreci.
- **Kapsam dışı:** Onaysız hotfix veya kapsam genişletme.
- **Bağımlılıklar:** Aşama 12 ve açık yayın onayı.
- **Branch:** `codex/post-release-validation`
- **Yapılacak işler:** Runbook’u uygulamak; sentetik/test hesaplarıyla smoke; log/metric izleme; mobil veri uyumu; incident eşiği.
- **Teknik riskler:** Production veri etkisi, cache/env farkı, mobil şema kırılması ve geç fark edilen yetki hatası.
- **Kabul kriterleri:** Site erişilebilir; auth, danışan, plan, mesaj/görsel, randevu ve abonelik çalışır; kritik log hatası yok; mobil uyumu ve smoke raporu tamamdır.
- **Manuel doğrulama:** Desteklenen browser/viewport’lar, gerçek redirect/webhook, log dashboard ve rollback hazır oluşu.
- **Teslim çıktıları:** Deployment kaydı, smoke raporu, izleme özeti ve kalan riskler.
- **Durum:** Bekliyor.

## 6. Aşamalar arası bağımlılıklar

| Aşama | Ön koşul | Sonraki aşamaya geçiş koşulu |
|---|---|---|
| 0 | Repository incelemesi | Kurallar, MVP ve yol haritası tamam |
| 1 | Aşama 0 | Tekrarlanabilir kurulum, typecheck, lint ve build temeli çalışıyor |
| 2 | Aşama 1 | Auth fail-closed ve rol/onay durumları doğrulandı |
| 3 | Aşama 1–2 | Şema, RLS ve veri izolasyonu doğrulandı; uygulama planı onaylı |
| 4 | Aşama 2–3 | Danışan erişimi güvenli ve kalıcı |
| 5 | Aşama 3–4 | Plan/öğün modeli ve mobil uyumu doğrulandı |
| 6 | Aşama 3–4 | Mesaj şeması ve Storage güvenliği hazır |
| 7 | Aşama 3–4 | Appointment sahipliği ve servis modeli hazır |
| 8 | Aşama 1–4 | Kullanıcı, sahiplik ve paket modeli hazır |
| 9 | Aşama 4–8 | MVP gerçek modülleri ve kapsam kararları tamam |
| 10 | Aşama 9 | Aktif import ve üretim route haritası doğrulandı |
| 11 | Aşama 1–10 | Kritik özellikler ve mock kararları tamam |
| 12 | Aşama 11 | Tüm kalite kapıları başarılı |
| 13 | Aşama 12 | Release checklist tamam ve yayın onayı verilmiş |

## 7. Önerilen branch yapısı

```text
codex/project-governance
codex/project-foundation
codex/auth-hardening
codex/supabase-security
codex/client-management
codex/meal-plans
codex/chat
codex/appointments
codex/subscriptions
codex/mock-cleanup
codex/repository-cleanup
codex/quality-baseline
codex/release-preparation
codex/post-release-validation
```

Her branch yalnızca ilgili aşamaya ait değişiklikleri içerir. Bir aşamanın kalan işi sonraki branch’e sessizce aktarılmaz; durum tablosu ve riskler güncellenir.

## 8. Genel kalite kapısı

Hedef komutlar:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

- Henüz bulunmayan scriptler Aşama 1 ve Aşama 11’de eklenir.
- Olmayan veya çalıştırılmayan kontrol başarılı kabul edilmez.
- Her aşamada kapsamla ilgili testler ve en az production build çalıştırılır.
- Build başarısızsa aşama tamamlanmaz ve `main`e alınmaz.
- Git diff ve status kontrolü zorunludur.
- Production verisi yazma ve migration oluşturma/çalıştırma durumu raporlanır.
- DB’ye yazabilen ad-hoc betikler otomatik test olarak kullanılmaz.

## 9. Genel Definition of Done

Proje aşağıdaki koşullar birlikte sağlandığında production açısından tamamlanmış sayılır:

- Mevcut yapı üzerinden, toplu yeniden yazım yapılmadan tamamlanmıştır.
- Yalnızca yetkili ve onaylı diyetisyenler web paneline erişebilir; client rolü erişemez.
- Auth fail-closed çalışır; rol/profil hatası erişim sağlamaz.
- RLS/Storage policy’leri diyetisyenler arasında veri izolasyonu sağlar.
- Bir diyetisyen başka diyetisyenin danışanını veya ilişkili verisini okuyamaz/değiştiremez.
- Danışan profil, ilişki, ölçüm ve yaşam tarzı verileri gerçek ve kalıcıdır.
- Beslenme planı ve öğün CRUD çalışır; web ve mobil aynı veri modelini kullanır.
- Diyetisyen ve danışan kalıcı mesaj ve güvenli görsel gönderebilir.
- Randevu CRUD kalıcı ve yetki kontrollüdür.
- Aylık/yıllık abonelik ve backend doğrulamalı paket limitleri çalışır.
- Başarısız işlem başarı gibi gösterilmez; production’da yanıltıcı mock işlem yoktur.
- `npm ci`, typecheck, lint, test ve production build başarılıdır.
- Kritik E2E senaryoları geçer ve CI kalite kapısı uygular.
- Migration, backup ve rollback planları mevcuttur.
- Deployment ve yayın sonrası smoke test başarılıdır.
- Kritik production güvenlik veya çalışma hatası bulunmaz.

## 10. Aşama durum tablosu

| No | Aşama | Durum | Branch | Başlangıç tarihi | Bitiş tarihi | Not |
|---:|---|---|---|---|---|---|
| 0 | Proje yönetimi ve kurallar | Tamamlandı | `codex/project-governance` | 2026-07-12 | 2026-07-12 | `AGENTS.md` ve `docs/ROADMAP.md` oluşturuldu ve doğrulandı |
| 1 | Teknik temel | Tamamlandı | `codex/project-foundation` | 2026-07-12 | 2026-07-12 | Teknik temel ve Node.js 24 LTS kalite kapıları doğrulandı |
| 2 | Authentication güvenliği | Tamamlandı | `codex/auth-hardening` | 2026-07-12 | 2026-07-13 | Fail-closed auth ve kritik gerçek hesap erişim senaryoları doğrulandı; Pending, rejected veya recovery özel durumları test ortamında ayrıca doğrulanacak |
| 3 | Supabase ve RLS | Tamamlandı | `codex/supabase-security` | 2026-07-13 | 2026-07-16 | Production history `9/9` eşleşti; kontrollü adoption ve gerçek policy-removal migration’ı tamamlandı; RPC/RLS/mobil/cleanup/plan senkronizasyon kapıları geçti; PR #1 `main`e merge edildi |
| 4 | Danışan yönetimi | Tamamlandı | `codex/client-management` | 2026-07-16 | 2026-07-18 | Measurement patch/pagination runtime, responsive/touch-target ve sıfır cleanup kapıları geçti; avatar signed URL cache/TTL davranışı P2 deferred kaldı |
| 5 | Beslenme planı | Bekliyor | `codex/meal-plans` |  |  |  |
| 6 | Mesajlaşma | `COMPLETED` | `codex/phase6-closeout` | 2026-07-26 | 2026-08-01 | Private görsel mesajlaşma, validator/cleanup/scheduler, iki yönlü gerçek E2E ve Production canary tamamlandı; kapanış raporu eklendi |
| 7 | Randevular | Bekliyor | `codex/appointments` |  |  |  |
| 8 | Abonelik | Bekliyor | `codex/subscriptions` |  |  |  |
| 9 | Mock temizliği | Bekliyor | `codex/mock-cleanup` |  |  |  |
| 10 | Repository temizliği | Bekliyor | `codex/repository-cleanup` |  |  |  |
| 11 | Test ve kalite | Tamamlandı | `codex/quality-baseline` | 2026-08-23 | 2026-08-23 | Web/Mobile Actions, disposable backend/browser kapıları ve protected required checks PASS |
| 12 | Yayın hazırlığı | `CLOSED` | `codex/mvp12-release-candidate` | 2026-08-25 | 2026-08-25 | Production read-only audit, dependency hardening, protected Web PR #18 / Mobile PR #10, final main CI ve RC lock PASS |
| 13 | Yayın sonrası doğrulama | `NOT STARTED` | `codex/post-release-validation` |  |  | Kontrollü launch checklist'i hazır; deployment/public launch ve Push 6C.2+ PAUSED |

## 11. Değişiklik günlüğü

| Tarih | Aşama | Değişiklik | Durum | İlgili branch/PR |
|---|---|---|---|---|
| 2026-08-25 | Aşama 12 | Production read-only RC audit, blocker closure, dependency hardening, protected merges/final CI ve exact RC locking tamamlandı; MVP-13/Push 6C.2+ başlatılmadı | `CLOSED` | `codex/mvp12-release-candidate`, Web PR #18, Mobile PR #10 |
| 2026-08-23 | Aşama 11 | Web/Mobile automated quality gates, disposable backend/browser coverage ve protected required checks kapatıldı | Tamamlandı | `codex/quality-baseline`, Web PR #17, Mobile PR #8/#9 |
| 2026-07-12 | Aşama 0 | `AGENTS.md` ve `docs/ROADMAP.md` oluşturuldu | Tamamlandı | `codex/project-governance` |
| 2026-07-12 | Aşama 1 | Teknik temel, lockfile, lint, typecheck ve environment standardizasyonu hazırlandı | İncelemeye hazır | codex/project-foundation |
| 2026-07-12 | Aşama 1 | Node.js 24 LTS altında npm ci, typecheck, lint ve production build doğrulandı | Tamamlandı | `codex/project-foundation` |
| 2026-07-12 | Aşama 2 | Merkezi auth access resolver, fail-closed route koruması ve güvenli recovery/kayıt akışları hazırlandı | İncelemeye hazır | `codex/auth-hardening` |
| 2026-07-13 | Aşama 2 | Kritik gerçek hesap auth ve rol senaryoları doğrulandı | Tamamlandı | `codex/auth-hardening` |
| 2026-07-13 | Aşama 3A | Supabase şema, RLS, Storage, function ve migration drift denetimi tamamlandı | Denetim tamamlandı | `codex/supabase-security` |
| 2026-07-13 | Aşama 3B | Supabase güvenlik migration taslakları, rollback yaklaşımı ve negatif RLS test planı hazırlandı | Taslaklar tamamlandı | `codex/supabase-security` |
| 2026-07-13 | Aşama 3C | Verification, güvenli onboarding ve meal completion RPC mimari kararları ile staging runbook’u hazırlandı | Hazırlık tamamlandı | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-1 | Ayrı staging Supabase projesi doğrulandı ve schema-only baseline planı hazırlandı | Plan tamamlandı | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-2 | Production public şema baseline’ı oluşturuldu, veri/secret taraması ve function envanteri uzlaştırması tamamlandı | Baseline hazır | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-3 | Production public şema baseline’ı staging’e uygulandı ve metadata eşitliği doğrulandı | Staging baseline hazır | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-4A-0 | Baseline öncesi eski migration geçmişi uzlaştırıldı ve temel migration zinciri yerel ortamda doğrulandı | Güvenlik migration hazırlığı yeniden başlayabilir | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-4A | Güvenlik migration zinciri hazırlandı ve disposable yerel Supabase ortamında doğrulandı | Staging uygulaması bekliyor | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-4B-0 | Auth onboarding trigger migration’ı hazırlandı ve disposable yerel ortamda doğrulandı | Staging uygulaması bekliyor | `codex/supabase-security` |
| 2026-07-13 | Aşama 3D-4B | Güvenlik ve onboarding migration zinciri yalnız staging’e uygulandı; migration history ve metadata doğrulandı | Negatif RLS testleri bekliyor | `codex/supabase-security` |
| 2026-07-14 | Aşama 3D-4C | Sentetik staging onboarding ve negatif RLS testleri tamamlandı; gerçek P0/P1 ihlal bulunmadı, legacy meals UPDATE için P1 deferred blocker doğrulandı | Mobil RPC cutover ve legacy policy kaldırma bekliyor | `codex/supabase-security` |
| 2026-07-14 | Aşama 3E-0 | Mobil ve web meal completion yazma yolları denetlendi; RPC cutover readiness ve legacy UPDATE policy kaldırma koşulları belirlendi | Denetim sonucundaki cutover işlemleri bekliyor | `codex/supabase-security` |
| 2026-07-14 | Aşama 3E-1C | Fiziksel cihazda network rollback, own-meal RPC, persistence, foreign-meal reddi ve final cleanup doğrulandı | Tamamlandı; legacy policy ve eski mobil build blocker olarak açık | codex/supabase-security |
| 2026-07-14 | Aşama 3E-1C-3 | Staging fixture cleanup, daily_logs bağı ve idempotent Auth cleanup için kalıcı olarak düzeltildi | Aşama 3E-2 eski build/policy kaldırma planı bekliyor | codex/supabase-security |
| 2026-07-14 | Aşama 3E-2A | Legacy client meals UPDATE policy kaldırma migration’ı, verification SQL’i ve staging runbook’u hazırlandı | 3E-2B staging uygulama/regresyon; 3E-2C production kararı bloklu | codex/supabase-security |
| 2026-07-14 | Aşama 3E-2B-1 | Legacy meals policy staging preflight tamamlandı; dietitian UPDATE ve client meals SELECT regresyon araçları eksik bulundu | Tamamlandı / NOT READY | `codex/supabase-security` |
| 2026-07-14 | Aşama 3E-2B-2 | Eksik client own/foreign meals SELECT ve dietitian meal UPDATE regresyon harness’i ile saf değerlendirme testleri hazırlandı | Hazır; staging integration testi bekliyor | `codex/supabase-security` |
| 2026-07-14 | Aşama 3E-2B-3 | Legacy client meals UPDATE policy yalnız staging’e uygulandı; remote history 9/9 eşleşti, security harness 17/17 ve fiziksel Android regresyonu geçti | Tamamlandı; production rollout bekliyor | `codex/supabase-security` |
| 2026-07-14 | Aşama 3E-2B-4 | Staging policy rollout sonucu, runtime/CLI migration history ayrımı ve mobil regresyon kanıtları kaydedildi | Tamamlandı; 3E-2C production karar kapısı bekliyor | `codex/supabase-security` |
| 2026-07-14 | Aşama 3E-2C-1 | Production rollout için disposable workdir, kimlik guard’ları, history/dry-run karar kapısı, rollback ve mutasyonsuz smoke test runbook’u hazırlandı | Hazır; 3E-2C-2 salt-okunur production preflight bekliyor | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2 | Production identity ve staging ayrımı doğrulandı; remote history EMPTY, `supabase_migrations` MISSING ve meal completion RPC MISSING bulundu | Tamamlandı / NOT READY | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2A | İlk sekiz migration için salt-okunur contract audit SQL'i, history uzlaştırma karar ağacı ve schema drift raporu hazırlandı | PREPARED; 3E-2C-2B production read-only audit bekliyor | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2B | İlk production read-only contract audit 42P01 `relation "own" does not exist` ile sonuçsuz durdu; production değişmedi; verification SQL ham policy kataloğuyla düzeltildi | BLOCKED BY VERIFICATION SQL ERROR; read-only retry PENDING | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2B | Ayrıştırılmış ham katalog kontrolleriyle production read-only contract audit tamamlandı; history/constraint/RLS/function/policy/RPC drift'i sayısal olarak kaydedildi | COMPLETED / NOT READY | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2C | Production pre-policy reconciliation, salt-okunur preflight/postflight ve history adoption güncellemesi hazırlandı; production'a uygulanmadı | PREPARED; 3E-2C-2D preflight PENDING | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2D | Production preflight verification consistency için bir `true + pending` satırı buldu; sync function, trigger ve constraint eksikliği doğrulandı | COMPLETED / BLOCKED_1_ROWS | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2D-1 | Fail-fast verification data remediation, aggregate postflight ve güncellenmiş reconciliation kapıları hazırlandı; production değiştirilmedi | PREPARED; 3E-2C-2D-2 approval/application PENDING; 3E-2C-2E BLOCKED | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2D-2 | Verification data remediation production'da başarıyla uygulandı; sonraki preflight veri tutarlılığını MATCH ve reconciliation kapısını YES doğruladı | COMPLETED | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2E | Production reconciliation denemesi `handle_new_user()` generic function postcondition validator'ında fail-closed durdu; transaction tamamen rollback oldu, legacy policy korunuyor | BLOCKED BY POSTCONDITION VALIDATOR | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2E-1 | Function body validator'ları semantic invariant, `proconfig` array ve ayrıntılı güvenli diagnostics ile düzeltildi; retry 2 function postcondition'ı geçti | COMPLETED | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2E-2 | Retry 2 constraint postcondition'da fail-closed rollback oldu; dual-source normalize semantic constraint validator hazırlandı, canonical DDL ve legacy policy korunuyor | PREPARED; production reconciliation retry 3 PENDING | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2E | Production reconciliation retry 3 ve salt-okunur postflight tamamlandı; function/verification/reconciliation/RPC readiness kapıları geçti, legacy policy korundu | COMPLETED; 3E-2C-2F RPC smoke test bekliyor | `codex/supabase-security` |
| 2026-07-15 | Aşama 3E-2C-2F | Production’a özel iki-client meal RPC smoke fixture, fail-closed mod sırası, explicit-ID cleanup ve mobil/policy kapıları hazırlandı; network testi çalıştırılmadı | PREPARED / NOT RUN; mobile production test PENDING | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-2F | Production CLI RPC smoke testleri geçti; ilk fiziksel mobil denemenin eksik aktif diyetisyen ilişkisi nedeniyle durduğu kaydedildi ve fixture mobil uyumlu modelle genişletildi | MOBILE-READY FIXTURE PREPARED; physical mobile retry PENDING; policy removal BLOCKED | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-2F | Fiziksel Android production own toggle, persistence ve foreign-not-exposed testleri geçti; fixture cleanup `PASS`, remaining `0` doğrulandı | Functional gate PASSED; legacy policy PRESENT; history adoption BLOCKER | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-2G | Dokuz local migration hash’i, version bazlı contract/adoption matrisi, ağsız validator ve kontrollü history adoption runbook’u hazırlandı | PREPARED; no history mutation; automatic bulk repair forbidden | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-3 | İlk sekiz migration için kontrollü production history adoption tamamlandı; Local–Remote migration history `9/9` eşleşti | Tamamlandı; history adoption blocker kapandı | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-3 | `20260714010000_remove_legacy_client_meals_update_policy.sql` production’a gerçek migration olarak uygulandı; eski client meals UPDATE policy’si kaldırıldı | Policy removal `PASS` | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-3 | Meal completion RPC güvenlik sözleşmesi, kritik RLS sözleşmesi ve fiziksel Android production doğrulamaları tamamlandı; fixture cleanup `PASS`, kalan `0` | Tamamlandı | `codex/supabase-security` |
| 2026-07-16 | Aşama 3E-2C-3 | Gerçek production danışanına plan kaydı, mobil görünürlük ve iki yönlü kalıcı meal completion senkronizasyonu doğrulandı | Tamamlandı | `codex/supabase-security` |
| 2026-07-16 | Aşama 3 | PR #1 `main` branch’ine `a9f0a5874b7b367656a09736de682403aeabb149` merge commit’iyle alındı | Merge tamamlandı | PR #1 / `main` |
| 2026-07-16 | Aşama 3 | Supabase şema, migration, RLS, RPC ve production mobil uyumluluk kapıları tamamlandı | Tamamlandı | `codex/supabase-security` |
| 2026-07-16 | Aşama 4 | Danışan yönetimi kickoff denetimi başlatıldı | Devam ediyor | `codex/client-management` |
| 2026-07-16 | Aşama 4.1 | UUID fail-fast, active relation gate, pending minimum görünüm ve active-only Realtime doğrulandı; sahte su tüketimi fallback’i kaldırıldı; active dietitian daily log SELECT migration’ı hazırlandı ancak uygulanmadı | BLOCKED — daily_logs visibility and focus verification; Daily logs RLS remediation prepared / not applied | `codex/client-management` |
| 2026-07-16 | Aşama 4.1 | Daily logs active-dietitian SELECT migration’ı yalnız staging’e uygulandı; RLS/UI/null-zero-empty-positive/error/cross-tenant/route/focus regresyonu ve sıfır cleanup tamamlandı | Tamamlandı — staging doğrulaması geçti | `codex/client-management` |
| 2026-07-16 | Aşama 4.2 | Danışan listesinde loading, başarılı veri, gerçek empty, arama/filtre empty ve error ayrımı; güvenli retry ile stale-state koruması uygulandı | Uygulandı / kod incelemesi ve manuel doğrulama bekliyor | `codex/client-management` |
| 2026-07-16 | Aşama 4.2 | Bağımsız kod incelemesinde Strict Mode in-flight kilidi ve arama metni/normalizasyonu düzeltildi; statik kabul matrisi geçti | Kod incelemesi geçti / canlı error-retry doğrulaması bekliyor | `codex/client-management` |
| 2026-07-16 | Aşama 4.2 | Chrome ve Codex tarayıcısı staging auth incelemesinde login isteği invalid credentials sınıfıyla reddedildi; DietBridge Staging projesinde kayıtlı test diyetisyeni bulunmadığı doğrulandı | Kod incelemesi geçti / staging test hesabı eksik olduğu için canlı doğrulama bekliyor | `codex/client-management` |
| 2026-07-16 | Aşama 4.2 | Kullanıcı staging diyetisyen hesabını hazırladı; auth, reload/yeni sekme session restore, loading, general-empty ve route dönüşü Codex tarayıcısında geçti | Query-error ve retry canlı doğrulaması bekliyor | `codex/client-management` |
| 2026-07-16 | Aşama 4.2 | Yalnız `dietitian_clients` isteği engellenerek query-error, retry-failure, rapid-retry ve blocking kaldırıldıktan sonra reload olmadan retry-success doğrulandı; loading sırasında route unmount/return testi geçti | Tamamlandı — kod incelemesi ve staging canlı error-retry doğrulaması geçti / commit incelemesine hazır | `codex/client-management` |
| 2026-07-17 | Aşama 4.3 | Danışan listesine ad/e-posta araması, tipli durum filtresi, Türkçe normalizasyon, deterministik sıralama ve ayrıştırılmış boş durumlar eklendi; staging fixture, canlı tarayıcı doğrulaması ve manifest tabanlı cleanup tamamlandı | Tamamlandı — kod incelemesi ve staging canlı doğrulaması geçti | `codex/client-management` |
| 2026-07-17 | Aşama 4.4A | Danışan ilişkilendirme güvenlik sözleşmesi migration'ı hazırlandı; relationship-scoped profil erişimi, güvenli davet RPC'si ve server-side status/timestamp doğrulaması staging testi bekliyor | Hazırlandı / staging doğrulaması bekliyor | `codex/client-management` |
| 2026-07-17 | Aşama 4.4A | Resmî `supabase init` çıktısı kabul edildi; yerel migration replay, DB lint, RLS/RPC güvenlik matrisi, gerçek eşzamanlı davet testi ve sıfır fixture cleanup doğrulaması geçti | Yerel doğrulama geçti / staging onayı bekliyor | `codex/client-management` |
| 2026-07-17 | Aşama 4.4B | Web davet akışı güvenli RPC'ye geçirildi; enumeration-safe sonuçlar, relation-ID tabanlı sıfır-satır güvenli kaldırma ve kontrollü liste yenileme uygulandı | Uygulandı / kod incelemesi ve staging canlı doğrulaması bekliyor | `codex/client-management` |
| 2026-07-17 | Aşama 4.4B | Davet modalına Escape, dinamik Tab/Shift+Tab focus trap, dialog fallback ve opener focus-return eklendi; statik erişilebilirlik ve kalite kapıları geçti | Erişilebilirlik düzeltmesi geçti / staging canlı doğrulaması bekliyor | `codex/client-management` |
| 2026-07-17 | Aşama 4.4B | DietBridge Staging üzerinde sentetik davet, enumeration, state koruması, erişilebilirlik, responsive görünüm, veri sınırı ve relation removal regresyonları doğrulandı; manifest tabanlı cleanup tüm aggregate değerlerini sıfırladı | Tamamlandı — kod incelemesi ve staging canlı regresyonu geçti | `codex/client-management` |
| 2026-07-17 | Aşama 4.4C | Danışan profil, sağlık ve yaşam tarzı read-model'i canonical kataloglar, junction tabloları, typed booleanlar ve uyku aralığıyla normalize edildi | Tamamlandı / staging doğrulaması geçti | `codex/client-management` |
| 2026-07-17 | Aşama 4.4C | Canonical read-model staging matrisi geçti; active ve pending detay görünümlerindeki mobil yatay taşma kaynakları hedefli responsive container, wrap ve min-width sözleşmesiyle giderildi | Responsive kontrol tamamlandı | `codex/client-management` |
| 2026-07-17 | Aşama 4.4C | Active/pending `Listeye Dön` ve pending `İsteği İptal Et` kontrolleri için açık 44×44 px minimum touch target sözleşmesi eklendi | Touch target ve klavye kontrolü tamamlandı | `codex/client-management` |
| 2026-07-17 | Aşama 4.4C | Staging security harness Preflight/Onboarding/RLS/RPC/functional ve cleanup kapılarını geçti; Auth/public/Storage aggregate sonucu `0/0/0` oldu. Runtime harness migration history sorgulayamadı | WP4.4C tamamlandı; Aşama 4 ölçüm mutation, avatar güvenliği ve bölüm bazlı error/empty/retry işleriyle devam ediyor | `codex/client-management` |
| 2026-07-18 | Aşama 4.6 | Private avatars bucket, 5 dakikalık signed URL, owner/active erişimi, pending/cross-tenant/anon retleri, canonical path, MIME/5 MiB sınırları, initials fallback ve sıfır cleanup doğrulandı | Tamamlandı; silme öncesi signed URL TTL/CDN cache davranışı P2 deferred, measurement history limit/pagination açık | `codex/client-management` |
| 2026-07-18 | Aşama 4.8 | Ayrık measurement patch RPC'leri, 4→12→13 cursor pagination, tek gerçek load-more GET, canonical save merge'ü, veri koruma matrisi, üç viewport ve 44 px kontrolleri disposable staging fixture ile geçti; cleanup Auth/public/Storage/measurement/failure `0/0/0/0/0` oldu | Aşama 4 tamamlandı; avatar signed URL cache/TTL davranışı P2 deferred, Aşama 5 başlatılmadı | `codex/client-management` |
| 2026-07-21 | WP5.4B | Web editöründe `HH:MM:SS → HH:MM` normalizasyonu tamamlandı; save/reload/previous-week copy, private signed-photo HTTP `200` ve `1280×720`/`1440×900` browser kabulü geçti; fixture sayaçları sıfırlandı | Web checkpoint tamamlandı; loading/error/retry, stale/double-submit kapanış kontrolü ve WP5.4A mobil blocker'ı açık, Aşama 6 başlatılmadı | `codex/meal-plans` |
| 2026-07-21 | WP5.4B | Loading/error/retry, aynı hafta retry, hafta ve danışan stale-response yarışları, hızlı çift tıklamada tek RPC, save kilidi, başarısız save'de editör koruması ve iki viewport'ta katman erişilebilirliği gerçek tarayıcıda geçti; disposable fixture ve geçici runner dosyaları temizlendi | WP5.4B web browser kabulü tamamlandı; WP5.4A mobil blocker'ı açık, Aşama 5 kapanmadı ve Aşama 6 başlatılmadı | `codex/meal-plans` |
| 2026-07-21 | Aşama 5 | Web ve mobil `main` merge'leri doğrulandı; atomik meal-plan RPC, plan/meal RLS, canonical macro/read sözleşmeleri, RPC-only completion, private signed photos, `HH:MM` normalizasyonu, responsive browser kabulü ve auth session lifecycle yarış düzeltmesi uygulama/entegrasyon kapsamını tamamladı | Implementation complete, release verification pending — gerçek Android 8+ dakika session lifecycle kabulü, refresh-token runtime doğrulaması ve browser Storage cleanup için service-role worker açık release blocker/teknik borç olarak korundu; Aşama 6 başlatılmadı | `main` |
