# Sohbet görsel, video, belge ve teslim/okundu hazırlığı

Tarih: 12 Ekim 2026. Durum: **kaynak kod hazır ve yerel kontroller başarılı; production'a uygulanmadı.**

## Kapsam ve branch

- Web: `codex/chat-media-20261012`; başlangıç `46b62005608c3d2e1cf6a87c43e14d0128e27564`.
- Mobil: `codex/chat-media-20261012`; başlangıç `d10b7c148a0f618a09a25a3645d79e2156d628f7`.
- Web aktif route'u `pages/Messages.tsx`, mobil `ChatScreen` / `useChatViewModel` zinciri korundu.
- Önceki mobil uyumluluk ve web davet bağlantısı hazırlıkları ayrı çalışma ağaçlarında duruyor. Bu göreve birleştirilmedi. Mevcut kullanıcı değişikliklerine dokunulmadı.

## Son davranış

- Web ve mobil sohbetten görsel seçilebilir. Mobilde mevcut kamera/galeri akışı açıldı.
- Video ve belge tek ek olarak, açıklama zorunlu olmadan gönderilebilir. Yükleme ve doğrulama bitmeden başarılı mesaj gösterilmez; tekrar deneme aynı gönderimi çoğaltmaz.
- Web videoyu tıklanınca oynatır; belge indirme bağlantısı üretir. Mobil video/belgeyi işletim sisteminin desteklediği görüntüleyiciye veya tarayıcıya açar.
- Sohbete ilk girişte ve mobil sekmeye yeniden dönüşte son mesaj konumlanır. Kullanıcı eski mesajlara kaydırınca zorla aşağı çekilmez. Önceki sayfaların yüklenmesi korunur.
- Tek gri tik: sunucu mesajı kabul etti. Çift gri tik: karşı tarafın istemcisi teslim kaydı yazdı. Çift mavi tik: karşı taraf mesajı görünür olarak okudu ve kayıt yazıldı. Çevrimiçi olmayı teslim/okundu saymıyoruz.
- Production'da mevcut katılımcı SELECT politikası `auth.uid() = user_id` koşuluyla karşı tarafın teslim/okundu kaydını gizliyordu. Migration bunu aktif sohbetin iki katılımcısına açar; mevcut diyetisyen onayı ve sağlık verisi kısıtlayıcı politikaları korunur.

## Sınırlar

Boyutlar ikili MB (MiB) olarak uygulanır; arayüzde anlaşılır olması için MB yazılır.

| Tür / kota | Sınır |
|---|---|
| Seçilen kaynak görsel | 20 MiB |
| Sunucuda saklanan görsel | JPEG, en fazla 4 MiB; en uzun kenar 2048 piksel |
| Video | MP4, MOV, WebM; en fazla 20 MiB |
| Belge | PDF, DOCX, XLSX, TXT, CSV; en fazla 10 MiB |
| Tek gönderim | Bir ek |
| Ek rezervasyonu, kullanıcı başına | 5/dakika, 30/saat |
| Ek byte rezervasyonu, kullanıcı başına | 100 MiB/saat, 300 MiB/son 24 saat |
| Tüm mesajlar, kullanıcı başına | 30/dakika, 200/saat |

Kotalar kullanıcının tüm sohbetleri için ortaktır. İptal edilen ve süresi dolan rezervasyonlar da zaman penceresinde sayılır. JPEG için sıkıştırmadan önce gerçek boyut bilinmediğinden rezervasyon başına 4 MiB ayrılır. Tekrar deneme aynı rezervasyonu kullanır. Video süresi için ayrı bir limit konmadı; boyut sınırı geçerlidir. EXE, ZIP, HTML, SVG gibi türler kabul edilmez.

## Sunucu ve gizlilik

- Mevcut `chat_upload_intents`, `chat_attachments`, mesaj, bildirim ve temizlik sözleşmeleri genişletildi. Ayrı bir sohbet veya paralel dosya modeli kurulmadı.
- Yeni private `chat-media` bucket'ı genel erişime açık değildir. Doğrudan authenticated Storage yazmaları kısıtlayıcı politikalarla engellenir.
- `validate-chat-media` kullanıcının oturumunu, gönderim iznini, aktif ilişkiyi, descriptor'ı, gerçek byte sayısını ve dosya formatını doğrular. Sunucunun ürettiği path'e yükler, saklanan dosyayı yeniden kontrol eder; yalnız servis doğrulanmış kaydı işaretleyebilir. İstemciye service-role anahtarı verilmez.
- PDF/Office/metin/video format kontrolü zararlı yazılım taraması veya bütün video codec'lerinin oynatma garantisi değildir. Office dosyalarının makroları/tehlikeli ZIP girdileri reddedilir; antivirüs motoru eklenmedi.
- İndirme bağlantıları tıklanınca, 5 dakika süreyle üretilir. Oturum/sağlık veri yenilemesi arayüzde açık URL'yi temizler. Daha önce üretilmiş imzalı bağlantı veya indirilmiş dosya uzaktan geri alınamaz; bir bağlantı kalan süre boyunca çalışabilir.
- Sağlık izin kontrolleri mevcut merkezi ayarlara bağlıdır. Bu geliştirme production'daki sağlık zorunluluk ayarlarını değiştirmez. Bu ayarların canlı kabulü ayrı yayın adımıdır.
- İptal edilen genel dosyalar için 10 dakika temizlik gecikmesi, halen devam eden sunucu yüklemesiyle yarışmayı önler. Mesaj silme, süresi dolan yüklemeler ve hesap silme mevcut temizlik akışına dahildir.

