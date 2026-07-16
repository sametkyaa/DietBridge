# DietBridge — Meals RLS Regresyon Harness Raporu

## 1. Amaç

Legacy client `public.meals` UPDATE policy’si staging’den kaldırılmadan önce eksik kalan client meal SELECT ve dietitian legitimate UPDATE regresyonlarını mevcut sentetik güvenlik harness’ine eklemek.

## 2. Preflight sonucu

Aşama 3E-2B-1 sonucu `NOT READY` idi. Bloklayıcı eksikler dietitian’ın kendi planındaki meal’i güncelleyebilmesi, client’ın kendi meal’ini okuyabilmesi ve foreign meal’i okuyamamasıydı.

## 3. Eksik testler

| Test ID | Aktör | İşlem | Beklenen | Admin doğrulaması |
|---|---|---|---|---|
| `MEALS-SELECT-OWN` | Client A | Own ve foreign fixture meal ID’lerini aynı sorguda SELECT | Yalnız own meal döner | Her iki fixture’ın mevcut olduğu doğrulanır |
| `MEALS-SELECT-CROSS` | Client A | Client B meal ID’sini doğrudan SELECT | Hata olmadan 0 satır | Foreign fixture’ın varlığı ve değişmezliği doğrulanır |
| `DIETITIAN-MEAL-UPDATE` | Dietitian A | Kendi planındaki fixture meal `title` alanını güncelle ve restore et | Update fiziksel olarak kalıcı olur; orijinal değer geri yüklenir | Update ve restore sonrasında ayrı readback yapılır |

## 4. Mevcut fixture yapısı

Harness Dietitian A/Client A ve Dietitian B/Client B tenant çiftlerini, iki aktif ilişkiyi ve her tenant için bir meal plan ile iki meal satırını üretir. Yeni regresyonlar bu fixture’ları yeniden kullanır; yeni tablo veya fixture türü eklemez.

Mevcut test akışının ilgili bölümü:

| Test ID | Aktör | İşlem | Beklenen | Admin doğrulaması |
|---|---|---|---|---|
| `RLS-OWN-PLAN` | Client A | Own meal plan SELECT | 1 satır | Yok |
| `RLS-CROSS-PLAN` | Client A | Foreign meal plan SELECT | 0 satır | Yok |
| `LEGACY-UPDATE` | Client A | Own meal’de direct non-`is_eaten` UPDATE | Migration sonrasında reddedilir/değişmez | Fiziksel title readback ve gerektiğinde restore |
| `RPC-OWN` | Client A | Own meal completion RPC | Başarılı | Fixture cleanup kapsamında |
| `RPC-CROSS` | Client A | Foreign meal completion RPC | Reddedilir | Foreign fixture ayrı tutulur |

## 5. Client own SELECT testi

Client A oturumu iki tenant’ın hedef meal ID’lerini aynı `.in(...)` sorgusunda ister. Değerlendirme yalnız sorgu hatasının olmamasına dayanmaz: sonuç tam olarak bir satır olmalı, ID own fixture ile eşleşmeli ve foreign ID sonuçta bulunmamalıdır. Admin client iki fixture’ın da gerçekte var olduğunu ayrıca doğrular.

## 6. Client foreign SELECT testi

Client A, Client B meal ID’sini doğrudan filtreler. Güvenli RLS sonucu hata olmadan boş dizi/0 satırdır. Satır dönmesi başarısızlıktır. Admin readback sorgudan önce ve sonra foreign fixture’ın aynı kaldığını doğrular.

## 7. Dietitian UPDATE testi

`title` kolonu kullanılır. Kolon şemada mevcut ve zorunlu metindir; sentetik fixture değeri kolayca ayırt edilir ve geri alınabilir. İlişki/sahiplik kolonlarına ve `is_eaten` alanına dokunulmaz.

Akış:

1. Admin orijinal title değerini okur.
2. Dietitian A kendi planındaki meal’i sentetik test title’ıyla günceller ve `.select('id,title')` ile dönen satırı kontrol eder.
3. Admin fiziksel database değerini yeniden okur.
4. Dietitian A orijinal title değerini geri yükler.
5. Admin restore sonucunu yeniden okur.
6. Dietitian restore başarısız kalırsa admin yalnız fixture state’ini onarmak için fallback restore yapar; test yine başarısız sayılır.

## 8. Legacy direct UPDATE testi

