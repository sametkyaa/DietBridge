# DietBridge — Production Migration History Adoption Runbook

## 1. Amaç ve kesin sınır

Bu runbook, reconcile edilmiş production şemasını yeniden uygulamadan remote migration history’yi version bazlı olarak benimseme ve ardından yalnız `20260714010000` policy-removal migration’ını gerçek migration push ile uygulama sırasını tanımlar.

Bu hazırlık görevinde hiçbir komut çalıştırılmamıştır. Her network veya mutation adımı yeni bir görev, doğrulanmış production link’i, backup/restore point’i ve açık manuel onay gerektirir.

```text
Production reconciliation: APPLIED SUCCESSFULLY
RPC production smoke tests: PASSED
Physical Android production smoke: PASSED
Fixture cleanup: PASSED
Remaining fixture records: 0
Legacy policy: STILL PRESENT
Migration history adoption: BLOCKER
AUTOMATIC_BULK_REPAIR_ALLOWED=NO
```

## 2. Değişmez güvenlik kuralları

- Repository kökü production’a linklenmez; ayrı disposable çalışma alanı kullanılır.
- Project identity ve staging ayrımı her mutation görevinde yeniden doğrulanır.
- Version listesi wildcard, çoklu version argümanı veya tek toplu repair komutuyla işlenmez.
- Her version için ayrı approval, ayrı history mutation ve hemen ardından ayrı remote list doğrulaması gerekir.
- `20260714010000` history’ye önceden `applied` yazılmaz.
- Legacy policy SQL Editor’da doğrudan kaldırılmaz; yalnız gerçek migration push ile kaldırılır.
- `--include-all` kullanılmaz.
- Beklenmeyen version, sıra, schema drift veya komut çıktısında işlem durur; force/bypass uygulanmaz.

## 3. Mutation kapıları

### A — Salt-okunur production postflight

Yeni görevde önce project identity, production/staging ayrımı, reconcile edilmiş function/verification/RLS/policy/RPC sözleşmeleri, legacy policy varlığı ve remote history’nin boş olduğu salt okunur olarak yeniden doğrulanır. Sonuçlar bu paketin manifestiyle eşleşmezse adoption başlamaz.

### B — Version bazlı adoption karar tablosu

| Version | Statik sınıf | Mutation öncesi karar |
|---|---|---|
| `20260713000000` | `SUPERSEDED_MANUAL_REVIEW` | Tarihsel sıra kanıtlanamadığı için ayrı risk acceptance olmadan adoption yok |
| `20260713000001` | `MATCH_VIA_RECONCILIATION` | Ayrı approval sonrası tek-version adoption adayı |
| `20260713010000` | `MATCH_VIA_RECONCILIATION` | Ayrı approval sonrası tek-version adoption adayı |
| `20260713010100` | `MATCH_VIA_RECONCILIATION` | Ayrı approval sonrası tek-version adoption adayı |
| `20260713010200` | `MATCH_VIA_RECONCILIATION` | Ayrı approval sonrası tek-version adoption adayı |
| `20260713010300` | `MATCH_VIA_RECONCILIATION` | Ayrı approval sonrası tek-version adoption adayı |
| `20260713010400` | `MATCH_VIA_RECONCILIATION` | Ayrı approval sonrası tek-version adoption adayı |
| `20260713010500` | `MATCH` | Ayrı approval sonrası tek-version adoption adayı |
| `20260714010000` | `MISSING` | Adoption yapılmaz; gerçek pending migration olarak korunur |

### C — Backup ve restore point

History mutation öncesinde production database backup/PITR durumu ve geri dönüş sorumlusu doğrulanır. History repair şema SQL’i çalıştırmasa da sonraki `db push` kararını değiştirdiği için restore point olmadan ilerlenmez.

### D — Her version için ayrı manuel approval

Approval kaydı version, SHA-256, sınıflandırma, karar sahibi, tarih/saat, production kimlik kanıtı ve son remote list sonucunu içermelidir. `20260713000000` için ayrıca “tarihsel prelude sırası final katalogdan kanıtlanamıyor” riskinin kabul edildiği yazılı olmalıdır.

### E — Her version için ayrı history mutation

Aşağıdaki satırlar şablondur; `<PINNED_CLI_VERSION>` doldurulmadan çalıştırılamaz. Her satır yalnız kendi version approval’ından sonra, ayrı bir adım olarak değerlendirilir:

```powershell
# APPROVAL REQUIRED: 20260713000000 historical-order risk acceptance
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713000000 --status applied --linked

# APPROVAL REQUIRED: 20260713000001
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713000001 --status applied --linked

# APPROVAL REQUIRED: 20260713010000
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713010000 --status applied --linked

# APPROVAL REQUIRED: 20260713010100
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713010100 --status applied --linked

# APPROVAL REQUIRED: 20260713010200
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713010200 --status applied --linked

# APPROVAL REQUIRED: 20260713010300
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713010300 --status applied --linked

# APPROVAL REQUIRED: 20260713010400
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713010400 --status applied --linked

# APPROVAL REQUIRED: 20260713010500
npx --yes supabase@<PINNED_CLI_VERSION> migration repair 20260713010500 --status applied --linked
```

