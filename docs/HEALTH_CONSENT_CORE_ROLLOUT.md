# Sağlık verisi rızası — çekirdek teknik hazırlık

**11.10.2026 · Taslak · Varsayılan kapalı.** Canlı migration veya mağaza gönderimi yapılmadı. PR #65'teki hukukî modelin teknik ilk parçasıdır; hukukî uygunluk onayı değildir.

- Saklama/kişisel takip ve aktif diyetisyene sunma ayrı tercihlerdir. Kullanım Koşulları ve KVKK bilgilendirme zamanları rıza sayılmaz; mevcut kullanıcılara otomatik rıza verilmez.
- Sunucu, kullanıcı kimliğini oturumdan; metin sürümünü, kapsamını ve zamanı kendi kayıtlarından alır. Olay kayıtları istemci tarafından değiştirilemez. Tercih değişiklikleri ayrı olaydır. Hesap silinince bu kayıtlar da mevcut hesap silme sözleşmesi uyarınca kaldırılır.
- Kullanıcının talebi geldiğinde rıza güncellenebilir; ayrıca bir geri alma ekranı/butonu eklenmez. Profildeki mevcut tercih bileşeninden de seçim güncellenebilir. Hesap silme aynı işlem değildir.
- Açık rızanın geri alınması gelecekte rızaya dayalı işlemleri durdurur. Eski kayıtların saklanması/silinmesi ayrı dayanak incelemesidir; bu PR otomatik silme veya saklamaya yeni dayanak oluşturmaz.

## Bu PR'ın teknik sınırı

`client_profiles`, `client_medical_conditions`, `client_medications`, `measurements`, `body_measurements`, `daily_logs` için INSERT/UPDATE trigger'ları hazırdır. JWT taşıyan SECURITY DEFINER yazıcılar da trigger'dan geçer. Boş auth profil oluşturma ve DELETE akışları korunur. Mevcut rol/sahiplik/aktif ilişki kontrolleri devam eder; rıza erişim yetkisi vermez. Bu tabloların diyetisyen SELECT yollarına ilave RESTRICTIVE paylaşım kontrolü eklenir. Kullanıcı kendi kayıtlarına erişebilir.

**Öğün genişletmesi:** `meal_plans`, `meals`, `meal_change_requests`, `client_nutrition_targets` INSERT/UPDATE ve diyetisyen SELECT yolları da korunur. Kişisel `meal-completion-photos` Storage SELECT/INSERT/UPDATE yollarına ilave RESTRICTIVE kontroller eklenir; mevcut sahiplik/RLS yetkileri genişlemez. Doğrudan ve JWT taşıyan definer yazıcılar kontrol edilir. Sağlık kaydının danışanı değiştirilemez. DELETE ve kişinin kendi eski kayıtlarını okuması korunur.

**Tüm sağlık verisi yolları kapatılmış sayılmaz:** chat/ekler, bildirimler, paylaşılan plan/tarif görselleri, SECURITY DEFINER okuma ve idempotent tekrar yanıtları, servis rolü işleri ve önceden üretilmiş signed URL/cache içeriği ayrıca tamamlanmalı. Bu çekirdek korumayı tek başına etkinleştirmek tam rıza koruması sağlamaz.

## Etkinleştirme öncesi yalnız gerekli kapılar

1. Gerçek veri sorumlusu kimliği ve başvuru kanalı; işleme şartları, aydınlatma/rıza metni ve sürümler. SQL'deki `*-draft` metinler kamuya sunulmaz.
2. Supabase ve gerçek teknik sağlayıcılar için KVKK m.9 aktarım mekanizması.
3. Yukarıdaki kalan sağlık veri yolları, gerçek migration zinciri/PostgREST/RPC/Storage ve fiziksel cihaz testleri; uyumlu mobil sürüm. Backend etkin olduğunda eski mobil sürümler korunan sağlık yazmalarında hata alır.

Bu kapılar ve canlı uygulama onayı olmadan `private.health_consent_settings.enabled` false kalır. Mobil `EXPO_PUBLIC_ENABLE_HEALTH_CONSENT=false` kalır. Mobil flag güvenlik sınırı değildir; backend kendi ayarını bağımsız uygular. Sağlık bilgisi girmeden hesap kullanımına devam edilebilir.

## Doğrulama

Yerel çekirdek ve öğün SQL harness'i gerçek migration'ı minimal, izole PostgreSQL uyumlu fixture üzerinde çalıştırır. Rıza yok/var, doğrudan yazma, definer yazma, aktif/yabancı diyetisyen, değişen metin sürümü, negatif tercih ve silme senaryolarını sınar. Tam Supabase migration replay'i veya gerçek HTTP testinin yerine geçmez. CI'da aynı harness `postgres:17-alpine` üzerinde ağ ve port açmadan çalışır:

`node scripts/runDisposableHealthConsentCore.mjs`

Migration kaldırılarak geri dönülmez; sorun varsa onaylı bir düzeltme migration'ı ve etkinleştirme kapısının kontrolü gerekir. Etkinleşmiş ortamda korumayı kapatmak sağlık kaydını rızasız açabileceğinden olağan rollback olarak kullanılmaz.

Kaynak: https://www.kvkk.gov.tr/Icerik/2037/Acik-Riza-Alirken-Dikkat-Edilecek-Hususlar

Öğün genişletmesi yerelde PGlite ile gerçek iki migration üzerinde PASS: rızasız tamamlamaya ret, saklama/paylaşım ayrımı, yabancı diyetisyen, fotoğraf erişimi ve yanlış yol, negatif tercih sonrası engelleme, kendi geçmiş kayıtları ve silme. Bu fixture gerçek Supabase/PostgREST/Storage HTTP testi değildir. CI PostgreSQL 17 matrisini aynı dosyalarla çalıştırır.
