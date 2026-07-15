# DietBridge — Production Şema Drift Preflight Raporu

## 1. Amaç

Production identity/history preflight bulgularını repository migration zinciriyle uzlaştırmak ve production mutation öncesindeki salt-okunur contract audit paketini kaydetmek.

## 2. Production kimlik doğrulaması

Disposable CLI alanında seçilen ref'in production environment ile eşleştiği ve linked ref'in aynı production hedefini gösterdiği kullanıcı tarafından doğrulandı. Ref, URL veya credential bu rapora yazılmadı.

## 3. Staging ayrımı

Production ref'in staging environment ref'inden farklı olduğu doğrulandı. GROUNDLESS bu kapsamın dışındadır ve hiçbir işlemde kullanılmadı.

## 4. Disposable workspace

Önceki salt-okunur preflight repository dışında benzersiz geçici alanda yapıldı. Repository kökü linklenmedi. İşlem sonunda disposable alan silindi.

## 5. Remote migration history sonucu

```text
Local migration count: 9
Remote migration count: 0
Production remote migration history: EMPTY
```

Bu sonuç ilk sekiz migration'ın uygulanmadığını tek başına kanıtlamaz; production şeması manuel veya history dışı yollarla oluşmuş olabilir.

## 6. Migration schema eksikliği

SQL Editor salt-okunur kontrolünde `supabase_migrations` şeması ve `supabase_migrations.schema_migrations` relation'ı bulunmadı. Bu görev history şeması oluşturmaz veya değiştirmez.

## 7. Production nesne envanteri

Doğrulanmış örnekler:

- `profiles`, `client_profiles`, `dietitian_profiles`, `dietitian_clients`, `meal_plans`, `meals`, `measurements`, `daily_logs`, `chat_messages` tabloları mevcut.
- `handle_new_user()`, `protect_profile_system_fields()`, `save_my_current_weight(numeric)` ve `set_profiles_updated_at()` mevcut.
- `auth.users.on_auth_user_created` ve `profiles` sistem alanı trigger'ı mevcut.
- Bu varlıklar migration sözleşmelerinin tamamının eşleştiğini kanıtlamaz.

## 8. Meals policy durumu

`public.meals` RLS açıktır. Legacy `Clients can update own meal completion` policy'si ve diyetisyen/client SELECT ile dietitian mutation policy'leri mevcuttur.

## 9. Meal completion RPC durumu

`public.set_my_meal_completion(uuid,boolean)` ve meal/completion adına benzeyen başka public RPC bulunmadı. Bu nedenle RPC readiness kapısının beklenen sonucu `NO`dur.

## 10. Production blocker

- Migration history yok.
- Verification sync function, sync trigger ve consistency constraint eksik.
- Verification alanlarında bir tutarsız satır vardır: `is_verified=true`, `verification_status=pending`.
- `dietitian_profiles`, `appointments` ve `chat_messages` tablolarında RLS kapalı.
- `20260713010300` kapsamındaki 11 policy eksik.
- Dört function'ın `search_path` sözleşmesi canonical hedeften farklı.
- Meal completion RPC production'da yok.
- Dört ekstra policy `EXTRA_POLICY_MANUAL_REVIEW` durumunda.
- Legacy policy removal RPC'ye ve mobil production erişim kanıtına bağlı.

## 11. İlk sekiz migration audit sonucu

Production salt-okunur contract audit'i tamamlandı. Sayısal sonuç:

```text
S01: history schema/table MISSING
S02: 32 MATCH
S03: 29 MATCH, 1 MISSING
S04: 5 MATCH
S05: 7 MATCH, 3 MISMATCH
S06: 4 MISMATCH, 1 MISSING
S07: 3 MATCH
S08: birleşik sorgu runtime error; ayrıştırılmış ham katalog audit'i başarılı
Expected policy: 41
Expected policy present: 30
Expected policy missing: 11
Extra policy: 4
S09: weight RPC grants 4 MATCH, meal RPC 4 MISSING
S10: 2 MATCH, 1 NOT_APPLICABLE
S11: RPC_READY_FOR_POLICY_REMOVAL=NO
```

Baseline geniş ve idempotent değildir. Nesne varlığı üzerinden toplu history adoption güvenli değildir.

## 12. History repair riski

`migration repair` yalnız tracking state'ini değiştirir; SQL uygulamaz. Eksik veya kısmi migration'ın applied işaretlenmesi, sonraki `db push` işleminin gerekli SQL'i atlamasına neden olabilir. Bu görevde repair yapılmadı.

## 13. RPC bağımlılığı

`20260713010400` production'da eksiktir ve applied işaretlenemez. `20260714010000` ancak RPC signature/security/search path/body/grant sözleşmesi ve mobil production erişimi doğrulandıktan sonra değerlendirilebilir.

## 14. Hazırlanan verification SQL

[`production_migration_history_reconciliation_verification.sql`](../supabase/verification/production_migration_history_reconciliation_verification.sql) history catalog, kritik tablo/kolon/constraint/index/RLS, function, trigger, policy, default privilege ve execute grant sözleşmelerini salt okunur olarak sınıflandırır. Sonuçlar `MATCH`, `MISSING`, `MISMATCH`, `NOT_APPLICABLE` veya `MANUAL_REVIEW` üretir.

