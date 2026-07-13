# DietBridge — Supabase Güvenlik Migration Planı

> [!CAUTION]
> Bu belgede açıklanan SQL taslakları production Supabase projesine uygulanmamıştır. Uygulama için ayrı kullanıcı onayı, test ortamı doğrulaması ve yedekleme gereklidir.

## 1. Planın amacı

Bu plan, Aşama 3A denetiminde bulunan RLS, policy, Storage, function ve şema güvenliği bulgularını küçük ve geri alınabilir taslaklara ayırır. Plan uygulama emri değildir.

## 2. Kaynak denetim raporu

Kaynak: docs/SUPABASE_SECURITY_AUDIT.md. Denetimde üç kritik public tabloda RLS kapalı, geniş profile linking erişimi, meal plan sahiplik eksikleri, public-role meal photo policy’leri ve function execute yüzeyi tespit edildi.

## 3. Canlı proje

Canlı proje referansı maskelenmiştir: kagv…cuxz.

## 4. Güvenlik sınırları

Bu görevde yalnızca metadata ve anonim aggregate ön kontrolleri okunmuştur. Production ortamında SQL mutation, migration, RLS/policy/function/trigger/Storage/Realtime değişikliği, kullanıcı işlemi veya dosya işlemi yapılmamıştır.

## 5. Uygulanmadı uyarısı

supabase/migration_drafts altındaki hiçbir SQL dosyası Supabase CLI migration dizininde değildir ve çalıştırılmamıştır.

## 6. Taslak listesi

| Sıra | Taslak | Durum |
|---|---|---|
| 1 | 202607130004_function_security_hardening.sql | İncelemeye hazır |
| 2 | 202607130001_critical_table_rls.sql | İncelemeye hazır; onboarding kapısına bağlı |
| 3 | 202607130002_relationship_policy_hardening.sql | İncelemeye hazır; kontrollü onboarding/linking kapısına bağlı |
| 4 | 202607130003_storage_policy_hardening.sql | İncelemeye hazır; signed URL istemci değişikliğine bağlı |
| 5 | 202607130005_constraints_and_indexes.sql | İncelemeye hazır; aggregate ve lock kapılarına bağlı |

Realtime taslağı oluşturulmadı. Şimdilik ertelendi: appointments için aktif subscription yoktur, chat web tarafında mock’tur ve daily_logs subscription’ı ilgili diyetisyen read policy’si netleşmeden publication’a eklenmemelidir. Realtime, RLS yerine geçmez.

## 7. Önerilen uygulama sırası

Önce function/trigger regression testi, sonra kritik RLS policy’leri, ardından kontrollü onboarding ve linking çözümü, Storage istemci uyumu ve en son constraint/index adımları uygulanmalıdır.

## 8. Her migration’ın amacı

- Kritik RLS: hassas profil, randevu ve mesaj satırlarını sahiplik/aktif ilişki ile sınırlar.
- İlişki hardening: geniş profile read policy’sini aktif ilişkiye indirir; meal plan ve meal policy tekrarlarını hedefli değiştirir.
- Storage: meal-photos erişimini public rolünden authenticated ve ilişki doğrulamasına geçirir.
- Function: doğrulanmış signature’larda güvenli search_path ve dar execute grant önerir.
- Constraint/index: veri düzeltilmeden uygulanmayan doğrulama kapıları ve sorgu odaklı index adayları verir.

## 9. Etkilenen nesneler

Tablolar: profiles, dietitian_profiles, dietitian_clients, appointments, meal_plans, meals, chat_messages.

Function’lar: current_user_role(), is_current_user_dietitian(), sync_client_weight_to_measurements(), save_my_current_weight(numeric), set_updated_at().

Bucket’lar: avatars, dietitian-diplomas, meal-photos.

## 10. Web etkisi

Web diyetisyen kaydı, tarayıcıdan profiles.role için dietitian değeri yazmaya çalışır. Bu alan istemci tarafından değiştirilemez olmalıdır; güvenli atama ayrı bir backend, güvenilir trigger veya kontrollü function üzerinden tasarlanmalıdır. Role policy sıkılaştırılmadan önce Aşama 2 kayıt akışıyla uyumluluk doğrulanmalıdır. Web danışan ekleme akışı da aktif ilişki öncesi e-posta tabanlı profile aramasına dayanır; geniş linking policy kaldırılmadan önce bu akışın dar kapsamlı bir alternatifle değiştirilmesi gerekir.

