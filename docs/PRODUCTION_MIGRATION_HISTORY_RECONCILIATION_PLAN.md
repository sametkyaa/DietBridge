# DietBridge — Production Migration History Uzlaştırma Planı

## 1. Amaç ve karar sınırı

Production şeması mevcut olmasına rağmen `supabase_migrations.schema_migrations` bulunmamaktadır. Bu plan, repository'deki ilk sekiz active migration'ın production'daki kalıcı sözleşmeleriyle salt okunur biçimde karşılaştırılmasını ve her version için ayrı adoption kararı verilmesini tanımlar.

Bu belge migration uygulamaz, history oluşturmaz ve `migration repair` çalıştırmaz. Production'daki doğrulanmış mevcut karar `NOT READY FOR PRODUCTION MIGRATION`dır.

## 2. Doğrulanmış başlangıç durumu

```text
Production project identity: PASS
Production/staging separation: PASS
Production remote migration history: EMPTY
supabase_migrations schema: MISSING
Legacy client direct UPDATE policy: PRESENT
public.meals RLS: ENABLED
set_my_meal_completion(uuid,boolean): MISSING
Production migration applied: NO
Production dry-run executed: NO
migration repair executed: NO
```

## 3. İlk sekiz migration sözleşmesi

| Version | Amaç | Oluşturulan/değiştirilen nesneler | Güvenlik sözleşmesi | Tekrar uygulanma riski |
|---|---|---|---|---|
| `20260713000000` | Baseline restore öncesinde geniş default table privilege mirasını kapatmak | `postgres` rolünün `public` tablo default ACL'i | Yeni tablolar anon/authenticated geniş yetkiyi otomatik almamalı | Sonraki baseline default grant'leri bu nihai durumu ezdiği için tarihsel uygulama final katalogdan kanıtlanamaz; tekrar uygulama gelecekteki tabloların erişimini değiştirir |
| `20260713000001` | Production `public` şema baseline'ı | 3 enum, 21 tablo, PK/FK/UNIQUE/CHECK, indexler, 10 function, 7 trigger, 51 policy, RLS ve grants/default privileges | Şema, sahiplik, RLS ve Data API erişim yüzeyi birlikte kurulmalıdır | **Yüksek:** enum/constraint/policy çakışması; bazı tablolar `IF NOT EXISTS` olsa da zincir idempotent değildir; mevcut production verisi/şeması üzerinde körlemesine çalıştırılamaz |
| `20260713010000` | Function search path ve execute yüzeyi hardening | `is_current_user_dietitian()` replace; dokuz function search path/execute düzeni | Güvenlik helper'ı verified dietitian kontrolü yapar; browser rolleri yalnız gerekli RPC/helper'ları çağırır | DDL çoğunlukla yeniden çalışır ancak function gövdesini/grant'leri yeniden yazar; tam sözleşme doğrulanmadan history adoption yapılamaz |
| `20260713010100` | Verification alanı tutarlılığı | `sync_dietitian_verification_fields()`, trigger ve CHECK constraint | `verification_status` kanonik; `is_verified` mirror; browser escalation reddedilir | **İdempotent değil:** function/trigger/constraint mevcutsa hata; tutarsız production verisinde fail-closed durur |
| `20260713010200` | Auth onboarding hardening | `handle_new_user()` replace ve direct execute revoke | Yalnız `client` veya `dietitian`; dietitian pending/false başlar; profile hataları yutulmaz | Replace yeniden çalışabilir ancak onboarding davranışını değiştirir; yalnız function varlığı tam sözleşmeyi kanıtlamaz |
| `20260713010300` | Kritik tablo RLS ve sistem alanı koruması | `protect_dietitian_profile_system_fields()`, trigger, 11 policy, `dietitian_profiles`/`appointments`/`chat_messages` RLS | Verified dietitian, aktif ilişki, sender/owner ve system-field guard'ları | **İdempotent değil:** hedef tablolarda herhangi bir policy varsa fail-fast; mevcut policy/trigger ile çakışır; veri önkoşulu vardır |
| `20260713010400` | Dar meal completion RPC | `set_my_meal_completion(uuid,boolean)` ve execute grants | SECURITY DEFINER + sabit search path + `auth.uid()` sahipliği; yalnız `is_eaten`; anon/PUBLIC kapalı, authenticated açık | **İdempotent değil:** RPC varsa fail-fast. Production'da eksik olduğu doğrulandığından applied işaretlenemez |
| `20260713010500` | Auth onboarding trigger'ını garanti etmek | Eksikse `auth.users.on_auth_user_created` | AFTER INSERT FOR EACH ROW, enabled ve hedef `handle_new_user()` | Tam eşleşen trigger varsa idempotent; drift/disabled/farklı function varsa fail-fast |

