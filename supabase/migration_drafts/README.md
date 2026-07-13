# DietBridge Supabase Migration Taslakları

> [!WARNING]
> Bu klasördeki SQL dosyaları taslaktır. Supabase’e uygulanmamış ve production ortamında doğrulanmamıştır.

Bu klasör, Aşama 3A güvenlik denetimindeki bulgular için incelenebilir SQL önerileri içerir. Supabase CLI migration klasörü değildir; dosyalar supabase/migrations altına taşınmadan, staging/test doğrulaması ve açık kullanıcı onayı alınmadan çalıştırılmamalıdır.

## Güvenli kullanım sınırı

- Dosyaları production Supabase projesinde, SQL Editor içinde veya supabase db push ile doğrudan çalıştırmayın.
- Her taslak önce ayrı staging/test projesinde uygulanmalı ve negatif RLS test matrisi çalıştırılmalıdır.
- Production uygulaması öncesinde geri yüklenebilir yedek, policy/function tanım dışa aktarımı ve onaylı rollback planı zorunludur.
- Taslaklardaki ön koşul blokları başarısız olursa veri düzeltmesi yapmayın; sonucu incelemeye ve ayrı onaya taşıyın.
- Bu dosyalar mevcut web veya mobil uygulama kodunu değiştirmez.

## Önerilen uygulama sırası

1. 202607130004_function_security_hardening.sql için trigger regresyon değerlendirmesi
2. 202607130007_auth_onboarding_hardening.sql
3. 202607130006_verification_consistency.sql için aggregate kapısı ve ayrı onaylı staging veri onarımı
4. 202607130008_meal_completion_rpc.sql
5. Web/mobil onboarding ve meal completion uyumluluk release’i
6. Sentetik staging hesaplarıyla negatif RLS/auth/RPC testleri
7. 202607130001_critical_table_rls.sql
8. 202607130002_relationship_policy_hardening.sql; geniş client meal UPDATE policy’si yalnız RPC geçişi kanıtlandıysa kaldırılır
9. Private bucket için signed URL tüketimi hazırlandıktan sonra 202607130003_storage_policy_hardening.sql
10. 202607130005_constraints_and_indexes.sql içindeki veri uyumluluğu ve lock penceresi gerektiren adımlar

Bu sıralama, RLS açılmadan önce policy’lerin hazırlanmasını ve mevcut istemci sözleşmelerinin doğrulanmasını amaçlar.

## Taslakların amacı ve bağımlılıkları

| Dosya | Amaç | Temel bağımlılık |
|---|---|---|
| 202607130001_critical_table_rls.sql | dietitian_profiles, appointments ve chat_messages için fail-closed RLS | Aktif diyetisyen-danışan ilişki modeli ve negatif test hesapları |
| 202607130002_relationship_policy_hardening.sql | profiles, dietitian_clients, meal_plans ve meals sahiplik policy’lerini daraltmak | Kontrollü onboarding ve ilişki arama akışı |
| 202607130003_storage_policy_hardening.sql | meal-photos public-role policy’lerini authenticated ve ilişki tabanlı hale getirmek | Web/mobil signed URL tüketimi ve doğrulanmış path sözleşmesi |
| 202607130004_function_security_hardening.sql | Doğrulanmış function signature’larında search_path ve execute yüzeyini daraltmak | Trigger regression testleri |
| 202607130005_constraints_and_indexes.sql | Veri uyumluluğu kapıları, NOT VALID constraint taslağı ve index adayları | Aggregate sonuçları, staging rehearsal ve lock bütçesi |
| 202607130006_verification_consistency.sql | Kanonik verification status, mirror boolean trigger/constraint ve manuel onarım kapısı | Aggregate tutarlılık, ayrı açık veri onarımı onayı |
| 202607130007_auth_onboarding_hardening.sql | Auth trigger ile güvenli client/dietitian başlangıç profili | Gerçek trigger/signature, signup regresyon testi |
| 202607130008_meal_completion_rpc.sql | Own-meal `is_eaten` RPC ve dar execute grant | Mobil RPC geçişi, negatif yetki testi |

## Ön kontrol sorguları

Her çalıştırma öncesinde yalnızca aggregate veya metadata kontrolleri yapılmalıdır:

    select count(*) from public.profiles where role is null;
    select count(*) from public.dietitian_profiles
    where is_verified is true
      and verification_status is distinct from 'approved';
    select count(*) from public.appointments
    where dietitian_id is null or client_id is null;
    select count(*) from public.meal_plans
    group by client_id, plan_date
    having count(*) > 1;

Kullanıcı kimliği, iletişim bilgisi, mesaj içeriği, sağlık verisi veya Storage object yolu raporlanmamalıdır.

## Uygulama sonrası doğrulama

- Hedef üç kritik tabloda RLS etkin ve anon için policy yoktur.
- Policy listesi yalnızca taslakta adlandırılan policy’leri içerir.
- İlgili/ilişkisiz diyetisyen ve client hesaplarıyla SELECT, INSERT, UPDATE ve DELETE negatif testleri başarısız olur.
- Yetkili diyetisyen randevu ve plan akışını, yetkili client ise yalnızca izinli read akışını tamamlar.
- Trigger çağrıları, doğrudan RPC execute yetkisi daraltıldıktan sonra staging’de çalışmaya devam eder.
- Private bucket nesneleri signed URL veya yetkili download yolu ile okunur; public URL varsayımı kullanılmaz.

## Rollback yaklaşımı

Rollback, RLS’yi kapatmak değildir. Uygulama erişimi etkilenirse önce policy ve function configuration tanımları uygulama öncesinde saklanan sürüme hedefli biçimde geri alınır. Constraint NOT VALID ise validate edilmeden kaldırılabilir; index geri alma ayrı onayla yapılır. Her rollback işleminde yeniden açık kullanıcı onayı gerekir ve veri silme içermez.

## Web ve mobil uyumluluk

- Web diyetisyen kaydı bugün client tarafında profiles.role değerini dietitian yapmaya çalışır. Bu model, client’ın rol yükseltmesini engelleyen güvenli onboarding ile çelişir. İlişki policy taslağı bu konu çözülmeden fail-closed durur.
- Web danışan ekleme akışı aktif ilişki oluşmadan profile araması yapar. Geniş linking read policy kaldırılmadan önce dar kapsamlı, onaylı bir ilişki isteği arama akışı gerekir.
- Web meal-photos yükleme yolu meal-plans/client-id/dosya-adı biçimindedir ve private bucket üzerinde getPublicUrl çağırır. Taslak policy bu path’i doğrular; istemcinin signed URL kullanımına geçişi ayrı görevdir.
- Mobil uygulamanın meal completion ve ilişki kabul akışları, meals alan bazlı update tasarımı netleşmeden değiştirilmemelidir.

## Production öncesi zorunlu kapılar

1. Staging/test proje yedeği ve production geri dönüş noktası.
2. Canlı policy, trigger, function configuration ve grant envanterinin güncel dışa aktarımı.
3. Bu klasördeki her dosya için bağımsız code review ve kullanıcı onayı.
4. Negatif RLS testi, kayıt/onboarding testi, Storage erişim testi ve trigger regression testi.
5. Production lock penceresi ve index runbook onayı.