Web meal photo kodu private bucket için getPublicUrl çağırır. Yeni Storage policy uygulanmadan önce signed URL veya yetkili download tüketimi uygulanmalıdır.

## 11. Mobil uygulama etkisi

Mobil client kayıtları düşük yetkili client rolünü kullanır. dietitian_clients kabul/reddetme ve meals.is_eaten güncelleme akışları ayrı test edilmelidir. RLS, bir UPDATE policy ile alan bazlı kısıtlama yapamaz; client meal completion için dar RPC veya ayrı DB rolü tasarımı gerekir. Mevcut geniş UPDATE policy bu karar ve web/mobil sözleşme doğrulanmadan doğrudan production’a alınmamalıdır.

## 12. Ön koşul aggregate sorguları

Kullanılan kontroller yalnızca aggregate sonuç döndürmüştür:

- profiles.role null ve enum dışı değerleri
- verification status ile is_verified çelişkisi
- dietitian_clients status uygunluğu
- appointments sahiplik alanlarının null olması ve status uygunluğu
- meal_plans client/tarih çakışmaları
- duplicate ilişki durumları

Kontrol, 1 verification tutarsızlığı olduğunu gösterdi. Bu satır kullanıcı verisi raporlanmadan kontrollü incelemeye taşınmalıdır. Production veri düzeltmesi için ayrı açık kullanıcı onayı gerekir; bu görevde kayıt düzeltilmeyecektir. meals.recipe_id için doğrulanabilir public parent tablo veya foreign key yoktur; orphan check/FK taslağı üretilmemiştir.

## 13. Veri uyumsuzluğunda izlenecek yol

Uyumsuzluğu otomatik UPDATE ile düzeltmeyin. Önce yalnızca aggregate ile kapsamı doğrulayın, sonra veri sahibi ve ürün kuralı onayı alın, ayrı migration veya yönetim akışı planlayın. Production veri düzeltmesi ayrı açık kullanıcı onayı olmadan yapılmaz. NOT VALID constraint ancak yeni/yenilenen satırlara etkisi kabul edilirse eklenebilir; VALIDATE CONSTRAINT daha sonraki ayrı adımdır.

## 14. Staging/test uygulama adımları

1. Production ile uyumlu, izole test hesapları ve ilişkiler oluşturun.
2. Güncel schema, policy, trigger, function config ve grant envanterini kaydedin.
3. Taslakları tek tek uygulayın; her adımdan sonra aşağıdaki negatif RLS matrisini çalıştırın.
4. Dietitian registration, client relationship request/accept, meal plan CRUD, appointment CRUD, Storage signed URL ve trigger regression akışlarını doğrulayın.
5. Hata varsa policy/function tanımını hedefli rollback edin; RLS’yi kapatmayın.

## 15. Production yedekleme adımı

Uygulama öncesinde doğrulanmış geri yükleme noktası, policy/function/trigger/grant çıktısı, bucket ayar envanteri ve onaylı bakım penceresi zorunludur.

## 16. Production uygulama adımları

Production uygulaması ayrı kullanıcı onayı ister. Önce gerekli web/mobil sözleşme değişiklikleri yayınlanır, sonra staging kanıtı ve güncel aggregate kapıları yeniden alınır. Lock riski taşıyan index/unique adımları onaylı runbook ile düşük trafikte yürütülür.

## 17. Uygulama sonrası doğrulama sorguları

Metadata düzeyinde RLS durumu, pg_policies adları, function configuration/grant listesi, storage.objects policy adları ve ilgili index/constraint adları doğrulanır. Kullanıcı satırı, mesaj veya Storage nesnesi listelenmez.

## 18. Negatif RLS test matrisi

