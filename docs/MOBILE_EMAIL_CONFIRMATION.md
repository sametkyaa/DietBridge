# Mobil kayıt e-posta doğrulaması

13 Ekim 2026 — Kaynak kod hazır; production yayını veya Supabase Auth ayarı değişikliği yapılmadı.

Mobil eş branch: `codex/mobile-email-confirmation`.
Web branch: `codex/mobile-email-confirmation-web`.

## Davranış

Mobil kayıt `emailRedirectTo` değerini `https://app.dietbridge.com.tr/mobil/eposta-dogrulama` olarak gönderir. `email_not_confirmed` hata kodu veya eski `Email not confirmed` mesajı güvenli Türkçe uyarıya çevrilir; yanlış şifre uyarısı korunur. Şifre kurtarma `dietbridge://reset-password` akışına dokunulmaz.

Web doğrulama sayfası `AuthProvider` ve diyetisyen veri provider'larından bağımsızdır. Standart Supabase mobil signup doğrulama linkinin `type=signup` callback'ini kabul eder. Auth sunucusundaki `getUser(accessToken)` yanıtında gerçek `email_confirmed_at` görülmeden başarı göstermez. Süresi dolmuş, hatalı, eksik veya recovery bağlantısı başarı sayılmaz. Ağ hatasında tekrar deneme vardır. Tokenlar URL'den temizlenir; callback kullanıcısı web oturumuna kaydedilmez. Tarayıcıdaki mevcut diyetisyen oturumu korunur.

Bu sayfa Supabase'in doğrulamayı tamamladıktan sonra yönlendirdiği sayfadır; `?confirmed=true` gibi URL işaretleri doğrulama kanıtı değildir. Mobil uygulamanın mevcut implicit Auth akışı korunmuştur; başka uygulamalardan gelen PKCE/code veya özel token-hash e-posta şablonları bu görevin kapsamına eklenmemiştir.

## Yayın sırası ve manuel kontroller

1. Web branch'ini inceleyip `/mobil/eposta-dogrulama` sayfasını yayınlayın. Normal diyetisyen giriş/kayıt ve şifre kurtarma akışlarını kontrol edin.
2. Supabase Authentication > URL Configuration > Redirect URLs listesine **tam olarak** `https://app.dietbridge.com.tr/mobil/eposta-dogrulama` ekleyin. Mevcut Site URL, web giriş adresleri, davet ve şifre kurtarma izinlerini koruyun. Bu yeni sayfayı bütün kayıtların Site URL'si yapmayın.
3. Confirm signup e-posta şablonundaki doğrulama bağlantısının `{{ .ConfirmationURL }}` kullandığını, `{{ .SiteURL }}` veya sabit diyetisyen login adresine yönlenmediğini doğrulayın. Aktif şablon bu görevde okunmadı/değiştirilmedi.
4. Eş mobil branch'ten yeni uygulama paketi oluşturun. `emailRedirectTo` yeni mobil sürümle gönderilir; daha önce gönderilmiş e-postalar yeni adrese kendiliğinden dönüştürülmez.
5. Onaylı test ortamında doğrulanmamış hesapla giriş uyarısı, yeni e-postadaki link, doğrulanmış hesapla mobil giriş, tekrar kullanılan/süresi dolmuş bağlantı ve mevcut web oturumu senaryolarını kontrol edin.

Canlı Auth allowlist/şablon uygunluğu, gerçek e-posta teslimatı ve fiziksel cihazdan giriş bu yerel testlerle doğrulanmış sayılmaz. Kullanıcı/test hesabı oluşturulmadı, doğrulama e-postası gönderilmedi, DB/Storage/RLS değişikliği veya migration yapılmadı.

## Yerel doğrulama

- Mobil: `npm ci`, typecheck, lint (0 hata; 41 mevcut uyarı), 514 Node testi ve Android/iOS Expo export.
- Web: `npm ci`, typecheck, lint (0 hata; 5 mevcut uyarı), production build, 3 yeni servis/parser testi ve 4 tarayıcı testi.
- Tarayıcı istekleri sahte `dietbridge-disposable-test.invalid` yanıtlarıyla sınırlandırıldı; production'a istek veya yazma yapılmadı. Mobil genişlik 390 × 844 kontrol edildi.
- Web genel test kapısı için `DIETBRIDGE_MOBILE_REPO` güncel mobil worktree'yi göstermelidir; eski varsayılan MVP10 klasörü güncel su sözleşmesi dosyalarını içermiyor.
