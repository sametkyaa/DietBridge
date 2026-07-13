# DietBridge — Baseline Öncesi Migration Geçmişi Uzlaştırması

> [!IMPORTANT]
> Bu uzlaştırma yalnızca repository geçmişi ve disposable yerel Supabase ortamı için yapılmıştır. Production ve staging üzerinde migration, SQL veya remote migration history değişikliği yapılmamıştır.

## 1. Sorunun özeti

Aktif zincirde yer alan tarihsel `20260706_add_sort_order.sql`, temiz yerel replay sırasında `public.meals` oluşmadan önce çalışıyordu. Bu nedenle replay `relation "meals" does not exist` hatasıyla duruyordu.

## 2. Başarısız yerel replay

Önceki denemede eski migration, baseline migration'larından önce sıralandığı için başarısız oldu. SQL gevşetilmedi, atlanmadı veya remote history onarılmadı.

## 3. Eski migration bilgileri

- Dosya: `20260706_add_sort_order.sql`
- İlk ve tek Git ekleme commit'i: `cb98139 feat(auth): enhance registration and unify UI`
- Dosya SHA-256: `744EA8D9202C07CF24C015E2170BA7F433E0A0780AD481F58C95819B36519E26`
- Git blob içeriği taşıma öncesi ve sonrası korunmuştur.

## 4. Git geçmişi

Dosya Git tarafından izleniyordu ve geçmişte sonraki bir içerik değişikliği bulunmadı. Arşivleme `git mv` ile yapıldı; SQL içeriği değiştirilmedi.

## 5. Eski migration semantik kapsamı

Eski migration yalnızca `public.meals` üzerinde iki kolon ekliyordu: `sort_order` için `integer`, varsayılan `0`; ve `time` için `varchar(5)`. Nullability için ek bir `NOT NULL`, constraint veya index eklemiyordu; top-level DML/backfill, function etkisi ya da `IF NOT EXISTS` kullanımı yoktu.

## 6. Baseline karşılaştırması

| Özellik | Eski migration | Production public baseline | Sonuç |
|---|---|---|---|
| Tablo | `public.meals` | `public.meals` | Eşleşiyor |
| `sort_order` | `integer`, `DEFAULT 0`, nullable | `integer`, `DEFAULT 0`, nullable | Eşleşiyor |
| `time` | `varchar(5)`, nullable | `time without time zone`, nullable | Baseline nihai şema tipini sağlar |
| Constraint/index | Yok | `plan_id, sort_order` ve `plan_id, time` indexleri var | Baseline daha kapsamlı |
| Diğer DDL etkileri | Yok | Yok | Eşleşiyor |

Sınıflandırma: **Tamamen baseline tarafından kapsanıyor.** Baseline'ın `time` tipi, eski tarihsel migration'daki geçici metin tipinden daha nihai production şema tipidir; bu bir eksik etki değildir.

## 7. Production migration history sonucu

Kullanıcı tarafından interaktif PowerShell terminalinde yapılan salt-okunur doğrulama: `20260706`, `20260713000000` ve `20260713000001` production remote history içinde yoktur.

## 8. Staging migration history sonucu

Kullanıcı tarafından interaktif PowerShell terminalinde yapılan salt-okunur doğrulama: `20260706` yoktur; `20260713000000` ve `20260713000001` mevcuttur.

## 9. Karar matrisi

İki arşivleme koşulu birlikte sağlandı: eski sürüm iki remote history'de de yoktur ve bütün kalıcı şema etkileri baseline'da bulunur. Bu nedenle eski dosya aktif bootstrap zincirinden arşivlenmiştir.

## 10. Arşivleme gerekçesi

`20260706_add_sort_order.sql` baseline öncesi yerel tarihsel migration'dır; remote migration history'nin parçası değildir. Dosya içerik değiştirilmeden `supabase/migration_archive/` altında tutulur ve Supabase CLI tarafından uygulanmaz.

## 11. Active migration zinciri

1. `20260713000000_staging_default_table_privileges.sql`
2. `20260713000001_production_public_baseline.sql`

## 12. Staging migration history uyumluluğu

Aktif zincirdeki iki sürüm, daha önce staging'e uygulanmış remote history sürümleriyle eşleşir. Bu görev staging migration history'yi değiştirmez.

## 13. Production rollout uyarısı

Production veritabanında baseline şeması zaten mevcut olduğundan active bootstrap baseline zinciri production’a doğrudan `db push` ile uygulanmayacaktır. Production migration history adoption ve yalnız ileri yönlü güvenlik migration rollout yaklaşımı ayrı onaylı aşamada belirlenecektir.

## 14. Yerel replay sonucu

Disposable yerel Supabase ortamında `supabase start` ve ardından `db reset --local --no-seed` başarıyla tamamlandı. Yalnız aktif prelude ve baseline migration'ları uygulandı; eski arşiv dosyası uygulanmadı.

## 15. Lint sonucu

`db lint --local --schema public --level warning --fail-on error` exit code `0` ile tamamlandı; schema error veya warning bildirilmedi.

Yerel metadata sonucu: 21 public tablo, RLS açık 18 tablo, 51 policy, 10 public function, 7 trigger ve public tablolarda 0 satır. `public.meals.sort_order` `integer`, `DEFAULT 0`, nullable; `public.meals.time` `time without time zone`, nullable durumundadır. İki ilgili meals index'i de mevcuttur.

## 16. Riskler

Yerel boş veritabanı replay'i, production veri uyumluluğunu veya production history adoption sürecini kanıtlamaz. Bunlar ayrı onaylı rollout aşamalarında ele alınacaktır.

## 17. Sonuç

Temel bootstrap zinciri, eski tarihsel migration olmadan yerel olarak tekrar uygulanabilir hale getirilmiştir. Güvenlik migration taslakları bu görevde aktif hale getirilmemiştir.