`LEGACY-UPDATE` korunmuştur. Migration sonrasında client direct UPDATE’in hata vermesi veya 0 satır etkilemesi tek başına yeterli değildir; admin readback’inde title değişmemelidir. Policy hâlâ geniş UPDATE’e izin verirse test sonucu `KNOWN DEFERRED GAP` ve production blocker olmaya devam eder.

## 9. RPC testleriyle etkileşim

Dietitian testi `title`, RPC testleri yalnız `is_eaten` alanını kullanır. Dietitian title değişikliği RPC başlamadan önce restore edilir. Foreign RPC ayrı tenant meal’ini hedefler.

## 10. Test izolasyonu

- SELECT testleri mutation yapmaz.
- Legacy direct UPDATE fiziksel değişiklik oluşturursa mevcut restore akışı çalışır.
- Dietitian UPDATE her durumda restore ve admin readback uygular.
- Own RPC’nin değiştirdiği `is_eaten` değeri sonraki testlerin assertion girdisi değildir ve explicit fixture cleanup ile silinir.
- Her hata yolunda cleanup `finally` bloğunda denenir.

## 11. Cleanup sözleşmesi

Cleanup yalnız runtime manifestine kaydedilen explicit ID’leri şu sırayla hedefler: `chat_messages`, `meals`, `meal_plans`, `appointments`, `dietitian_clients`, ardından Auth kullanıcıları. Final aggregate `profiles`, `client_profiles`, `dietitian_profiles`, ilişkiler ve fixture tabloları ile Storage bucket toplamını doğrular. Beklenen final sonuç Auth/public/Storage `0/0/0` değeridir.

Bu harness `daily_logs` üretmez. Mobil fixture’dan kalmış satır bulunması zaten boş-staging preflight’ını başarısız kılar; gereksiz genel silme eklenmemiştir.

## 12. Yeni saf testler

`scripts/staging-security-tests.test.mjs`, gerçek Supabase bağlantısı olmadan şu değerlendirmeleri kapsar:

- own meal mevcut/foreign gizli → PASS;
- own meal eksik → FAIL;
- foreign sorgu 0 satır ve fixture değişmemiş → PASS;
- foreign satır dönmesi → FAIL;
- dietitian update fiziksel ve restore edilmiş → PASS;
- API success görünüp fiziksel update yok → FAIL;
- fonksiyonel blocker exit code `12`;
- cleanup hatası öncelikli exit code `20`.

## 13. Değiştirilen dosyalar

- `scripts/staging-security-test-assertions.mjs`
- `scripts/staging-security-tests.mjs`
- `scripts/staging-security-tests.test.mjs`
- `docs/MEALS_RLS_REGRESSION_HARNESS_REPORT.md`
- `docs/LEGACY_MEALS_UPDATE_POLICY_REMOVAL_PLAN.md`
- `docs/ROADMAP.md`

## 14. Statik kontroller

- `node --check`: ana harness ve saf assertion modülü başarılı.
- Yeni saf testler: 8/8 başarılı.
- Mevcut mobil fixture cleanup saf testleri: 5/5 başarılı.
- `npm run typecheck`: başarılı.
- `npm run lint`: 0 hata, 71 mevcut uyarı.
- `git diff --check`: başarılı.
- Hedef dosyalarda secret kalıbı: bulunmadı.
- Production build: çalıştırılmadı; değişiklik uygulama bundle’ına dahil olmayan Node harness/dokümantasyon kapsamındadır ve görev environment dosyalarının okunmasını yasaklar.
- Mobil repository: `codex/meal-completion-rpc-cutover`, `73009da`, temiz.

## 15. Çalıştırılmayan integration testleri

Bu hazırlık görevinde `scripts/staging-security-tests.mjs` çalıştırılmamıştır. Supabase staging/production bağlantısı kurulmamış; fixture, kullanıcı veya database mutation yapılmamıştır.

## 16. Staging uygulama blocker’ları

Migration ve gerçek regresyon matrisi henüz staging’de çalıştırılmadığı için production rollout blokludur. Aşama 3E-2B-3’te doğru staging kimliği, remote migration history ve tek-pending dry-run doğrulanmadan migration uygulanmamalıdır.

## 17. Sonuç

```text
Migration applied to staging: NO
Regression harness prepared: YES
Integration tests executed: NO
Production rollout: BLOCKED
Stage 3 complete: NO
```

Saf ve statik kalite kapıları başarılı olduğu takdirde harness staging uygulama aşamasına hazırdır.

## 18. Sonraki aşama

Aşama 3E-2B-3 — Yalnız staging hedefini doğrula, migration’ı uygula ve tam RLS/mobil regresyon matrisini çalıştır.
