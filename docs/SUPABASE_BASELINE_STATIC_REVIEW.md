# DietBridge — Production Public Şema Baseline Statik İncelemesi

> [!WARNING]
> Bu baseline SQL staging veya production Supabase projesine uygulanmamıştır.

## 1. İncelemenin amacı

Production projesinin yalnızca `public` şemasına ait, veri içermeyen baseline taslağını statik olarak incelemek ve aktif migration olmayan bir taslak olarak saklamaktır.

## 2. Önceki db pull başarısızlığının özeti

Önceki `db pull` yaklaşık beş dakika sonra başarıyla tamamlanmadan sonlandı ve SQL baseline üretmedi.

## 3. Kök neden belirlenebildiyse hata kategorisi

Önceki db pull stderr çıktısı korunmadığı için kök neden kesinleştirilemedi. Hata kategorisi: Bilinmeyen.

## 4. Kullanılan fallback yöntemi

Geçici ve yalnızca production projesine linkli çalışma alanında `supabase db dump --linked --schema public` ile schema-only dump alındı.

## 5. Supabase CLI sürümü

`2.109.1`

## 6. Production referansı — maskelenmiş

`kagv…cuxz`

## 7. Dump kapsamı

Yalnızca linked production projesinin `public` şeması.

## 8. Hariç tutulan şemalar

`auth` ve `storage` şemaları kapsam dışıdır.

## 9. SQL dosya adı

`supabase/baseline_drafts/dietbridge_production_public_baseline.sql`

## 10. Dosya boyutu

57.433 bayt.

## 11. Satır sayısı

1.000 satır.

## 12. SHA-256

`68D99574628B599756CE604F670D9F3E51983EEDBFC4FB7B18D57A444E99C698`

## 13. Veri taşıma taraması

`COPY`, `INSERT`, doğrudan `UPDATE`, `DELETE` ve `TRUNCATE` veri taşıma kalıpları bulunmadı. Bir `UPDATE` ifadesi fonksiyon gövdesindeki şema mantığıydı; veri satırı taşımıyor.

## 14. Secret ve kişisel veri taraması

Token, connection string, e-posta, telefon, JWT, kullanıcı/veri satırı veya Storage nesnesi bulunmadı. `service_role` yalnızca yetki DDL ifadelerinde rol tanımlayıcısı olarak geçmektedir; secret değildir.

## 15. Public tablo sayısı

21 — Eşleşiyor.

## 16. RLS sayısı

18 — Eşleşiyor.

## 17. Policy sayısı

51 — Eşleşiyor.

## 18. Function sayısı

10 — İnceleme gerekli. Önceki production metadata sayımı 3 olarak kaydedilmişti; dump 10 fonksiyon bildiriyor. Fonksiyon gövdeleri kapalı ve 7 trigger fonksiyon referansının tamamı tanımlı fonksiyonlara bağlanıyor.

## 19. Trigger sayısı

7 — Eşleşiyor.

## 20. Index ve constraint özeti

21 açık `CREATE INDEX` ifadesi, 58 `ADD CONSTRAINT` ve 13 inline constraint bulundu. Constraint toplamı 71 ile metadata sayımına eşleşir; index sayımı dump sözdizimi ile metadata sayımının farklı kategorileştirmesi nedeniyle açıklanabilir farktır.

## 21. Production metadata karşılaştırması

| Kategori | Production metadata | Baseline SQL | Durum |
|---|---:|---:|---|
| Public tablolar | 21 | 21 | Eşleşiyor |
| RLS açık tablolar | 18 | 18 | Eşleşiyor |
| Policy'ler | 51 | 51 | Eşleşiyor |
| Function'lar | 3 | 10 | İnceleme gerekli |
| Trigger'lar | 7 | 7 | Eşleşiyor |

## 22. Açıklanabilir farklar

Index ve constraint ifadeleri dump içinde farklı SQL sözdizimi biçimlerinde temsil edildiğinden metadata sayımıyla bire bir `CREATE INDEX` karşılaştırması yapılmadı.

## 23. İnceleme gerektiren farklar

Fonksiyon sayısının metadata kaydından farklı olması, staging uygulamasından önce mevcut metadata sayım yönteminin yeniden doğrulanmasını gerektirir.

## 24. Bloklayıcı bulgular

Veri taşıma, secret/kişisel veri, eksik kritik tablo, tanımsız trigger fonksiyonu veya tanımsız policy hedef tablosu bulunmadı.

## 25. Storage/Auth kapsam sınırlaması

Baseline `auth` kullanıcı nesnelerini veya `storage` nesnelerini içermez. Policy/fonksiyonlarda bulunan `auth.uid()` benzeri yetkilendirme çağrıları schema bağımlılığıdır; auth verisi değildir.

## 26. Staging uygulama ön koşulları

Fonksiyon sayı farkı ve migration uygulama planı onaylanmalı; staging projesi ayrıca doğrulanmalı ve açık kullanıcı onayı alınmalıdır.

## 27. Sonraki önerilen adım

Baseline'ı uygulamadan önce fonksiyon metadata sayımını doğrulayın ve staging için ayrı, onaylı migration planı hazırlayın.

## 28. Sonuç

Baseline, yalnızca draft klasöründe saklanan statik inceleme paketi olarak incelemeye hazırdır; staging veya production ortamına uygulanmamıştır.

## Function envanteri ve uzlaştırma güncellemesi (2026-07-13)

Production `pg_catalog` metadata'sı ile baseline karşılaştırması tamamlandı: baseline'daki 10 public function'ın tamamı production'da aynı isim ve signature ile bulunuyor. Bunların 7'si trigger function, 3'ü non-trigger function'dır. Önceki `3 public function` sayısı, trigger function'ları dışarıda bırakan non-trigger auth-helper/RPC alt kümesini temsil eder. Sonuç: **Uzlaştırıldı**.

