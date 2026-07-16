# DietBridge — Meal Completion RPC Cutover Denetimi

> [!IMPORTANT]
> Legacy client meals UPDATE policy’si, mobil meal completion akışının tamamı
> `set_my_meal_completion` RPC’sine geçirilmeden kaldırılamaz. Bu belge salt-okunur
> kod denetimi sonucudur; bu aşamada mobil uygulama, Web uygulaması veya veritabanı
> üzerinde çalışma zamanı değişikliği yapılmamıştır.

## 1. Amaç

Bu denetim, client meal-completion yazma yüzeylerini belirler; legacy client UPDATE
policy’sinin kaldırılma koşullarını ve güvenli cutover sırasını tanımlar.

## 2. İncelenen repository’ler

| Repository | Kapsam | İşlem |
|---|---|---|
| `DietBridge-Web` | Active migration, RLS policy, RPC ve diyetisyen meal-plan servisi | Salt-okunur |
| `dietBridge - Kopya` | Mobil Expo/React Native kaynak akışı | Salt-okunur |

GROUNDLESS incelenmedi. Supabase bağlantısı, sorgusu veya mutation çalıştırılmadı.

## 3. Sabit proje yolları

- Web: `DietBridge-Web`
- Mobil kök: `dietBridge - Kopya`
- Mobil uygulama: `dietBridge - Kopya/apps/mobile`

## 4. Başlangıç commit’leri

- Web branch: `codex/supabase-security`
- Web başlangıç commit’i: `8eb0f71 test: record staging onboarding and RLS verification`
- Web başlangıç çalışma ağacı: temiz.
- Mobil kök ve `apps/mobile` mevcut; ancak `git -C "dietBridge - Kopya"` bu dizini Git repository olarak tanımadı. Bu nedenle mobil branch, commit ve Git çalışma ağacı başlangıç durumu **UNKNOWN — MANUAL VERIFICATION REQUIRED** olarak kaydedildi.

## 5. Mobil proje yapısı

Mobil uygulama Expo/React Native JavaScript yapısındadır. Uygulama girişindeki `MealsProvider`, aktif olarak `apps/mobile/src/features/meals/context/MealsContext.js` dosyasından gelir. `RootNavigator` → `MainTabs` zinciri Dashboard ve Meals ekranlarını aktif kaynaktan yükler.

## 6. Mobil meal completion çağrı zinciri

| Katman | Dosya | Function | Görevi |
|---|---|---|---|
| UI | `apps/mobile/src/features/clients/screens/DashboardScreen.js` | `handleToggleMealCompletion` | “Öğünümü Yedim”/geri al eylemini başlatır. |
| ViewModel | `apps/mobile/src/features/clients/viewmodels/useDashboardViewModel.js` | `completeMeal` | Görünen meal ID’sini alır, hedef boolean değeri hesaplar ve hatayı kullanıcıya bildirir. |
| Context/state | `apps/mobile/src/features/meals/context/MealsContext.js` | `toggleMealCompletion` | Optimistic `completedMeals` durumunu değiştirir; hata halinde önceki duruma rollback yapar. |
| Service | `apps/mobile/src/features/meals/services/mealService.js` | `updateMealCompletion` | Oturumu ve aktif ilişkiyi kontrol eder; meal/plan sahipliğini okur ve yazmayı yapar. |
| Supabase | `mealService.js` | direct table update | `meals` satırında yalnız `is_eaten` günceller. |
| Sonuç işleme | `useDashboardViewModel.js` | `setMeals` | Dönen meal verisiyle yerel listeyi günceller; ayrı refetch yapmaz. |

Meal ID, `getDailyMeals()` sonucundaki `meal.id` değerinden gelir. Service’e kullanıcı, plan veya dietitian ID parametre olarak gönderilmez; service mevcut oturumu ve aktif bağlantıyı kendi içinde okur. Başarısızlıkta context rollback yapar ve ViewModel Türkçe `Alert` gösterir. Statik incelemede aktif kaynakta offline/retry veya RPC sonrası direct-update fallback yolu bulunmadı.

## 7. Mobil direct UPDATE arama sonuçları

`updateMealCompletion(mealId, isEaten)` içinde önce meal ve ilişki sorguları yapılır; ardından:

- `.from('meals').update({ is_eaten: Boolean(isEaten) })` kullanılır.
- Başka meal kolonu bu payload ile gönderilmez.
- Sıfır satır veya hata kullanıcıya kontrollü hata olarak döner.

Bu, yalnız `is_eaten` yazsa bile legacy client UPDATE policy’sine dayanan aktif production yoludur.

## 8. Mobil RPC kullanım sonuçları

Aktif `apps/mobile/src` altında `set_my_meal_completion` referansı bulunmadı. RPC çağrısı, RPC parametre uyumu veya RPC sonucu için state işleme kodu yoktur.

