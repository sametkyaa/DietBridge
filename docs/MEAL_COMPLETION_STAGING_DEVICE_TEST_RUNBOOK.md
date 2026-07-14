# DietBridge Mobile — Staging Meal Completion Cihaz Testi

> [!IMPORTANT]
> Bu test yalnız DietBridge Staging üzerinde geçici sentetik kullanıcılar ve fixture
> verileriyle yapılmalıdır. Production ve GROUNDLESS kullanılmamalıdır. Test
> tamamlanınca cleanup komutu zorunludur.

## 1. Amaç

Mobil meal completion RPC cutover’ını gerçek cihaz veya emülatörde doğrulamak; own-meal persistence, rollback ve foreign-meal yetki reddi için kanıt üretmek.

## 2. Ön koşullar

- Web repository: `DietBridge-Web`, branch `codex/supabase-security`.
- Mobil repository: `dietBridge - Kopya`, branch `codex/meal-completion-rpc-cutover`.
- Web fixture script’i, mobil çalışma ağacı ve staging schema hazır olmalı.
- Test yalnız boş DietBridge Staging ortamında yapılmalı; production ve GROUNDLESS kesinlikle kullanılmamalı.
- Admin key ve geçici client password yalnız aynı interaktif PowerShell oturumunda tutulmalı; sohbet, dosya veya ekran görüntüsüne yazılmamalı.

## 3. Repository commit’leri

Test öncesi iki repository’de `git status --short --branch` ve `git rev-parse HEAD` çalıştırın. Web veya mobil çalışma ağacında beklenmeyen değişiklik varsa test başlatmayın.

## 4. Staging ortam ayrımı

Fixture script’i `DietBridge-Web/.env.staging.local` içindeki `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` isimlerini kullanır; production URL ile eşleşirse durur. Mobil client ise `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` okur.

Tracked mobil `.env` dosyasını değiştirmeyin. Aşağıdaki helper, staging değerlerini ekrana yazmadan yalnız mevcut PowerShell oturumuna aktarır:

```powershell
$webRoot = 'C:\Users\drsam\Desktop\Yeni klasör\DietBridge-Web'
$mobileRoot = 'C:\Users\drsam\Desktop\Yeni klasör\dietBridge - Kopya'

function Get-DietBridgeEnvValue([string]$path, [string]$name) {
  $line = Get-Content -LiteralPath $path | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { throw "$name staging environment dosyasında bulunamadı." }
  return (($line -split '=', 2)[1]).Trim().Trim('"').Trim("'")
}

$stagingEnv = Join-Path $webRoot '.env.staging.local'
$productionEnv = Join-Path $webRoot '.env'
$env:EXPO_PUBLIC_SUPABASE_URL = Get-DietBridgeEnvValue $stagingEnv 'VITE_SUPABASE_URL'
$env:EXPO_PUBLIC_SUPABASE_ANON_KEY = Get-DietBridgeEnvValue $stagingEnv 'VITE_SUPABASE_ANON_KEY'

if ($env:EXPO_PUBLIC_SUPABASE_URL -eq (Get-DietBridgeEnvValue $productionEnv 'VITE_SUPABASE_URL')) {
  throw 'Production URL reddedildi.'
}
Write-Host 'Staging/production URL ayrımı: PASS'
```

## 5. Secret güvenliği

Admin key veya password’ü sohbetle paylaşmayın. Publishable/anon key admin key değildir. Test sonunda tüm temporary environment değişkenlerini kaldırın.

## 6. PowerShell secret değişkenlerini yükleme

```powershell
$secureAdmin = Read-Host "DietBridge Staging admin key" -AsSecureString
$adminPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdmin)

try {
  $env:DIETBRIDGE_STAGING_ADMIN_KEY =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPtr)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPtr)
}

$securePassword = Read-Host "Temporary staging client password" -AsSecureString
$passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

try {
  $env:DIETBRIDGE_STAGING_TEST_CLIENT_PASSWORD =
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
}

$env:DIETBRIDGE_CONFIRM_STAGING_MOBILE_TESTS =
  'YES_DIETBRIDGE_STAGING_MOBILE_ONLY'
```

