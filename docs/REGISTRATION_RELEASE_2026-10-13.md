# DietBridge kayıt ve e-posta düzeltmeleri — yayın kaydı

13 Ekim 2026. Kullanıcı web yayınını ve Play Console yeni sürüm güncellemesini açıkça istedi.

## Kaynak ve kapsam

Web: `codex/mobile-email-confirmation-web`, `C:/dev/DietBridge-Web-Email-Confirmation`, taban `56ef9bd35901852d441c7ea714f907a63db06b88`.

Mobil birleşik yayın alanı: `codex/release-registration-20261013`, `C:/dev/DietBridge-Mobile-Registration-Release-20261013`, taban `9625e3cab97f170aad641be32f59eec694ff48c5`. Mevcut 1.0.1 yayın adayı dosyaları kopyalanarak bildirim, izin kurtarma, logo, Firebase yapılandırması ve öğün düzeltmeleri korundu. Bunun üzerine bu görevin sağlık rızası yerleşimi ve e-posta düzeltmeleri aktarıldı. Kaynak branch'lerdeki değişiklikler korunuyor; commit/push/merge/PR yapılmadı.

Onboarding'deki tekrar eden sağlık rızası alanları kaldırıldı. Kayıt ekranındaki KVKK bölümüne ayrı, varsayılan boş saklama/paylaşma seçenekleri eklendi. Profildeki sağlık bilgilendirme/tercih alanı Ayarlar'a taşındı. Doğrulanmamış e-posta için açık Türkçe giriş uyarısı ve mobil signup'a özel web dönüş sayfası eklendi. Uygulama sürümü, package.json ve lockfile kök sürümü 1.0.2 olarak eşleştirildi; bağımlılık sürümleri bu yayında değiştirilmedi.

Dosya listeleri önceki `MOBILE_REGISTRATION_FLOW_REPORT_2026-10-13.md` içinde. Birleşik mobil kaynak kimliği `C:/dev/dietbridge-registration-source-manifest-20261013.json` içinde dosya bazlı SHA-256 ile kaydedildi. Tam çalışma ağacı listeleri bu yayın raporunun yanındaki `REGISTRATION_RELEASE_CHANGED_FILES_2026-10-13.txt` içinde.

## Web yayını

Vercel CLI ile hedef `dietbridge/diet-bridge`, `prj_sZayHPl8Ww6dqX7ftKU4aXvdWAy5` açıkça doğrulandı. Bağlantısız çalışma alanında başka proje oluşturulmadı; açık project/scope hedefleri kullanıldı. Bağlı Vercel connector get_project isteği 404 verdi; doğrulanan mevcut CLI hesabıyla devam edildi.

Önce production adayı domain ataması olmadan oluşturuldu: `dpl_DkdvL1bQmJ31NdcaoQcqWXQykuon`, https://diet-bridge-6diqd1kuf-dietbridge.vercel.app . Uzak build READY. Koruma kaldırılmadan `vercel curl` ile HTML ve derlenmiş JS kontrol edildi; doğru production Supabase adresi ve yeni sayfa bulundu. Sonra `vercel promote` başarıyla tamamlandı.

Canlı https://app.dietbridge.com.tr/mobil/eposta-dogrulama HTTP 200 döndü; `/assets/index-CNcrCEPF.js` yeni adayla eşleşti. Canlı tarayıcıda tokensız link başarı sayılmadı ve mobil uygulamaya yönelten açıklama görüldü. Gerçek yeni kayıt/doğrulama e-postası gönderilmedi; başarılı doğrulama dalı önceki dört izole tarayıcı testinde doğrulandı.

Önceki canlı deployment `dpl_4ACejoBDJvSV6Kn55W13sMCx8Ekw`, https://diet-bridge-gnhsdgp7o-dietbridge.vercel.app . API metadata'sında aynı `56ef9bd` main tabanı ve önceki invite-code yayını doğrulandı. Vercel environment ayarları değiştirilmedi. Sorun halinde bu önceki deployment'a dönüş ayrı bir operasyon olur.

## Supabase işlemleri

Salt okunur SQL ile yalnız `private.health_consent_settings` belgesi okundu: sunucu enabled=true; belge/aydınlatma sürümleri ve iki tam rıza metni mobil sabit belgeyle eşleşiyor. Kullanıcı izin kayıtları okunmadı veya yazılmadı.

Auth URL Configuration'da yalnız `https://app.dietbridge.com.tr/mobil/eposta-dogrulama` eklendi; listede altıncı URL olarak kaydedildiği görüldü. Site URL ve mevcut beş redirect korunuyor. Confirm sign up şablonunun `{{ .ConfirmationURL }}` kullandığı kaynak editöründe doğrulandı; şablon değiştirilmedi.

Yönlendirme ekran kanıtı: [Kaydedilen ayar](C:/dev/dietbridge-auth-redirect-20261013.jpg).

Production DB/Storage/Auth kullanıcı verisi yazması, RLS değişikliği, migration oluşturma/çalıştırma yok. Yayın kapsamındaki tek Supabase yazması Auth redirect ayarıdır. Kullanıcı oluşturma, test hesabı, e-posta gönderme veya kullanıcı adına sağlık rızası işlemi yapılmadı.

## Doğrulama

