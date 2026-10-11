# Yayın öncesi düzeltme raporu — 11 Ekim 2026

Önceki beş bulgu için dar kapsamlı düzeltmeler hazırlandı. Production kilo-tarihi migration'ı kullanıcının ayrı açık onayıyla uygulandı; postflight başarılı. Native Android paketinin Linux lockfile uyumsuzluğu giderildi; yeni gerçek preview APK EAS'ta başarıyla oluşturuldu. Yeni paket fiziksel telefonda henüz denenmedi. Tüm risklerin kapanmış veya uygulamanın mağaza yayınına tam hazır olduğu değerlendirilmemelidir.

## 1. Amaç

Mobil/web ortak kilo tarihi, mobil kabul kayıtları, kontrollü bağımlılık yamaları, mağaza öncesi cihaz testi ve güncel kurtarma kanıtı.

## 2. Dallar ve çalışma dizinleri

| Aşama | Dal | Dizin |
|---|---|---|
| Kilo tarihi | codex/release-weight-date | C:\dev\DietBridge-Release-Audit\2026-10-11\web-current |
| Mobil kabul | codex/release-mobile-legal | C:\dev\DietBridge-Release-Audit\2026-10-11\mobile-current |
| Mobil bağımlılıklar | codex/release-dependency-patches | C:\dev\DietBridge-Release-Fixes\2026-10-11\mobile-dependencies |
| Web bağımlılıklar | codex/release-dependency-patches | C:\dev\DietBridge-Release-Fixes\2026-10-11\web-dependencies |
| Birleşik web kaynak | codex/release-preparation | C:\dev\DietBridge-Release-Fixes\2026-10-11\web-ready |
| Birleşik mobil kaynak | codex/release-preparation | C:\dev\DietBridge-Release-Fixes\2026-10-11\mobile-ready |

Web tabanı ea213dec5a3b97ec2c49dfe7f2ae700325cf3740; mobil tabanı a29deda4417cc8742c8e769c35c6860b5ea0b50f. Kullanıcının ilk web/mobil çalışma dizinlerindeki mevcut değişikliklere dokunulmadı. Bu görev kaynakları ayrı çalışma dizinlerindedir. Birleşik kaynak yalnız bu oturumun dosya değişikliklerini içerir; başka kullanıcı dalları merge edilmedi.

## 3. Değişen dosyalar

Web: package-lock.json; scripts/runBackendQualityGate.mjs; scripts/runDisposableSupabaseLocalReplay.mjs; yeni scripts/runDisposableMobileWeightDateHarness.mjs; yeni supabase/migrations/20261011103029_mobile_weight_istanbul_date.sql; docs/RELEASE_WEIGHT_DATE_FIX.md; docs/RELEASE_WEIGHT_PRODUCTION_EVIDENCE.json; bu rapor ve RELEASE_BACKUP_VERIFICATION_2026-10-11.md.

Mobil: App.js; package.json/package-lock.json; auth RegisterView.js, AuthScreen.js, authService.js, useAuthViewModel.js; mevcut passwordRecoveryContract.test.cjs ve legalSupportSource.test.cjs beklentileri; yeni LegalAcceptanceFields.js, LegalAcceptanceScreen.js, useLegalAcceptanceViewModel.js, legalAcceptancePolicy.cjs ve legalAcceptance.test.cjs; docs/RELEASE_ACCEPTANCE_2026-10-11.md ve docs/RELEASE_ANDROID_BUILD_EVIDENCE.json. Tam yollar ilgili çalışma dizinlerine göredir.

## 4. Değişiklikler

- Kilo tarihi: iki mevcut DB fonksiyonuna yalnız Europe/Istanbul TimeZone ayarı. RPC imzası, fonksiyon gövdeleri, izinleri, tablo/RLS/constraint yapısı korunur. Günlük upsert ve diğer ölçümler korunur. Eski yanlış günlü veriler otomatik değiştirilmez.
- Mobil kayıt: koşul kabulü ve KVKK bilgilendirme alanları başlangıçta boş; mevcut Auth trigger metadata'sına aktarılır. Eksik kabulü olan mevcut danışan için tamamlama ekranı; mevcut accept_legal_terms RPC kaydı ve profil tekrar okuması başarıyla tamamlanmadan uygulama açılmaz. Başarısız kayıt başarı gibi gösterilmez.
- Bağımlılıklar: uyumlu küçük güncellemeler; major Expo/RN/Tailwind değişimi yok. Mobil kritik uyarı giderildi; audit tüm bulgular için temiz değildir. Native Linux Node 24.17.0/npm 11.13.0 temiz kurulum başarılı; yalnız eksik @emnapi/core/runtime 1.11.3 kayıtları eklendi, diğer sürümler aynı. Ardından Windows gate'leri tekrar başarılı.
- Cihaz testi: kullanıcının Android denemesi beyan olarak kaydedildi. Expo'da önceki tamamlanmış preview/development build kanıtı görüldü. İlk yeni native deneme lockfile nedeniyle hata verdi; Linux düzeltmesinden sonra build 94596a86-2cbd-476b-b7fd-9cc1c1340861 FINISHED, APK artifact'i mevcut. Yeni paketin cihaz testi bekliyor.
- Kurtarma: güncel DB ve 49 Storage dosyası dışa aktarıldı; ağsız yerel gerçek PostgreSQL restore ve kayıt/policy/dosya doğrulaması başarılı. Şifreli arşiv açılıp hash eşitliği doğrulandı.

