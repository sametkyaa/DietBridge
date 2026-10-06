# Faz 2 backend — production release runbook

Bu belge Faz 2 backend migration'larının production'a **kontrollü** alınması içindir.
Bu PR hiçbir production veritabanına, Storage'a veya secret'a dokunmaz. Aşağıdaki
adımların hepsi açık kullanıcı onayı ile, ayrı bir production gate'te yapılır.

## Kapsam

| Sıra | Migration | İçerik |
| --- | --- | --- |
| 1 | `20261006090000_meal_change_request_security.sql` | Danışan yalnızca **aktif** diyetisyenine `pending` talep açabilir; doğrudan UPDATE/DELETE kapatıldı; karar yalnızca `review_meal_change_request` RPC'si ile. |
| 2 | `20261006090100_dietitian_unread_message_counts.sql` | `get_dietitian_unread_counts()` — okuma imlecinden sonraki, silinmemiş, danışan mesajları. |
| 3 | `20261006090200_client_nutrition_targets.sql` | Diyetisyene ait `client_nutrition_targets` + `set_client_nutrition_target` RPC'si. `client_profiles` değişmez. |
| 4 | `20261006090300_profile_legal_acceptance.sql` | `profiles.terms_accepted_at`, `profiles.kvkk_accepted_at`; zaman damgasını yalnızca sunucu yazar; `accept_legal_terms()`. Bayraksız kayıt (mağazadaki mobil sürüm) aynen çalışır. |
| 5 | `20261006090400_dietitian_activity_notifications.sql` | Yeni bildirim şekilleri, `private.notification_producer_flags`, iki pg_cron işi. |
| 6 | `20261006090500_meal_slot_label.sql` | `meals.slot_label` + `save_weekly_meal_plan` güncellemesi (anahtarsız payload etiketi korur). |
| 7 | `20261006090600_application_result_email_outbox.sql` | Başvuru sonucu e-posta kuyruğu + service_role RPC'leri. |
| — | Edge Function `send-application-result-emails` | Kuyruğu Resend HTTP API ile boşaltır. |

## Ön koşul: #46 production migration gate

PR #46'daki iki migration (`20261005120000_realtime_publication_core_tables.sql`,
`20261005120100_save_active_client_weight_canonical.sql`) repository zincirinde
fakat production'da **uygulanmamış** durumda. Davet/tarif migration'ları
(`20261005120859…`, `20261005124951…`, `20261005132107…`) ise production'da.
Dolayısıyla #46 migration'ları production geçmişinde "geriden gelen" (out-of-order)
sürümlerdir; `supabase db push` bunları yalnızca `--include-all` ile uygular.

Önerilen sıra:

1. #46 gate: iki migration'ı uygula, `supabase/tests/realtime_weight_contract.sql`
   eşdeğeri salt-okunur doğrulamaları çalıştır.
2. Faz 2 gate: yukarıdaki 7 migration'ı sırayla uygula.
3. Web'i deploy et (Web, yeni RPC'leri çağırır; DB önce gelmelidir).

## Uygulama öncesi kontroller (salt okunur)

```sql
-- 1. Talep tablosunda yanlış diyetisyene açılmış veya karar verilmiş kayıtlar
select status, count(*) from public.meal_change_requests group by 1;
select count(*) from public.meal_change_requests r
 where not exists (select 1 from public.dietitian_clients dc
                    where dc.client_id = r.client_id and dc.dietitian_id = r.dietitian_id);
-- 2. Yeni bildirim şekillerinin hiç olmadığını doğrula
select count(*) from public.notifications where category in ('client_activity','meal_plan') or event_type = 'reminder_30m';
-- 3. pg_cron mevcut
select extname from pg_extension where extname = 'pg_cron';
```

Migration 1, geçmişte `approved/rejected` kaydı varsa yeni tutarlılık kısıtını
`NOT VALID` bırakır (yeni yazımlar yine denetlenir); bu beklenen davranıştır.

## Uygulama sonrası doğrulama

- `supabase/tests/faz2_backend_contract.sql` dosyası **yalnızca disposable/staging**
  ortamda çalıştırılır (fixture kullanıcı oluşturur, sonunda `rollback` eder). Production'da çalıştırma.
- Production'da salt okunur kontroller:

```sql
select producer, enabled from private.notification_producer_flags order by 1;
-- client_meal_plan_updated = false olmalı
select jobname, schedule, active from cron.job
 where jobname in ('dietitian-appointment-reminders-every-5-minutes','client-meal-inactivity-hourly');
select has_function_privilege('anon','public.review_meal_change_request(uuid,text,text)','EXECUTE'); -- false
```

## Bildirim bayrakları

| Bayrak | Varsayılan | Not |
| --- | --- | --- |
| `dietitian_appointment_reminder_30m` | açık | Yalnızca diyetisyen (Web) alır. |
| `dietitian_meal_photo_completed` | açık | Yalnızca diyetisyen. |
| `dietitian_meal_inactivity` | açık | Saatlik iş; aynı ara için tek bildirim. |
| `dietitian_meal_change_requested` | açık | Talep oluşturulunca. |
| `client_meal_plan_updated` | **kapalı** | Danışana gider. `meal_plan/updated` türünü gösteren mobil sürüm mağazalarda yayında olmadan **açılmaz**. |

Hiçbir yeni tür push için uygun değildir (`private.is_push_eligible_notification` değişmedi).
Bayrak değiştirmek (onaylı production işlemi):

```sql
update private.notification_producer_flags set enabled = true, updated_at = now()
 where producer = 'client_meal_plan_updated';
```

## Başvuru sonucu e-postası — gerçek blocker

Projede bugün işlemsel e-posta sağlayıcısı yok. Kod ve kuyruk hazır; çalışması için
production'da şu secret'lar gerekir (değerler uydurulmadı, repo'ya yazılmaz):

```bash
supabase secrets set RESEND_API_KEY=<resend api key>
supabase secrets set APPLICATION_EMAIL_FROM="DietBridge <bildirim@dietbridge.com.tr>"   # doğrulanmış gönderici alan adı
supabase secrets set DIETBRIDGE_PANEL_URL=https://<web panel adresi>
supabase functions deploy send-application-result-emails
```

Secret'lar yokken fonksiyon `503 provider_not_configured` döner ve kuyruktaki
satırları **talep etmez**; admin ekranında "kuyrukta bekliyor" bilgisi gösterilir.
Kuyruk düzenli boşaltılmak istenirse service-role anahtarıyla zamanlanmış bir çağrı
(ör. pg_cron + pg_net, Vault'ta saklanan URL/anahtar) ayrıca kurulmalıdır.

## Geri dönüş

Migration'lar ileri yönlüdür. Sorun halinde:
- Bildirim üreticileri: ilgili bayrağı `false` yap; cron işlerini `cron.unschedule(...)`.
- E-posta: secret'ları kaldırmak gönderimi durdurur; kuyruk korunur.
- Talep güvenliği / hedefler / slot etiketi için geri alma, mobil uyumluluk değerlendirilmeden yapılmaz.