- Mobil `npm ci --ignore-scripts` başarılı. İlk quality koşusunda app.json 1.0.2 ile package kök sürümü 1.0.1 farkını iki mevcut sözleşme testi yakaladı. Package/lockfile kök sürümleri eşleştirildi; test beklentileri gevşetilmedi.
- Son `EXPO_PUBLIC_ENABLE_HEALTH_CONSENT=true npm run quality`: typecheck başarılı; lint 0 hata/41 mevcut uyarı; 565 test geçti; public Expo config ve Android/iOS export başarılı. Production public URL/key EAS'ten ignored `.env.local` içine alındı, değerler rapora/loga yazdırılmadı.
- Web önceki aşamanın typecheck, lint (0 hata/5 mevcut uyarı), test ve dört tarayıcı kontrolü başarılı. Yayın kaynağı Vercel production build başarılı. Web genel testleri `DIETBRIDGE_MOBILE_REPO=C:/dev/DietBridge-Mobile-Registration-Release-20261013 npm test` ile yeniden çalıştırıldı; `WEB_CONTRACT_TEST_GATE_PASS`, exit 0.
- `git diff --check` geçti. Mevcut audit bulguları bu görevde düzeltilmedi.

Komut aileleri: git status/log/ls-remote/worktree/diff/apply; npm ci/quality/test; eas env:list/env:pull/build:version:get/build/build:view; vercel project inspect/deploy/inspect/curl/promote/list/api; salt okunur Supabase execute_sql; Chrome'da Auth URL/şablon inceleme ve Play Console sürüm hazırlama. Kullanılmayan ağır/yazabilen repository test betikleri çalıştırılmadı.

## Android ve Play Console

Mevcut etkin kanal Dahili test; önceki sürüm 1.0.1 (3), EAS build `f12f5ffc-74a7-4554-a833-f4e328a80cf4`. Google Play üretim erişimi kapalı, Alpha taslak durumda; kanal değiştirilmedi, tester/listing/policy alanlarına dokunulmadı.

Yeni EAS production STORE AAB: [build 3df6f0e8-fd8e-4cb5-9ed5-dbd61ab654b1](https://expo.dev/accounts/samet_app/projects/dietbridge/builds/3df6f0e8-fd8e-4cb5-9ed5-dbd61ab654b1), sürüm 1.0.2, versionCode 4. FINISHED, 13 Ekim 2026 08:39:56 UTC. Mevcut remote Android keystore `--freeze-credentials` ile korundu. Production Google Services secret dosyası mevcut EAS ayarından kullanıldı.

AAB yerel dosyası: `E:/DietBridge-Release-Tools-20261012/android-artifacts/DietBridge-production-3df6f0e8.aab`. SHA-256: `5284300A68B4916FA3D50DEA6EC458AA579099FD01516E0CB78143964312443B`. `bundletool validate` exit 0; manifest `com.dietbridge.app`, versionName 1.0.2, versionCode 4, minSdk 24, targetSdk 36. `jarsigner -verify`: jar verified, exit 0. Mevcut self-signed yükleme sertifikası/timestamp uyarıları kaydedildi; önceki 1.0.1 AAB ile SHA-256 yükleme sertifikası aynı. EAS'e gönderimden sonra 64 kaynak dosyasının hash'leri değişmedi. Bu kontroller fiziksel cihaz testi değildir.

Play Console AAB'yi işledi ve Yapılar tablosunda `4 (1.0.2)`, API 24+, hedef SDK 36 olarak kabul etti. Desteklenen cihaz kaybı 0. Tek uyarı: R8/proguard kod gösterme dosyası yok; yayın engeli veya kaynak hatası değildi. Yeni `1.0.2 (4) - Dahili test` adı ve Türkçe değişiklik notlarıyla Kaydet ve yayınla tamamlandı.

13 Ekim 2026 11:44 Türkiye saati: kanal Etkin, Son sürüm 1.0.2 (4); Console **Dahili test kullanıcıları tarafından kullanılabilir** durumunu gösterdi. Sürüm 3 details: https://play.google.com/console/u/0/developers/4876164662379631066/app/4972892752323500020/tracks/4700787092786123034/releases/3/details . Play uyarısına göre cihazlarda görünmesi genellikle bir saati bulabilir. Üretim/herkese açık veya Alpha yayını yapılmadı; mevcut tester listesi korundu. Fiziksel telefondaki güncelleme henüz doğrulanmadı.

![Play Console yayın sonucu](C:/dev/dietbridge-play-release-1.0.2-20261013.jpg)

## Kalan kontroller ve sonraki aşama

Yeni AAB'nin telefonda güncellenmesi; kayıt KVKK/sağlık seçimleri, Ayarlar'dan kaydetme/geri çekme, doğrulanmamış giriş uyarısı, yeni doğrulama e-postası ve doğrulama sonrası mobil giriş kullanıcı cihazında kontrol edilmeli. Önceden gönderilmiş e-postalar yeni mobil redirect'e kendiliğinden dönüşmez. Rıza metinlerinin mevcut `-draft` sürüm kimlikleri değiştirilmedi.

Supabase Dashboard'da mevcut kota/grace period ve genel olay banner'ları görüldü; faturalandırma veya plan değiştirilmedi. Fiziksel cihaz testi, gerçek e-posta teslimatı veya mağazanın üretim onayı gerçekleşmiş sayılmaz.

Sonraki aşama: güncel dahili test sürümünün cihaz kabulü; ardından mevcut Google Play kapalı test/üretim erişimi gerekliliklerinin tamamlanması. Son git status kontrollerinde web `codex/mobile-email-confirmation-web`, mobil `codex/release-registration-20261013` çalışma ağaçları bu görev ve önceki yayın dosyalarıyla dirty. Kaynak aşama branch'leri korunuyor. Asıl web checkout'u `codex/mobile-profile-navigation`, önceden mevcut untracked belgelerle aynı durumda. Commit, push, merge veya PR yapılmadı. Kaynak dosyalar geri alınmadı.