Dokuzuncu migration `20260714010000`, legacy `Clients can update own meal completion` policy'sini kaldırır. `20260713010400` RPC sözleşmesi ve mobil production RPC erişimi doğrulanmadan uygulanamaz veya applied işaretlenemez.

## 4. Tam uygulanmışlığın kanıt standardı

Bir nesnenin yalnız var olması migration'ın tamamının uygulandığını kanıtlamaz. Her version için ilgili tablo/kolon/default, constraint/index, function body/security/search path/owner/execute, trigger timing/event/target, policy command/role/USING/WITH CHECK ve RLS sözleşmelerinin tamamı `MATCH` olmalıdır.

Özellikle:

- `20260713000000` etkisi sonraki baseline default grant'leri tarafından supersede edildiği için final state'ten tek başına ispatlanamaz.
- `20260713000001` 21 tablonun varlığıyla kanıtlanamaz; tüm bağımlı nesneler ve ACL'ler gerekir.
- `20260713010000`, `10200` için function varlığı yeterli değildir; gövde ve grants doğrulanmalıdır.
- `20260713010100`, `10300`, `10500` için function + trigger + constraint/policy/RLS bütünü gerekir.
- `20260713010400` için signature, SECURITY DEFINER, fixed search path, body ve execute sözleşmesi birlikte gerekir.

## 5. Karar ağacı

### Senaryo A — Migration sözleşmesi tamamen eşleşiyor

Tüm kontroller `MATCH` ise migration SQL'i tekrar çalıştırılmaz. O version'ın history'ye `applied` olarak alınması değerlendirilebilir; ancak `migration repair` otomatik çalıştırılmaz. Her version için ayrı manuel onay, backup/restore noktası ve iki kişilik karar kapısı gerekir.

### Senaryo B — Migration tamamen eksik

Migration `applied` işaretlenmez. Bağımlılık sırasına göre güvenli forward uygulama planlanır. Eksik RPC için bu senaryo geçerlidir.

### Senaryo C — Migration kısmen uygulanmış

Migration `applied` işaretlenmez ve orijinal SQL körlemesine çalıştırılmaz. Mevcut doğru nesnelere dokunmayan, drift'te fail-fast duran hedefli reconciliation paketi hazırlanır. Paket active migration zincirinin dışında kalır ve ayrı production onayı olmadan çalıştırılmaz.

### Senaryo D — Production sözleşmesi repository'den farklı

Production rollout durur. Drift raporu ve şema kararı tamamlanmadan history, policy, trigger, grant veya function değiştirilmez.

## 6. `migration repair` güvenlik planı