History relation'ı var olmayabileceği için exact version listesi dinamik SQL kullanılmadan aynı hata-güvenli sorguda okunamaz; relation mevcut çıkarsa ayrı guarded read-only adım gerekir.

### Tamamlanan production contract audit

İlk salt-okunur production çalıştırması sonuç üretmeden PostgreSQL runtime/catalog deparse hatasıyla durdu:

```text
ERROR: 42P01: relation "own" does not exist
```

Hata verification SQL'in Statement 08 policy contract bölümündeki `pg_policies` deparse yoluna daraltıldı. Dosyada `own` adlı relation, CTE veya identifier yoktu; `own` yalnız tek tırnaklı policy adı string'lerinde bulunuyordu. `pg_policies` görünümü kaldırılarak ham `pg_policy` metadata kontrolüne geçildi. Predicate gövdesi decompile edilmeden temel policy sözleşmesi doğrulanır; semantik predicate sonucu `MANUAL_REVIEW` olarak bırakılır.

Birleşik Statement 08 aynı 42P01 hatasını yeniden üretse de policy adları/komutları, raw roller, `USING` varlığı ve `WITH CHECK` varlığı ham `pg_policy` katalog sorgularıyla ayrı ayrı başarıyla okundu. Audit sonucu bu ayrıştırılmış kanıtla tamamlandı; production şeması veya verisi değişmedi.

Statement 08 artık expected-policy join veya predicate decompile yapmayan, kritik tablolarla sınırlı `MANUAL_REVIEW` inventory sorgusudur.

## 15. Uzlaştırma karar ağacı

- Tam `MATCH`: SQL tekrar çalıştırılmaz; version bazında manuel history adoption değerlendirilebilir.
- `MISSING`: Applied işaretlenmez; bağımlılık sırasıyla forward rollout planlanır.
- Kısmi: Orijinal migration körlemesine çalıştırılmaz; hedefli reconciliation migration değerlendirilir.
- `MISMATCH`: Rollout durur ve drift kararı alınır.

## 16. Değiştirilen dosyalar

- `supabase/reconciliation/production_pre_policy_removal_reconciliation.sql`
- `supabase/verification/production_pre_policy_removal_reconciliation_preflight.sql`
- `supabase/verification/production_pre_policy_removal_reconciliation_postflight.sql`
- `scripts/production-reconciliation-validator.test.mjs`
- `docs/PRODUCTION_SCHEMA_DRIFT_PREFLIGHT_REPORT.md`
- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md`
- `docs/PRODUCTION_PRE_POLICY_RECONCILIATION_PACKAGE_REPORT.md`
- `docs/ROADMAP.md`

## 17. Statik doğrulamalar

Preflight/postflight read-only taraması, ana SQL izin/yasak kapsam taraması, Statement 08 marker/statement kontrolleri, repository testleri, typecheck, lint, diff ve secret kontrolleri commit öncesinde çalıştırılır. Sonuçlar yalnız gerçek komut çıktısına göre görev raporunda kaydedilir.

## 18. Uygulanmayan işlemler

Tamamlanan salt-okunur production contract audit kullanıcı tarafından Production SQL Editor'da yürütüldü; ayrıştırılmış katalog sorguları sonucu üretti ve DDL/veri mutation'ı oluşturmadı. Bu paket hazırlığında Supabase login, project list, link, migration list, SQL Editor sorgusu, dry-run, `db push`, `migration repair`, reconciliation/policy/RPC uygulaması, fixture veya kullanıcı oluşturma yapılmadı.

## 19. Sonuç

```text
Production identity verified: YES
Production migration history available: NO
Production schema fully reconciled: NO
Meal completion RPC available: NO
Legacy policy removable: NO
Production migration applied: NO
Production reconciliation package prepared: YES
Production reconciliation applied: NO
Data remediation required: NO
Data remediation applied: YES
Decision: NOT READY
```

## 20. Verification consistency ve reconciliation uygulama sonucu

```text
Verification sync function: MISSING
Verification sync trigger: MISSING
Verification consistency constraint: MISSING
Verification inconsistent rows before remediation: 1
Drift combination before remediation: true + pending
Canonical source-of-truth: verification_status
Canonical remediation result: false + pending
DATA_REMEDIATION_REQUIRED: NO
Data remediation: APPLIED AND PRESERVED
Production reconciliation application: BLOCKED
```

Data remediation daha önce başarıyla uygulandı. Güncel salt-okunur preflight `VERIFICATION_DATA_CONSISTENCY=MATCH`, `DATA_REMEDIATION_READY=NO` ve `RECONCILIATION_READY=YES` üretti. Ana reconciliation denemesi `handle_new_user()` generic function postcondition hatasında fail-closed durdu; transaction rollback olduğu için meal RPC, RLS, policy veya function değişikliği kalıcılaşmadı. Legacy policy kaldırılmadı.

Validator düzeltmesi hardcoded Grup A/B body hash'lerini semantic invariant kontrolleriyle, exact `function_config` string karşılaştırmasını `proconfig` array sözleşmesiyle değiştirdi. Production reconciliation retry bekliyor.

## 21. Sonraki aşama

Güncellenmiş `production_pre_policy_removal_reconciliation_preflight.sql` dosyasını salt-okunur çalıştır ve `RECONCILIATION_READY=YES` sonucunu yeniden doğrula. Reconciliation retry için ayrıca açık uygulama adımı gerekir.