## 5–9. Komutlar ve kalite sonuçları

| Kontrol | Web birleşik kaynak | Mobil birleşik kaynak |
|---|---|---|
| npm ci --ignore-scripts (Windows) | Başarılı | Başarılı |
| npm ci --ignore-scripts (Linux Node 24.17.0/npm 11.13.0) | Bu oturumda çalıştırılmadı | Başarılı |
| npm run typecheck | Başarılı | Başarılı |
| npm run lint | 0 hata, 5 uyarı | 0 hata, 40 uyarı |
| npm run test | WEB_CONTRACT_TEST_GATE_PASS | 444/444 başarılı |
| npm run build / Expo export Android | Vite production build başarılı | Android JS export başarılı |
| EAS Android native preview | Uygulanmaz | FINISHED; gerçek APK mevcut, 1.0.0/versionCode 1 |
| Özel DB runtime testi | MOBILE_WEIGHT_DATE_RUNTIME_PASS | Ortak DB düzeltmesini web harness'i doğruladı |
| Ek kontroller | git diff --check başarılı | Hukuki dal Android/iOS export başarılı; bağımlılık dalı Expo Doctor 18/18 |

Komutlar: npm ci --ignore-scripts; npm run typecheck/lint/test/build; npx expo export --platform android/ios; npx expo-doctor; node scripts/runDisposableMobileWeightDateHarness.mjs; npm audit --json; npm audit --omit=dev --json; kontrollü npm update/install --package-lock-only --ignore-scripts; Supabase CLI db dump --linked (schema/data/roles); storage cp --linked --recursive (yalnız download); Docker psql restore/verify; EAS whoami, build:list, env:list ve build --platform android --profile preview --non-interactive --no-wait.

Web build doğrulaması localhost Supabase placeholder env ile yapıldı; production işlev uçtan uca tarayıcı testi değildir. Gerçek DB'ye yazabilen test_insert.js çalıştırılmadı. Linux lockfile düzeltmesinin ardından Windows temiz kurulum, typecheck/lint/444 test/Android export tekrar başarılı; production migration sürümüyle dosya adı eşitlenince özel DB harness, web test ve build tekrar başarılı. Ham komut logları C:\dev\DietBridge-Release-Audit\2026-10-11 altındadır; private loglar paylaşılmamalı.

## 10. Henüz tamamlanmayan kontroller

Yeni paket fiziksel cihaz kabul testi, Play production AAB/internal-track testi ve iOS IPA/fiziksel iPhone testi. Yeni Android preview native APK artık başarılıdır. Canlı kullanıcı hesabına otomatik test yazması, staging Supabase üzerinden gerçek e-posta/Auth/Storage HTTP smoke testi yapılmadı. Tam backend replay/e2e gate burada çalıştırılmadı; yalnız değişikliğe özel gerçek DB harness'i çalıştı.

## 11–13. Üretim ve migration durumu

Production'da katalog incelemesi, DB export ve Storage download yapıldı. Kullanıcı ayrı açık onay verdiğinde yalnız mobile_weight_istanbul_date migration'ı uygulandı. Tool'un migration history sürümü 20261011103029; birleşik kaynak dosyası buna eşitlendi, onaylanan SQL içeriği aynı. Production schema ve migration history kaydı bu kapsamda değişti. Uygulama verisine INSERT/UPDATE/DELETE/test RPC veya Storage upload/delete yapılmadı. RLS/Storage policy değişmedi. Sentetik test DB'si ve güncel yedeğin yerel restore'unda migration/rollback başarılı. Production postflight'ta gövde hash'leri, owner, SECURITY DEFINER, grants ve search_path aynı; yalnız TimeZone eklendi. EAS kaynak upload/build isteği yapıldı; mağaza yayını, EAS Submit veya Vercel deploy yapılmadı.