## 9. Kullanılmayan veya eski kod yolları

`src_backup/context/MealsContext.js` ve `src_backup/screens/HomeScreen.js` local-only meal completion tutar; meal ID yerine type kullanır ve Supabase yazması yapmaz. Aktif `App.js` ve aktif navigation zincirinde bu backup dizinine import bulunmadı. Bu yol **DEAD/UNREFERENCED CODE** olarak sınıflandırıldı; bu görevde silinmedi veya değiştirilmedi.

`MealsScreen` ve `useMealsViewModel` meal listesi/meal-change request işlevleri içerir; statik incelemede meal completion yazması çağırmaz.

## 10. Web meal düzenleme çağrı zinciri

`features/meal-plans/services/mealPlanService.ts`, diyetisyen için günlük plan oluşturur veya mevcut planın meal satırlarını silip yeni satırlar ekler. Bu service client adına `is_eaten` değiştirmez ve `meals.update()` kullanmaz. Web’de client role ile meal-completion yazma yolu bulunmadı.

Diyetisyen meal içeriği düzenleme yetkisi, client policy’sinden ayrı sahiplik policy’lerine dayanır. Client policy’sinin kaldırılması Web’deki dietitian plan düzenleme akışını hedeflememelidir.

## 11. RPC kontratı

Kaynak: `supabase/migrations/20260713010400_meal_completion_rpc.sql`.

| Alan | Denetim sonucu |
|---|---|
| Signature | `public.set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)` |
| Return | `boolean` |
| Yetki modeli | `SECURITY DEFINER`; `search_path=pg_catalog, public` |
| Owner | Migration owner atama yapmaz; statik dosyadan kesin owner belirlenemez. |
| Ownership | `auth.uid()` alınır; meal’in planı yalnız aynı `meal_plans.client_id` ise güncellenir. |
| Güncellenen kolon | Yalnız `is_eaten` |
| Hata | Null kullanıcı/boolean veya tek satır güncellenmemesi durumunda yetki hatası üretir. |
| Foreign meal | Satır güncellenmez, hata döner. |
| Anonymous | `anon` ve `PUBLIC` execute revoke edilmiştir. |
| Execute | Yalnız `authenticated` grant’i vardır. |

Aktif mobil service henüz bu RPC’yi çağırmadığından parametre/sonuç uyumu uygulama düzeyinde doğrulanmış değildir.

## 12. Legacy client UPDATE policy

Kaynak: `supabase/migrations/20260713000001_production_public_baseline.sql`.

| Alan | Değer |
|---|---|
| Policy adı | `Clients can update own meal completion` |
| Tablo | `public.meals` |
| Komut/rol | UPDATE / `authenticated` |
| USING ve WITH CHECK | Meal planın `client_id` değeri `auth.uid()` ile eşleşmelidir. |
| Kolon kısıtı | Yok; RLS policy kolona göre sınırlandıramaz. |
| Cross-tenant koruması | Var; başka client planı eşleşmez. |
| Alan aşımı riski | Client kendi satırında `title` gibi `is_eaten` dışı güncellenebilir alanları değiştirebilir. |

Policy kaldırma yalnız `DROP POLICY` komutundan ibaret bir release kararı değildir: aktif mobil direct UPDATE yolu önce kaldırılmalı, başka client UPDATE policy bulunmadığı ve staging’de table privilege/RLS etkisinin doğrulandığı kanıtlanmalıdır. RPC, kendi `SECURITY DEFINER` sahiplik kontrolüyle client UPDATE policy olmadan çalışabilecek şekilde tasarlanmıştır.

## 13. Diyetisyen UPDATE yetkileri

Baseline’da `Dietitians can update meals of own plans` ve `Dietitians can update own meal rows` policy’leri vardır. İkisi de planın `dietitian_id` değerini `auth.uid()` ile eşleştirir ve UPDATE için USING/WITH CHECK uygular. Client policy’den bağımsızdır; dietitian meal düzenleme yetkisi korunmalıdır.

## 14. Cutover readiness matrisi

| ID | Repository | Dosya | Function | Mevcut yöntem | Sınıflandırma | Gerekli işlem |
|---|---|---|---|---|---|---|
| MOB-01 | Mobil | `apps/mobile/src/features/meals/services/mealService.js` | `updateMealCompletion` | Direct `meals.update({ is_eaten })` | DIRECT UPDATE — BLOCKER | RPC çağrısı, sonucu ve hata işleme ile değiştir. |
| MOB-02 | Mobil | `apps/mobile/src/features/meals/context/MealsContext.js` | `toggleMealCompletion` | Optimistic state + rollback | DIRECT UPDATE — BLOCKER | Service RPC’ye geçtikten sonra mevcut rollback davranışını koru. |
| MOB-03 | Mobil | `apps/mobile/src/features/clients/viewmodels/useDashboardViewModel.js` | `completeMeal` | Context wrapper | DIRECT UPDATE — BLOCKER | RPC sonucunu state’e yansıt ve hata UX’ini doğrula. |
| MOB-LEGACY | Mobil | `src_backup/*` | legacy context/HomeScreen | Local-only | DEAD/UNREFERENCED CODE | Silme ayrı görevde değerlendirilmeli; aktif bundle’a erişmediği yeniden doğrulanmalı. |
| WEB-01 | Web | `features/meal-plans/services/mealPlanService.ts` | `createDailyMealPlan` | Dietitian delete/insert | RPC cutover dışında | Dietitian policies korunarak regression testi yap. |

