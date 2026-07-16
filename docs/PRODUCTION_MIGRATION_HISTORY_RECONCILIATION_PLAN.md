# DietBridge — Production Migration History Adoption Planı

## 1. Amaç ve güncel durum

Bu plan, remote migration history’si boş olan ancak canonical reconciliation ile güncel local zincirin final sözleşmesine getirilmiş production şemasını yeniden uygulamadan version bazlı history adoption kararını tanımlar.

```text
Production project identity: PASS
Production/staging separation: PASS
Production reconciliation: APPLIED SUCCESSFULLY
Reconciliation postflight: PASS
Verification consistency contract: PASS
Meal completion RPC: PRESENT AND MATCH
RPC production smoke tests: PASSED
Physical Android production smoke: PASSED
Fixture cleanup: PASSED
Remaining fixture records: 0
Legacy policy: STILL PRESENT
Policy removal functional gate before cleanup: PASSED
Remote migration history: EMPTY
Local migrations: 9
Migration history adoption: BLOCKER
```

Bu görev yalnız repository içindeki migration, reconciliation, verification ve kullanıcı tarafından doğrulanmış sanitized production sonuçlarını statik olarak uzlaştırır. Production veya staging’e bağlanmaz ve history mutation çalıştırmaz.

## 2. Karar standardı

Sınıflandırma yalnız şu değerlerden biridir:

```text
MATCH
MATCH_VIA_RECONCILIATION
SUPERSEDED_MANUAL_REVIEW
MISSING
MISMATCH
NOT_APPLICABLE
```

Bir version’ın yalnız bazı nesnelerinin varlığı yeterli değildir. Değerlendirme; schema/table/type, kolon/default/nullability, PK/FK/UNIQUE/CHECK, index, function signature/body/security/search_path/owner, execute grants, trigger timing/event/level/target/enabled state, RLS, policy command/roles/USING/WITH CHECK, table/schema/default privileges ve dependency order kapsamını içerir.

## 3. Version bazlı sonuç matrisi

| Version | Sınıf | `history_adoption_eligible` | Deterministic reason |
|---|---|---:|---|
| `20260713000000` | `SUPERSEDED_MANUAL_REVIEW` | `NO` | Prelude’nun baseline’dan önce çalıştığı final katalogdan kanıtlanamaz; ayrı tarihsel risk acceptance zorunlu |
| `20260713000001` | `MATCH_VIA_RECONCILIATION` | `YES` | 3 type, 21 table, 58 constraint, 21 index, 10 function, 7 trigger, 51 policy, 18 RLS ve privilege temeli mevcut; sonraki hardening/reconciliation final-state farklarını açıklıyor |
| `20260713010000` | `MATCH_VIA_RECONCILIATION` | `YES` | Audited function search_path/execute drift’i reconciliation ile canonical final sözleşmeye getirildi ve postflight geçti |
| `20260713010100` | `MATCH_VIA_RECONCILIATION` | `YES` | Ayrı veri remediation sonrası canonical function, BEFORE INSERT/UPDATE trigger ve validated consistency CHECK reconciliation ile kuruldu |
| `20260713010200` | `MATCH_VIA_RECONCILIATION` | `YES` | `handle_new_user()` canonical allowlist body/security/search_path/execute sözleşmesi reconciliation ile kuruldu |
| `20260713010300` | `MATCH_VIA_RECONCILIATION` | `YES` | 11 critical policy, 3 RLS enablement ve dietitian system-field guard reconciliation ile canonical hale getirildi |
| `20260713010400` | `MATCH_VIA_RECONCILIATION` | `YES` | Canonical own-meal RPC ve grant sözleşmesi reconciliation ile kuruldu; CLI ve fiziksel mobil production testleri geçti |
| `20260713010500` | `MATCH` | `YES` | Enabled `auth.users` AFTER INSERT FOR EACH ROW trigger hedefi `public.handle_new_user()` olarak reconciliation öncesi/sonrası eşleşti |
| `20260714010000` | `MISSING` | `NO` | Exact legacy policy hâlâ mevcut; migration gerçek push için pending kalmalı ve history’ye önceden alınmamalı |

Eligibility history mutation yetkisi değildir. İlk sekiz version’ın her biri ayrı manuel approval, backup/restore point ve mutation sonrası remote list kontrolü gerektirir.

## 4. Kalıcı sözleşme envanteri

### `20260713000000` — Default privilege prelude