Resmî [Supabase database migrations dokümantasyonuna](https://supabase.com/docs/guides/deployment/database-migrations) göre `migration repair` SQL uygulamaz; remote history kaydını değiştirir. Bu nedenle yanlış `applied` kaydı sonraki `db push` kararını tehlikeli biçimde etkiler.

Kurallar:

- Remote history boş diye ilk sekiz version topluca `applied` işaretlenemez.
- Her version bağımsız doğrulanır.
- `MISSING`, `MISMATCH`, `MANUAL_REVIEW` veya kısmi sözleşme applied işaretlenemez.
- `20260713010400`, RPC production'da eksik olduğu için applied işaretlenemez.
- `20260714010000`, legacy policy mevcut ve RPC eksik olduğu için applied işaretlenemez.
- `20260713000000` superseded tarihsel etki nedeniyle yalnız final-state audit ile otomatik adopted edilemez.

Bir version için repair ancak bütün sözleşmeler `MATCH`, production backup/restore noktası hazır, history/list doğrulaması tamamlanmış ve iki kişilik manuel karar kapısı geçmişse önerilebilir. Komut bu belgede kasıtlı olarak çalıştırılabilir değerle verilmez; version placeholder'ı ayrı mutation görevinde doldurulur.

## 7. Hedefli reconciliation seçenekleri

| Seçenek | Uygun durum | Risk/karar |
|---|---|---|
| Orijinal migration'ı tekrar çalıştırma | Yalnız tamamen eksik ve veri/lock etkisi ayrıca kabul edilmişse | CREATE çakışması, duplicate policy/trigger, grant drift'i, production veri etkisi ve zincirin yarıda kalması riski yüksek |
| History repair | Yalnız bütün sözleşmeleri tam `MATCH` version | Şemayı değiştirmez; yanlış adoption sonraki push sırasını bozar |
| Yeni reconciliation migration | Kısmi ancak hedef state kesin belirlenmişse | Tercih edilen yaklaşım: doğru nesneye dokunmaz, eksik nesneyi fail-fast guard ile ekler, drift'te durur |
| Yeni production baseline | History tamamen yok ve çok sayıda kısmi migration varsa | Repository/staging history ile ayrışma yaratabilir; ayrı mimari karar ve rollout gerekir |

## 8. Güvenli production sırası

1. İlk sekiz migration için salt-okunur contract audit.
2. Her version'ı `MATCH`, `MISSING`, `MISMATCH`, `MANUAL_REVIEW` olarak sınıflandır.
3. Tam eşleşen version'lar için ayrı history adoption kararı ver.
4. Kısmi/eksik version'lar için hedefli reconciliation veya forward migration kararı al.
5. Eksik meal completion RPC'yi ayrı onaylı production migration'ıyla ekle.
6. RPC catalog ve function privilege postflight yap.
7. Açıkça ayrılmış test hesabı varsa own/foreign RPC smoke testi yap; yoksa veri mutation testi yapma.
8. Mobil production client'ın RPC endpoint'ine eriştiğini doğrula.
9. Yalnız bundan sonra legacy policy removal migration'ını değerlendir.
10. Policy/RPC/RLS postflight, history doğrulaması ve mutasyonsuz application smoke testi yap.

## 9. Production Meal Completion RPC Rollout

Ön koşullar:

- `public.meals`, `public.meal_plans` ve `meals_plan_id_fkey` sözleşmeleri doğrulanmış olmalı.
- Client ve dietitian SELECT policy'leri mevcut olmalı.
- RPC SQL'i repository'deki `20260713010400` ile eşleşmeli.
- SECURITY DEFINER kullanımı, `pg_catalog, public` search path ve `auth.uid()` sahiplik kontrolü birlikte doğrulanmalı.
- Function yalnız `is_eaten` alanını güncellemeli.
- PUBLIC/anon execute kapalı, authenticated execute açık olmalı.

RPC uygulandıktan ve policy kaldırılmadan önce catalog, privilege ve body invariant sonuçları `MATCH` olmalıdır. Gerçek kullanıcı verisi kullanılmaz. Ayrı production test hesabı yoksa own/foreign mutation testi yapılmaz; staging fiziksel cihaz kanıtı korunur fakat production doğrulaması gibi sunulmaz.

## 10. Verification SQL ve history sınırlaması

[`production_migration_history_reconciliation_verification.sql`](../supabase/verification/production_migration_history_reconciliation_verification.sql) yalnız katalog ve information schema okur. `supabase_migrations.schema_migrations` eksikken hata vermemek için relation satırlarına doğrudan referans vermez.

Tablo mevcut çıkarsa exact count/version listesi, ayrı onaylı ve tablo varlığı doğrulanmış ikinci salt-okunur adımda alınmalıdır. Bu sınırlama `MANUAL_REVIEW` olarak görünür; dinamik SQL veya mutation ile aşılmaz.

## 11. Production contract audit sonrası version sınıflandırması

| Version | Audit sonucu | History adoption durumu |
|---|---|---|
| `20260713000000` | Tarihsel final state'ten kanıtlanamıyor | `MANUAL_REVIEW` |
| `20260713000001` | Kritik örnek sözleşmeler büyük ölçüde `MATCH`, fakat migration'ın bütün 21 tablo/10 function/7 trigger/51 policy kapsamı tamamen kanıtlanmadı | `NOT YET ELIGIBLE` |
| `20260713010000` | Function `search_path` drift'i var | `NOT ELIGIBLE` |
| `20260713010100` | Verification consistency constraint eksik | `NOT ELIGIBLE` |
| `20260713010200` | `handle_new_user` `search_path` drift'i var | `NOT ELIGIBLE` |
| `20260713010300` | Üç tabloda RLS ve 11 policy eksik | `NOT ELIGIBLE` |
| `20260713010400` | RPC tamamen eksik | `NOT ELIGIBLE` |
| `20260713010500` | Trigger sözleşmesi `MATCH` | `CANDIDATE`; dependency ve tam migration incelemesi gerekir |
| `20260714010000` | Legacy policy hâlâ mevcut ve RPC smoke testi yapılmadı | `BLOCKED` |

Reconciliation başarıyla uygulansa bile toplu veya otomatik `migration repair` yapılmaz. Her version, postflight kanıtı ve tam migration sözleşmesi üzerinden ayrı yeniden sınıflandırılır.

## 12. Hazırlanan pre-policy reconciliation paketi

Paket active migration dizini dışında üç parçalıdır: salt-okunur preflight, transaction/fail-fast ana SQL ve salt-okunur postflight. Ana SQL yalnız audit ile doğrulanan drift kapsamını hedefler. Migration history, legacy client UPDATE policy'si, dört ekstra policy ve production satırları bu paketin değişiklik kapsamı dışındadır.

Hazırlık durumu `PREPARED`, uygulama durumu `NOT APPLIED`dır. Bir sonraki kapı, production SQL Editor'da yalnız preflight SQL'inin salt-okunur çalıştırılmasıdır.

## 13. Son karar

```text
Production schema fully reconciled: NO
Meal completion RPC available: NO
Legacy policy removable: NO
Production migration applied: NO
Production reconciliation package prepared: YES
Production reconciliation applied: NO
Decision: NOT READY
```