`20260714010000` için history repair satırı kasıtlı olarak yoktur.

### F — Her mutation sonrası remote list

Her tek-version mutation’dan hemen sonra ayrı salt-okunur kontrol yapılır:

```powershell
npx --yes supabase@<PINNED_CLI_VERSION> migration list --linked
```

Remote liste yalnız onaylanan prefix’i içermeli, sıradaki version ve `20260714010000` remote tarafta görünmemelidir. Sapmada sonraki mutation çalıştırılmaz.

### G — Policy removal dry-run kapısı

Dry-run ancak remote history aşağıdaki ilk sekiz version ile local zinciri birebir eşleştirdiğinde çalıştırılabilir:

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

Bu durumda beklenen durum: `exactly one pending migration: 20260714010000`.

```powershell
# APPROVAL REQUIRED: read-only dry-run after exact 8/8 history match
npx --yes supabase@<PINNED_CLI_VERSION> db push --linked --dry-run
```

Dry-run başka bir version, seed, role veya beklenmeyen SQL gösterirse:

```text
POLICY REMOVAL BLOCKED
```

### H — Tek pending migration push

Yalnız dry-run exact tek pending migration olarak `20260714010000` gösterirse ayrı production mutation onayıyla:

```powershell
# APPROVAL REQUIRED: apply exact pending 20260714010000 migration
npx --yes supabase@<PINNED_CLI_VERSION> db push --linked
```

Policy kaldırma doğrudan katalog SQL’iyle değil, repository’de hash’i sabit migration ile yapılır.

### I — Policy/RPC/RLS postflight

Push sonrasında salt-okunur kontroller şunları doğrular:

- remote/local history `9/9` exact version match;
- legacy policy absent;
- `set_my_meal_completion(uuid,boolean)` body/security/search_path/grant sözleşmesi unchanged;
- kritik RLS/policy, verification ve onboarding sözleşmeleri unchanged;
- beklenmeyen policy veya history satırı yok.

### J — Uygulama smoke testleri

Web diyetisyen akışı ve production mobil meal completion own/persistence/foreign-not-exposed senaryoları kontrollü fixture ile yeniden doğrulanır. Cleanup sonucu Auth/public fixture kayıtları `0` olmalıdır.

## 4. `20260713000000` seçenekleri ve öneri

| Seçenek | Değerlendirme |
|---|---|
| A — Ayrı manuel risk acceptance ile applied adoption | **Önerilen.** Prelude’nun tarihsel sırası kanıtlanamaz; fakat final zincirin reconcile edilmiş sözleşmesi doğrulanmıştır. Risk açıkça kabul edilip yalnız history kaydı ayrı mutate edilir. |
| B — Superseded/NOT_APPLICABLE bırakmak | CLI remote/local exact version hedefini sağlamaz ve dokuzuncu migration’ı tek pending duruma getirmez. |
| C — Yeni production baseline/history stratejisi | Staging ve mevcut local zincirle yeni ayrışma üretir; mevcut dokuz-version zinciri için gereksiz geniş mimari değişikliktir. |
| D — Zinciri değiştirmeyen başka yöntem | Supabase history modelinde exact local/remote eşleşme için güvenli, mutasyonsuz bir alternatif yoktur. |

Öneri A otomatik eligibility anlamına gelmez. İmzalı risk acceptance oluşana kadar manifestte `history_adoption_eligible=false` ve bütün policy-removal adımları bloklu kalır.

## 5. Hedef durumlar

Policy kaldırma öncesi remote history: ilk sekiz version. Local-only pending: `20260714010000`.

Policy kaldırma sonrası:

```text
Local migrations: 9
Remote migrations: 9
Exact version match: YES
Legacy policy: REMOVED BY MIGRATION
```

İlk sekiz version’dan herhangi biri ayrı adoption onayını veya post-mutation list kontrolünü geçmezse sonuç değişmez:

```text
POLICY REMOVAL BLOCKED
```

## 6. Resmî CLI referansları

- [Supabase migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair): `applied` history satırı ekler, `reverted` mevcut history satırını siler; şema SQL’ini uygulamaz.
- [Supabase migration list](https://supabase.com/docs/reference/cli/supabase-migration-list): linked project üzerinde applied remote version listesini gösterir.
- [Supabase db push](https://supabase.com/docs/reference/cli/supabase-db-push): pending local migration’ları uygular; `--dry-run` uygulanacak listeyi mutation yapmadan gösterir.