- **Privilege:** `public` şemasında gelecekte oluşturulacak tablolar için anon/authenticated default table privilege’larını revoke eder.
- **Tarihsel bağımlılık:** Baseline restore’dan önce çalışmalıdır.
- **Final-state sınırı:** Sonraki baseline kendi default table grants’lerini yeniden tanımlar; bu nedenle tarihsel uygulama sırası final ACL’den türetilemez.
- **Karar:** `SUPERSEDED_MANUAL_REVIEW`; otomatik `MATCH` veya bulk adoption yasak.

### `20260713000001` — Production public baseline

- **Schema/type/table:** 3 enum, 21 public tablo; kolon type/default/nullability sözleşmeleri.
- **Constraint/index:** 58 PK/FK/UNIQUE/CHECK, 21 index.
- **Function/trigger:** 10 function ve 7 trigger; signature, owner, security, body ve başlangıç search_path/grant yüzeyi.
- **RLS/policy:** 18 RLS-enabled tablo ve 51 policy.
- **Privilege:** schema usage, tablo/sequence/function grants ve 12 default privilege statement.
- **Dependency:** Bütün sonraki hardening migration’larının temelidir. Sonraki migration’ın bilinçli olarak değiştirdiği function/grant/policy alanları baseline mismatch sayılmaz; final zincir semantiği esas alınır.

### `20260713010000` — Function security hardening

- `is_current_user_dietitian()` canonical SECURITY DEFINER body ve `pg_catalog, public` search_path.
- Dokuz mevcut function için fixed search_path; browser-callable helper/RPC’lerde dar grant, trigger/internal function’larda PUBLIC/anon/authenticated execute revoke.
- Reconciliation audited drift bulunan function’ları canonical hale getirdi; diğer kalıcı contract’lar postflight başlangıç/precondition sözleşmesiyle korundu.

### `20260713010100` — Verification consistency

- `sync_dietitian_verification_fields()` non-definer trigger function, fixed search_path ve direct execute revoke.
- `trg_sync_dietitian_verification_fields`: BEFORE INSERT OR UPDATE, FOR EACH ROW, enabled, doğru target/function.
- `dietitian_profiles_verification_consistency_check`: validated, no-inherit olmayan canonical null-safe CHECK.
- `verification_status` source of truth, `is_verified` mirror; browser escalation reddedilir.

### `20260713010200` — Auth onboarding hardening

- `handle_new_user()` SECURITY DEFINER, trigger return, owner `postgres`, fixed search_path.
- Metadata yalnız `client`/`dietitian`; profile ve subtype satırları fail-closed oluşturulur.
- Dietitian `pending/false` başlar; PUBLIC/anon/authenticated execute kapalı, service role korunur.

### `20260713010300` — Critical RLS

- `protect_dietitian_profile_system_fields()` ve BEFORE INSERT/UPDATE row trigger.
- `dietitian_profiles` için 4, `appointments` için 5, `chat_messages` için 2 canonical policy.
- Policy’lerde authenticated role, doğru command, USING/WITH CHECK ve active relationship/owner/sender semantiği.
- Üç tabloda RLS enabled.

### `20260713010400` — Meal completion RPC

- `set_my_meal_completion(uuid,boolean) returns boolean`.
- SECURITY DEFINER, owner `postgres`, fixed search_path.
- `auth.uid()` ile plan client ownership; yalnız `meals.is_eaten` update; tam bir satır dışında `42501`.
- authenticated/service_role execute açık; anon/PUBLIC kapalı.
- Production own/foreign/persistence/anonymous CLI ve fiziksel Android own/persistence/foreign-not-exposed kanıtları `PASS`.

### `20260713010500` — Auth trigger assurance

- `auth.users.on_auth_user_created` AFTER INSERT, FOR EACH ROW, enabled.
- Target `public.handle_new_user()`.
- Eksikse oluşturur; drift/disabled target’ı değiştirmeden fail-fast durur.

### `20260714010000` — Legacy policy removal

- Precondition yalnız exact `Clients can update own meal completion` UPDATE/authenticated/USING/WITH CHECK sözleşmesini kabul eder.
- Kalıcı etki yalnız bu policy’nin kaldırılmasıdır.
- Şu anda policy `PRESENT`; migration `MISSING`/pending ve adoption için uygun değildir.

## 5. `20260713000000` özel kararı

Dört seçenek değerlendirilmiştir:

1. **Ayrı manuel risk acceptance ile applied adoption — önerilen.** Final state prelude’nun tarihsel çalışmasını kanıtlamaz. Bu belirsizlik açıkça kabul edilir, version tek başına history’ye alınır ve hemen list kontrolü yapılır.
2. **Superseded/NOT_APPLICABLE bırakma — önerilmez.** Remote/local exact version hedefini ve tek pending migration durumunu engeller.
3. **Yeni production baseline/history — önerilmez.** Mevcut staging/local dokuz-version zinciriyle yeni ayrışma yaratır.
4. **Local zinciri değiştirmeden başka yöntem — uygun güvenli alternatif bulunmadı.** Supabase history modeli exact eşleşme için version kaydı gerektirir.

