# DietBridge — Supabase Staging Şema Baseline Planı

> [!WARNING]
> Bu belgede açıklanan baseline ve migration işlemleri henüz production veya staging Supabase projesine uygulanmamıştır.

## 1. Planın amacı

Bu plan, boş DietBridge staging şemasını production şemasının **verisiz** ve tekrar üretilebilir baseline’ı ile güvenli biçimde hazırlamak için izlenecek süreci tanımlar. Güvenlik migration taslakları bu baseline tamamlanmadan staging’e uygulanmayacaktır.

## 2. Production ve staging ayrımı

Yerel environment dosyaları ve bağlı Supabase proje metadatası karşılaştırıldı. URL, proje referansı ve anon anahtarı farklıdır. Production proje staging olarak kullanılmayacak; staging’e production kullanıcı verisi, Auth kullanıcıları veya Storage object’leri taşınmayacaktır.

## 3. Maskelenmiş proje referansları

| Ortam | Referans |
|---|---|
| Production | `kagv…cuxz` |
| Staging | `ezwq…rjkv` |

## 4. Staging sağlık durumu

- Proje adı: `DietBridge Staging`
- Bölge: `eu-central-1`
- Durum: `ACTIVE_HEALTHY`
- Oluşturulma zamanı: `2026-07-13T09:30:51Z`
- Production’dan ayrıdır: evet

## 5. Staging mevcut şema envanteri

Salt-okunur metadata sonucunda staging `public` şemasında uygulama tablosu yoktur. Policy, function, trigger, RLS etkin tablo, Storage bucket, Realtime uygulama tablosu ve Supabase migration metadata kaydı sayısı da sıfırdır.

Beklenen DietBridge tablolarının hiçbiri bulunmadı: `profiles`, `dietitian_profiles`, `client_profiles`, `dietitian_clients`, `appointments`, `meal_plans`, `meals`, `measurements`, `daily_logs`, `chat_messages`, `meal_change_requests`.

Beklenen bucket’lar `avatars`, `dietitian-diplomas` ve `meal-photos` da bulunmadı. Bu sonuç staging’in DietBridge uygulama şeması açısından boş olduğunu gösterir; nesnelerin hangi kaynaktan gelmiş olabileceği hakkında tahmin yapılmaz.

## 6. Production şema envanteri özeti

Production’da salt-okunur metadata ile 21 public tablo, 71 constraint, 26 foreign key, 53 index, 18 RLS etkin tablo, 51 policy, 3 public function, 7 trigger, 3 Storage bucket ve 6 Realtime public tablo tespit edildi. Repository’de yalnız `supabase/migrations/20260706_add_sort_order.sql` bulunmaktadır; migration metadata geçmişi iki ortamda da görünür kayıt döndürmedi.

## 7. Production–staging fark tablosu

| Kategori | Production | Staging | Fark |
|---|---:|---:|---|
| Public tablolar | 21 | 0 | Baseline gerekli |
| Kolonlar | Production tablolarında mevcut | 0 | Tüm uygulama şeması eksik |
| Foreign key’ler | 26 | 0 | Eksik |
| Constraint’ler | 71 | 0 | Eksik |
| Index’ler | 53 | 0 | Eksik |
| RLS açık tablolar | 18 | 0 | Eksik |
| Policy’ler | 51 | 0 | Eksik |
| Function’lar | 3 | 0 | Eksik |
| Trigger’lar | 7 | 0 | Eksik |
| Storage bucket’lar | 3 | 0 | Eksik |
| Realtime tabloları | 6 | 0 | Eksik |
| Migration metadata kayıtları | görünür kayıt yok | görünür kayıt yok | Geçmiş baseline kaynağı değildir |

## 8. Repository migration drift’i

Production’daki şema, policy, trigger, function ve Storage modeli repository migration geçmişinde tam temsil edilmemektedir. Tek mevcut repository migration’ı meal sıralama/zaman alanlarına yöneliktir. Bu nedenle Aşama 3B/3C güvenlik taslaklarını boş staging’e doğrudan uygulamak geçerli bir test olmaz.