## Doğrulama ve kanıt

| Kontrol | Sonuç |
|---|---|
| Web `npm run quality` | Başarılı: typecheck, lint (0 hata, mevcut 5 uyarı), 609 test, production build |
| Mobil `npm run quality` | Başarılı: typecheck, lint (0 hata, mevcut 41 uyarı), 511 test, Android ve iOS JS export |
| Üç Edge girişinin Deno typecheck'i | Başarılı |
| Medya doğrulama, mevcut temizlik ve hesap silme Edge testleri | 50 başarılı test, 2 alt adım, 0 hata |
| `npm run test:chat-media:runtime` | Başarılı; yalnız geçici yerel Supabase ortamı |
| Gerçek web bileşenleri, Chromium, 1280 ve 390 piksel | Görsel/video/dosya seçici, açıklamasız belge gönderimi, hatalı tür/boyut, gerçek WebM oynatma, yatay taşma ve sayfa hatası kontrolü başarılı |

Yerel Supabase testi gerçek Auth, REST, Storage ve Edge üzerinden TXT yükleme/indirme, gerçek oynatılabilir WebM, mevcut gerçek JPEG akışı, ters yönlü gönderim, karşı taraf teslim/okundu kaydı, yabancı kullanıcının reddi, sağlık paylaşımı geri çekilmesi, silme/temizlik kuyruğu, tekrar denemenin tek mesaj üretmesi ve byte/adet kotalarını doğruladı. Her test yalnız loopback adresini kabul eden geçici ortamda yürütüldü; ortam test sonunda durduruldu.

Web kontrat testleri mobil dosyaları da okuduğundan komut şu environment ile çalıştı: `DIETBRIDGE_MOBILE_REPO=C:\dev\DietBridge-Release-Fixes\2026-10-12\mobile-chat-media`.

Kanıtlar: `C:\dev\DietBridge-Release-Audit\2026-10-12\chat-*-quality.log`, `chat-edge-check.log`, `chat-edge-test.log`, `chat-backend-runtime.log`, `chat-web-browser.log`, `chat-web-desktop.png`, `chat-web-narrow.png`. Bunlar yerel artefaktlardır; production veya fiziksel cihaz kabul kanıtı değildir.

PR incelemesinde mobil picker kilidi, geçmişten yüklenen ekin dosya adı ve gönderim sonrası reconciliation bekleme/sohbet değişikliği koruması düzeltildi. 10 yeni regresyon testi eklendi. Yeni medya Edge testleri ve gerçek migration/Storage akışı `media-validator` / `media-runtime` GitHub kontrol kapılarına bağlandı. Ayrıntılar: `CHAT_MEDIA_PR_REVIEW_2026-10-12.md`.

`expo-document-picker ~14.0.8` SDK 54'ün uyumlu native modülü olarak eklendi (MIT). Mevcut picker kamera/galeriye odaklandığı için genel belge seçiminde gereklidir. Expo export boyutu yaklaşık 4.46 MB; bu APK/IPA boyutu veya picker'ın tek başına boyut etkisi değildir. Major paket yükseltmesi yapılmadı.

Mobil paket kurulumu npm taramasında 45 bildirim (22 yüksek, 23 orta) raporladı. Bunlar dağıtılan uygulamada kullanılabilir 45 açık kanıtı değildir; bağımlılık zinciri ayrıca değerlendirilmelidir. Bu sohbet görevi kapsamında toplu `audit fix --force` veya major yükseltme uygulanmadı.

## Kontrollü yayın sırası

