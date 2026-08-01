# Aşama 6 — Görselli Mesajlaşma Production Kapanış Raporu

## 1. Kapsam

Bu belge, DietBridge Aşama 6’nın private görsel mesajlaşma rollout’unu ve kapanış kanıtlarını kaydeder. Kapanış işi yalnız dokümantasyondur; web/mobil runtime, Supabase, Storage, migration, Edge Function, grant, secret ve scheduler üzerinde bu görevde değişiklik yapılmamıştır.

## 2. Production mimarisi

Production proje adı `dietbridge_Production`, project ref maskeli olarak `kagv…cuxz` biçimindedir. Görsel akış; authenticated istemcinin upload intent oluşturması, JPEG doğrulaması, finalize/abort RPC’leri ve private `chat-images` Storage nesnesi üzerinden çalışır. Canonical görsel formatı JPEG, maksimum boyut 4 MiB’dir.

## 3. Migration ve Storage durumu

Görsel mesaj backend migration’ları Production’da uygulanmış ve aktivasyon commit’i `e0530010a5048e3d66817aea65cc2f82701f1d78` ile kayıtlıdır. `chat-images` bucket private’tır; Storage policy’leri yalnız pending intent ve canlı attachment koşullarını kabul eder. Doğrudan authenticated/anon tablo DML’i ve public erişim yoktur.

## 4. Edge Function durumu

- `validate-chat-image`: ACTIVE, JWT açık; canonical JPEG, boyut ve decode sözleşmesini doğrular.
- `cleanup-chat-images`: ACTIVE, JWT kapalı; scheduler’ın custom secret doğrulamasıyla yalnız internal cleanup çağrısı kabul edilir.

Function’lar service-role kontrollü RPC yüzeyini kullanır; kullanıcı istemcisine secret veya signed URL kaydı eklenmemiştir.

## 5. Scheduler ve cleanup

`chat-image-cleanup-every-5-minutes` scheduler’ı `*/5 * * * *` cadence ile aktiftir. Başarılı cron çalışması Production canary kapsamında doğrulanmıştır. Abort edilen veya silinen attachment’lar cleanup queue’ya alınır; service-role cleanup worker nesneyi silip queue kaydını tamamlar.

## 6. Grant ve güvenlik matrisi

| Yüzey | `authenticated` | `anon/public` | `service_role` |
|---|---|---|---|
| `create_chat_image_upload_intent` | Execute | Yok | Yok |
| `finalize_chat_image_message` | Execute | Yok | Yok |
| `abort_chat_image_upload` | Execute | Yok | Yok |
| `record_chat_image_validation` | Yok | Yok | Execute |
| Cleanup claim/complete RPC’leri | Yok | Yok | Execute |
| `chat-images` bucket | Policy ile ilişkili görsel | Yok | Internal cleanup |

Konuşma ve attachment okuması yalnız ilgili authenticated taraflara açıktır. Validator ve cleanup internal RPC’leri service-role dışına açılmamıştır.

## 7. Web düzeltmesi

Web PR [#12](https://github.com/sametkyaa/DietBridge/pull/12), kaynak commit `fc20773079a2bcd1c520973bd53167ca4012a756` üzerinden squash merge edilmiştir. Merge commit `432911d1b1e0dbf6a8508daa6584a0f7d81cdda9`’dır. `createImageBitmap()` başarısızlığında HTMLImageElement fallback, idempotent object URL cleanup ve ayrı canvas encode hata kodu düzeltildi.

## 8. Mobil düzeltmesi

Mobil PR [#7](https://github.com/sametkyaa/DietBridge-Mobile/pull/7), kaynak commit `de1bfd5a3285375003f67ee1b0fc23d829375492` üzerinden squash merge edilmiştir. Merge commit `26664ba226d96289b57a7f9f24a5b193f677fca1`’dır. Image picker dönüşündeki AppState refresh sırasında aktif sohbet subtree’sinin unmount olup draft state’i silmesi engellendi.

## 9. Manuel E2E sonuçları

Kullanıcı tarafından gerçek cihaz ve tarayıcıda doğrulanan sonuçlar: web → mobil ve mobil → web görsel seçimi, preview, caption, realtime görünürlük, görsel açma ve tekil mesaj oluşturma PASS’tir. Web yenileme ve mobil uygulama restart sonrasında persistence PASS’tir. Metin mesajlaşması ve duplicate mesaj regresyonları PASS’tir.

## 10. Kalıcılık ve duplicate kontrolleri

İki yönlü görsel mesajlar web yenilemesi ve mobil uygulamanın tamamen kapatılıp açılması sonrasında korunmuştur. Her doğrulama akışında mesaj yalnız bir kez oluşturulmuş, reconnect/realtime görünürlüğü korunmuştur.

## 11. Test sonuçları

- Production canary: PASS; validator, cleanup ve beş dakikalık cron çalışması doğrulandı.
- Manuel web ↔ mobil E2E: PASS.
- Realtime, restart persistence, text-message regression ve duplicate kontrolü: PASS.
- Dokümantasyon değişikliği sonrası `git diff --check`, secret-benzeri değer taraması, Markdown başlık/link kontrolü ve final status çalıştırılmıştır.
- Kod ve migration değişmediği için full test suite yeniden çalıştırılmamıştır.

## 12. Bilinen non-blocking advisor bulguları

Aşama 6 kapanışında görsel mesajlaşma için block edici advisor bulgusu yoktur. Önceki aşamalardan kalan avatar signed URL TTL/CDN cache davranışı ve meal-photo cleanup worker ihtiyacı bu raporun kapsamı dışındaki non-blocking P2 kayıtlarıdır; Aşama 6 kararını engellemez.

## 13. Rollback prosedürü

1. Web ve mobil feature flag kapatılır.
2. Authenticated execute şu RPC’lerden revoke edilir: `create_chat_image_upload_intent`, `finalize_chat_image_message`, `abort_chat_image_upload`.
3. Validator, cleanup, scheduler, bucket ve migration history yerinde bırakılır.
4. Başarılı migration’lar repair veya destructive rollback ile geri alınmaz.

Bu sıra secret, token, kullanıcı verisi veya signed URL içermez.

## 14. Merge ve commit referansları

- Backend aktivasyon: `e0530010a5048e3d66817aea65cc2f82701f1d78`.
- Web PR #12: `fc20773079a2bcd1c520973bd53167ca4012a756` → `432911d1b1e0dbf6a8508daa6584a0f7d81cdda9`.
- Mobil PR #7: `de1bfd5a3285375003f67ee1b0fc23d829375492` → `26664ba226d96289b57a7f9f24a5b193f677fca1`.
- Güncel backend `origin/main`: `432911d1b1e0dbf6a8508daa6584a0f7d81cdda9`.
- Güncel mobil `origin/main`: `26664ba226d96289b57a7f9f24a5b193f677fca1`.

## 15. Final karar

`PHASE_6_COMPLETE`
