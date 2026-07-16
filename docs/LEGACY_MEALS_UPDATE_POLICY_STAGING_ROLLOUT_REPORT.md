# DietBridge — Legacy Meals UPDATE Policy Staging Rollout Raporu

## 1. Amaç

Legacy client direct `public.meals` UPDATE erişimini yalnız staging ortamında kaldırmak ve policy, RLS, RPC ile fiziksel Android regresyon sonuçlarını kaydetmek.

## 2. Başlangıç durumu

Rollout, `codex/supabase-security` branch’indeki hazırlanmış migration ve staging-only disposable çalışma alanı üzerinden yürütüldü. Production ve GROUNDLESS kapsam dışı bırakıldı.

## 3. Migration

Uygulanan migration: `20260714010000_remove_legacy_client_meals_update_policy.sql`.

## 4. Staging hedef doğrulaması

Hedef proje staging olarak doğrulandı. Production proje referansı ve GROUNDLESS proje referansı ile eşleşme olmadığı doğrulandı. Ref, URL, token, parola, e-posta ve UUID kaydedilmedi.

## 5. Dry-run sonucu

Dry-run yalnız `20260714010000_remove_legacy_client_meals_update_policy.sql` migration’ını listeledi.

## 6. Migration uygulama sonucu

Migration staging’e başarıyla uygulandı. Başka migration uygulanmadı.

## 7. Docker cache uyarısı

Docker Desktop bulunmadığı için migration catalog cache ile ilgili bir uyarı görüldü. Uyarı SQL migration uygulamasından sonra oluştu; CLI migration uygulamasının başarıyla bittiği ve ayrı remote history doğrulamasının geçtiği kaydedildi.

## 8. Remote migration history doğrulaması

Staging-only CLI kontrolünde 9 local ve 9 remote active migration eşleşti. `20260714010000` remote history’de mevcuttu.

## 9. Post-migration policy kataloğu

Kaldırılan policy: `Clients can update own meal completion`.

Korunan policy’ler:

- `Clients can view meals of own plans`
- `Dietitians can view meals of own plans`
- `Users can select own meal rows`
- `Dietitians can update meals of own plans`
- `Dietitians can update own meal rows`
- `Dietitians can insert meals into own plans`
- `Dietitians can delete meals of own plans`

## 10. RPC güvenlik sözleşmesi

`public.set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)` fonksiyonu `SECURITY DEFINER` olarak kaldı; `search_path` değeri `pg_catalog, public`, authenticated EXECUTE yetkisi açık ve anon EXECUTE yetkisi kapalı olarak doğrulandı.

## 11. Security harness sonucu

```text
Preflight: PASS
Onboarding: 7/7
RLS tests: 17/17
Security failures P0/P1: 0
Deferred P1 blockers: 0
P2 functional blockers: 0
Cleanup: PASS
Final Auth users: 0
Final public rows: 0
Final Storage buckets: 0
Security harness exit code: 0
```

## 12. Client own SELECT

`MEALS-SELECT-OWN` geçti: client kendi fixture meal satırını gördü, foreign meal aynı sonuçta görünmedi ve admin fixture varlığını doğruladı.

## 13. Client foreign SELECT

`MEALS-SELECT-CROSS` geçti: foreign meal SELECT sonucu 0 satırdı; admin readback foreign fixture’ın değişmediğini doğruladı.

## 14. Client direct UPDATE rejection

`LEGACY-UPDATE` geçti: client direct non-`is_eaten` UPDATE reddedildi veya 0 satır etkiledi; admin readback database değerinin değişmediğini doğruladı.

## 15. Dietitian meal UPDATE

`DIETITIAN-MEAL-UPDATE` geçti: Dietitian A kendi planındaki meal title değerini değiştirdi, admin fiziksel update’i doğruladı ve orijinal değer restore edildi.

## 16. Own-meal RPC

`RPC-OWN` geçti: client kendi meal completion değerini RPC üzerinden güncelledi.

## 17. Foreign-meal RPC

`RPC-CROSS` geçti: foreign meal RPC reddedildi ve foreign meal değişmedi. Fiziksel mobil foreign-check exit code `10`, bu bağımsız negatif güvenlik senaryosunun beklenen başarı kodudur.

## 18. Fiziksel telefon network rollback

Fiziksel Android telefonda internet kapalıyken kontrollü Türkçe hata gösterildi, uygulama kapanmadı, UI completion durumunu geri aldı ve database `is_eaten` değeri `false` kaldı.

## 19. Persistence

Fiziksel Android uygulaması tamamen kapatılıp açıldıktan sonra own-meal completion durumu korundu ve database `is_eaten` değeri `true` olarak doğrulandı.

## 20. Cleanup

Harness ve mobil fixture cleanup sonuçları PASS’tir. Final Auth kullanıcı, public row ve Storage bucket sayıları `0/0/0` olarak doğrulandı.

## 21. Production durumu

```text
Migration applied to staging: YES
Legacy client UPDATE policy removed from staging: YES
Security harness: 17/17 PASS
Physical mobile regression: PASS
Final cleanup: PASS
Applied to production: NO
Production rollout: PENDING
Stage 3 complete: NO
```

## 22. Kalan işlemler

Production rollout karar kapısı, yalnız production hedef doğrulaması, production preflight, migration dry-run, kontrollü migration uygulaması, postflight policy/RPC kontrolü ve production regresyon kararı tamamlanmalıdır.

## 23. Sonuç

Staging rollout başarılıdır. Production rollout henüz uygulanmamıştır ve ayrı onay/karar kapısına bağlıdır.