## 15. Production blocker’lar

1. Aktif mobil meal completion service direct `meals` UPDATE kullanıyor.
2. Aktif mobil source tree RPC referansı içermiyor.
3. Mobil staging testi, foreign-meal RPC reddi ve eski build uyumluluğu henüz çalıştırılmadı.

Bu nedenle legacy direct client `meals` UPDATE policy’si şu anda kaldırılamaz.

## 16. Mobil kod değişikliği gereksinimleri

- `updateMealCompletion` içinde direct UPDATE yerine `set_my_meal_completion` RPC kullanılmalı.
- Gerçek parametre adları `p_meal_id` ve `p_is_eaten` olmalı.
- RPC başarı sonucu mevcut `completedMeals` ve dashboard meal listesine yansıtılmalı.
- Hata halinde mevcut rollback ve kullanıcıya gösterilen Türkçe hata korunmalı.
- Direct-update/fallback yolu eklenmemeli.

## 17. Web kod değişikliği gereksinimleri

Bu denetimde Web client meal completion yazma yolu bulunmadı. Web kod değişikliği şu aşamada gerekli görünmüyor; ancak policy migration öncesinde dietitian meal-plan create/update/delete regression testi gerekir.

## 18. Database migration gereksinimleri

Legacy policy kaldırma migration’ı bu aşamada oluşturulmadı veya uygulanmadı. Mobil cutover, staging mobil testi ve policy/grant envanteri doğrulamasından sonra ayrı onaylı migration hazırlanmalıdır.

## 19. Test gereksinimleri

1. Mobil static/unit doğrulama: RPC parametreleri, optimistic state ve rollback.
2. Staging’de client kendi meal completion başarısı.
3. Staging’de foreign meal RPC reddi.
4. Dietitian Web meal-plan düzenleme regression testi.
5. Policy kaldırma sonrasında staging harness ve mobil smoke testi.

## 20. Eski mobil sürüm uyumluluğu

Mağaza yayını, internal build kullanımı, aktif kullanıcılar ve eski APK/Expo build durumu repository’den kanıtlanamadı: **UNKNOWN — MANUAL VERIFICATION REQUIRED**. Eski build direct UPDATE kullanıyorsa policy kaldırıldığında “Öğünümü Yedim” işlemi yetki hatasıyla başarısız olur. Cutover ile policy kaldırma arasında uyumluluk penceresi veya zorunlu güncelleme kararı manuel olarak verilmelidir.

## 21. Release sırası

1. Mobil service RPC’ye geçirilir.
2. Context/ViewModel sonucu, rollback ve kullanıcı hatası doğrulanır.
3. Direct/fallback update yolları kaldırılır.
4. Mobil static/unit kontrolleri çalıştırılır.
5. Staging mobil own/foreign meal senaryoları doğrulanır.
6. Eski build uyumluluğu kararı alınır.
7. Legacy client UPDATE policy kaldırma migration’ı ayrı onayla hazırlanır ve yalnız staging’e uygulanır.
8. Staging security harness, Web regression ve mobil smoke testleri yeniden çalıştırılır.
9. Production rollout kararı verilir.

## 22. Rollback planı

Mobil RPC geçişi sorun çıkarırsa mobil kod geri alınabilir; RPC korunur. Policy migration uygulanmışsa geri dönüş ayrı onaylı ileri düzeltme migration’ı ile planlanmalıdır. Legacy geniş policy’yi varsayılan rollback olarak yeniden açmak, client’ın kendi meal satırındaki alan aşımı riskini geri getirir. Her düzeltme staging doğrulamasından geçmelidir.

## 23. Kapsam dışı konular

Mobil/Web uygulama kodu, Supabase policy/function, migration, environment ve package dosyaları değiştirilmedi. Gerçek kullanıcı verisi okunmadı; test user veya fixture oluşturulmadı.

## 24. Sonuç

Mobil meal completion RPC cutover tamamlanmamıştır. Aktif mobil meal completion akışında direct `meals` UPDATE kullanımı doğrulandı. Legacy meals UPDATE policy’si production blocker olarak devam etmektedir.

## 25. Sonraki aşama

Aşama 3E-1 — Mobil meal completion servisinin `set_my_meal_completion` RPC’sine geçirilmesi.
