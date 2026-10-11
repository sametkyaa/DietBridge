# DietBridge — KVKK m.6 / m.9 uygulama kararı ve yayın kapısı
Tarih: 11.10.2026 · Kaynak: canlı Supabase **yalnız şema metadata okuması**, iki GitHub deposunun `main` kaynakları ve resmî KVKK/Supabase belgeleri.

> Bu belge hukukî bir uygunluk onayı değildir. Gerçek danışan sağlık verileri henüz olmadığı bildirildi. Tasarım önerileri canlıya alınmadan hukukî doğrulama, gerçek teknik negatif test ve ayrı deploy izni gerekir.

## Taslak işletmeci adı — 11.10.2026 kararı

- **Belgelerde şimdilik kullanılacak ad:** **DietBridge** (ürün/marka/platform adı).
- **Önerilen taslak gösterim:** `DietBridge (platform adı) — işletmeci/veri sorumlusunun resmî kimlik ve iletişim bilgileri yayından önce tamamlanacaktır.`
- **Hukukî sıfat:** “DietBridge” adının tek başına kayıtlı bir şirket veya ayrı bir tüzel kişilik olduğu ileri sürülmez. KVKK aydınlatma metnindeki veri sorumlusunun **gerçek kişi adı-soyadı veya tüzel kişinin tam ticaret unvanı**, adresi ve başvuru kanalı faaliyet başlamadan kesinleştirilmelidir. Veri işleyen / veri sorumlusu rolleri faaliyet bazında belirlenir.
- **Kapsam:** Bu adlandırma **yalnız taslak belgeler ve hazırlık kayıtları** içindir. Kamuya açık kesin aydınlatma veya sağlayıcı sözleşmesi tarafı olarak resmî kimlik yerine kullanılamaz.
- **Durum:** Kullanıcı tercihiyle marka adı geçici olarak netleştirildi; hukukî tarafın kimliği ve imza yetkisi **yayın öncesi açık iş**.

## 1. Doğrulanan uygulama modeli

- Danışan, diyetisyenle ilişki olmadan bağımsız hesap açıp boy/kilo, beslenme amacı, intolerans ve sonrasında kronik hastalık, ilaç, kan grubu/tahlil bilgileri girebilir.
- Mobil kaynak: `apps/mobile/src/features/onboarding/viewmodels/useOnboardingSetupViewModel.js`, `apps/mobile/src/features/clients/services/clientService.js` ve `ProfileScreen.js`.
- Web: diyetisyen mesleki planlama ve danışan kayıtlarını görme sürecine katılır; DietBridge kendi başına teşhis/tedavi önermez.
- Üretim Supabase bölgesi `eu-central-1` (Frankfurt). Canlı metadata'da `client_profiles` (kilo, boy, kronik hastalıklar, ilaçlar, intoleranslar, kan grubu, tahlil tarihi), `client_medical_conditions`, `client_medications`, `measurements`, `daily_logs` bulunur.
- `profiles.terms_accepted_at` ve `profiles.kvkk_accepted_at` vardır; bunlar **sağlık verisi açık rızası** ya da belge sürümü değildir.
- Salt okunur canlı RLS kontrolünde `client_profiles`, `client_medical_conditions`, `client_medications`, `measurements` tablolarında diyetisyen genel rol kapısı **RESTRICTIVE**, ilişkili diyetisyen okuma politikaları ise `dietitian_clients.status='active'` şartlı olarak görüldü. Bu olumlu metadata bulgusudur; iki kullanıcıyla gerçek negatif erişim testi yerine geçmez.
- Mevcut mobil sağlık bilgilendirmesi bir **aydınlatma** bileşenidir; açık rıza oluşturmaz.

## 2. İşleme şartı önerisi (KVKK m.6)

