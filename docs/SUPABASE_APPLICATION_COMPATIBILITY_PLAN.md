# DietBridge — Supabase Migration Uygulama Uyumluluk Planı

> [!CAUTION]
> Bu plan uygulama talimatı değildir. SQL taslakları production’da uygulanmamıştır; staging kanıtı ve açık production onayı olmadan çalıştırılamaz.

## Amaç

Bu plan, Aşama 3C güvenlik kararlarının web ve mobil istemci sözleşmeleriyle uyumlu şekilde uygulanabilmesi için expand → migrate → contract yaklaşımını tanımlar. Bu görevde uygulama kodu değiştirilmez.

## Mevcut web uyumluluk yüzeyleri

| Yüzey | Mevcut davranış | Gerekli uyumluluk kararı |
|---|---|---|
| `features/dietitians/services/dietitianService.ts` | Signup sonrası browser’dan `profiles.role` ve `dietitian_profiles` upsert’i dener | Onboarding trigger’ı profile satırlarını oluşturduktan sonra browser role/system-field yazımı kaldırılmalı; e-posta onayı, diploma hata ve tekrar deneme akışı ayrıca ele alınmalı |
| `features/auth/services/authService.ts` | Role, dietitian profil ve verification durumunu fail-closed çözer | `verification_status` kanonik kalmalı; geçişte mirror boolean ile çelişki erişimi kapatmalı |
| `features/auth/context/AuthContext.tsx` | Client web oturumunu kapatır; pending/rejected/allowed durumlarını taşır | Trigger ile oluşturulan pending diyetisyen profilini eksik profil olarak göstermemeli; session restore staging’de doğrulanmalı |
| `features/meal-plans/services/mealPlanService.ts` | Dietitian plan/öğün CRUD yapar | Client-only completion RPC’sine gereksiz çağrı eklenmez; dietitian policy regresyonu staging’de test edilir |
| `pages/MealPlans.tsx` | Diyetisyen plan düzenleme ekranı | Client completion geçişi bu sayfanın kapsamı değildir |

## Mobil uyumluluk sınırı

Mobil uygulama bu repository’de bulunmaz. Bu nedenle aşağıdaki maddeler fonksiyonel sözleşme olarak tutulur; dosya, ekran veya çağrı yolu varsayılmaz.

- Client signup, yalnız `client` başlangıç türünü taşımalı ve güvenli trigger ile profil oluşturmayı doğrulamalıdır.
- Var olan client oturumu metadata değiştirerek role yükseltememelidir.
- Client meal completion, geniş `meals` UPDATE yerine `set_my_meal_completion(uuid, boolean)` RPC’sine geçmelidir.
- Mevcut geniş policy, tüm desteklenen mobil sürümler RPC’ye geçip staging’de doğrulanmadan kaldırılmamalıdır.
- Verification alanlarını okuyorsa kanonik `verification_status` ile davranmalı ve bu alanları yazmamalıdır.
- RPC hata yönetimi, retry ve offline durumda optimistic completion sonucunu kalıcı başarı gibi göstermemelidir; bağlantı geri geldiğinde yalnız güvenli yeniden deneme stratejisi uygulanmalıdır.

## Expand → migrate → contract

| Evre | İçerik | Geri dönüş sınırı |
|---|---|---|
| Expand | Function/search_path hardening, güvenli onboarding trigger modeli, verification mirror/constraint hazırlığı, meal completion RPC eklenmesi | Eski istemci sözleşmeleri korunur; geniş policy henüz kaldırılmaz |
| Migrate | Web signup akışının browser role/system-field yazımından ayrılması; mobil completion RPC geçişi; sentetik staging testleri | İstemci sürüm/akış sonuçları kaydedilir |
| Contract | Eski geniş completion UPDATE policy’sinin kaldırılması ve browser self-profile INSERT yolunun kapatılması | Yalnız tüm istemci kanıtları ve rollback paketi hazırsa, ayrı onayla |

## Önerilen staging uygulama sırası

1. `202607130004_function_security_hardening.sql` uyumlu bölümünü ve trigger regresyon testini değerlendirin.
2. `202607130007_auth_onboarding_hardening.sql` ile mevcut `handle_new_user()` trigger’ını güvenli onboarding modeline hazırlayın.
3. `202607130006_verification_consistency.sql` için aggregate kapısı, manuel onaylı staging veri onarımı ve trigger/constraint doğrulamasını yürütün.
4. `202607130008_meal_completion_rpc.sql` ile dar RPC/grant yüzeyini ekleyin.
5. Web ve mobil uyumluluk değişikliklerini ayrı branch/release olarak staging’e alın.
6. Sentetik hesaplarla onboarding, role escalation, verification ve RPC negatif testlerini çalıştırın.
7. Onaylı verification veri onarımını yalnız staging’de deneyin; production için ayrı açık onay alın.
8. `202607130001_critical_table_rls.sql` kritik RLS policy’lerini uygulayın.
9. `202607130002_relationship_policy_hardening.sql` ile geniş relationship/meal policy’lerini yalnız uygulama hazırsa daraltın.
10. Storage policy, constraint/index ve Realtime kararlarını kendi bağımlılık kapılarıyla ele alın.

## Uyumluluk matrisi

| Değişiklik | Web | Mobil | Staging kanıtı | Contract öncesi koşul |
|---|---|---|---|---|
| Verification canonical model | Auth resolver çelişkiyi engeller | Okuma/yazma sözleşmesi kontrol edilir | Pending/rejected/approved ve çelişki negatif testi | Tutarsız aggregate sıfır veya onaylı onarım planı |
| Auth trigger onboarding | Browser upsert kaldırılır/daraltılır | Client signup doğrulanır | Client, pending dietitian, bilinmeyen metadata, tekrar signup | Auth trigger ve profil kayıtları atomik çalışır |
| Role hardening | Browser `role` yazmaz | Metadata escalation yapmaz | Client role escalation ret testi | Güvenli trigger/managed role yolu kanıtlandı |
| Meal completion RPC | Diyetisyen UI etkilenmez | RPC’ye geçer | Own client izin, unrelated/dietitian/anon ret, direct update ret | Desteklenen tüm client sürümleri RPC kullanır |
| Broad meal policy kaldırma | Meal plan CRUD regresyonu yok | Completion çalışır | Tam RLS matrisi | RPC ve rollout telemetrisi/manuel kanıt tamam |

## Uygulama dışı bırakılan alanlar

- Storage signed URL tüketimi ve `meal-photos` sözleşmesi
- Client linking lookup daraltması
- Appointment/chat Realtime kararı
- Production veri onarımı
- Mobil source code değişikliği

Bu alanlar ayrı görev ve açık kullanıcı onayı gerektirir.

## Kabul kapıları

1. Staging projesi production’dan açıkça ayrıdır ve yalnız sentetik test verisi kullanır.
2. Her taslak için schema/policy/function/grant öncesi-sonrası metadata kaydı vardır.
3. Web ve mobil için başarılı yol ile negatif yetki testleri kanıtlanmıştır.
4. Rollback provası RLS kapatmadan ve veri silmeden yürütülmüştür.
5. Production uygulama paketi ayrı code review ve açık kullanıcı onayı almıştır.
