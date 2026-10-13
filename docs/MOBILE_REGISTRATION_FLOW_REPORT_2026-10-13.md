# Mobil kayıt, KVKK ve e-posta doğrulaması — görev raporu

13 Ekim 2026

## Amaç ve sonuç

Sağlık verisi seçimleri tekrarlanan onboarding adımlarından kayıt ekranındaki KVKK alanına taşındı. Profildeki KVKK/sağlık verisi bilgilendirmesi ve tercih kaydetme alanı Ayarlar'a taşındı. KVKK bilgilendirmesi, sağlık verisi saklama rızası ve diyetisyene paylaşım rızası ayrı seçimlerdir; sağlık rızası olmadan hesap oluşturma/sağlık adımlarını atlama korunur. Seçimler varsayılan boş başlar.

Mobil giriş artık doğrulanmamış e-posta hatasını özel Türkçe mesajla gösterir. Mobil signup için doğrulama dönüş adresi `https://app.dietbridge.com.tr/mobil/eposta-dogrulama` olur. Yeni web sayfası sunucudan doğrulanmış e-posta bilgisini kontrol eder ve mobil uygulamadan giriş yapılabileceğini açıklar; diyetisyen panelini açmaz. Geçersiz ve süresi dolmuş linkler başarı göstermez.

## Branch'ler ve çalışma konumları

| Aşama | Branch | Çalışma konumu |
| --- | --- | --- |
| Sağlık verisi yerleşimi | `codex/mobile-consent-placement` | `C:/dev/DietBridge-Mobile-UI` |
| Mobil e-posta hatası ve yönlendirmesi | `codex/mobile-email-confirmation` | `C:/dev/DietBridge-Mobile-Email-Confirmation` |
| Web doğrulama sayfası | `codex/mobile-email-confirmation-web` | `C:/dev/DietBridge-Web-Email-Confirmation` |

Yeni branch'ler mevcut yerel `origin/main` referanslarından oluşturuldu; pull/fetch yapılmadı. Aşamalar ayrı tutuldu, başka branch'ler birleştirilmedi. Kontroller her aşamanın kendi çalışma ağacında yapıldı; tüm aşamaları içeren birleşik native paket oluşturulmadı.

Başlangıçtaki web çalışma klasörü `C:/Users/drsam/Desktop/Yeni klasör/DietBridge-Web` ve `codex/mobile-profile-navigation` branch'i değiştirilmedi. Önceden mevcut beş untracked kayıt grubu korunuyor: iki `CLAUDE46_PRODUCTION_*` belgesi, `docs/legal/` ve iki `supabase/preflight/claude46_production_*` SQL dosyası.

## Değişen dosyalar

Sağlık verisi branch'i:

- `App.js`
- `apps/mobile/src/features/auth/components/RegisterView.js`
- `apps/mobile/src/features/auth/screens/AuthScreen.js`
- `apps/mobile/src/features/auth/screens/LegalAcceptanceScreen.js`
- `apps/mobile/src/features/auth/services/authService.js`
- `apps/mobile/src/features/auth/services/__tests__/healthDataNoticeContract.test.cjs`
- `apps/mobile/src/features/auth/services/__tests__/legalAcceptance.test.cjs`
- `apps/mobile/src/features/auth/services/__tests__/registrationCompletion.test.cjs` — yeni
- `apps/mobile/src/features/auth/viewmodels/useAuthViewModel.js`
- `apps/mobile/src/features/auth/viewmodels/useLegalAcceptanceViewModel.js`
- `apps/mobile/src/features/clients/screens/ProfileScreen.js`
- `apps/mobile/src/features/clients/screens/SettingsScreen.js`
- `apps/mobile/src/features/healthConsent/components/HealthConsentPanel.js`
- `apps/mobile/src/features/healthConsent/components/RegistrationHealthConsentFields.js` — yeni
- `apps/mobile/src/features/healthConsent/services/healthConsentClient.cjs`
- `apps/mobile/src/features/healthConsent/services/healthConsentService.js`
- `apps/mobile/src/features/healthConsent/services/registrationHealthConsent.cjs` — yeni
- `apps/mobile/src/features/healthConsent/services/__tests__/registrationHealthConsent.test.cjs` — yeni
- `apps/mobile/src/features/onboarding/screens/OnboardingSetupScreen.js`
- `docs/HEALTH_CONSENT_CORE.md`