Seçenek 1’in önerilmesi mevcut anda eligibility vermez. İmzalı risk acceptance oluşana kadar:

```text
20260713000000 history_adoption_eligible=NO
POLICY REMOVAL BLOCKED
```

## 6. Adoption kararı

### Mevcut durumda uygun

Her biri ayrı approval ile: `20260713000001`, `20260713010000`, `20260713010100`, `20260713010200`, `20260713010300`, `20260713010400`, `20260713010500`.

### Mevcut durumda uygun değil

- `20260713000000`: tarihsel risk acceptance bekliyor.
- `20260714010000`: history adoption yapılmayacak; gerçek pending migration olarak push bekliyor.

Bu nedenle ilk sekiz version otomatik veya toplu biçimde repair edilemez. `20260713000000` kararı tamamlanmadan policy removal blokludur.

## 7. Hedef history

Policy kaldırma öncesi remote:

```text
20260713000000
20260713000001
20260713010000
20260713010100
20260713010200
20260713010300
20260713010400
20260713010500
```

Local-only pending: `20260714010000`.

Dry-run yalnız bu exact `8 remote / 9 local` durumda tek pending migration göstermelidir. Push sonrasında hedef `9 local / 9 remote / exact version match`tir.

## 8. Tarihsel kayıt

Önceki salt-okunur audit sırasında migration history/scheme yoktu; verification function/trigger/constraint, 11 critical policy, üç RLS enablement, function search_path hardening ve meal completion RPC eksik/drifted olarak kaydedildi. İlk reconciliation denemeleri function ve constraint validator’larında fail-closed rollback oldu. Ayrı verification data remediation ve validator düzeltmelerinden sonra reconciliation retry 3 başarıyla uygulandı; postflight bütün canonical kapıları geçti. Sonraki production CLI ve fiziksel mobil smoke testleri geçti; fixture tamamen temizlendi. Bu tarihsel `MISSING`, `NOT READY`, `NOT RUN` ve rollback sonuçları olay anı için geçerlidir; güncel kararın yerine geçmez.

İlk audit snapshot’ı:

```text
Production remote migration history: EMPTY
supabase_migrations schema: MISSING
Legacy client direct UPDATE policy: PRESENT
public.meals RLS: ENABLED
set_my_meal_completion(uuid,boolean): MISSING
Production migration applied: NO
Production dry-run executed: NO
migration repair executed: NO
```

İlk version sınıflandırması da tarihsel kanıt olarak korunur:

| Version | Önceki audit sonucu | Önceki karar |
|---|---|---|
| `20260713000000` | Tarihsel final state’ten kanıtlanamıyor | `MANUAL_REVIEW` |
| `20260713000001` | Kritik örnekler büyük ölçüde match, tam kapsam henüz kanıtlanmamıştı | `NOT YET ELIGIBLE` |
| `20260713010000` | Function search_path drift’i | `NOT ELIGIBLE` |
| `20260713010100` | Function/trigger/constraint eksik ve bir tutarsız verification satırı | `NOT ELIGIBLE` |
| `20260713010200` | `handle_new_user` search_path drift’i | `NOT ELIGIBLE` |
| `20260713010300` | Üç RLS ve 11 policy eksik | `NOT ELIGIBLE` |
| `20260713010400` | RPC eksik | `NOT ELIGIBLE` |
| `20260713010500` | Auth trigger sözleşmesi eşleşiyor | `CANDIDATE` |
| `20260714010000` | Legacy policy mevcut, RPC smoke henüz yapılmamıştı | `BLOCKED` |

Bu snapshot sonrasında data remediation ve reconciliation gerçekten uygulandığı için güncel version sınıfları Bölüm 3’teki sonuçlardır.

## 9. Son karar

```text
LOCAL_MIGRATION_CHAIN_VALID=YES
RECONCILIATION_EQUIVALENCE_VALID=YES
HISTORY_ADOPTION_PLAN_COMPLETE=YES
AUTOMATIC_BULK_REPAIR_ALLOWED=NO
POLICY_REMOVAL_MIGRATION_READY_AFTER_ADOPTION=YES
CURRENT_POLICY_REMOVAL_STATUS=BLOCKED_BY_HISTORY_ADOPTION
```