## 7. Fixture setup

Web repository kökünde, yalnız hazırlık tamamlandıktan sonra çalıştırın:

```powershell
Set-Location -LiteralPath $webRoot
node .\scripts\staging-mobile-meal-test-fixture.mjs setup
```

Beklenen çıktı `Setup: PASS`, sentetik Client A login email’i, own-meal label’ı, manifest yolu ve UTC expiry bilgisini içerir. Password, UUID veya key yazdırılmaz. Setup preflight boş Auth/public/Storage aggregate şartını doğrular.

## 8. Mobil uygulamayı staging environment ile başlatma

Mobil `package.json` kök dizindedir. Expo `EXPO_PUBLIC_*` değerlerini bundle oluştururken okur; eski bundle/cache karışmasını önlemek için cache temizliğiyle başlatın:

```powershell
Set-Location -LiteralPath $mobileRoot
npm run start -- --clear
```

Bu komut yeni tracked dosya oluşturmaz. Expo dev server yeniden başladıktan sonra cihaz/emülatörü bu bundle’a bağlayın. Bölüm 4’teki helper staging değerlerini aynı PowerShell oturumunda yüklemiş olmalıdır.

## 9. Client A ile giriş

Setup çıktısındaki sentetik Client A email’i ve aynı oturumda tutulan geçici password ile giriş yapın. Gerçek kullanıcı hesabı kullanmayın.

## 10. Çalıştırma sırası

Network/RPC rollback senaryosu, own-meal başarı senaryosundan **önce** yeni bir
`is_eaten=false` fixture ile çalıştırılmalıdır. Böylece başarısız deneme gerçek
başarı kanıtını veya persistence kontrolünü kirletmez.

## 11. Test MC-STG-04 — Network/RPC hata rollback

Yeni bir fixture hazırlayın ve own meal için başlangıç değerinin
`is_eaten=false` olduğunu `status` ile doğrulayın. Client A ile giriş yaptıktan
sonra, own-meal başarı eylemini denemeden önce cihaz ağını geçici olarak kapatın
ve “Öğünümü Yedim” eylemini çalıştırın.

Beklenen:

- UI optimistic olarak kısa süre true olabilir.
- RPC/network hatasından sonra UI yeniden `false` durumuna döner.
- Kullanıcıya Türkçe, kontrollü bir hata mesajı görünür.
- Teknik Supabase hata metni kullanıcıya gösterilmez.

Ağı yeniden açın ve fixture script ile `status` çalıştırın. Own meal veritabanında
hala `false` olmalıdır. Bu doğrulanmadan own-meal başarı senaryosuna geçmeyin.
Bu kontrol için admin/script ile yapay toggle-back veya state değişikliği
yapılmamalıdır.

## 12. Test MC-STG-01 — Own meal success

Başlangıçta own meal `is_eaten=false` olmalıdır. Dashboard’da “Öğünümü Yedim” eylemini çalıştırın.

Beklenen:

- UI optimistic olarak true olur.
- RPC başarılı olur; rollback gerçekleşmez.
- Kullanıcıya teknik Supabase hatası gösterilmez.

Ardından Web repository’de şunu çalıştırın:

```powershell
Set-Location -LiteralPath $webRoot
node .\scripts\staging-mobile-meal-test-fixture.mjs status
```

Beklenen: `Client A own meal is_eaten: true`.

## 13. Test MC-STG-02 — Persistence

Mobil uygulamayı tamamen kapatıp yeniden açın veya güvenli refetch akışını tetikleyin. Own meal true görünmeye devam etmelidir.

## 14. Test MC-STG-03 — Toggle back

**Uygulanamaz.** Mevcut mobil arayüz completed durumundan incomplete durumuna
dönen bir kontrol sunmaz. Bu davranışı admin/script ile yapay olarak üretmeyin;
test matrisi bu senaryoyu geçer veya kalır olarak saymamalıdır.