Mobil e-posta branch'i:

- `apps/mobile/src/features/auth/services/authService.js`
- `apps/mobile/src/features/auth/viewmodels/useAuthViewModel.js`
- `apps/mobile/src/features/auth/utils/emailConfirmationPolicy.cjs` — yeni
- `apps/mobile/src/features/auth/services/__tests__/legalAcceptance.test.cjs`
- `apps/mobile/src/features/auth/services/__tests__/emailConfirmation.test.cjs` — yeni

Web branch'i:

- `App.tsx`
- `lib/supabaseClient.ts`
- `features/auth/pages/MobileEmailConfirmationPage.tsx` — yeni
- `features/auth/services/mobileEmailConfirmationService.ts` — yeni
- `features/auth/utils/mobileEmailConfirmation.ts` — yeni
- `scripts/runAllContractTests.mjs`
- `playwright.features.config.ts`
- `tests/mobileEmailConfirmation.test.cjs` — yeni
- `tests/e2e/mobile-email-confirmation.spec.ts` — yeni
- `docs/MOBILE_EMAIL_CONFIRMATION.md` — yeni
- `docs/MOBILE_REGISTRATION_FLOW_REPORT_2026-10-13.md` — yeni

## Veri akışı ve hata yönetimi

Kayıt anında authenticated oturum bulunmadığından ilk sağlık tercihleri, gösterilen tam metin ve belge sürümleriyle Auth metadata'sında taşınır. Metadata erişim izni değildir. İlk doğrulanmış danışan oturumunda mevcut authenticated consent RPC'si ile kayıt doğrulanır. Sunucuda daha önce kaydedilmiş bir grant veya geri alma varsa signup seçimi tekrar uygulanmaz. Hesap kimliği değişirse seçim yazması durdurulur. Metin/sürüm uyuşmazlığı, RPC hatası veya doğrulanamayan sonuç halinde uygulama/provider'lar açılmadan güncel metinlerle tamamlama ekranı gösterilir. Ret de kaydedilebilir.

E-posta sayfası `getUser(accessToken)` ile salt okunur doğrulama yapar; tokenları tarayıcı oturumuna kaydetmez. Ana web Supabase client'ının otomatik callback tüketimi yalnız bu yolda kapalıdır; normal giriş ve password recovery davranışları korunur. Callback tokenları adres çubuğundan temizlenir. Aynı sekmede başka doğrulama linki açılması ve ağ hatasından sonra retry test edildi.

## Çalıştırılan kontroller

| Kontrol | Sağlık verisi mobil | E-posta mobil | E-posta web |
| --- | --- | --- | --- |
| `npm ci` | PASS | PASS | PASS |
| `npm run typecheck` | PASS | PASS | PASS |
| `npm run lint` | PASS; 41 mevcut uyarı, 0 hata | PASS; 41 mevcut uyarı, 0 hata | PASS; 5 mevcut uyarı, 0 hata |
| `npm test` | 521/521 PASS | 514/514 PASS | `WEB_CONTRACT_TEST_GATE_PASS` |
| Production build/export | Android ve iOS Expo export PASS; sağlık bayrağı true ile | Android ve iOS Expo export PASS | `npm run build` PASS |
| Tarayıcı | Fiziksel mobil UI kontrolü yapılmadı | Fiziksel mobil UI kontrolü yapılmadı | 4/4 Playwright testi PASS |
| `git diff --check` | PASS | PASS | PASS |

Mobil export komutları: `npm run export:android`, `npm run export:ios`. Sağlık verisi exportlarında `EXPO_PUBLIC_ENABLE_HEALTH_CONSENT=true` sadece kontrol komutuna verildi; kayıtlı rollout yapılandırması değiştirilmedi.

Web genel test komutu `DIETBRIDGE_MOBILE_REPO=C:/dev/DietBridge-Mobile-Email-Confirmation` ortamıyla çalıştırıldı. İlk genel test denemesinde eski varsayılan `DietBridge-Mobile-MVP10` dizini su sözleşmesini içermediği için iki test başarısızdı; mevcut fixture dizini açıkça gösterilince tüm kapı geçti. Kod dışı eski test dizini değiştirilmedi.

