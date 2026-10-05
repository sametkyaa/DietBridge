# Invite + recipe import — production migration history reconciliation

2026-10-05, Europe/Istanbul. Salt okunur inceleme; production'da hiçbir yazma, history repair, migration, Storage, Edge, secret, Vault, cron veya flag değişikliği yapılmadı.

## Sonuç

Production `kagvxhyvxxypspdxcuxz` / `dietbridge_Production` (eu-central-1, ACTIVE_HEALTHY, PostgreSQL 17.6.1.052) history'si 58 versiyon içeriyor; repo 62 migration içeriyor. Remote-only versiyon yok. Repo-only dört versiyonun biri tarihsel, üçü bu yayının yeni migration'ları.

Önceki "remote 58 / repo 59 tarihsel" ifadesinin exact karşılığı **`20260817120000_push_registry_outbox_backend.sql`**. Bu versiyonun history kaydı yok ve oluşturacağı objelerin hiçbiri production'da yok: `private.push_installations`, `private.push_occurrences`, `private.push_deliveries`, beş fonksiyon (`is_push_eligible_notification`, `capture_push_occurrence`, `guard_push_delivery_status_transition`, `register_push_installation`, `revoke_push_installation`), `public.notifications` üzerindeki `trg_capture_push_occurrence` ve delivery transition trigger'ı. `push` içeren başka tablo/fonksiyon da yok; `public.notifications` üzerinde hiç trigger yok. Kısmi uygulama izi bulunmadı.

**Karar: D — NO ACTION (bu yayın için).** Şema eksik olduğundan history adoption yanlış olur (A elendi). Migration'ın kendi preflight'ı obje varsa durur ve production önkoşulları (`public.notifications`, `public.profiles`, `auth.users`) mevcut, yani dosya teknik olarak uygulanabilir (B mümkün) ama uygulanması `public.notifications` üzerine her bildirimde outbox satırı üreten bir trigger ekler ve bunları tüketecek worker henüz yok. Bu, davet/import'un önkoşulu değil ve repo belgeleri (`MVP_EXECUTION_STATE.md`, `MVP13_ADMIN_MIGRATION_ROLLOUT.md`, `MVP13_LAUNCH_CHECKLIST.md`) onu Push 6C.2+ ile bilinçli ertelenmiş olarak kayıt altına alıyor. Push başlatıldığında ayrı görevde B olarak, kendi preflight/backup/onayıyla uygulanır. Forward-fix gerekmiyor (C elendi); durum kesin olarak belirlendiği için BLOCKED değil (E elendi).

Şema doğrulamasında ikinci bir sapma bulundu: **`20260713010300_critical_table_rls`** history'de var ama oluşturduğu `public.protect_dietitian_profile_system_fields()` ve `trg_protect_dietitian_profile_system_fields` production'da yok. Önceki onaylı `production_pre_policy_removal_reconciliation.sql` paketi bu fonksiyonu oluşturmadı; doğrulama alanı korumasını `20260713010100` ile gelen `trg_sync_dietitian_verification_fields` (BEFORE INSERT/UPDATE, enabled) üstlendi. Production gövdesi kullanıcının kendi satırında `verification_status`, `is_verified`, `verified_at`, `rejection_reason` atamasını/değişimini 42501 ile reddediyor; `user_id` değişimini ise "Dietitians can update own non-system profile fields" policy'sinin `WITH CHECK (user_id = auth.uid())` koşulu engelliyor. Sınıf `HISTORY_PRESENT_BUT_SCHEMA_DRIFT`, karar **D — NO ACTION**: işlevsel koruma eşdeğer, davet ve import onay kapısı (`verification_status='approved' and is_verified`) bu korumaya güveniyor ve preflight check 06 bunu doğruluyor. Orijinal migration yeniden çalıştırılamaz (policy varlığında fail-fast). İsteğe bağlı sonraki hardening: `authenticated` rolünün `dietitian_profiles` sistem kolonlarındaki UPDATE kolon grant'lerinin daraltılması ayrı forward-fix görevidir; bu yayının engeli değildir.

## Yöntem

Her migration dosyasından sırayla `create`/`drop` edilen tablo, view, fonksiyon, index, trigger ve policy isimleri çıkarıldı; sonraki dosyalarda drop edilenler düşüldü ve kalan 350 beklenen obje production kataloğunda tek bir read-only sorguyla arandı. Bu isim ve varlık düzeyinde bir karşılaştırmadır; fonksiyon gövdeleri, kolon tipleri ve ACL'ler bütün zincir için yeniden karşılaştırılmadı. Gövde/kolon/ACL düzeyindeki kanıt, davet ve import'un dokunduğu alanlar için `supabase/preflight/invite_recipe_preflight.sql` (20 check) ile, eski çekirdek versiyonlar için ise `PRODUCTION_MIGRATION_HISTORY_RECONCILIATION_PLAN.md` ve `PRODUCTION_PRE_POLICY_RECONCILIATION_PACKAGE_REPORT.md` kanıtıyla sağlanıyor. İlk taramada baseline index'leri şema önekli isimle arandığı için eksik görünmüştü; doğrudan `public` şemasında arama hepsinin mevcut olduğunu gösterdi.