## 15. Test MC-STG-05 — Foreign meal API güvenlik testi

Web repository’de çalıştırın:

```powershell
node .\scripts\staging-mobile-meal-test-fixture.mjs foreign-check
```

Beklenen:

```text
Foreign meal RPC: REJECTED
Foreign meal unchanged: YES
Result: PASS
```

Exit code `10`, beklenen güvenlik reddidir; test hatası değildir. Foreign meal değişirse P0/P1 security blocker olarak ele alınmalıdır.

## 16. Status kontrolü

`status` yalnız manifestteki explicit fixture ID’lerini okur. Client A own meal durumu, Client B foreign meal değişmezliği, fixture sayıları ve manifest expiry sonucunu kontrol eder; mutation yapmaz.

## 17. Expo/fetch başlangıç sorunu

İlk açılışta `whatwg-fetch` kaynaklı `Response constructor status=0` görülürse
bunu gerçek bir HTTP yanıtı veya RPC sonucu olarak sınıflandırmayın. Expo yeniden
başlatıldıktan sonra uygulama çalışıyorsa test devam edebilir; olay rapora
“geçici başlangıç/ağ hatası” olarak kaydedilmelidir. Tekrarlarsa staging
environment, cihaz ağı ve fetch wrapper ayrıca incelenmelidir.

## 18. Logout

Mobil uygulamada sentetik Client A oturumunu kapatın. Cihazda gerçek kullanıcı oturumu bırakmayın.

## 19. Cleanup

Tüm cihaz testleri bittiğinde Web repository’de çalıştırın:

```powershell
node .\scripts\staging-mobile-meal-test-fixture.mjs cleanup
```

Cleanup yalnız manifestte kaydedilmiş explicit meal, meal plan, relationship ve Auth user ID’lerini siler. `delete all`, `truncate`, `db reset` veya migration işlemi kullanmaz.

## 20. Final aggregate doğrulama

Beklenen cleanup çıktısı:

```text
Cleanup: PASS
Final Auth users: 0
Final public rows: 0
Final Storage buckets: 0
```

Cleanup başarısızsa manifest korunur; yeniden setup çalıştırmayın.

## 21. Secret temizliği

```powershell
Remove-Item Env:DIETBRIDGE_STAGING_ADMIN_KEY -ErrorAction SilentlyContinue
Remove-Item Env:DIETBRIDGE_STAGING_TEST_CLIENT_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:DIETBRIDGE_CONFIRM_STAGING_MOBILE_TESTS -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUBLIC_SUPABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUBLIC_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
```

## 22. Sonuç matrisi

| Test | Beklenen | Sonuç |
|---|---|---|
| MC-STG-04 | Yeni false fixture üzerinde network/RPC rollback ve kontrollü hata; ardından DB’de false | Testte doldurulacak |
| MC-STG-01 | Own meal RPC success | Testte doldurulacak |
| MC-STG-02 | Uygulama yeniden açıldığında state korunur | Testte doldurulacak |
| MC-STG-03 | Mobil UI kontrolü bulunmadığı için uygulanamaz | Uygulanamaz |
| MC-STG-05 | Foreign RPC reddi ve foreign meal değişmezliği | Testte doldurulacak |
| MC-STG-06 | Explicit-ID cleanup ve sıfır aggregate | Testte doldurulacak |

## 23. Production blocker kararı

Legacy client `meals` UPDATE policy’si; own-meal, persistence, rollback, foreign-meal reddi ve cleanup staging’de doğrulanmadan kaldırılamaz. Eski mobil build uyumluluğu ayrıca değerlendirilmelidir.

## 24. Kapsam sınırı

Bu rehber fixture script’ini çalıştırmaz, Supabase’e bağlanmaz ve hiçbir staging/production verisi yazmaz. Uygulama, migration ve policy değişikliği ayrı açık onay gerektirir.