| Function | Signature | Tür | Security | Search path | Doğrudan çağrı | Veri değiştirme davranışı | Durum |
|---|---|---|---|---|---|---|---|
| `current_user_role` | `() → user_role` | Auth/rol helper | SECURITY DEFINER | `public` | Web kodunda yok; anon/authenticated RPC yüzeyi açık | Yok | Eşleşiyor |
| `handle_new_user` | `() → trigger` | Trigger function | SECURITY DEFINER | `public, pg_temp` | Hayır | Yalnızca auth trigger yolunda profil kayıtlarını oluşturur/günceller | Eşleşiyor |
| `is_current_user_dietitian` | `() → boolean` | Auth/rol helper | SECURITY DEFINER | `public` | Web kodunda yok; anon/authenticated RPC yüzeyi açık | Yok | Eşleşiyor |
| `protect_client_profile_system_fields` | `() → trigger` | Trigger function | SECURITY INVOKER | `public` | Hayır | Yok | Eşleşiyor |
| `protect_profile_system_fields` | `() → trigger` | Trigger function | SECURITY INVOKER | `public` | Hayır | Yok | Eşleşiyor |
| `save_my_current_weight` | `(numeric) → jsonb` | Uygulama RPC | SECURITY DEFINER | `public, pg_temp` | Web kodunda yok; authenticated RPC yüzeyi açık | Yalnızca çağrıldığında `client_profiles` ve `measurements` günceller | Eşleşiyor |
| `set_client_profiles_updated_at` | `() → trigger` | Updated-at helper | SECURITY INVOKER | `public` | Hayır | Trigger yolunda updated-at alanını değiştirir | Eşleşiyor |
| `set_profiles_updated_at` | `() → trigger` | Updated-at helper | SECURITY INVOKER | `public` | Hayır | Trigger yolunda updated-at alanını değiştirir | Eşleşiyor |
| `set_updated_at` | `() → trigger` | Updated-at helper | SECURITY INVOKER | Tanımlı değil | Hayır | Trigger yolunda updated-at alanını değiştirir | Hardening riski kayıtlı |
| `sync_client_weight_to_measurements` | `() → trigger` | Veri senkronizasyon helper | SECURITY DEFINER | `public` | Hayır | Yalnızca trigger çağrıldığında `measurements` senkronizasyonu yapar | Eşleşiyor |

### Trigger function'ları

Production metadata'sındaki 7 trigger, baseline'daki aynı 7 function'a bağlıdır. Trigger referanslarının tamamının hedef function'ı baseline ve production metadata'sında mevcuttur.

### SECURITY DEFINER, search path ve execute yüzeyi

Beş SECURITY DEFINER function eşleşir ve her birinin sabit search path tanımı vardır. `current_user_role`, `is_current_user_dietitian` ve `sync_client_weight_to_measurements` anon/authenticated execute yüzeyine; `save_my_current_weight` authenticated execute yüzeyine sahiptir. Trigger function'ların doğrudan RPC olarak kullanılmaması gerekir. `set_updated_at` için function-specific search path tanımlı değildir; bu, önceki advisor hardening riskidir ve bu görevde değiştirilmemiştir.

### Function gövdesi ve top-level veri taşıma kontrolü

Tek doğrudan `UPDATE`, `save_my_current_weight` function gövdesindedir ve yalnızca function çağrıldığında çalışır. Trigger helper'lar da yalnızca bağlı trigger olaylarında veri değiştirir. Function gövdeleri dışındaki top-level SQL'de kullanıcı verisi değiştiren `INSERT`, `UPDATE`, `DELETE` veya `TRUNCATE` bulunmadı; baseline uygulandığında otomatik veri düzeltmesi çalışmaz.

### Staging öncesi kalan function riskleri

Function envanteri farkı bloklayıcı değildir. `set_updated_at` search-path hardening riski ve SECURITY DEFINER execute allowlist/negatif test gereksinimi, staging uygulamasından önceki ayrı güvenlik değerlendirmesinde ele alınmalıdır. Baseline staging veya production'a uygulanmamıştır.

### Git whitespace değerlendirmesi

Git whitespace değerlendirmesi: Kaynak dump sonundaki boş satır dosya bütünlüğünün parçası olduğundan kaldırılmadı. Dosyaya özel `.gitattributes` kuralıyla yalnızca `blank-at-eof` kontrolü kapatıldı. Baseline SHA-256 değeri değişmedi.

Git index bütünlüğü: İlk stage denemesinde Git, CRLF satır sonlarını LF'ye normalize ettiği için index blob'u ham dump ile byte-eşit değildi. Yalnızca baseline dosyasına `-text whitespace=-blank-at-eof,cr-at-eol` attribute'u uygulanarak EOL normalizasyonu kapatıldı; CRLF satır sonundaki CR karakterinin trailing whitespace sayılması engellendi. Working tree ve staged Git blob içeriklerinin nesne kimlikleri karşılaştırılarak byte eşitliği doğrulandı.

### Function uzlaştırması doğrulama özeti

- Baseline public function sayısı: 10.
- Production metadata public function sayısı: 10; bütün signature'lar eşleşiyor.
- Trigger function sayısı: 7; önceki 3 sayısı non-trigger helper/RPC alt kümesini temsil eder.
- `save_my_current_weight` içindeki `UPDATE` yalnızca function çağrıldığında çalışır.
- Top-level veri değiştiren SQL bulunmuyor.
- `set_updated_at` sabit search path riski ve SECURITY DEFINER execute yüzeyi staging negatif testlerini bekliyor.
