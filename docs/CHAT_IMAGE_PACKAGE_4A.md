# Aşama 6 Paket 4A — Deploy edilmemiş JPEG validator

`supabase/functions/validate-chat-image` yalnızca bekleyen bir chat image upload intent'inin gerçek JPEG içeriğini doğrular ve doğrulama metadata'sını kaydeder. Bu fonksiyon repository'de hazırlanmıştır; deploy edilmemiştir.

## HTTP sözleşmesi

Yalnız `POST` kabul edilir. İstek gövdesi tam olarak aşağıdaki şekildedir:

```json
{ "intentId": "<uuid>" }
```

Başarılı cevap canonical MIME, byte size, width, height ve validation zamanını içerir. Hata cevapları `unauthorized`, `invalid_request`, `not_found`, `intent_not_pending`, `intent_expired`, `object_not_found`, `invalid_image`, `image_too_large`, `image_dimensions_exceeded`, `validation_failed` veya `internal_error` kodlarından birini kullanır. Tüm cevaplarda `Cache-Control: no-store` vardır; ham Storage, SQL veya decoder hata metni dönmez.

## Yetkilendirme ve akış

Fonksiyon gelen Bearer JWT'yi `SUPABASE_URL` ve `SUPABASE_ANON_KEY` ile doğrular. Yalnız JWT'deki kullanıcıya ait intent kabul edilir. Ardından, `create_chat_image_upload_intent` ile aynı predicate kullanılır: intent conversation'ında çağıran dietitian veya client olmalı ve bağlı `dietitian_clients.status` değeri `active` olmalıdır.

`SUPABASE_SERVICE_ROLE_KEY` yalnız Edge runtime environment'ta kullanılır. Client'a iletilmez. Service role, exact intent bucket/path'ten object indirmek ve şu imzayla metadata kaydetmek için kullanılır:

```text
record_chat_image_validation(
  p_intent_id uuid,
  p_validated_mime text,
  p_validated_byte_size bigint,
  p_validated_width integer,
  p_validated_height integer
)
```

Fonksiyon object'i taşımaz, silmez veya message finalize etmez. `finalize_chat_image_message` istemci akışında ayrı kalır.

## JPEG ve bellek sınırları

Object konumu request'ten değil intent satırından alınır ve yalnız `pending/<lowercase-uuid>/<lowercase-uuid>.jpg` kabul edilir. Object MIME değeri `image/jpeg`, byte size en fazla 4,194,304 olmalıdır.

`jpeg-js@0.4.4`, MIME/header kontrolünden sonra gerçek full decode yapar. Header taraması yalnız decode öncesi width/height/pixel bomb sınırı için kullanılır; tek başına kabul ölçütü değildir. Sınırlar migration sözleşmesiyle aynıdır: en fazla 2,048 px kenar, en fazla 4,194,304 piksel ve en fazla 4 MiB. Decoder `maxResolutionInMP: 4.194304` ve `maxMemoryUsageInMB: 24` ile çalışır. En büyük canonical RGBA buffer 16 MiB'dir; 24 MB limiti 4 MiB input ve sınırlı decoder overhead'i için dar pay bırakır.

## Durum ve rollback

Bu Paket 4A fonksiyonu henüz deploy edilmemiştir. Historical migration'lar değiştirilmedi; authenticated image RPC grant'ları kapalı kalır. Secret, scheduler, activation migration, Edge Function deploy ve Staging/Production kontrolleri Paket 5 kapsamındadır.

Fonksiyon kodunu geri almak dormant backend sözleşmesini değiştirmez: mevcut RPC grant'ları kapalı olduğundan upload/finalize akışı aktive edilmez.