## 14. Git durumu

İlk düzeltme raporu hazırlanırken kaynaklar modified/untracked haldeydi; commit veya push yapılmamıştı. Kullanıcı daha sonra değişiklikleri GitHub'a gönderme yetkisi verdi. Web ve mobil değişiklikleri kendi repository'lerinde codex/release-preparation dalına ayrı mantıksal commitlerle kaydedilir. Kullanıcının ilk çalışma dizinindeki eski branch/değişiklikler korunur; başka kullanıcı dalları birleştirilmez. Bu gönderim main merge/deploy işlemi içermez.

## 15. Kalan riskler

| Alan | Son durum ve gerekli iş |
|---|---|
| Gece kilo tarihi | Production düzeltmesi uygulandı ve katalog doğrulandı; yeni Android gece kaydı manuel kontrolü bekliyor. Geçmiş kayıt düzeltmesi ayrı inceleme |
| Hukuki kabul | Teknik kayıt tamam; sağlık verisi dayanağı/açık rıza/yurt dışı aktarım ve metin sürümleme ayrıca değerlendirilmelidir |
| Mobil audit | 0 kritik, 22 yüksek, 23 orta (45); aynı alt paket çok sayıda üst paketi işaretler. Hepsi cihazda doğrudan açık değildir; sıfır risk kanıtı değildir |
| Audit değişimi | 9 paket adı temizlendi. js-yaml yüksek→orta oldu; yeni @istanbuljs/load-nyc-config ve babel-plugin-istanbul uyarıları bu kalan zincirden geliyor. Orta sayısı 20→23 yükseldi; gizlenmedi |
| Web audit | 5 yüksek, 2 orta (7); npm audit --omit=dev sıfır. Kalan zincir Tailwind/build araçları |
| Braces/node-forge | Bildirimlerde henüz patched sürüm yok. Uyumlu major/refactor ayrı aşamada ele alınmalı |
| image-size 1.x | Expo/RN/Metro build zincirinde; 2.x API'ye kör override yapılmadı. 2.x hattı 2.0.4 ile yamalı |
| Decode/uuid/js-yaml/sprintf | Üst paket sürüm kısıtları veya API farkları sürer. NavigationContainer linking yapılandırması yok, custom password recovery kendi parser'ını kullanır; bu erişilebilirlik değerlendirmesi PoC veya tüm kullanım yollarının güvenli olduğu kanıtı değildir |
| Yedek | DB/Storage yerel restore kanıtı hazır. Free plan otomatik yedek yok. Offsite kopya/bağımsız anahtar yok; DPAPI mevcut Windows profiline bağlı. Scheduler/Vault/platform secrets/managed servislerin tam kurtarması denenmedi |
| Mobil yayın | Yeni APK kabulü ve production AAB iç test tamamlanmadan mağaza için tam onay verilmez |

Bağımlılık kaynakları: [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [decode-uri-component advisory](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr). Zincir/range verileri bu tarihteki npm audit ve npm explain çıktılarından; uygulama erişilebilirliği kaynak incelemesinden çıkarımdır.

## 16–17. Manuel kontrol ve sonraki aşama

Yeni Android deneme paketi: [EAS build/APK indir](https://expo.dev/accounts/samet_app/projects/dietbridge/builds/94596a86-2cbd-476b-b7fd-9cc1c1340861). Native build 11 Ekim 2026 10:45:46 UTC tamamlandı. Kimlik: mobil docs/RELEASE_ANDROID_BUILD_EVIDENCE.json; 14 değişen kaynak dosyasının SHA-256 manifest'i audit dizininde. EAS build sırasında henüz commit/push yapılmamış çalışma ağacı yüklenmiştir. Mobil kaynak kod App.js ve apps/mobile/src altında C:\dev\DietBridge-Release-Fixes\2026-10-11\mobile-ready dizinindedir; kullanıcının eski mobil klasörü bu değişiklikleri içermez.

Production onayı, uygulama ve salt okunur postflight tamamlandı. Yeni Android preview paketi ile kabul ekranı, şifre kurtarma, gece kilo kaydı, fotoğraf/sohbet ve bildirim senaryoları docs/RELEASE_ACCEPTANCE_2026-10-11.md tablosuna işlenmeli. Mağaza için public yayın gerekmeden Google Play internal testing ile production AAB denenebilir. Ardından düzenli/offsite yedek ve kalan SDK/bağımlılık/hukuki değerlendirme aşaması.
