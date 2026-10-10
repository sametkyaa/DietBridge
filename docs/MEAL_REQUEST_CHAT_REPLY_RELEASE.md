# Öğün değişikliği yanıtlarının sohbete iletilmesi

Amaç: Diyetisyen talebi onaylarken veya reddederken bir yanıt yazarsa danışan
bu yanıtı mevcut mobil sohbetinde normal metin mesajı olarak görür. Yeni mobil
ekran, mesaj türü veya paket gerekmez. Boş not sohbet mesajı oluşturmaz.

## Veri akışı

`MealChangeRequestReviewDialog` → `reviewMealChangeRequest` →
`review_meal_change_request` → mevcut `send_chat_message` RPC'si.

Karar, `response_note`, sohbet mesajı, konuşmanın son mesaj bilgisi ve sohbet
bildirimi aynı transaction içindedir. Hata durumunda tümü geri alınır.
Yalnızca talebin gönderildiği onaylı diyetisyen, aktif ilişki devam ederken yanıt
verebilir. Mevcut RLS ve doğrudan UPDATE/DELETE yasağı korunur.

Mesaj: başlık, plan günü (`DD.MM.YYYY`), seçilen öğünler, Onaylandı/Reddedildi
kararı ve diyetisyenin kırpılmış yanıt notu. Onay planı otomatik değiştirmez.
1000 karakter yanıt sınırı korunur; mesaj mevcut 4000 karakter sınırına uyar.

Talep UUID'si sohbetin sabit `client_message_id` anahtarıdır. Aynı karar/notla
tekrar deneme aynı sonucu döndürür; farklı karar/not reddedilir. Silinen mesaj
yeniden oluşturulmaz. Eski sonuçlandırılmış talepler için mesaj üretilmez.

## Kabul kriterleri ve kontroller

- Mobilin mevcut metin projeksiyonuyla yanıt okunur; danışan sohbetten cevap verebilir.
- Onay/red, birden fazla öğün, çok satırlı not, boş not ve bozuk eski JSON desteklenir.
- Eşzamanlı tekrarlar bir mesaj ve bir bildirim olayı oluşturur.
- Başka danışan/diyetisyen mesajı okuyamaz; mevcut rol/ilişki kontrolleri geçerlidir.
- Mesaj veya bildirim hatası talebi beklemede bırakır, yarım başarı göstermez.
- HTTP hatasında web diyaloğu notu korur; işlem sürerken kontroller kilitlenir.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- `npm run test:faz2:runtime`: yalnızca disposable yerel Supabase; SQL ve Auth/PostgREST kontrolleri.
- `npx playwright test -c playwright.features.config.ts tests/e2e/meal-request-reply.spec.ts`:
  390px ekran, gönderim payload'ı, hata/tekrar ve boş not.
- GitHub kalite kapıları: web, disposable backend ve kritik browser E2E.

## Yayın ve geri dönüş

1. Production şema, fonksiyon, ACL ve migration history preflight kontrolü.
2. Tüm kalite kapıları geçtikten sonra yalnızca bu görevin migration'ı uygulanır.
3. RPC imzası, authenticated ACL, RLS, sohbet bağlantısı ve migration history doğrulanır.
4. Test edilmiş web commit'i Vercel production'da yayınlanır; commit ve domain kontrol edilir.
5. HTTP/sayfa/asset kontrolü yapılır. Production'a test kullanıcı veya mesajı eklenmez.

Backend geri dönüşü: önceki `20261006090000_meal_change_request_security.sql`
dosyasındaki review RPC tanımı, ayrı bir forward-fix migration ile geri yüklenir.
Tablolar, kayıtlı kararlar ve gönderilmiş sohbet mesajları silinmez. Web geri
dönüşü Vercel'de önceki production deployment'a yapılabilir.

Mobil cihazda yeni bir talep ve diyetisyen yanıtıyla görünür sohbet/bildirim
kontrolü kullanıcı akışında yapılmalıdır. Cihaz push teslimi mevcut izinlere,
token kayıtlarına ve push göndericisinin durumuna bağlıdır; yalnızca sohbet
bildirimi oluşması cihaz push tesliminin doğrulandığı anlamına gelmez.