Remote history'deki iki ad farkı (`20260725133956` → `20260725160000_client_relationship_security_contract_forward_fix` adı ve `20260817084531` → `20260816194431_appointment_reminders_backend` adı) versiyon numarasında birebir eşleşir; repo dosyaları remote versiyonlarıyla adlandırılmış. Bunlar `MATCH`'tir.

## Versiyon matrisi

"Schema" sütunu, o versiyona atfedilen isimli objelerden production'da bulunanların sayısıdır.

| Version | Local migration | Remote history | Schema | Classification | Not |
|---|---|---|---|---|---|
| `20260713000000` | `20260713000000_staging_default_table_privileges.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260713000001` | `20260713000001_production_public_baseline.sql` | YES | 104/104 | `MATCH` |  |
| `20260713010000` | `20260713010000_function_security_hardening.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260713010100` | `20260713010100_verification_consistency.sql` | YES | 2/2 | `MATCH` |  |
| `20260713010200` | `20260713010200_auth_onboarding_hardening.sql` | YES | 1/1 | `MATCH` |  |
| `20260713010300` | `20260713010300_critical_table_rls.sql` | YES | 9/11 | `HISTORY_PRESENT_BUT_SCHEMA_DRIFT` | `protect_dietitian_profile_system_fields` + trigger yok; aynı koruma `trg_sync_dietitian_verification_fields` ve own-row UPDATE WITH CHECK ile sağlanıyor (önceki onaylı reconciliation). Karar: NO_ACTION. |
| `20260713010400` | `20260713010400_meal_completion_rpc.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260713010500` | `20260713010500_ensure_auth_user_onboarding_trigger.sql` | YES | 1/1 | `MATCH` |  |
| `20260714010000` | `20260714010000_remove_legacy_client_meals_update_policy.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260722131259` | `20260722131259_expand_measurement_side_columns.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260723093230` | `20260723093230_sync_dietitian_display_name.sql` | YES | 1/1 | `MATCH` |  |
| `20260723093510` | `20260723093510_revoke_anon_dietitian_display_name_execute.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260723164416` | `20260723164416_create_dietitian_recipes.sql` | YES | 11/11 | `MATCH` |  |
| `20260723180039` | `20260723180039_production_compatible_weekly_meal_plan_rpc.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260724063211` | `20260724063211_persist_recipe_meal_snapshots.sql` | YES | 1/1 | `MATCH` |  |
| `20260724071352` | `20260724071352_allow_clients_read_planned_recipe_images.sql` | YES | 1/1 | `MATCH` |  |
| `20260725125627` | `20260725125627_allow_dietitians_view_active_client_avatars.sql` | YES | 1/1 | `MATCH` |  |
| `20260725133956` | `20260725133956_20260725160000_client_relationship_security_contract_forward_fix.sql` | YES | 3/3 | `MATCH` |  |
| `20260726090000` | `20260726090000_chat_conversation_schema.sql` | YES | 2/2 | `MATCH` |  |
| `20260726090100` | `20260726090100_chat_constraints_indexes.sql` | YES | 8/8 | `MATCH` |  |
| `20260726090200` | `20260726090200_chat_rls.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260726090300` | `20260726090300_chat_rpc.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260727091215` | `20260727091215_chat_table_privilege_hardening.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260727094415` | `20260727094415_chat_realtime_publication.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260727131340` | `20260727131340_chat_legacy_message_text_compatibility.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260728103000` | `20260728103000_chat_delete_delivery_receipts.sql` | YES | 1/1 | `MATCH` |  |
| `20260728160000` | `20260728160000_allow_active_clients_read_linked_dietitian_avatar.sql` | YES | 1/1 | `MATCH` |  |
| `20260729090000` | `20260729090000_chat_image_schema.sql` | YES | 9/9 | `MATCH` |  |
| `20260729090100` | `20260729090100_chat_image_rls_privileges.sql` | YES | 2/2 | `MATCH` |  |
| `20260729090200` | `20260729090200_chat_image_rpc.sql` | YES | 2/2 | `MATCH` |  |
| `20260729090300` | `20260729090300_chat_image_storage.sql` | YES | 2/2 | `MATCH` |  |
| `20260729090400` | `20260729090400_chat_image_cleanup.sql` | YES | 9/9 | `MATCH` |  |
| `20260730180636` | `20260730180636_chat_image_cleanup_scheduler.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260730180641` | `20260730180641_chat_image_rpc_activation.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260801090000` | `20260801090000_align_measurements_with_mobile.sql` | YES | 1/1 | `MATCH` |  |
| `20260802090000` | `20260802090000_chat_active_relationship_hardening.sql` | YES | 6/6 | `MATCH` |  |
| `20260807115919` | `20260807115919_mvp_security_hardening_reconciliation.sql` | YES | 5/5 | `MATCH` |  |
| `20260810055845` | `20260810055845_mvp3_meal_photo_lifecycle_closure.sql` | YES | 11/11 | `MATCH` |  |
| `20260810074910` | `20260810074910_mvp3_real_storage_upload_policy_correction.sql` | YES | 1/1 | `MATCH` |  |
| `20260811103909` | `20260811103909_create_persistent_dashboard_daily_tasks.sql` | YES | 9/9 | `MATCH` |  |
| `20260812090000` | `20260812090000_mvp7_subscription_plans_and_client_limits.sql` | YES | 11/11 | `MATCH` |  |
| `20260813120000` | `20260813120000_create_persistent_dietitian_notes.sql` | YES | 9/9 | `MATCH` |  |
| `20260814120000` | `20260814120000_appointment_slot_collision_and_booking_indexes.sql` | YES | 2/2 | `MATCH` |  |
| `20260814130000` | `20260814130000_meal_completion_visibility.sql` | YES | 1/1 | `MATCH` |  |
| `20260814214101` | `20260814214101_notification_core_backend.sql` | YES | 15/15 | `MATCH` |  |
| `20260816101405` | `20260816101405_mark_all_notifications_read.sql` | YES | 1/1 | `MATCH` |  |
| `20260817084531` | `20260817084531_appointment_reminders_backend.sql` | YES | 4/4 | `MATCH` |  |
| `20260817120000` | `20260817120000_push_registry_outbox_backend.sql` | NO | 0/17 | `LOCAL_ONLY_NEW` | Tarihsel ama bilinçli ertelenmiş (Push 6C.2+); history ve 3 tablo/5 fonksiyon/2 trigger yok. Karar: NO_ACTION, bu yayına dahil değil. |
| `20260826133224` | `20260826133224_product_admin_dietitian_verification.sql` | YES | 14/14 | `MATCH` |  |
| `20260827084741` | `20260827084741_standalone_platform_admin_access.sql` | YES | 1/1 | `MATCH` |  |
| `20260830060342` | `20260830060342_dietitian_diploma_storage_hardening.sql` | YES | 4/4 | `MATCH` |  |
| `20260830141202` | `20260830141202_meal_plan_cross_day_identity_preservation.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260830185101` | `20260830185101_meal_plan_snapshot_edit_contract.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260831071948` | `20260831071948_meal_plan_new_recipe_custom_snapshot_contract.sql` | YES | 1/1 | `MATCH` |  |
| `20260831190352` | `20260831190352_meal_completion_photo_contract.sql` | YES | 15/15 | `MATCH` |  |
| `20260901083212` | `20260901083212_client_grocery_list.sql` | YES | 6/6 | `MATCH` |  |
| `20260901165402` | `20260901165402_client_account_deletion_backend.sql` | YES | — | `MATCH` | Oluşturulan isimli obje yok (grant/ACL/veri/alter); history + önceki reconciliation kanıtı. |
| `20260901193000` | `20260901193000_client_account_deletion_hardening.sql` | YES | 4/4 | `MATCH` |  |
| `20260901200413` | `20260901200413_client_account_deletion_scope_tightening.sql` | YES | 2/2 | `MATCH` |  |
| `20261005120859` | `20261005120859_dietitian_invite_codes.sql` | NO | 1/18 | `LOCAL_ONLY_NEW` | Yeni özellik; bu yayında uygulanacak. |
| `20261005124951` | `20261005124951_recipe_import_core.sql` | NO | 0/18 | `LOCAL_ONLY_NEW` | Yeni özellik; bu yayında uygulanacak. |
| `20261005132107` | `20261005132107_recipe_import_extraction_metrics.sql` | NO | 0/1 | `LOCAL_ONLY_NEW` | Yeni özellik; bu yayında uygulanacak. |

Sınıf sayıları: MATCH 57, HISTORY_PRESENT_BUT_SCHEMA_DRIFT 1, LOCAL_ONLY_NEW 4 (1 ertelenmiş tarihsel + 3 yeni), REMOTE_ONLY 0, BLOCKED 0.

## Yayın migration planı

| Step | Version | Action | Reason | Approval |
|---|---|---|---|---|
| — | `20260713010300` | NO_ACTION | Koruma `trg_sync_dietitian_verification_fields` + RLS ile eşdeğer; preflight 06 PASS | Gerekmez |
| — | `20260817120000` | NO_ACTION, dışarıda tut | Push 6C.2+ ile ertelenmiş; davet/import önkoşulu değil | Push görevi başlarsa ayrı |
| 1 | `20261005120859` | Apply + tek versiyon kaydı | Davet kodu | YES |
| 2 | `20261005124951` | Apply + tek versiyon kaydı | Import core (davet smoke'tan sonra) | YES |
| 3 | `20261005132107` | Apply + tek versiyon kaydı | Extraction metrics, `gpt-6-luna` | YES |

Tarihsel versiyonlar için history adoption gerekmiyor. Toplu repair yok.