## 9. Baseline neden gerekli?

Güvenlik taslakları mevcut production nesnelerinin gerçek adlarına, function signature’larına, policy’lerine ve ilişki modeline bağlıdır. Önce eşdeğer, schema-only staging baseline oluşturulmadan bu taslakların ön koşulları başarısız olur veya yanlış şema üzerinde doğrulanmış sayılır.

## 10. Değerlendirilen baseline yöntemleri

### Seçenek A — Supabase CLI ile schema-only baseline pull

Production şemasını veri içermeyen, incelemeye açık bir migration olarak almak; statik review sonrası staging’e uygulamak. Seçilen yöntem budur.

### Seçenek B — Supabase eklentisi ile tam DDL export

Bu görevde eklentinin eksiksiz, tekrar üretilebilir function body, trigger, policy, Storage ve schema DDL export’u sağladığı doğrulanmadı. Bu nedenle uygun baseline yöntemi olarak seçilmedi.

### Seçenek C — Mevcut migration’ları elle tamamlamak

Production drift’i yüksek, repository migration sayısı düşük olduğundan varsayılan yöntem değildir. Tahmini SQL veya eksik DDL ile baseline üretilmeyecektir.

## 11. Seçilen yöntem

**Seçenek A: Supabase CLI ile schema-only production baseline pull.** CLI kullanılabilir hale geldikten ve ayrı açık kullanıcı onayı alındıktan sonra production şeması verisiz migration olarak alınacak, statik inceleme yapılacak ve ancak onaylanan baseline staging’e uygulanacaktır.

## 12. Seçim gerekçesi

Bu yöntem tablo yanında gerçek constraint, index, function, trigger ve policy tanımlarını koruma olasılığı en yüksek tekrar üretilebilir yöntemdir. Veri export’u veya elle tahmini DDL gerektirmez. Baseline önce review edildiği için staging ve production metadata’sı karşılaştırılabilir kalır.

## 13. Supabase CLI gereksinimi

Yerel `supabase` CLI bu görevde bulunamadı. Otomatik kurulum yapılmadı. Sonraki ayrı onaylı görevde desteklenen CLI sürümü güvenilir kaynaktan kurulmalı, yalnız gerekli proje bağlantısı için kullanılmalı ve komutların kapsamı önceden onaylanmalıdır.

## 14. Credential güvenliği

- `.env.staging.local` Git tarafından ignore edilir ve tracked değildir.
- Production/staging URL ve anon key’leri farklıdır; değerleri bu belgede yer almaz.
- Service role, secret key, database password ve connection string kullanılmaz veya raporlanmaz.
- Baseline işlemi sırasında credential’lar terminal çıktısı, commit veya belgeye yazılmaz.

## 15. Schema-only kuralı

Baseline yalnız DDL ve migration metadata’sı için oluşturulur. Kullanıcı satırları, `auth.users`, sağlık verileri, mesajlar, Storage object’leri, token’lar ve application row data export edilmez veya kopyalanmaz.

## 16. Kullanıcı verisi kopyalamama kuralı

Production kullanıcıları, ilişkileri, verification durumları, randevular, öğünler, ölçümler ve dosyalar staging’e taşınmayacaktır. Staging testleri yalnız daha sonraki açık onayla oluşturulan sentetik hesap/veri kullanır.

## 17. Baseline migration oluşturma adımları

1. Ayrı onayla Supabase CLI’yi güvenli biçimde kullanılabilir hale getirin.
2. Production proje bağlantısını, secret göstermeden, yalnız schema pull amacıyla doğrulayın.
3. `supabase db pull` için ayrı açık kullanıcı onayı alın.
4. Oluşan baseline migration’ın yalnız DDL içerdiğini doğrulayın.
5. Oluşan dosyayı code review’a sunun; bu aşamada staging’e uygulamayın.

