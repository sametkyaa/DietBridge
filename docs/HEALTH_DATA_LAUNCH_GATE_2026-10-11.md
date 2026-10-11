# DietBridge — Sağlık verisi için yayın öncesi hukukî karar kapısı

## Kapsam
Danışan, bir diyetisyene bağlanmadan hesap oluşturabilir ve boy, kilo, beslenme hedefi, intolerans, hastalık ve ilaç gibi bilgileri kaydedebilir. Aktif bağlantı oluştuğunda yalnızca yetkili diyetisyen bu kayıtlara erişebilir. DietBridge altyapıyı sağlar; bağımsız klinik teşhis ya da tedavi kararı üretmez. Kayıt/saklama/gösterme KVKK açısından yine veri işlemedir.

## Bu PR'da yapılan
- Diyetisyen web kayıt ekranındaki KVKK aydınlatmasının okunduğu yönündeki kayıt, genel açık rıza gibi gösterilmez.
- Kayıt akışı, sunucuya gönderilen mevcut alanlar ve Supabase yetkileri değiştirilmez.

## Gerçek sağlık verisi alınmadan önce tamamlanacaklar
1. **İşletmeci:** Yasal veri sorumlusu kimliği ve başvuru kanalı kesinleşecek.
2. **KVKK m.6:** Bağımsız üyelikte sağlık verisinin ilk kaydı, diyetisyene gösterimi, bağlantı kesilmesi ve yedekler için faaliyet bazında hukukî dayanak belirlenecek. Açık rıza gerekiyorsa **ayrı, belirli, özgür iradeye dayalı, geri alınabilir ve sürümlü** bir akış tasarlanacak. Aydınlatma kutucuğu bunun yerine geçmez.
3. **Sunucu kontrolü:** Seçilen işleme şartını veri kaydetme/okuma uçlarında geçerli kılan backend-RLS/RPC kontrolleri tasarlanıp test edilecek. Yalnızca arayüz kutucuğu yeterli değildir.
4. **KVKK m.9:** Supabase Frankfurt, bildirim, e-posta, destek, AI ve diğer alt işleyenler için gerçek aktarım envanteri ve uygun mekanizma doğrulanacak.
5. **Metinler:** Rol dağılımı, veri kategorileri, somut saklama süreleri, hesap silme/yedek etkisi ve veri sahibinin hakları hukukçu tarafından onaylanacak. Google Play Data Safety/Health Apps ve App Store Privacy beyanları gerçek kodla eşleştirilecek.
6. **Sürüm:** Mevcut `terms_accepted_at` ve `kvkk_accepted_at` zaman damgaları ayrı sağlık rızası veya belge-sürüm delili değildir. Gerekirse yeni sürümlü kayıt tasarımı ayrıca onaylanacak.

## Güvenli sınır
Bu PR canlı metinleri, veri saklamayı, kimlik doğrulamayı, sağlık işleme hukukî dayanağını veya yurt dışı aktarımı **tamamlanmış** saymaz. Gerçek kullanıcı verisiyle prod yayını için hukukî karar ve ayrı dağıtım onayı gerekir.
