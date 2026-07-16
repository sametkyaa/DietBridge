# DietBridge — Legacy Meals UPDATE Policy Production Rollout Runbook

## 1. Amaç

Staging’de doğrulanan legacy client direct `public.meals` UPDATE policy kaldırma migration’ını production’da yalnız açık karar kapısından sonra, tek migration ve fail-closed guard’larla uygulamak.

## 2. Kapsam

Hedef migration yalnız `20260714010000_remove_legacy_client_meals_update_policy.sql` dosyasıdır. Production’da fixture, sentetik kullanıcı, seed veya test verisi oluşturulmaz.

## 3. Staging kanıtı

Staging’de migration uygulandı; local/remote history 9/9 eşleşti, security harness 17/17 PASS verdi, fiziksel Android rollback/own RPC/persistence/foreign RPC kontrolleri PASS ve cleanup `0/0/0` oldu. Ayrıntılar [staging rollout raporundadır](LEGACY_MEALS_UPDATE_POLICY_STAGING_ROLLOUT_REPORT.md).

## 4. Production ön koşulları

- Bu runbook için ayrı açık production mutation onayı bulunmalıdır.
- Branch, commit ve çalışma ağacı önceden kaydedilmelidir.
- Production ve staging environment URL’lerinden türetilen ref’ler farklı olmalıdır.
- Local active migration sayısı tam olarak 9 olmalıdır.
- Operatör `dietbridge_Production` proje adını ve seçilen ref’i terminalinde doğrulamalıdır.
- Production database password veya CLI token sohbet, log, Git veya dokümantasyona yazılmamalıdır.

## 5. Gerekli roller ve erişimler

Supabase CLI için geçerli kişisel access token ve production database password gerekir. Bu değerler yalnız operatörün interaktif terminaline girilir; burada veya repository’de saklanmaz.

## 6. Secret yönetimi

Kullanılacak geçici environment değişkenleri `SUPABASE_ACCESS_TOKEN` ve `SUPABASE_DB_PASSWORD`’dır. Değerleri `Write-Host`, dosya, komut satırı argümanı, Git diff veya rapora koymayın. İşlem sonunda bunları ve ref değişkenlerini kaldırın.

## 7. Disposable çalışma alanı

Repository kökü hiçbir zaman production’a linklenmez. Yeni ve benzersiz geçici alan oluşturun:

```powershell
$repoRoot = (git -C "C:\Users\drsam\Desktop\Yeni klasör\DietBridge-Web" rev-parse --show-toplevel)
$workdir = Join-Path $env:TEMP ("dietbridge-production-policy-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workdir -ErrorAction Stop | Out-Null
Set-Location -LiteralPath $workdir
npx --yes supabase@latest init
Copy-Item -Recurse -Force (Join-Path $repoRoot 'supabase\migrations') (Join-Path $workdir 'supabase\migrations')
Copy-Item -Force (Join-Path $repoRoot 'supabase\verification\legacy_client_meals_update_policy_verification.sql') (Join-Path $workdir 'supabase\verification\legacy_client_meals_update_policy_verification.sql')
```

## 8. Production project identity guard

Bu blok ref değerlerini ekrana yazdırmaz. `.env` production kaynağı, `.env.staging.local` staging kaynağıdır.

```powershell
function Get-EnvValue([string]$Path, [string]$Name) {
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)$") {
      return $Matches[1].Trim().Trim([char]34, [char]39)
    }
  }
}
function Get-SupabaseProjectRef([string]$Url) {
  if ($Url -match '^https://([a-z0-9-]+)\.supabase\.co/?$') { return $Matches[1] }
  throw 'Supabase URL biçimi beklenenden farklı.'
}

$PRODUCTION_PROJECT_REF = Get-SupabaseProjectRef (Get-EnvValue (Join-Path $repoRoot '.env') 'VITE_SUPABASE_URL')
$STAGING_PROJECT_REF = Get-SupabaseProjectRef (Get-EnvValue (Join-Path $repoRoot '.env.staging.local') 'VITE_SUPABASE_URL')
if (-not $PRODUCTION_PROJECT_REF -or -not $STAGING_PROJECT_REF) { throw 'Environment ref yüklenemedi.' }
if ($PRODUCTION_PROJECT_REF -eq $STAGING_PROJECT_REF) { throw 'Production ve staging ref aynı; STOP.' }
if ($PRODUCTION_PROJECT_REF -match 'groundless' -or $STAGING_PROJECT_REF -match 'groundless') { throw 'GROUNDLESS ref guard tetiklendi; STOP.' }
if ((Get-Location).Path -eq $repoRoot) { throw 'Repository kökünde link yapılamaz; STOP.' }
```

