# Aşama 6.1 — Chat Staging Uygulama Runbook'u

Bu runbook yalnız DietBridge Staging için hazırlanmıştır. Migration uygulamak için
ayrı ve açık kullanıcı mutation onayı gerekir. Production uygulaması bu runbook'un
kapsamında değildir.

## Ön koşullar

1. Hedef proje kimliğini maskeli olarak doğrula; DietBridge Staging dışında hiçbir
   Supabase projesinde devam etme.
2. Yerel migration history ile remote history'yi karşılaştır. Bu paket, repository
   zincirinde bulunan ancak Staging'de bulunmayan migration'lar uzlaştırılmadan
   uygulanamaz.
3. `chat_messages` aggregate row count'ını ve canonical-chat tablo/fonksiyonlarının
   bulunmadığını salt okunur metadata ile doğrula.
4. Mevcut chat satırı sıfır değilse legacy preflight/backfill kararı için dur; satır
   içeriği okumadan ayrı onay al.
5. Disposable local replay, lint ve `chat_security_harness.sql` sonuçları PASS
   olmadan remote mutation isteme.

## Uygulama sırası

1. Backup/restore ve geri dönüş stratejisini kaydet.
2. `supabase migration list` ile migration history drift'ini çöz.
3. Schema diff veya dry-run ile yeni chat nesnelerini doğrula.
4. Kullanıcıdan açık staging mutation onayı al.
5. Migration'ları sırasıyla uygula:
   - `20260726090000_chat_conversation_schema.sql`
   - `20260726090100_chat_constraints_indexes.sql`
   - `20260726090200_chat_rls.sql`
   - `20260726090300_chat_rpc.sql`
   - `20260727091215_chat_table_privilege_hardening.sql`
   - `20260727094415_chat_realtime_publication.sql`
   - `20260727131340_chat_legacy_message_text_compatibility.sql`
   - `20260728103000_chat_delete_delivery_receipts.sql`
   - `20260729090000_chat_image_schema.sql`
   - `20260729090100_chat_image_rls_privileges.sql`
   - `20260729090200_chat_image_rpc.sql`
   - `20260729090300_chat_image_storage.sql`
   - `20260729090400_chat_image_cleanup.sql`
   - `20260730180636_chat_image_cleanup_scheduler.sql`
   - `20260730180641_chat_image_rpc_activation.sql`
   - `20260802090000_chat_active_relationship_hardening.sql`
6. Postflight metadata ile tablo/kolon/FK/index/RLS/policy/function ACL'lerini
   doğrula.
7. Yalnız disposable sentetik fixture ile active, pending, removed, cross-tenant,
   idempotency, read-state, cursor ve anon güvenlik matrisini çalıştır.
8. Fixture cleanup aggregate sonucu Auth users, chat tables, relationship ve profiles
   için sıfır olmalıdır.
9. Web/mobil entegrasyonu ancak staging güvenlik matrisi PASS sonrasında Aşama 6.2+
   kapsamında başlatılabilir.

## Harness PASS sözleşmesi

Staging üzerinde çalıştırılmasına ancak açık kullanıcı onayıyla izin verilen
`supabase/tests/chat_security_harness.sql`, yukarıdaki canonical migration
zincirini varsayar. Harness tamamlandığında tam olarak 71 benzersiz `PASS:` etiketi
ve tek `CHAT_SECURITY_HARNESS_PASS` marker'ı bulunmalı; herhangi bir `FAIL:` marker'ı
veya beklenmeyen SQL hatası başarısızlıktır.

## Geri dönüş yaklaşımı

Bu paket destructive değildir ve legacy `chat_messages` kolonlarını/satırlarını
silmez. Sorun oluşursa RLS'yi kapatmak veya tablo drop etmek yerine yeni, hedefli bir
forward-fix migration hazırla. RPC erişimini kapatmak gerekirse authenticated execute
grant'ini hedefli olarak geri al; direct client DML açma.