| İşlem | Ön değerlendirme | Gereken kapı |
| --- | --- | --- |
| Bağımsız hesap / kimlik ve oturum | KVKK m.5 kapsamında faaliyet bazlı değerlendirme | Güncel aydınlatma |
| Bağımsız hesapta sağlık bilgilerinin ilk saklanması | Platformun bağımsız m.6 şartı olmalı; m.6/3-a ayrı açık rıza **öncelikli değerlendirilecek seçenek** | Gerçek sağlık verisi kaydından önce ayrı, belirli ve kaydedilebilir süreç |
| İlişki kurulunca yetkili diyetisyene sağlık bilgisi gösterilmesi | DietBridge aktarım/görüntüleme + diyetisyenin mesleki işlemesi ayrı değerlendirilir | Aktif bağlantı ve yeterli m.6 dayanağı, RLS/RPC ile sunucuda doğrulama |
| Diyetisyenin mesleki değerlendirmesi | İlgili diyetisyenin sorumluluğu; m.6/3-e istisnasının şartları **olay bazında** incelenir | Platforma kendiliğinden genişletilmez |
| Bağlantı kopması / rıza geri alma | Gelecek diyetisyen erişiminin durdurulması; saklama/silme için ayrı hukukî değerlendirme | Aktif ilişki kesme, talep ve kayıt/retention akışı |

**Not:** Açık rıza, tüm kullanıcı hesabının zorunlu koşulu gibi sunulamaz. Sağlık alanları gerçekten opsiyonelse reddeden kullanıcı, mümkün olan sağlık verisi gerektirmeyen işlemlere devam edebilmelidir. Açık rıza ile KVKK aydınlatması tek kutucukta birleştirilemez.

## 3. Hedef teknik kabul kriterleri (henüz uygulanmadı)

1. Ayrı sağlık verisi rıza metni, kapsam/amaç/sürüm bilgisi ve ayrı seçim: kayıt ekranındaki mevcut iki kutucukla karıştırma. Amaçların bağımsız olması gerektiğinde ayrı tercihler.
2. Sunucu saatli, kullanıcı/purpose/metin-sürümü/durum bazlı ve değişiklik geçmişini koruyan kayıt. Yalnız `kvkk_accepted_at` kullanma.
3. Sağlık verisi yazan **tüm** yolları tarama: `client_profiles` UPDATE, `measurements`, `daily_logs`, medikal join tabloları ve ilgili RPC'ler. Eski mobil istemcinin doğrudan PostgREST yazma yolunu atlaması mümkün olmayacak. RLS / güvenli RPC / trigger tasarımı, doğru yetki testi ve aşamalı rollout ile hazırlanmalı.
4. Rıza yoksa sağlık alanları kaydedilmeyecek; ekranda sahte başarı gösterilmeyecek. Genel hesap alanları gereksiz yere bloke edilmeyecek.
5. Geri alma sonrası yeni kaydın/erişimin durması, önceki kayıtların kanunî saklama gerekçesi veya silme süreciyle yönetilmesi. Veri işleme geçmişinin silinmesi ile rıza işlem kaydının saklanması ayrı değerlendirilecek.
6. Yetkisiz/pending/rejected/removed diyetisyen erişimleri negatif RLS testlerinden geçecek; eski sürüm, offline, yarış koşulu ve ilişki sonlandırma testleri kapsanacak.
7. Teknik uygulama **iki ayrı PR**: önce backend schema/güvenlik/izole test, ardından mobil UX. Production migration ve store deploy ayrı onay gerektirir.

## 4. Yurt dışı aktarım (KVKK m.9) — halen açık, yayın engeli