## 9. Staging/production ayrım guard’ı

CLI login sonrasında yalnız salt-okunur proje listesi alınır. Operatör listede seçilen projenin `dietbridge_Production` olduğunu terminalinde doğrular; GROUNDLESS veya staging adı görünürse işlem durur.

```powershell
npx --yes supabase@latest projects list
$confirmedProjectName = Read-Host 'Seçilen proje adını terminalde doğrulayıp aynen girin'
if ($confirmedProjectName -ne 'dietbridge_Production') { throw 'Production project adı doğrulanmadı; STOP.' }
npx --yes supabase@latest link --project-ref $PRODUCTION_PROJECT_REF
```

Database password sorulursa yalnız interaktif terminale girilir. Link tamamlanmadan hiçbir history, SQL veya push komutu çalıştırılmaz.

## 10. Migration dosyalarının hazırlanması

Yalnız disposable workdir içindeki `supabase/migrations` dizini kullanılır. Aşağıdaki kontrol tam 9 migration ve hedef dosyayı doğrulamalıdır:

```powershell
$migrations = Get-ChildItem .\supabase\migrations -File | Sort-Object Name
if ($migrations.Count -ne 9) { throw 'Local active migration sayısı 9 değil; STOP.' }
if ($migrations[-1].Name -ne '20260714010000_remove_legacy_client_meals_update_policy.sql') { throw 'Hedef migration sırası beklenenden farklı; STOP.' }
```

## 11. Remote migration history

```powershell
npx --yes supabase@latest migration list --linked
```

Kabul koşulu: ilk sekiz local migration remote’da mevcut; `20260714010000` yalnız local/pending; remote’da ek veya farklı migration yok. History geride, ileride veya farklıysa `migration repair`, `db pull`, `db reset`, `migration up` ya da push çalıştırmadan STOP.

## 12. Preflight policy/RPC doğrulaması

[legacy_client_meals_update_policy_verification.sql](../supabase/verification/legacy_client_meals_update_policy_verification.sql) yalnız `SELECT` içerir. Disposable kopyayı SQL Editor’a yapıştırmak için:

```powershell
Get-Content -Raw .\supabase\verification\legacy_client_meals_update_policy_verification.sql | Set-Clipboard
```

Production SQL Editor’da PRE snapshot’ı çalıştırın. Kabul koşulları:

- `public.meals` için RLS açık.
- `Clients can update own meal completion` policy’si `UPDATE`, yalnız `authenticated`, beklenen `qual` ve `with_check` sözleşmesiyle mevcut.
- İki dietitian UPDATE policy’si ile client/dietitian SELECT policy’leri mevcut.
- `set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)` `SECURITY DEFINER`; `search_path` `pg_catalog, public`; authenticated EXECUTE açık, anon EXECUTE kapalı.

Bu dosya sonuçları otomatik fail etmez; herhangi bir satır beklenenle uyuşmazsa push öncesinde STOP.

## 13. Dry-run

```powershell
npx --yes supabase@latest db push --linked --dry-run
```

Kabul koşulu: çıktı yalnız `20260714010000_remove_legacy_client_meals_update_policy.sql` dosyasını listeler. Başka pending migration veya fark görünürse STOP.

## 14. Production migration uygulaması

Bu adım yalnız ayrı production mutation onayından sonra çalıştırılır:

```powershell
npx --yes supabase@latest db push --linked
```

`--include-all`, `--db-url`, `db reset`, `migration up`, `migration repair` ve SQL Editor ile doğrudan policy drop kullanılmaz.

## 15. Docker cache uyarısı değerlendirmesi

