# DietBridge — Staging Güvenlik Migration Uygulama Raporu

> [!IMPORTANT]
> Bu rapordaki güvenlik ve onboarding migration’ları yalnızca ayrı DietBridge Staging Supabase projesine uygulanmıştır. Production ve GROUNDLESS projeleri değiştirilmemiştir.

## 1. Amaç ve uygulama tarihi

Amaç, disposable yerel ortamda doğrulanmış güvenlik ve onboarding zincirini yalnız staging’e dry-run sonrasında kontrollü uygulamaktır. Uygulama tarihi: 2026-07-13. Başlangıç commit’i: `fbe4424 chore: add auth onboarding trigger migration`.

## 2. Ortam ayrımı

Staging referansı `ezwq…rjkv`, production referansı `kagv…cuxz` olarak maskelenmiş biçimde doğrulandı; referanslar ve istemci anahtarları farklıdır. Geçici CLI alanı repository dışında oluşturuldu ve yalnız staging referansıyla linklendi. Repository kökü linklenmedi. Production’a link, SQL veya migration işlemi yapılmadı. GROUNDLESS referansı kullanılmadı, linklenmedi ve üzerinde işlem yapılmadı.

## 3. Uygulama öncesi doğrulama

Active migration listesi sekiz dosya olarak doğrulandı: iki baseline dosyasını sırasıyla aşağıdaki altı pending migration izledi.

1. `20260713010000_function_security_hardening.sql`
2. `20260713010100_verification_consistency.sql`
3. `20260713010200_auth_onboarding_hardening.sql`
4. `20260713010300_critical_table_rls.sql`
5. `20260713010400_meal_completion_rpc.sql`
6. `20260713010500_ensure_auth_user_onboarding_trigger.sql`

Baseline SHA-256 değeri `68D99574628B599756CE604F670D9F3E51983EEDBFC4FB7B18D57A444E99C698`, boyutu 57433 byte, Git attribute’ları ise `text: unset` ve `whitespace: -blank-at-eof,cr-at-eol` olarak doğrulandı. Pending migration’larda secret/proje referansı, gerçek kullanıcı bilgisi ve top-level kullanıcı verisi DML’i bulunmadı. Yalnız `set_my_meal_completion` function gövdesindeki kontrollü `UPDATE` tespit edildi.

Uygulama öncesi remote history’de yalnız `20260713000000` ve `20260713000001` bulunuyordu. Staging metadata başlangıcı: 21 public tablo, 18 RLS tablo, 51 policy, 10 public function, 5 SECURITY DEFINER function, 7 public trigger, 0 Auth onboarding trigger, 0 Auth kullanıcısı, 0 Storage bucket/object ve public tablo istatistik toplamı 0. `dietitian_profiles`, `appointments` ve `chat_messages` için RLS kapalıydı; `handle_new_user()` mevcuttu. Anonymous policy, Realtime publication tablosu ve Storage policy bulunmadı.

## 4. Dry-run ve gerçek push

`db push --linked --dry-run` yalnız yukarıdaki altı pending migration’ı gösterdi. Prelude/baseline, archive/draft, seed, roles, Storage ve Realtime migration’ı görünmedi. Karar kapısı geçtikten sonra aynı altı migration `db push --linked` ile staging’e uygulandı.

CLI, migration’ların uygulanmasından sonra pg-delta migration catalog cache için yerel sertifika dosyası bulunamadığı uyarısını verdi. Komut exit code 0 ile tamamlandı; ardından remote migration history ve staging metadata ayrı salt-okunur kontrollerle doğrulandı.

## 5. Push sonrası migration history

Local ve staging remote history birebir eşleşti: `20260713000000`, `20260713000001`, `20260713010000`, `20260713010100`, `20260713010200`, `20260713010300`, `20260713010400` ve `20260713010500`. Beklenmeyen, archive veya draft migration kaydı yoktur.

## 6. Metadata karşılaştırması

| Kategori | Önce | Sonra | Sonuç |
|---|---:|---:|---|
| Public tablolar | 21 | 21 | Değişmedi |
| RLS açık tablolar | 18 | 21 | Beklenen +3 |
| Policy’ler | 51 | 62 | Beklenen +11 |
| Public function’lar | 10 | 13 | Beklenen +3 |
| SECURITY DEFINER function | 5 | 6 | Beklenen +1 |
| Public trigger’lar | 7 | 9 | Beklenen +2 |
| Auth onboarding trigger | 0 | 1 | Beklenen |
| Public satırlar | 0 | 0 | Catalog istatistik toplamı |
| Auth kullanıcıları | 0 | 0 | Doğrulandı |
| Storage bucket/object | 0 / 0 | 0 / 0 | Değişmedi |

`dietitian_profiles`, `appointments` ve `chat_messages` üzerinde RLS açıktır. Kritik tablolarda beklenen policy’ler mevcuttur ve anonymous policy sayısı 0’dır. Verification consistency function ile birlikte tam bir trigger ve constraint bulunduğu doğrulandı. Altı SECURITY DEFINER function’ın tamamında güvenli `search_path=pg_catalog, public` ayarı bulundu.

## 7. Function, execute grant ve onboarding sonuçları

`public.set_my_meal_completion(uuid, boolean)` mevcuttur; `authenticated` için execute açıktır, `anon` için kapalıdır. Legacy `meals` UPDATE policy’leri korunmuştur (3 policy). `public.handle_new_user()` SECURITY DEFINER, `search_path=pg_catalog, public` ile hardened durumdadır; PUBLIC, anon ve authenticated direct execute yetkileri kapalıdır. Onboarding ve verification trigger helper function’larında istemci execute yetkisi sayısı 0’dır.

`auth.users.on_auth_user_created` tam olarak bir kez mevcuttur; etkin ve internal değildir. Tanımı `AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()` ile eşleşir. Bu migration kullanıcı veya seed verisi oluşturmadı.

## 8. Storage, Realtime ve kapsam dışı alanlar

Storage bucket/object veya Storage policy oluşturulmadı; uygulama sonrası Storage policy sayısı 0’dır. Realtime publication değişikliği yoktur. Auth signup, sentetik kullanıcı/veri, public tablo DML’i, service role, migration repair, remote reset ve production rollout uygulanmadı.

## 9. Production ve GROUNDLESS değişmezliği

Production salt-okunur metadata kontrolü bu görevde zorlanmadı; staging-only link, komut günlükleri ve kullanılan tek referans üzerinden production üzerinde DDL, DML, migration, Auth, Storage veya Realtime işlemi yapılmadığı doğrulandı. GROUNDLESS kapsam dışı bırakıldı; referansı hiçbir işlemde kullanılmadı.

## 10. Açıklanabilir farklar, bloklayıcılar ve sonraki aşama

Beklenen şema farkları RLS, policy, function, trigger ve onboarding assurance migration’larından kaynaklanır. Bloklayıcı metadata/history farkı bulunmadı. CLI’nin pg-delta catalog cache uyarısı push sonucu veya doğrulama sonuçlarını değiştirmedi; yine de sonraki CLI güncellemesi/çalıştırmasında izlenmelidir.

Kalan negatif test gereksinimleri: sentetik staging kullanıcılarıyla client/dietitian onboarding, session/role, ilişki sahipliği, kritik RLS red senaryoları ve meal RPC yetki testleri. Sıradaki aşama Aşama 3D-4C’dir.

## 11. Sonuç

Güvenlik ve onboarding migration zinciri yalnız DietBridge Staging ortamına dry-run sonrasında kontrollü uygulanmış, migration history ve metadata doğrulaması tamamlanmıştır. Production ve GROUNDLESS değiştirilmemiştir.
