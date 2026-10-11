# Mobil kilo tarihi düzeltmesi

Dal: codex/release-weight-date. Taban: ea213dec5a3b97ec2c49dfe7f2ae700325cf3740.

Migration: 20261011103029_mobile_weight_istanbul_date.sql.
Yalnız save_my_current_weight(numeric) ve sync_client_weight_to_measurements() için TimeZone=Europe/Istanbul ayarlanır.
Fonksiyon gövdeleri, RPC parametreleri/sonuçları, sahiplik, yetkiler ve tablo yapıları değiştirilmez.
Mobil mevcut RPC ile çalışmaya devam eder; web zaten İstanbul gününü kullanır.
Mevcut geçmiş ölçümler geriye dönük taşınmaz. Gece yarısı kayıtları için tarihsel veri düzeltmesi ayrı inceleme/onay gerektirir.

## Doğrulama
node scripts/runDisposableMobileWeightDateHarness.mjs

Test postgres:17-alpine üzerinde network=none, port yayınlamadan, sentetik fixture kullanır.
Önce UTC negatif kontrolü, ardından mevcut gerçek RPC/trigger gövdeleri, kayıt günü, aynı günlük upsert,
diğer ölçümlerin korunması, izin/hatalı değer/eksik profil, sınır saatleri ve idempotency kontrol edilir.
Backend Quality Gate bu harness'i çalıştırır. Başka feature harness'lerinin sabit geçmiş replay zinciri
bu migration'ı dışarıda tutar; düzeltme dedicated harness'te doğrulanır.

## Üretim uygulama sırası
1. Güncel yedek ve geri yükleme kanıtı.
2. Salt okunur preflight: fonksiyon signature/gövde/search_path/grants, aktif trigger ve ölçüm constraint kontrolü.
3. Kullanıcı tarafından açık production migration onayı.
4. Yalnız bu migration'ın uygulanması; bekleyen push migration'ı dahil toplu db push yapılmaması.
5. Salt okunur katalog postflight: iki fonksiyonda TimeZone=Europe/Istanbul; gövde/yetkiler aynı.
6. Onaylı test hesabıyla Android kayıt testi (üretim yazma testi ayrıca açık kapsam gerektirir).

## Geri dönüş
İnceleme öncesinde her iki fonksiyonun TimeZone proconfig'i yoktu.
Bu durum uygulama öncesinde yeniden doğrulanırsa geri dönüş:
alter function public.save_my_current_weight(numeric) reset "TimeZone";
alter function public.sync_client_weight_to_measurements() reset "TimeZone";
Bu işlem eski tarih hatasını geri getirir; veri geri yüklemesi değildir.
Geri dönüş güncel yedeğin yerel restore'unda başarıyla çalıştırıldı; production'da çalıştırılmadı.

## Production sonucu
Kullanıcı yalnız bu migration için açık uygulama onayı verdi. Supabase apply_migration ile mobile_weight_istanbul_date uygulandı; tool'un kaydettiği sürüm 20261011103029 olduğundan birleşik kaynak dosyası aynı sürüme adlandırıldı. Onay sırasında kullanılan 20261011120000 dosyasının SQL içeriği değişmedi.
Postflight başarılı: iki fonksiyonda TimeZone=Europe/Istanbul, önceki search_path korunuyor; gövde hash'leri, owner, SECURITY DEFINER ve grants birebir aynı. Uygulama kayıtlarına/test RPC'sine/Storage'a yazılmadı. Ayrıntı RELEASE_WEIGHT_PRODUCTION_EVIDENCE.json.
