# DietBridge Web — Production Geliştirme Yol Haritası

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
- **Durum:** Bekliyor.

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
- **Durum:** Bekliyor.

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
- **Durum:** Bekliyor.

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
- **Durum:** Bekliyor.

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
- **Durum:** Bekliyor.

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
- **Durum:** Bekliyor.

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
- **Durum:** Bekliyor.

Kritik E2E senaryoları: diyetisyen kayıt/giriş; client rol reddi; onaysız diyetisyen; danışan ekleme/profil; plan ve öğün CRUD; mesaj/görsel; randevu CRUD; abonelik; paket limiti; logout/session restore.

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
| 1 | Teknik temel | Bekliyor | `codex/project-foundation` |  |  |  |
| 2 | Authentication güvenliği | Bekliyor | `codex/auth-hardening` |  |  |  |
| 3 | Supabase ve RLS | Bekliyor | `codex/supabase-security` |  |  |  |
| 4 | Danışan yönetimi | Bekliyor | `codex/client-management` |  |  |  |
| 5 | Beslenme planı | Bekliyor | `codex/meal-plans` |  |  |  |
| 6 | Mesajlaşma | Bekliyor | `codex/chat` |  |  |  |
| 7 | Randevular | Bekliyor | `codex/appointments` |  |  |  |
| 8 | Abonelik | Bekliyor | `codex/subscriptions` |  |  |  |
| 9 | Mock temizliği | Bekliyor | `codex/mock-cleanup` |  |  |  |
| 10 | Repository temizliği | Bekliyor | `codex/repository-cleanup` |  |  |  |
| 11 | Test ve kalite | Bekliyor | `codex/quality-baseline` |  |  |  |
| 12 | Yayın hazırlığı | Bekliyor | `codex/release-preparation` |  |  |  |
| 13 | Yayın sonrası doğrulama | Bekliyor | `codex/post-release-validation` |  |  |  |

## 11. Değişiklik günlüğü

| Tarih | Aşama | Değişiklik | Durum | İlgili branch/PR |
|---|---|---|---|---|
| 2026-07-12 | Aşama 0 | `AGENTS.md` ve `docs/ROADMAP.md` oluşturuldu | Tamamlandı | `codex/project-governance` |