| Kaynak | Kullanıcı tipi | İşlem | Beklenen sonuç | Test ortamı gerekli mi? |
|---|---|---|---|---|
| dietitian_profiles | Kendi diyetisyen hesabı | SELECT | İzin | Evet |
| dietitian_profiles | Başka diyetisyen | SELECT | Ret | Evet |
| dietitian_profiles | Client | UPDATE verification | Ret | Evet |
| appointments | İlgili diyetisyen | CRUD | İzin | Evet |
| appointments | İlişkisiz diyetisyen | SELECT/UPDATE/DELETE | Ret | Evet |
| appointments | İlgili client | SELECT | İzin | Evet |
| chat_messages | Gönderen | INSERT | İzin | Evet |
| chat_messages | İlişkisiz kullanıcı | SELECT | Ret | Evet |
| profiles | Client kendi rolü | UPDATE role | Ret | Evet |
| client_profiles | İlişkili diyetisyen | SELECT | İzin | Evet |
| client_profiles | İlişkisiz diyetisyen | SELECT | Ret | Evet |
| meal_plans | İlgili diyetisyen | CRUD | İzin | Evet |
| meal_plans | İlişkisiz diyetisyen | SELECT/UPDATE/DELETE | Ret | Evet |
| meals | Client kendi planı | SELECT | İzin | Evet |
| meal-photos | İlişkisiz kullanıcı | SELECT/DELETE | Ret | Evet |
| dietitian-diplomas | Anon | SELECT | Ret | Evet |

## 19. Rollback yaklaşımı

Önceki policy tanımları, function config/grant listeleri ve Storage policy’leri uygulama öncesinde saklanmalıdır. Yanlış policy hedefli olarak önceki sürümüne döndürülür; RLS kapatmak varsayılan rollback değildir. Revoke edilen function grant’i yalnızca kanıtlanmış ihtiyaçta, ayrı onayla geri verilir. NOT VALID constraint validate edilmeden kaldırılabilir; index kaldırma ayrı onaylı operasyon olmalıdır. Rollback veri kaybı hedeflemez ve yeniden açık kullanıcı onayı gerektirir.

## 20. Risk ve bağımlılık tablosu

| Alan | Risk | Bağımlılık | Karar |
|---|---|---|---|
| profiles.role | Tarayıcıdan rol yükseltme | Kontrollü dietitian onboarding | Bloklayıcı |
| profile linking | Aktif ilişki olmadan geniş client read | Dar lookup/request akışı | Bloklayıcı |
| meal completion | RLS alan bazlı UPDATE kısıtlayamaz | RPC veya ayrı DB rolü | Açık karar |
| meal-photos | Private bucket + public URL varsayımı | Signed URL istemcisi | Bloklayıcı |
| verification | Mevcut tutarsız kayıt | Ayrı onaylı veri düzeltmesi | Bloklayıcı |
| index/unique | Yazma lock riski | Staging rehearsal ve bakım penceresi | Yüksek |

## 21. Açık kararlar ve kullanıcı onayı

1. Dietitian rolü hangi güvenilir backend, trigger veya kontrollü function üzerinden atanacak ve Aşama 2 kayıt akışıyla nasıl uyumlu tutulacak?
2. Diyetisyen, aktif ilişki yokken danışanla bağlantı isteği göndermek için hangi dar lookup mekanizmasını kullanacak?
3. Client’ın meals.is_eaten güncellemesi RPC ile mi, ayrı DB rolüyle mi yapılacak?
4. Private meal photo ve avatar tüketiminde signed URL standardı onaylanıyor mu?
5. Verification tutarsız kaydın iş kuralına uygun düzeltmesi kim tarafından yapılacak?
6. Index ve unique constraint adımları için bakım penceresi onaylanıyor mu?

## 22. Aşama 3C önerisi

Önce kontrollü diyetisyen onboarding, bağlantı isteği lookup sözleşmesi ve private Storage URL tüketimi için küçük, ayrı uygulama görevleri tasarlayın. Ardından staging’de bu taslakları uygulayıp negatif RLS testlerini çalıştırın. Production uygulaması ancak bu kanıtlarla ayrı onaya sunulmalıdır.

## 23. Sonuç

Taslaklar kritik erişim açıklarını hedefler; ancak mevcut web onboarding/linking ve private Storage URL davranışıyla açık bağımlılıkları vardır. Bu nedenle SQL taslakları incelemeye uygundur, production uygulamasına uygun değildir.
