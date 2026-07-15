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
- İlk sekiz migration'ın production sözleşmesi tam doğrulanmadı.
- Meal completion RPC production'da yok.
- Legacy policy removal RPC'ye ve mobil production erişim kanıtına bağlı.

## 11. İlk sekiz migration audit ihtiyacı

Baseline geniş ve idempotent değildir. Sonraki hardening migration'ları function body, trigger, constraint, grants ve policy semantiği taşır. Nesne varlığı üzerinden toplu history adoption güvenli değildir.

## 12. History repair riski

`migration repair` yalnız tracking state'ini değiştirir; SQL uygulamaz. Eksik veya kısmi migration'ın applied işaretlenmesi, sonraki `db push` işleminin gerekli SQL'i atlamasına neden olabilir. Bu görevde repair yapılmadı.

## 13. RPC bağımlılığı

`20260713010400` production'da eksiktir ve applied işaretlenemez. `20260714010000` ancak RPC signature/security/search path/body/grant sözleşmesi ve mobil production erişimi doğrulandıktan sonra değerlendirilebilir.

## 14. Hazırlanan verification SQL

[`production_migration_history_reconciliation_verification.sql`](../supabase/verification/production_migration_history_reconciliation_verification.sql) history catalog, kritik tablo/kolon/constraint/index/RLS, function, trigger, policy, default privilege ve execute grant sözleşmelerini salt okunur olarak sınıflandırır. Sonuçlar `MATCH`, `MISSING`, `MISMATCH`, `NOT_APPLICABLE` veya `MANUAL_REVIEW` üretir.

History relation'ı var olmayabileceği için exact version listesi dinamik SQL kullanılmadan aynı hata-güvenli sorguda okunamaz; relation mevcut çıkarsa ayrı guarded read-only adım gerekir.

## 15. Uzlaştırma karar ağacı

- Tam `MATCH`: SQL tekrar çalıştırılmaz; version bazında manuel history adoption değerlendirilebilir.
- `MISSING`: Applied işaretlenmez; bağımlılık sırasıyla forward rollout planlanır.
- Kısmi: Orijinal migration körlemesine çalıştırılmaz; hedefli reconciliation migration değerlendirilir.
- `MISMATCH`: Rollout durur ve drift kararı alınır.

## 16. Değiştirilen dosyalar

- `supabase/verification/production_migration_history_reconciliation_verification.sql`
- `docs/PRODUCTION_MIGRATION_HISTORY_RECONCILIATION_PLAN.md`
- `docs/PRODUCTION_SCHEMA_DRIFT_PREFLIGHT_REPORT.md`
- `docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md`
- `docs/ROADMAP.md`

## 17. Statik doğrulamalar

SQL read-only/mutation-token kontrolü, repository testleri, typecheck, lint, diff, secret taraması ve mobil repository değişmezliği commit öncesinde çalıştırılır. Sonuçlar yalnız gerçek komut çıktısına göre görev raporunda kaydedilir.

## 18. Uygulanmayan işlemler

Bu hazırlık görevinde Supabase login, project list, link, migration list, SQL Editor sorgusu, dry-run, `db push`, `migration repair`, migration/policy/RPC uygulaması, fixture ve kullanıcı oluşturma yapılmadı.

## 19. Sonuç

```text
Production identity verified: YES
Production migration history available: NO
Production schema fully reconciled: NO
Meal completion RPC available: NO
Legacy policy removable: NO
Production migration applied: NO
Decision: NOT READY
```

## 20. Sonraki aşama

Aşama 3E-2C-2B — Production SQL Editor'da salt-okunur reconciliation verification SQL'ini çalıştır ve ilk sekiz migration'ı `MATCH`/`MISSING`/`MISMATCH`/`MANUAL_REVIEW` olarak sınıflandır.
