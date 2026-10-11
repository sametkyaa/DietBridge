# DietBridge — MVP hukukî metin çekirdeği ve yayın sınırları
**Durum:** İç hazırlık taslağı · 11.10.2026 · Gerçek kullanıcılarla yayına doğrudan uygun değildir.

## 1. Sabitlenen çerçeve

- **Ad:** DietBridge, şimdilik **ürün/platform adı** olarak yazılır. Kayıtlı şirket veya başlı başına tüzel kişi olduğu ileri sürülmez. Gerçek veri sorumlusunun tam adı/ticaret unvanı ve iletişim bilgileri **yayın öncesi doldurulacak zorunlu alanlardır**.
- **Hizmet:** Bağımsız diyetisyenler ile danışanların beslenme ve takip süreçleri için dijital kayıt, düzenleme, görüntüleme ve iletişim altyapısı.
- **Sorumluluk:** Danışanın bireysel sağlık/beslenme değerlendirmesi ve kişisel planın mesleki uygunluğu diyetisyene aittir. DietBridge'in kendi veri işleme, erişim güvenliği ve yasal yükümlülükleri saklıdır.
- **Kayıt modeli:** Danışan bağımsız hesap açar, sağlık ve ölçüm bilgisi girebilir; diyetisyenle daha sonra bağlantı kurar. Yetkili erişim **aktif ilişki** ile sınırlandırılır. Sağlık verilerinin bağımsız kayıt aşamasındaki işlenmesi için platformun kendi KVKK m.6 şartı gerekir.
- **Esneklik:** Özellikler ve hizmet sunum yöntemleri teknik/ürün ihtiyaçlarına göre değişebilir; bu kayıt kullanıcının zorunlu hukukî haklarını kaldırmaz, yeni amaçla veri işlemeye otomatik izin vermez.

## 2. Kullanım Koşulları için kısa metin önerisi

> DietBridge, diyetisyenler ve danışanlar arasında beslenme planlarının yönetilmesini, takip kayıtlarının tutulmasını ve iletişimi kolaylaştıran dijital bir platformdur. Platform, kendi başına teşhis, tedavi kararı veya bağımsız klinik değerlendirme sunmaz. Diyetisyenin mesleki değerlendirmesi ve hazırladığı kişisel planlardan ilgili diyetisyen sorumludur. DietBridge'in kişisel veri güvenliği ve hukuktan doğan yükümlülükleri devam eder.
>
> DietBridge, güvenlik, hizmet kalitesi, teknolojik gelişmeler ve kullanıcı ihtiyaçları doğrultusunda hizmetin özelliklerini güncelleyebilir. Kullanıcıların yürürlükteki mevzuattan doğan hakları saklıdır.

## 3. KVKK Aydınlatma Metni — mutlaka somut olacak asgari alanlar

**Veri sorumlusu:** DietBridge platformunun işletmecisi **[gerçek kişi adı-soyadı / tüzel kişi tam ticaret unvanı]**; **[başvuru kanalı ve iletişim]**. Yalnızca “DietBridge” yazılması bu alanı tamamlamaz.

**Veri kategorileri:** Hesap ve iletişim bilgileri; danışan–diyetisyen bağlantısı; beslenme, takip, boy/kilo/ölçüm, intolerans, hastalık, ilaç ve kullanıcı/diyetisyen tarafından girilen diğer ilgili sağlık kayıtları.

**Amaçlar:** Hesap/oturum yönetimi; danışan–diyetisyen ilişkisinin kurulması ve yönetimi; beslenme planı ve takip kayıtlarının saklanması ve yetkili kişilere gösterilmesi; mesajlaşma; sistem güvenliği, destek ve yasal yükümlülükler.

**Toplama yöntemi:** Web/mobil uygulama, kullanıcı ve yetkili diyetisyen girişi, hizmetin teknik işleyişi.

**Hukukî sebepler:** Hesap ve sözleşme için ilgili KVKK m.5 işleme şartları **faaliyet bazında** yazılmalı. Özel nitelikli sağlık verileri için KVKK m.6 şartı ayrıca ve açıkça belirlenmeli; **ayrı açık rıza gerekli bulunursa m.6/3-a ile sınırlandırılmış rıza alınmalı**. Mevcut `kvkk_accepted_at`, sağlık verisi rızası değildir.

