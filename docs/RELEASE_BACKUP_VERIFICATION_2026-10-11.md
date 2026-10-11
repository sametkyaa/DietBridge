# Güncel yedek ve yerel geri yükleme kanıtı

11 Ekim 2026. Supabase Dashboard'da üretim projesi Free planında, scheduled backups ekranında otomatik yedek bulunmadığı görüldü. Ücretli plan veya ayar değişikliği yapılmadı. Kota grace-period uyarısı görüldü; mevcut kullanımın erişim engeline neden olduğu doğrulanmadı.

Supabase CLI 2.110.0 ile production üzerinde salt okunur export/download yapıldı. İstemci anahtarları, erişim token'ları ve gerçek kullanıcı içerikleri bu rapora/Git'e yazılmadı.

Özel yedek dizini: C:\dev\DietBridge-Backups\2026-10-11-release-preparation. Windows ACL yalnız mevcut kullanıcı ve SYSTEM erişimine sınırlandı. SQL verileri ve 49 dosya sağlık/kimlik verisi içerebilir; özel dizin uygulama repository'sinin dışındadır.

## Kapsam ve sonuç

- Şema/veri: public, private, auth, storage, supabase_migrations.
- Role export mevcut rol ayarlarını içerir; yönetilen platform rollerini Supabase Postgres imajı sağlar.
- Realtime publication'ın 13 tablo üyeliği ayrıca supplement.sql'de korunur. Auth on_auth_user_created trigger'ı asıl schema.sql içinde vardır; ikinci kez oluşturulmaz.
- public.ecr.aws/supabase/postgres:17.6.1.167 imajında, network=none ve port açmadan iki boş yerel veritabanında restore yapıldı. İkinci tam restore ON_ERROR_STOP ile tek geçişte başarılı.
- 83 tablo, 139 fonksiyon, 37 kullanıcı trigger'ı ve 129 policy eşleşti. Aynı search_path altında policy tanımlarının toplu hash'i eşleşti.
- Dump içindeki 81 COPY bloğunun her tablo kayıt sayısı restore sonrasında birebir eşleşti. 72 migration kaydı korundu.
- Storage: 49 obje, 64.403.774 byte. İndirilen her dosyanın boyutu restore edilen Storage metadata'sıyla eşleşti; dosya başına SHA-256 manifest'i özel dizinde.
- Yerel restore üzerinde yeni kilo tarihi migration'ı uygulandı ve RESET TimeZone rollback'i başarıyla çalıştırıldı. Sonrasında kullanıcının açık onayıyla yalnız aynı migration production'a uygulandı; postflight başarılı. Yedek, migration öncesi 72 migration kaydını kapsar; uygulanan SQL delta'sı ve postflight kanıtı şifreli arşive eklendi.

## Şifreli kopya

snapshot.aesgcm: AES-256-GCM; key.windows-dpapi: Windows DPAPI CurrentUser. Arşiv yeniden çözülüp SHA-256 eşitliği doğrulandı. Bu anahtar mevcut Windows profilini gerektirir. Ayrı kurtarma anahtarı ve başka cihaz/bulut kopyası oluşturulmadı. ACL ile sınırlı SQL/dosya kaynak kopyaları yerelde tutulur; bunlar ayrıca şifreli değildir.

Bu kanıt veritabanının ve Storage dosya kopyalarının güncel, yerelde okunabilir olduğunu doğrular. Canlı projeyi geri yükleme, Storage HTTP upload/erişim testi, dış servisler, Edge Function deploy/secrets, Vault sırları, scheduler/pg_cron işleri ve platform Auth/SMS/SMTP ayarlarının tam felaket kurtarması denenmedi. Üretim geri yüklemesi ayrıca açık onay gerektirir. Storage snapshot'ı DB snapshot'ıyla tek atomik transaction değildir; bu tarihte obje/byte toplamları eşleşti.

## Tekrar yükleme sırası

Şifreli arşivi açmak için aynı Windows kullanıcısıyla özel yedek dizininde `node unseal-backup.mjs` çalıştırılır. Bu yardımcı mevcut çıktı dosyasının üstüne yazmaz; oluşturduğu ZIP kişisel veriler içerir ve özel dizinde tutulmalıdır. Yardımcı bu arşiv üzerinde gerçekten çalıştırılıp ZIP boyutu doğrulandı.

1. Ayrı test projesi/izole veritabanı; dış ağ ve scheduler yan etkileri kapalı.
2. Supabase yönetilen rolleri ve dump'ın gerektirdiği extensions/uuid-ossp/pgcrypto/pg_stat_statements/vault/pg_graphql altyapısı hazırlanır.
3. roles.sql, schema.sql; trigger yan etkilerini engellemek için yalnız restore bağlantısında session_replication_role=replica; data.sql; origin'e dönüş; supplement.sql.
4. verify-backup.mjs ile kayıt/policy ve obje boyutları karşılaştırılır. Script yalnız adı belirlenmiş yerel container/veritabanlarını kabul eder.
5. Ayrı onaylı projede obje dosyaları aynı bucket ve Storage obje yollarına yüklenir, RLS/Auth/Realtime gerçek kullanıcı kabul testi yapılır. Bu adım yapılmadı.

Yedek kaynakları ve raw loglar paylaşılmamalı. En yakın sonraki işlem: şifreli yedeği bağımsız depoya almak ve bu bilgisayar kaybolsa da kullanılabilen güvenli kurtarma anahtarı düzeni oluşturmak; sonra düzenli yedek politikasını seçmek.
