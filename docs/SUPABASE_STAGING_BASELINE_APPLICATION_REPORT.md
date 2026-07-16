# DietBridge — Staging Public Şema Baseline Uygulama Raporu

> [!IMPORTANT]
> Bu rapordaki baseline yalnızca ayrı DietBridge staging Supabase projesine uygulanmıştır. Production projesi değiştirilmemiştir.

## 1. İşlemin amacı

Production `public` şemasının verisiz baseline taslağını, ayrı staging projesine kontrollü olarak uygulamak ve metadata eşitliğini doğrulamaktır.

## 2. Uygulama tarihi

2026-07-13.

## 3. Production proje referansı — maskelenmiş

`kagv…cuxz`

## 4. Staging proje referansı — maskelenmiş

`ezwq…rjkv`

## 5. Ortam ayrımı doğrulaması

Referanslar ve istemci anahtarları farklıdır. Staging proje adı `DietBridge Staging`, durumu `ACTIVE_HEALTHY` olarak doğrulandı. Geçici CLI alanı yalnız staging projesine linklendi; production linklenmedi.

## 6. Baseline dosya adı

`supabase/baseline_drafts/dietbridge_production_public_baseline.sql`

## 7. Baseline SHA-256

`68D99574628B599756CE604F670D9F3E51983EEDBFC4FB7B18D57A444E99C698` — 57.433 bayt.

## 8. Geçici çalışma alanı yaklaşımı

Repository dışında, boş ve Git repository olmayan benzersiz bir geçici Supabase CLI alanı oluşturuldu. Baseline byte-for-byte bu alandaki migration klasörüne kopyalandı; repository içindeki migration klasörü kullanılmadı.

## 9. Default privilege prelude kararı

Baseline güvenli default-table-privilege revoke ifadesini içermediği için staging-only prelude uygulandı: `20260713000000_staging_default_table_privileges.sql`. Prelude yalnız anon ve authenticated için tablo varsayılan yetkilerini revoke eder.

## 10. Dry-run sonucu

`db push --linked --dry-run` yalnız aşağıdaki migration'ları, doğru sırayla listeledi:

1. `20260713000000_staging_default_table_privileges.sql`
2. `20260713000001_production_public_baseline.sql`

Seed, role, eski repository migration'ı ve güvenlik migration taslağı listelenmedi.

## 11. Uygulanan migration listesi

Staging'e yalnız prelude ve production public baseline migration'ı uygulandı.

## 12. Staging migration history sonucu

Yerel ve uzak staging migration history'sinde `20260713000000` ve `20260713000001` bulundu; history eşleşti.

## 13. Public tablo karşılaştırması

Production baseline: 21. Staging: 21. Tablo adları eşleşti.

## 14. Kolon ve veri tipi karşılaştırması

Production ve staging kolon adı/veri tipi metadata imzaları eşleşti.

## 15. Constraint ve foreign key karşılaştırması

Her iki ortamda 71 constraint bulundu; constraint tanım imzaları eşleşti.

## 16. Index karşılaştırması

Her iki ortamda 53 index bulundu; index tanım imzaları eşleşti.

## 17. RLS karşılaştırması

Her iki ortamda 18 RLS açık public tablo bulundu; RLS durum imzaları eşleşti. `dietitian_profiles`, `appointments` ve `chat_messages` baseline'daki mevcut production durumu gereği RLS kapalı kaldı; bu görevde değiştirilmedi.

## 18. Policy karşılaştırması

Her iki ortamda 51 policy bulundu. Policy adları, hedefleri, komutları, rol adları, `USING` ve `WITH CHECK` ifadelerinin semantic imzaları eşleşti.

## 19. Function karşılaştırması

Her iki ortamda 10 public function bulundu. İmza, dönüş tipi, dil, volatility, security-definer ve config metadata imzaları eşleşti.

## 20. Trigger karşılaştırması

Her iki ortamda 7 trigger bulundu; trigger–function bağlantısı ve tanım imzaları eşleşti.

## 21. Satır sayısı kontrolü

21 DietBridge public tablosunda aggregate kontrolle toplam satır sayısı 0 bulundu. Kullanıcı veya satır ayrıntısı okunmadı.

## 22. Auth kapsam sınırı

Auth şeması baseline kapsamına alınmadı. Auth kullanıcısı oluşturulmadı veya listelenmedi.

## 23. Storage kapsam sınırı

Staging Storage bucket sayısı 0 bulundu. Bucket veya object oluşturulmadı.

## 24. Realtime kapsam sınırı

Realtime publication ayarı değiştirilmedi.

## 25. Default privilege değerlendirmesi

Prelude baseline'dan önce uygulandı. Baseline'ın açık tablo ve default privilege tanımları production ile eşleşti: anon/authenticated için 21 tabloda select erişimi ve 6 default ACL kaydı iki ortamda da aynı metadata imzasına sahiptir. Bu, mevcut production baseline durumudur; geniş yetki hardening'i sonraki güvenlik migration aşamasında ele alınacaktır.

## 26. Production değişmezlik doğrulaması

Production üzerinde link, migration, DDL, DML, Auth, Storage veya Realtime işlemi yapılmadı. Salt-okunur metadata sayıları 21 tablo, 18 RLS, 51 policy, 10 function ve 7 trigger olarak değişmeden doğrulandı.

## 27. Açıklanabilir farklar

Staging Storage bucket sayısı 0, production Storage bucket sayısı 3'tür. Storage baseline kapsamı dışındadır. İlk policy hash karşılaştırmasındaki fark rol OID'lerinden kaynaklandı; rol adlarıyla normalize edilen semantic policy imzaları eşleşti.

## 28. Bloklayıcı farklar

Bulunmadı.

## 29. Sonraki aşama ön koşulları

Staging baseline eşitliği doğrulandı. Güvenlik migration taslaklarının staging migration'larına dönüştürülmesi, execute/default-privilege hardening değerlendirmesi ve negatif RLS testleri için ayrı onay gerekir.

## 30. Sonuç

Production public şema baseline'ı yalnız ayrı staging projesine kontrollü uygulandı ve metadata eşitliği doğrulandı. Production değiştirilmedi; baseline hiçbir güvenlik migration taslağını, Auth, Storage veya Realtime değişikliğini içermedi.
