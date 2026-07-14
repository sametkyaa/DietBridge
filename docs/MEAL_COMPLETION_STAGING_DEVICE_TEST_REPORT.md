# DietBridge Mobile — Staging Meal Completion Cihaz Test Raporu

## Kapsam ve kabul ortamı

Aşama 3E-1C fiziksel Android telefon ve DietBridge Staging üzerinde tamamlandı. Production ve GROUNDLESS kullanılmadı. Bu sonuçlar kullanıcı tarafından interaktif PowerShell ve fiziksel cihazla doğrulandı; bu sonuç kaydı görevi staging/production bağlantısı veya yeni fixture oluşturma işlemi çalıştırmaz.

Mobil kod düzeltmesi: `73009da fix: rollback meal completion on RPC failure` (Aşama 3E-1C-2) — PASS.

## Fiziksel cihaz doğrulamaları

| Test | Sonuç | Kanıt |
|---|---|---|
| Network database rollback | PASS | Ağ kapalıyken own meal `is_eaten=false` kaldı; foreign meal değişmeden kaldı. |
| Mobil UI rollback | PASS | Uygulama kapanmadı ve buton yeniden “Öğünümü yedim” durumuna döndü. |
| Kontrollü Türkçe hata | PASS | “Öğün durumu güncellenemedi. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.” gösterildi; teknik fetch, Supabase veya PostgREST metni gösterilmedi. |
| Uygulama crash | PASS | Unhandled crash gözlenmedi. |
| Own-meal RPC | PASS | İnternet yeniden açıldığında hata olmadan “Geri Al” durumuna geçildi; own meal `is_eaten=true` oldu. |
| Persistence | PASS | Uygulama tamamen kapatılıp açıldıktan sonra fixture’daki tek öğün için “Bugünün bütün öğünleri tamamlandı” mesajı görüldü; own meal `is_eaten=true` kaldı. |
| Foreign meal rejection | PASS | `Foreign meal RPC: REJECTED`, `Foreign meal unchanged: YES`; exit code `10` beklenen güvenlik başarısıdır. |
| Final cleanup | PASS | Final Auth users: `0`, public rows: `0`, Storage buckets: `0`; cleanup exit code `0`. |

## Emülatör notu

Emülatörde ağ kapatma davranışı güvenilir kabul edilmedi: RPC isteği beklemede kalabildi veya UI geçici olarak “Geri Al” durumunda kaldı; veritabanı `is_eaten=false` kaldı. Kabul testi fiziksel Android telefon sonucudur.

## Cleanup olayı ve kök neden

İlk cleanup denemesi PARTIAL oldu: Auth cleanup sırasında `user_not_found` dışı bir hata ile durdu; status, 2/3 fixture Auth kullanıcısının ve 0/6 temel fixture satırının kaldığını gösterdi. Tanılama sonucunda, mobil kullanım sırasında oluşan fixture Client A kaydı `public.daily_logs.client_id` üzerinden `profiles.id`e `ON DELETE NO ACTION` bağıyla bağlıydı. Bu tek günlük log satırı Auth kullanıcısı silinmesini engelledi. `client_profiles.user_id` ilişkisi `ON DELETE CASCADE` olduğu için engelleyici değildi.

Yalnız Synthetic Client A'ya ait günlük log silindikten sonra ilgili Auth kullanıcıları güvenle temizlendi. Son cleanup script ve aggregate doğrulaması, staging’de geçici test verisi kalmadığını doğruladı.

## Kalıcı fixture cleanup düzeltmesi

- Cleanup, manifestteki fixture kullanıcı UUID’leriyle sınırlı `daily_logs.client_id` satırlarını Auth silmeden önce temizler.
- `404` yalnız `status=404`, `code=user_not_found` ve “User not found” mesajı birlikte olduğunda zaten temizlenmiş kullanıcı sayılır.
- `AuthRetryableFetchError` veya `5xx` en çok üç kez kısa artan beklemeyle denenir; son hata başarılı sayılmaz ve manifest korunur.
- `daily_logs` artık final public-row aggregate hesabına dahildir. Tablo/sorgu hatası sessizce yok sayılmaz.
- Tüm fixture satırları ve aggregate sıfır olmadıkça manifest silinmez. Manifest yokken ikinci cleanup yalnız aggregate sıfırsa idempotent PASS verir.
- Partial cleanup sonrasında foreign meal satırı yoksa status, güvenlik ihlali izlenimi vermek yerine `NOT APPLICABLE — fixture row absent` gösterir.

`daily_logs.client_id` foreign key davranışı ayrı bir şema karar/riskidir; bu görevde foreign key, migration veya policy değiştirilmedi.

## Sonuç ve blocker

Aşama 3E-1C mobil doğrulaması tamamlandı: network rollback, kontrollü hata, own-meal RPC, restart sonrası persistence, foreign-meal reddi ve final cleanup PASS’tir. Legacy client `meals` UPDATE policy’si hâlâ mevcuttur; eski mobil build uyumluluğu da henüz değerlendirilmedi. Bu nedenle production security rollout bloklu ve Aşama 3 tamamen kapanmış değildir.

Sıradaki işlem: **Aşama 3E-2 — Eski mobil build uyumluluğunu değerlendir ve legacy client `meals` UPDATE policy kaldırma planını hazırla.**