Migration SQL’i başarıyla tamamlanmışsa tek başına local Docker/catalog cache uyarısı rollback nedeni değildir. Uyarıdan sonra remote history, postflight policy/RPC sonucu ve uygulama smoke testleri başarılı değilse rollout başarı kabul edilmez.

## 16. Remote history postflight

```powershell
npx --yes supabase@latest migration list --linked
```

Kabul koşulu: 9 local ve 9 remote migration eşleşir; hedef migration remote’da mevcuttur.

## 17. Policy/RPC postflight

Section 12’deki salt-okunur SQL’i tekrar çalıştırın. Kabul koşulları: legacy client UPDATE policy yok, korunan dietitian/SELECT policy’leri mevcut, RPC sözleşmesi ve RLS açık.

## 18. Uygulama smoke testleri

Gerçek kullanıcı verisini değiştirmeden doğrulayın:

- Production web açılır; mevcut dietitian login akışı çalışır.
- Client web erişim engeli beklenen mesajla korunur.
- Yetkili client meal listesi okunur.
- Dietitian meal plan sayfası okunur.
- Genel API/frontend sağlık kontrolü başarılıdır.

## 19. Test verisi politikası

Production’da fixture, sentetik kullanıcı veya gerçek kullanıcı meal completion mutation testi yapılmaz. Açıkça tanımlanmış ve ayrıca onaylanmış test hesabı yoksa completion mutation testi staging kanıtı ile sınırlı kalır.

## 20. Rollback karar kapısı

Rollback otomatik değildir ve ayrı manuel onay gerektirir. Yalnız client completion tamamen çalışamazsa, RPC/grant kaybı kanıtlanırsa veya policy drop ile doğrudan ilişkili kritik üretim kesintisi oluşursa değerlendirilir.

## 21. Rollback SQL

Rollback SQL [kaldırma planında](LEGACY_MEALS_UPDATE_POLICY_REMOVAL_PLAN.md) korunur. Bu SQL eski geniş client direct UPDATE erişimini yeniden açar; `is_eaten` dışındaki alanları da değiştirebilir. Varsayılan çözüm değildir.

## 22. Cleanup

Production’da fixture cleanup yoktur. Yalnız disposable terminal alanı ve process environment temizlenir.

## 23. Secret ve disposable alan temizliği

Postflight kayıtları tamamlandıktan sonra:

```powershell
Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
Remove-Variable PRODUCTION_PROJECT_REF, STAGING_PROJECT_REF -ErrorAction SilentlyContinue
Set-Location -LiteralPath $repoRoot
Remove-Item -LiteralPath $workdir -Recurse -Force
```

## 24. STOP koşulları

- Production ref environment ile eşleşmiyor.
- Production ref staging ref ile aynı.
- Seçilen proje `dietbridge_Production` değil veya GROUNDLESS görünüyor.
- Remote history ilk sekiz migration ile eşleşmiyor.
- Hedef migration remote’da zaten beklenmedik şekilde mevcut/yok veya başka pending migration var.
- Dry-run hedef dosya dışında migration listeliyor.
- Legacy policy PRE snapshot’ında yok ya da sözleşmesi farklı.
- Dietitian policy, SELECT policy, RPC, grant veya RLS PRE snapshot’ında eksik.
- Migration fail-fast hata veriyor.
- POST snapshot’ında legacy policy hâlâ var ya da korunan yapı kayıp.
- Postflight history 9/9 eşleşmiyor.

Bu koşullardan herhangi biri oluşursa production mutation durur; rollback otomatik çalıştırılmaz.

## 25. Başarı kriterleri

Production rollout ancak single-migration dry-run, migration application, 9/9 history, policy/RPC/RLS postflight ve mutasyonsuz smoke testlerin tümü geçtiğinde başarı sayılır.

## 26. Sonuç kayıt şablonu

```text
Production identity: PASS/STOP
Remote history preflight: PASS/STOP
Policy/RPC preflight: PASS/STOP
Dry-run: PASS/STOP
Migration application: PASS/NOT RUN
Remote history postflight: PASS/NOT RUN
Policy/RPC postflight: PASS/NOT RUN
Smoke tests: PASS/NOT RUN
Rollback: NOT RUN
```