1. Git yayın izniyle web ve mobil branch'lerini incelemeye aç. Önceki ayrı uyumluluk/davet hazırlıklarının dahil edileceği sürümü belirle; kendiliğinden başka branch'i birleştirme.
2. Güncel DB ve Storage yedek/kurtarma kanıtını tazele. `supabase/preflight/chat_media_preflight.sql` salt okunur kontrolünü production'da çalıştır. Fingerprint veya beklenen policy/constraint farkı varsa migration'ı uygulama; tekrar incele.
3. **Açık production onayından sonra** yalnız `20261012080237_chat_media_and_rate_limits.sql` migration'ını uygula. Tek seferliktir; idempotent değildir; beklenmeyen önkoşulda transaction rollback olur. Video/belge gönderim bayrağı başlangıçta kapalıdır. Katılımcı receipt düzeltmesi ve mesaj/ek kotaları migration'la yürürlüğe girer.
4. `validate-chat-media`, güncellenmiş `cleanup-chat-images` ve `delete-client-account` Edge fonksiyonlarını dağıt. Mevcut temizleme scheduler'ı/secreti korunur; bu görev yeni secret gerektirmez. JPEG `validate-chat-image` mevcut haliyle kalır.
5. Web ve medya okuyabilen yeni mobil sürümü yayıma hazırla. Yeni native picker için **yeni Android APK/AAB ve iOS IPA gerekir; yalnız OTA/JS export yeterli değildir.** Mağaza yayını olmadan Android preview APK denenebilir. İmzalı iOS cihaz/TestFlight testi Apple hesabı ve imzalama hazırlığı bekler.
6. Salt okunur `supabase/preflight/chat_media_postflight.sql` kontrolü ve onaylı test kullanıcılarıyla kabul testi yap. Canlı test kullanıcı/mesaj/dosya oluşturma ayrıca production yazma onayı gerektirir.
7. Okuyabilen sürümler ve sunucu hazır olmadan video/belge bayrağını açma. Bayrağı açmak için ayrı onaylı SQL: `update private.chat_media_settings set enabled=true where singleton;`. Eski APK'lar genel medyayı okuyamaz; genel medyayı açmadan zorunlu güncelleme veya tüm aktif istemcilerin güncellendiğine ilişkin karar gerekir.

## Geri dönüş

İlk tedbir, onaylı şekilde `enabled=false` yaparak yeni video/belge gönderimini durdurmaktır. Mevcut video/belge okuma ve temizlik akışları çalışmaya devam etmelidir. Yeni kayıtlar varken medya tanımayan eski okuyucuya dönülmez; kolon/bucket/dosya silinmez. Transaction uygulanırken hata olursa commit edilmez. Commit sonrası receipt veya kota değişikliği için hedefli düzeltme migration'ı hazırlanır; veriyi silen otomatik down migration yoktur.

## Görev sonu kaydı ve kalan manuel kontroller

- Amaç: kullanıcı tarafından istenen iki platform sohbet ekleri, kota, mobil son mesaj konumu ve tik sistemi.
- Değişen dosyalar: bu raporun yanındaki `CHAT_MEDIA_CHANGED_FILES_2026-10-12.md` envanterinde.
- Çalıştırılan komutlar: `npm ci --ignore-scripts` (web/mobil), mobil `npx expo install expo-document-picker --ignore-scripts`, her iki repoda `npm run quality`, Edge `deno check` ve `deno test --no-lock --node-modules-dir=none`, web `npm run test:chat-media:runtime`, yerel Chromium bileşen testi, Git durum/diff kontrolleri. Kurulum ve export loglarında mevcut uyarılar korunuyor.
- Build/typecheck/lint/test sonuçları yukarıdaki tabloda; web build'de mevcut büyük chunk uyarıları var.
- Çalıştırılmayan: imzalı yeni APK/AAB/IPA build ve fiziksel Android/iOS kabul testi, production migration/Edge deploy/web deploy, canlı kota ve temizlik scheduler kabulü. Hesap/imzalama ve production yazma/yayın onayı gerekir.
- Supabase production yalnız salt okunur incelendi; veri/RPC/Storage yazması yapılmadı. Yeni migration oluşturuldu ve geçici yerel ortamda uygulandı; production'da çalıştırılmadı.
- Git: yerel hazırlık doğrulaması sırasında iki ayrı branch'te kaydedilmemiş görev değişiklikleri vardı. Kullanıcı 12 Ekim 2026'da iki branch için commit/push ve PR açılmasını onayladı. Merge veya production dağıtımı bu onayın kapsamında değil. Başlangıç çalışma ağaçları korunuyor.
- Cihaz kabulü: kamera/galeri görseli, MP4/MOV, PDF/DOCX/XLSX/TXT/CSV, boyut sınırları, iptal/çevrimdışı/tekrar deneme, iki yönlü teslim/okundu, uzun sohbet/klavye, sekmeden dönüş, eski mesajda kalma ve hesap silme.
- Sonraki aşama: bu kapsamın Git incelemesi ve onaylı sunucu dağıtımı; ardından yeni mobil paket ve iki cihaz kabulü. Kullanıcının önceki APK için bildirdiği başarı bu yeni özelliğin cihaz testini karşılamaz.