**Alıcılar ve aktarım:** Yalnızca hizmetin gerektirdiği kapsamda yetkili diyetisyen ve uygun sözleşmeli teknik hizmet sağlayıcı grupları, hangi amaçla aktarıldıkları belirtilerek yazılmalı. Gerçek yurt dışı aktarım ayrıca KVKK m.9 şartlarını karşılamalı; “tüm iş ortakları / her türlü amaç” gibi belirsiz hükümler kullanılmamalı.

**Haklar:** KVKK m.11 kapsamındaki haklar ve başvurunun yapılacağı gerçek iletişim kanalı açıklanmalı.

## 4. Sağlık verisi açık rızası — gerekirse ayrı işlem

Aydınlatma ile rıza farklı metin/tercih olmalı. Onboarding ve profil ekranlarında **sağlık bilgilerini ilk kaydetmeden önce** uygun m.6 şartı doğrulanmalı. Açık rızaya dayanılırsa kullanıcıya anlaşılır amaç ve erişim kapsamı gösterilmeli; seçimi başlangıçta boş olmalı, tarih/sürüm/amaç bazında sunucuda kaydedilmeli ve geri alma yolu bulunmalı. Diyetisyene veri açma için bağlantı onayında ayrıca gerekli hukukî işlem yapılmalı. Sadece UI kutusu, API/RLS kontrolünün yerine geçmez. Sağlık verisi paylaşılmadan sunulabilen hesap işlevleri sebepsiz yere engellenmemeli.

## 5. Açık kalan **üç** yayın kapısı

1. **Hukukî kimlik ve metin:** İşletmecinin resmî kimliği/başvuru kanalı, gerçek veri amaçları, alıcıları, m.5/m.6 şartları ve gerekli aydınlatma/rıza metni hukukî olarak kesinleştirilecek.
2. **Altyapı aktarımı:** Üretim Supabase bölgesi **Frankfurt (eu-central-1)**. Supabase'in AB SCC içeren DPA'sı tek başına Türk KVKK m.9 güvencesi kabul edilmeyecek. Supabase ve gerçek alt işleyenler için uygun yurt dışı aktarım mekanizması teyit edilecek; gerektiğinde Türk standart sözleşmesi ve 5 iş günü bildirim yükümlülüğü uygulanacak.
3. **Teknik uygulama ve test:** Rıza gerekiyorsa eski mobil istemci dahil sağlık verisi yazan tüm PostgREST/RPC yollarında sunucu tarafı koruma, sürümlü kayıt/geri alma ve ilişkisi olmayan diyetisyene erişimi reddeden negatif testler tamamlanacak; prod migration ve mağaza sürümü ayrıca onaylanacak.

**Mevcut doğrulama:** Supabase'te yalnız şema/politika metadata'sı okundu; `client_profiles`, `client_medical_conditions`, `client_medications`, `measurements` için RESTRICTIVE rol kontrolü ve aktif ilişkiye bağlı diyetisyen SELECT politikaları görüldü. Gerçek kullanıcıyla izolasyon testi yapılmadı. `profiles.terms_accepted_at` / `kvkk_accepted_at` sütunları mevcut; özel sağlık rızası/sürüm kaydı değildir. Canlı DB, veri, kullanıcı veya mağaza dağıtımı bu hazırlıkta değiştirilmedi.

## Kısa kaynak listesi
- KVKK aydınlatma asgari içerik: https://www.kvkk.gov.tr/Icerik/2033/Aydinlatma-Yukumlulugu-
- KVKK 2026/347 (aydınlatma–rıza ayrımı): https://www.kvkk.gov.tr/Icerik/8710/veri-sorumlulari-tarafindan-acik-riza-ve-aydinlatma-metinlerinin-ayri-ayri-duzenlenmesi-gerektigi-hakkinda-kisisel-verileri-koruma-kurulunun-18-02-2026-tarihli-ve-2026-347-sayili-ilke-kararina-iliskin-kamuoyu-duyurusu
- KVKK m.9 / standart sözleşme: https://www.kvkk.gov.tr/Icerik/8043/Standart-Sozlesme-Bildirim-Modulu-Hakkinda-Kamuoyu-Duyurusu
- Supabase DPA: https://supabase.com/legal/customer-resources/data-processing-addendum