- Frankfurt'ta veritabanı tutmak, Türkiye açısından **yurt dışına aktarım** değerlendirmesini kaldırmaz.
- Supabase 06.10.2026 tarihli veri konumu SSS'inde DB/Auth/Storage'ın seçilen bölgede olduğunu; destek erişimi, işletim/log ve global CDN nedeniyle başka bölgelerde sınırlı işlemenin mümkün olduğunu belirtir.
- Supabase 01.08.2026 DPA'sı **AB Komisyonu SCC** içerir. Bu, Kurulca yayımlanmış **Türk KVKK standart sözleşmesinin** kendiliğinden imzalandığı veya Kuruma bildirildiği anlamına gelmez.
- Kurumun yeterlilik sayfasında yeterli koruma için henüz ülke belirlemesi bulunmadığı belirtilir. Sürekli aktarımda `arızi aktarım` istisnasına dayalı genel rıza, varsayılan çözüm olarak kullanılmaz.
- Uygun güvence yöntemi belirlendiğinde Türk standart sözleşmesi kullanılıyorsa doğru modül (çoğunlukla platform veri sorumlusu → altyapı veri işleyen = tip 2; diğer faaliyetlerde farklı olabilir), imza, temsil yetkisi, ekler ve **imzadan itibaren 5 iş günü bildirimi** kontrol edilmeli.
- Öncelikli ihtiyaç: Supabase hukuk ekibinden **Türkiye KVKK m.9 için Kurul standart sözleşmesini kabul edip etmeyeceğini** ve taraf/alt işleyen bilgisini yazılı teyit etmek.
- **Diğer sağlayıcılar ayrı envanter:** Mobil push (APNs/FCM), e-posta/SMTP, Supabase Edge, Storage CDN, web barındırma ve tarif importunda OpenAI yalnız gerçekten bu veri türünü görüyorsa kapsama alınacak. Tarif importunun tüm sağlık profillerini OpenAI'a ilettiği varsayılmamalı.
- Supabase ile uygun mekanizma kurulamıyorsa Türkiye'de barındırma gibi mimari alternatifler ve maliyet ayrı değerlendirilir. İnceleme tamamlanmadan `KVKK tam uyumlu` denmez.

**Sağlayıcıya sorulacak tek ana soru (gönderilmedi):**
“Türkiye'den DietBridge uygulamasının kullanıcı kişisel verilerini Supabase üzerinde sürekli saklaması için 6698 sayılı Kanun m.9'a uygun, Türk KVKK Kurulunun yayımladığı standart sözleşmenin veri sorumlusundan veri işleyene aktarım tipini yetkili imzacıyla imzalayabiliyor musunuz? İlgili aktarım tarafı, imza/tüzel kişilik bilgileri, alt işleyenler ve destek/CDN veri konumları için doğru muhatap kimdir?”

## 5. Şimdiki durum / kesin yayın kapısı

**Tamamlandı:** Bağımsız kayıt gerçek akışı belirlendi; bağlantı/mesleki sorumluluk ayrımı belgelenmiş; mobil ve web aydınlatma iyileştirmeleri main'e alındı; temel üretim şema ve bölge metadata'sı okundu.

**Açık:** m.6 nihai dayanak + rıza metni/geri alma, tüm yazma yollarında server enforcement, m.9 sağlayıcı imzaları ve mekanizma, gerçek kullanıcıya yönelik KVKK ve gizlilik metninin işletmeci bilgisi, yaş/retention, uçtan uca negatif testler. Bunlar tamamlanmadan gerçek sağlık verili prod lansman hukukî olarak onaylı sayılmayacak.

## Resmî / sağlayıcı kaynakları

- KVKK m.6 2024 değişikliği: https://kvkk.gov.tr/SharedFolderServer/CMSFiles/4eba766b-7425-4cd4-97f5-cb09c4cf4ef9.pdf
- KVKK 2026/347 açık rıza ve aydınlatma ayrımı: https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu
- KVKK m.9 / yeterlilik ve arızi haller: https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim
- KVKK standart sözleşme tipleri: https://www.kvkk.gov.tr/Icerik/7929/Standart-Sozlesmeler
- KVKK standart sözleşme imza usulü: https://www.kvkk.gov.tr/Icerik/8170/Yurt-Disina-Kisisel-Veri-Aktariminda-Kullanilacak-Standart-Sozlesmelerde-Dikkat-Edilmesi-Gereken-Hususlara-Iliskin-Kamuoyu-Duyurusu
- Supabase DPA: https://supabase.com/legal/customer-resources/data-processing-addendum
- Supabase data residency FAQ: https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq
