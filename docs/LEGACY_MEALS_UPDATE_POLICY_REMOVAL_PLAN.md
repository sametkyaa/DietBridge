# DietBridge — Legacy Client Meals UPDATE Policy Kaldırma Planı

## 1. Amaç

Client’ın `public.meals` satırlarını doğrudan UPDATE etmesine izin veren eski RLS policy’sini kaldırmak; meal completion yazmasını yalnız `set_my_meal_completion` RPC’sine bırakmak.

## 2. Mevcut risk

RLS satır erişimini sınırlar, kolonları değil. Eski policy kendi planındaki satırı doğrulasa da client `is_eaten` dışında güncellenebilir `meals` alanlarını da değiştirebilir.

## 3. Legacy policy’nin tam adı

`Clients can update own meal completion`

## 4. Mevcut policy tanımı

| Policy | İşlem | Rol | USING | WITH CHECK | Kaynak |
|---|---|---|---|---|---|
| `Clients can update own meal completion` | UPDATE | `authenticated` | Meal’in planında `client_id = auth.uid()` olmalı | Aynı client sahipliği tekrar doğrulanır | `20260713000001_production_public_baseline.sql` |
| `Dietitians can update meals of own plans` | UPDATE | `authenticated` | Planın `dietitian_id = auth.uid()` olmalı | Aynı dietitian sahipliği tekrar doğrulanır | Aynı baseline |
| `Dietitians can update own meal rows` | UPDATE | `authenticated` | Planın `dietitian_id = auth.uid()` olmalı | Aynı dietitian sahipliği tekrar doğrulanır | Aynı baseline |
| `Clients can view meals of own plans` | SELECT | `authenticated` | Planın `client_id = auth.uid()` olmalı | Yok | Aynı baseline |
| `Dietitians can view meals of own plans` | SELECT | `authenticated` | Planın `dietitian_id = auth.uid()` olmalı | Yok | Aynı baseline |
| `Users can select own meal rows` | SELECT | `authenticated` | Planın client veya dietitian sahibi `auth.uid()` olmalı | Yok | Aynı baseline |

Client ve dietitian aynı UPDATE policy içinde değildir. Eski client policy kolon bazlı sınırlama içermez; bu nedenle client kendi satırında `title`, `time`, `calories`, `macros`, `photo_url` veya `sort_order` gibi alanları değiştirebilir.

## 5. Policy’nin neden riskli olduğu

Eski policy cross-client erişimi engellese de geniş UPDATE yüzeyi P1 alan aşımı riskidir. Client completion gereksinimi yalnız boolean `is_eaten` yazmasıdır; geniş table UPDATE bu ürün sözleşmesinden fazladır.

## 6. Mobil RPC cutover durumu

Aktif mobil repository `73009da` commit’inde `updateMealCompletion`, `set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)` RPC’sini çağırır. Aktif `apps/mobile/src` altında completion için `from('meals').update(...)` veya fallback bulunmadığı salt-okunur kontrolle doğrulandı; `src_backup` eşleştirmeleri aktif kaynak değildir.

RPC `supabase/migrations/20260713010400_meal_completion_rpc.sql` içinde `SECURITY DEFINER`, `search_path = pg_catalog, public`, `auth.uid()` sahiplik kontrolü ve yalnız `is_eaten` UPDATE’iyle tanımlıdır. `PUBLIC` ve `anon` execute revoke edilmiş, `authenticated` execute grant’i korunmuştur. Client direct UPDATE policy kaldırıldığında RPC çalışmaya devam etmelidir; bunun staging’de yeniden doğrulanması zorunludur.

## 7. Fiziksel cihaz staging kanıtı

Fiziksel Android telefonda network rollback, kontrollü Türkçe hata, own-meal RPC, restart sonrası persistence, foreign-meal reddi ve fixture cleanup PASS’tir. Foreign-check exit code `10` beklenen güvenlik başarısıdır. Ayrıntılar `docs/MEAL_COMPLETION_STAGING_DEVICE_TEST_REPORT.md` içindedir.

## 8. Eski build uyumluluğu kararı

**Legacy compatibility: NOT REQUIRED**

Bu karar kullanıcı beyanına dayanır: eski DietBridge mobil build’i dış kullanıcıya, Play Store’a, TestFlight’a, EAS Internal Distribution’a veya başka dağıtım kanalına gönderilmedi; yalnız geliştiricinin fiziksel telefonu ve emülatöründe kullanıldı. Bu nedenle aktif eski istemci uyumluluğu gereksinimi yoktur.

## 9. Hazırlanan migration

Dosya: `supabase/migrations/20260714010000_remove_legacy_client_meals_update_policy.sql`

Migration önce `public.meals`, exact policy adı, UPDATE komutu, yalnız `authenticated` rolü ve hem `qual` hem `with_check` varlığını katalogdan doğrular. Ardından `DROP POLICY` ile yalnız `Clients can update own meal completion` policy’sini kaldırır. `IF EXISTS` kullanılmadı; drift veya yanlış policy adı migration’ı sessizce başarılı gösteremez.

## 10. Korunan dietitian yetkileri

`Dietitians can update meals of own plans` ve `Dietitians can update own meal rows` migration tarafından değiştirilmez. Dietitian’ın meşru plan/meal düzenleme yetkisi staging regresyonuyla ayrıca doğrulanacaktır.

## 11. Korunan SELECT yetkileri

Üç `meals` SELECT policy’si migration tarafından değiştirilmez. Client kendi meal’ini okuyabilmeli; foreign meal görünmemeli veya RLS tarafından reddedilmelidir.

## 12. Migration öncesi kontroller

1. Staging proje kimliği production ve GROUNDLESS’tan bağımsız olarak doğrulanır.
2. Bu branch commit’i kaydedilir; repository kökü linklenmez.
3. Staging-linked disposable çalışma alanında `supabase/verification/legacy_client_meals_update_policy_verification.sql` PRE sorguları çalıştırılır.
4. Legacy policy snapshot’ı, RPC execute/RLS sonucu ve fixture manifestinin yokluğu kaydedilir.
5. Dry-run yalnız `20260714010000_remove_legacy_client_meals_update_policy.sql` migration’ını göstermelidir.

## 13. Migration sonrası kontroller

Verification SQL POST sorguları şu sonuçları göstermelidir:

- Legacy client UPDATE policy yoktur.
- `meals` üzerinde yalnız iki reviewed dietitian UPDATE policy kalmıştır.
- SELECT policy’leri değişmemiştir.
- RPC `SECURITY DEFINER`, sabit search path ve `authenticated` execute yetkisini korur.
- `public.meals` üzerinde RLS açıktır.

## 14. Staging test matrisi

| Test | Test ID | Aktör | Beklenen |
|---|---|---|---|
| Client own meals SELECT | `MEALS-SELECT-OWN` | Client A | Own meal görünür, foreign meal aynı sorguda görünmez; admin fixture varlığını doğrular |
| Client foreign meals SELECT | `MEALS-SELECT-CROSS` | Client A | 0 satır; admin foreign fixture’ın değişmediğini doğrular |
| Client direct `meals` UPDATE | `LEGACY-UPDATE` | Client A | RLS hatası veya 0 satır; admin readback’inde database satırı değişmez |
| Dietitian legitimate meal update | `DIETITIAN-MEAL-UPDATE` | Dietitian A | Fixture `title` değeri güncellenir, admin readback ile doğrulanır ve orijinal değer restore edilir |
| Client own-meal RPC false → true | `RPC-OWN` | Client A | Başarılı |
| Client foreign-meal RPC | `RPC-CROSS` | Client A | Reddedilir ve satır değişmez |
| Mobile offline rollback | Fiziksel cihaz | Client A | UI geri döner, DB değişmez |
| Mobile restart persistence | Fiziksel cihaz | Client A | Tamamlanma korunur |
| Fixture cleanup | Harness cleanup | Admin | Auth/public/Storage sonucu `0/0/0` |

`MEALS-SELECT-OWN`, `MEALS-SELECT-CROSS` ve `DIETITIAN-MEAL-UPDATE` testleri staging güvenlik harness’ine hazırlanmıştır. Bu testler migration staging’e uygulandıktan sonra çalıştırılacaktır; bu hazırlık görevinde staging testi çalıştırılmamıştır.

## 15. Staging uygulama ve regresyon runbook’u

Bu görevde hiçbir komut çalıştırılmayacaktır. Aşama 3E-2B’de, yalnız staging’e linklenmiş disposable çalışma alanında ve açık uygulama onayıyla aşağıdaki sıra izlenir:

1. Staging proje adı ve maskelenmiş ref doğrulanır; production ve GROUNDLESS reddedilir.
2. Repository commit’i ve policy PRE snapshot’ı kaydedilir; fixture manifestinin bulunmadığı doğrulanır.
3. Daha önce doğrulanan tooling ile `npx --yes supabase@latest db push --linked --dry-run` çalıştırılır. Dry-run yalnız bu migration’ı göstermelidir.
4. Ayrı karar kapısından sonra aynı disposable staging çalışma alanında `npx --yes supabase@latest db push --linked` uygulanır.
5. POST verification SQL çalıştırılır; ardından yukarıdaki test matrisi staging fixture üzerinde tamamlanır.
6. Doğrudan UPDATE denemesi client JWT ile `from('meals').update(...)` kullanır; 0 satır/RLS hatasına ek olarak admin doğrulamasında satırın değişmediği kaydedilir.
7. `node .\scripts\staging-security-tests.mjs` yeni meals SELECT ve dietitian UPDATE regresyonlarıyla birlikte çalıştırılır; exit code `0` olmalıdır. P2 fonksiyonel blocker exit code `12`, P0/P1 güvenlik blocker exit code `11`, cleanup hatası exit code `20` üretir.
8. Fixture cleanup, düzeltilmiş script ile `node .\scripts\staging-mobile-meal-test-fixture.mjs cleanup` komutundan sonra `0/0/0` sonucu vermelidir.

Repository kökü bu akışta linklenmez. Bu runbook migration, SQL veya fixture işlemlerinin bu hazırlık görevi içinde uygulandığı anlamına gelmez.

## 16. Rollback yaklaşımı

Rollback yalnız acil staging geri dönüşü için ayrı onayla uygulanabilir. Aşağıdaki SQL eski geniş client direct UPDATE erişimini yeniden açar; varsayılan veya otomatik rollback değildir:

```sql
create policy "Clients can update own meal completion"
on public.meals
for update to authenticated
using (
  exists (
    select 1
    from public.meal_plans as mp
    where mp.id = meals.plan_id
      and mp.client_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.meal_plans as mp
    where mp.id = meals.plan_id
      and mp.client_id = auth.uid()
  )
);
```

## 17. Production blocker

Migration staging’e uygulanmadı, client direct UPDATE reddi doğrulanmadı ve dietitian/mobile regresyonları yeniden çalıştırılmadı. Production rollout blokludur.

## 18. Değiştirilen dosyalar

- `supabase/migrations/20260714010000_remove_legacy_client_meals_update_policy.sql`
- `supabase/verification/legacy_client_meals_update_policy_verification.sql`
- `docs/LEGACY_MEALS_UPDATE_POLICY_REMOVAL_PLAN.md`
- `scripts/staging-security-test-assertions.mjs`
- `scripts/staging-security-tests.mjs`
- `scripts/staging-security-tests.test.mjs`
- `docs/MEALS_RLS_REGRESSION_HARNESS_REPORT.md`
- `docs/MEAL_COMPLETION_STAGING_DEVICE_TEST_REPORT.md`
- `docs/ROADMAP.md`

## 19. Çalıştırılan statik kontroller

Migration ve verification SQL içerikleri, policy/RPC repository taraması, aktif mobil direct UPDATE taraması, whitespace/diff kontrolü ve secret taraması bu görevde çalıştırılır. Staging veya production bağlantısı gerektiren kontrol çalıştırılmaz.

## 20. Sonraki aşama

**Aşama 3E-2B — Legacy policy removal migration’ını yalnız staging’e uygula ve tam RLS/mobil regresyon matrisini çalıştır.**

```text
Legacy compatibility: NOT REQUIRED
Migration prepared: YES
Applied to staging: NO
Applied to production: NO
Production rollout: BLOCKED
Stage 3 complete: NO
```