Bu komutlar Aşama 3D-1’de çalıştırılmadı.

## 18. Baseline statik inceleme adımları

- Tablo, kolon, enum, primary/foreign key, constraint ve index tanımlarını production metadata ile karşılaştırın.
- RLS, policy, function, trigger, Storage ve Realtime tanımlarını eksiksizlik açısından inceleyin.
- DDL dışında kullanıcı satırı, credential, token veya Storage object yolu olmadığını tarayın.
- Destructive veya tahmini SQL bulgularını uygulamadan önce ayrı review’a taşıyın.
- Baseline commit’i ile Aşama 3B/3C güvenlik taslaklarını ayrı tutun.

## 19. Staging’e uygulama ön koşulları

- Review edilmiş schema-only baseline migration
- Ayrı açık staging uygulama onayı
- Staging proje sağlık ve environment ayrımı yeniden doğrulaması
- Rollback/rebuild planı
- Uygulama kodu ve mobil sözleşme etkilerinin kaydı
- Staging’in sentetik veri için uygun olduğunun teyidi

## 20. Staging uygulama sırası

1. Önce onaylı schema-only baseline migration’ı staging’e uygulayın.
2. Production/staging metadata sayımını tekrar karşılaştırın.
3. Farklar varsa güvenlik taslaklarına geçmeden baseline drift’ini çözün.
4. Ardından Aşama 3B/3C taslaklarını gerçek staging migration’larına ayrı review ile dönüştürün.
5. Yalnız bundan sonra sentetik hesap ve negatif RLS testleri için ayrı onay isteyin.

## 21. Uygulama sonrası metadata karşılaştırması

Baseline sonrası yalnız metadata üzerinden tablo/kolon, foreign key, constraint, index, RLS, policy, function, trigger, bucket, Realtime ve migration kayıtları karşılaştırılır. Gerçek kullanıcı veya Storage object içeriği okunmaz.

## 22. Güvenlik migration taslaklarının baseline sonrası sırası

1. `202607130004_function_security_hardening.sql` için trigger regresyon değerlendirmesi
2. `202607130007_auth_onboarding_hardening.sql`
3. `202607130006_verification_consistency.sql` için aggregate kapısı ve onaylı staging veri kararı
4. `202607130008_meal_completion_rpc.sql`
5. Web/mobil uyumluluk release’i ve sentetik negatif testler
6. `202607130001_critical_table_rls.sql`
7. `202607130002_relationship_policy_hardening.sql`
8. Storage ve constraint/index taslakları kendi bağımlılık kapılarıyla

## 23. Rollback yaklaşımı

Staging baseline uygulamasında sorun olursa önce migration/policy/function metadata farkı incelenir. Staging boş uygulama şeması ayrı onaylı rebuild ile yeniden kurulabilir; production RLS kapatılmaz, production verisi değiştirilmez ve production rollback bu planın kapsamına girmez.

## 24. Açık kullanıcı onayları

- Supabase CLI kurulumu veya etkinleştirilmesi
- Production schema-only `supabase db pull`
- Oluşan baseline migration’ın repository’ye eklenmesi
- Baseline’ın staging’e uygulanması
- Sentetik kullanıcı/veri oluşturulması
- Aşama 3B/3C güvenlik migration’larının staging’e uygulanması

## 25. Aşama 3D-2 önerisi

Aşama 3D-2, kullanıcı onayıyla Supabase CLI’nin hazırlanması, production schema-only baseline export’unun alınması ve statik güvenlik incelemesine sunulması olmalıdır. Bu aşamaya bu görevde başlanmadı.

## 26. Sonuç

Staging projesi production’dan ayrı ve sağlıklıdır; ancak DietBridge uygulama şeması bakımından boştur. **Production şema baseline’ı tamamlanmadan güvenlik migration taslakları staging’e uygulanmayacaktır.**