Web Playwright komutu: `CI=1 npx playwright test -c playwright.features.config.ts mobile-email-confirmation.spec.ts`. Başarı, doğrulanmamış kullanıcı, süresi dolmuş/uydurulmuş link, token temizliği, GET dışı işlem olmaması, tekrar deneme, mevcut web oturumunun korunması ve 390 × 844 taşmasız görünüm doğrulandı. İlk denemede ilk sayfanın load beklemesi ve aynı sayfada yeni hash linki açılması testleri başarısızdı; hash değişimi ele alındı ve son dört test geçti.

Web build ve tarayıcı kontrolleri sahte endpoint/anahtarla çalıştırıldı. Mobil e-posta worktree'sine production environment dosyası kopyalanmadı; Expo export derleme kontrolüdür, yapılandırılmış imzalı native release paketi değildir. Gerçek ortam değerleri release sırasında sağlanmalıdır. Supabase URL/anahtarları rapora veya kaynak koda eklenmedi.

İlgili servis/parser ve kayıt tamamlama testleri ayrıca `node --test` ile çalıştırıldı. `test_insert.js`, production yazabilen betikler, `test:backend`, migration, seed ve mağaza gönderimi çalıştırılmadı.

## Production, migration ve Git durumu

- Production DB, Auth kullanıcıları veya Storage'a yazılmadı; test hesabı veya mesaj/öğün kaydı oluşturulmadı.
- Gerçek doğrulama e-postası gönderilmedi; Auth ayarı/şablonu değiştirilmedi.
- Migration oluşturulmadı veya çalıştırılmadı. RLS/policy/şema değiştirilmedi.
- Yeni bağımlılık eklenmedi ve lockfile değiştirilmedi.
- Commit, push, merge, rebase veya PR yapılmadı.
- Üç görev branch'inde yukarıdaki değişiklikler modified/untracked olarak duruyor. Başlangıç web çalışma ağacı korunuyor.

## Kalan riskler ve manuel kontrol

1. Yeni web sayfası henüz production'da yayınlanmadı. Auth Redirect URLs listesine tam callback URL'si eklenmeli; Confirm signup şablonunun `.ConfirmationURL` yönlendirmesine uyduğu kontrol edilmeli. Mevcut Site URL ve diyetisyen kayıt akışı değiştirilmemeli. Ayrıntılı sıra `MOBILE_EMAIL_CONFIRMATION.md` dosyasında.
2. Eski gönderilmiş e-postalar yeni callback adresine kendiliğinden dönüşmez. Yeni mobil sürümden gelen e-posta ve fiziksel cihazdan doğrulama/giriş test edilmeli.
3. Sağlık verisi rollout bayrağı korunuyor. Kayıt belgesi mevcut backend'in `health-core-2026-10-11-v1-draft` metnine sabitlenmiştir; onaylı yayın belgesiyle eşleme release öncesinde doğrulanmalı. Metin değişirse otomatik eski rıza verilmez; kontrollü tamamlama ekranı açılır.
4. Fiziksel cihazda kayıt kutuları, e-posta sonrası ilk giriş, başka cihazdan giriş, onboarding'in tüm adımları, Ayarlar'dan rızayı geri alma ve sağlık verisi yazmasının engellenmesi kontrol edilmeli. Canlı RLS/e-posta teslimatı/native deep link davranışı burada doğrulanmış sayılmaz.
5. Mevcut lint uyarıları ve web'in 500 kB üzeri bundle uyarısı kapsam dışında bırakıldı. `npm ci` mevcut kilitli bağımlılıklarda mobil için 45 (23 moderate/22 high), web için 7 (2 moderate/5 high) audit bulgusu raporladı; audit fix veya paket yükseltmesi yapılmadı.

Önerilen sonraki aşama: kod incelemesi; izin verilen ayrı commit'ler ve branch entegrasyonu; web yayını/Auth callback yapılandırması; birleşik mobil preview paketi ve gerçek cihaz kabul testi. Yayın sonrası doğrulama ayrı aşamadır.

Supabase signup yönlendirmesinin resmi referansı: [signUp / emailRedirectTo](https://supabase.com/docs/reference/javascript/auth-signup).
