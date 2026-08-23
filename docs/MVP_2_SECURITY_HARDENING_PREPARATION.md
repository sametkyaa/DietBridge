# DietBridge MVP-2 Security Hardening Preparation

Bu belge MVP-2A için yalnızca hazırlık artefact'ıdır. Migration hiçbir remote ortama uygulanmamıştır. Sonraki aşama yalnızca **MVP-2B — Local/Disposable Security Validation** olmalıdır.

## Kapsam ve doğrulanan üretim girdileri

- Canonical production project ref: `kagvxhyvxxypspdxcuxz` (`dietbridge_Production`, `ACTIVE_HEALTHY`). Repository link'i aynı ref'i göstermektedir.
- Local ve production migration listeleri 36 version/name ile eşleşmektedir; son migration `20260802090000_chat_active_relationship_hardening`'dir. Hash eşitliği Supabase migration kataloğundan doğrulanamaz.
- Historical hardening migration history'de görünmesine rağmen production'da approval helper body ve ACL invariant'ları yoktur. Eski migration değiştirilmeyecek veya repair edilmeyecektir.
- `is_current_user_dietitian()` production'da yalnız `profiles.role = 'dietitian'` kontrol eder. Canonical kolonlar `dietitian_profiles.verification_status = 'approved'` ve `is_verified is true` olarak hem repository hem production kataloğunda doğrulanmıştır.
- `public.user_role` repository ve production'da tam olarak `dietitian` ve `client` değerlerinden oluşur; başka user-facing rol yoktur.
- Production verification verisi correction anında tutarlıdır: 2 dietitian profile içinde approved/`is_verified` çelişkisi 0'dır. Migration aynı invariant'ı uygulama öncesi tekrar kontrol eder ve veri düzeltmez.
- `dietitian_clients.dietitian_id` ve `client_id` UUID/NOT NULL olup `profiles(id)` foreign key'leridir; `status` NOT NULL `client_status` ve canonical enum `active` değerini içerir. Migration bu relationship contract'ını explicit preflight ile doğrular.
- `daily_logs` üzerinde client-own `SELECT/INSERT/UPDATE` policy'leri vardır; active dietitian `SELECT` policy'si yoktur.
- `current_user_role()`, `is_current_user_dietitian()` ve trigger-only `sync_client_weight_to_measurements()` production'da SECURITY DEFINER'dır. MVP-1'de doğrulanan anonymous/PUBLIC direct execution yüzeyi devam etmektedir.
- Production'da 20 public tablo anon DML/SELECT grant'i taşımaktadır. Web/Mobile source scan'inde pre-auth tablo okuması bulunmamıştır.
- Web ve Mobile GraphQL kullanmaz; Supabase JS REST/RPC/Storage kullanır. Son 24 saatlik MVP-1 API log örneğinde GraphQL çağrısı yoktur.

## Authorization dependency map

| Caller / policy | Mevcut authorization | Approved gerekli mi? | Migration action |
|---|---|---:|---|
| `request_client_connection_by_email(text)` | Auth + role-only helper + target/client/status checks | Evet | RPC body korunur; canonical helper düzeltmesiyle fail-closed olur |
| Appointments dietitian CRUD policies | Dietitian id + helper + active relationship | Evet | Helper düzeltmesi; ayrıca restrictive gate |
| Recipe table ve recipe-image owner policies | Helper + explicit approved/is_verified | Evet | Helper düzeltmesi yeterli; mevcut explicit defense-in-depth korunur |
| `Dietitians can view client profiles for linking` | Helper | Evet | Helper düzeltmesi |
| Client profile, medication, condition, measurement dietitian SELECT | Active relationship; helper yok | Evet | Restrictive approved-dietitian gate |
| `dietitian_clients` dietitian INSERT/SELECT/UPDATE yolları | Own id/role/status; bazı yollarda helper yok | Evet | Restrictive approved-dietitian gate; client branch korunur |
| Meal plan / meals dietitian policies | Own plan/id; helper yok | Evet | Restrictive approved-dietitian gate; client-own yollar korunur |
| Meal change request party policies | Client veya dietitian id; helper yok | Dietitian branch için evet | Restrictive approved-dietitian gate |
| Daily logs | Yalnız client-own | Evet, sadece active-linked SELECT | Yeni dar SELECT policy + restrictive gate |
| `chat_has_active_relationship(uuid,uuid)` ve ona bağlı text/read RPC/policies | Active relationship + participant; approval yok | Dietitian branch için evet | Helper dietitian branch'i approval-aware yapılır |
| Chat tables'in direct RLS yolları | Participant/owner | Dietitian branch için evet | Restrictive approved-dietitian gate |
| `save_weekly_meal_plan` ve `save_active_client_body_measurements_v2` | Zaten explicit approved/is_verified + active relation | Evet | Rewrite yok |
| Client-own onboarding/profile/avatar yolları | Caller owns row/object | Hayır; pending kullanıcı onboarding'i tamamlayabilmeli | Değişiklik yok |

Restrictive gate explicit allowlist uygular: `current_user_role() = 'client' OR is_current_user_dietitian()`. Client için mevcut client-own policy'ler karar vermeye devam eder; yalnız approved dietitian ikinci branch'i geçer. Pending/rejected dietitian, eksik profile/NULL role ve gelecekte eklenebilecek bilinmeyen roller fail-closed reddedilir. `IS DISTINCT FROM 'dietitian'` biçiminde negative allow kullanılmaz. `current_user_role()` bu gate'in gerçek RLS bağımlılığı olduğu için authenticated EXECUTE korunur; anon/PUBLIC kaldırılır.

`current_user_role()` artık yalnız mevcut body'ye güvenmez: source-of-truth `20260713000001_production_public_baseline.sql` semantiğiyle migration içinde yeniden canonicalize edilir. Input almadan `auth.uid()` caller'ının kendi `public.profiles.role` değerini döndürür; eksik profile NULL verir; `STABLE`, `SECURITY DEFINER` ve `search_path = pg_catalog, public` contract'ı postflight'ta normalized body karşılaştırmasıyla doğrulanır.

### Connection RPC sonucu

RPC null session'ı reddeder, normalized email ile yalnız client target arar, foreign role target'ı döndürmez, advisory lock kullanır ve existing active/pending state'i idempotent sonuçlara çevirir. İlk kontrol doğrudan canonical helper'a bağlıdır. Helper düzeltildikten sonra pending/rejected dietitian body'nin target lookup veya relationship mutation bölümüne ulaşamaz; RPC rewrite gereksizdir.

## Daily logs policy contract

Yeni `Approved dietitians can view active client daily logs` policy'si yalnız `SELECT TO authenticated` içindir. Predicate aynı anda:

- caller'ın canonical approved dietitian olmasını;
- `dietitian_clients.dietitian_id = auth.uid()` olmasını;
- relationship client'ının `daily_logs.client_id` ile eşleşmesini;
- relationship status'unun `active` olmasını

zorunlu tutar. Mevcut client-own INSERT/SELECT/UPDATE policy'leri korunur. Dietitian UPDATE/DELETE grant veya policy'si eklenmez.

Preflight canonical client-own üç policy'nin command/role/permissive/predicate semantiğini doğrular ve başka user-facing permissive policy varsa reconciliation isteyerek durur. Postflight yeni dietitian SELECT predicate'inin exact relationship bileşenlerini, client-own policy'lerin korunduğunu ve ek user-facing permissive yol oluşmadığını katalogdan doğrular.

## Function ACL planı

| Function | PUBLIC | anon | authenticated | service_role / trigger |
|---|---:|---:|---:|---|
| `current_user_role()` | Revoke | Revoke | Execute: restrictive RLS gate için gerekli | Execute korunur |
| `is_current_user_dietitian()` | Revoke | Revoke | Execute: RLS/RPC için gerekli | Execute korunur |
| `sync_client_weight_to_measurements()` | Revoke | Revoke | Revoke | service_role execute + owner-trigger contract korunur |
| `chat_has_active_relationship(uuid,uuid)` | Revoke | Revoke | Execute: chat RLS/RPC için gerekli | Execute korunur |

MVP-2B, trigger fonksiyonunun doğrudan RPC invocation'ının reddedildiğini ve `client_profiles` weight değişikliğinin trigger üzerinden measurement sync yapmaya devam ettiğini ayrı ayrı kanıtlamalıdır.

## Anonymous table grant matrix

Source scan signup/login sayfalarında veya auth service'lerinde pre-auth table query bulmadı. Reference tablolar Mobile client profil ekranında, iki medical junction tablo Web authenticated client detail akışında kullanılır. Bu nedenle bütün satırlarda anon revoke, authenticated preserve uygulanır.

| Table | Sınıf | anon action | authenticated action | Neden |
|---|---|---|---|---|
| `activity_levels` | Reference | Revoke all | Preserve | Yalnız authenticated Mobile profil |
| `alcohol_statuses` | Reference | Revoke all | Preserve | Yalnız authenticated Mobile profil |
| `appointments` | Sensitive | Revoke all | Preserve | Private scheduling data |
| `blood_types` | Reference | Revoke all | Preserve | Yalnız authenticated Mobile profil |
| `body_measurements` | Sensitive/legacy | Revoke all | Preserve | Health data; P2 cleanup deferred |
| `client_goals` | Reference | Revoke all | Preserve | Yalnız authenticated Mobile profil |
| `client_medical_conditions` | Sensitive | Revoke all | Preserve | Client health data |
| `client_medications` | Sensitive | Revoke all | Preserve | Client medication data |
| `client_profiles` | Sensitive | Revoke all | Preserve | Client PII/health profile |
| `daily_logs` | Sensitive | Revoke all | Preserve | Client daily health data |
| `dietitian_clients` | Sensitive | Revoke all | Preserve | Tenant relationship graph |
| `dietitian_profiles` | Sensitive | Revoke all | Preserve | Verification/onboarding fields |
| `meal_change_requests` | Sensitive | Revoke all | Preserve | Private workflow data |
| `meal_plans` | Sensitive | Revoke all | Preserve | Assigned care plan |
| `meals` | Sensitive | Revoke all | Preserve | Assigned meal content/status |
| `measurements` | Sensitive | Revoke all | Preserve | Health measurements |
| `medical_conditions` | Reference | Revoke all | Preserve | Yalnız authenticated profile UI |
| `medications_catalog` | Reference | Revoke all | Preserve | Yalnız authenticated profile UI |
| `nutrition_types` | Reference | Revoke all | Preserve | Yalnız authenticated Mobile profil |
| `profiles` | Sensitive | Revoke all | Preserve | Identity/role/PII |

## Default privileges

`20260713000000_staging_default_table_privileges.sql` least-privilege yönüne giderken hemen sonraki production baseline app rollerine geniş grants/default grants vermiştir. Reconciliation yalnız `public` application schema'sında application migration owner'ı `postgres` için gelecekteki anon table/sequence grant'lerini ve PUBLIC/anon function EXECUTE default'unu kaldırır. Authenticated ve service-role defaults değiştirilmez. Production metadata'sında `supabase_admin` defaults geniş olsa da bu internal role davranışını değiştirmenin MVP app-owned objects için zorunlu olduğu kanıtlanmamıştır; bu nedenle `supabase_admin` statement ve membership precondition'ı migration'dan çıkarılmıştır.

## GraphQL kararı

Verdict: **PLATFORM-MANAGED / POST-MVP HARDENING**.

`graphql_public.graphql(text,text,jsonb,jsonb)` local clean stack'te `supabase_admin` owned'dır; application migration role'ü `postgres` bu entrypoint ACL'sini güvenli ve etkili biçimde değiştiremez. Reconciliation migration bu nedenle platform-owned function üzerinde `REVOKE`, `GRANT`, owner veya role-membership mutation yapmaz ve `pg_graphql` extension'ını değiştirmez. GraphQL table/column görünürlüğü standard PostgreSQL grants, row authorization ise RLS ile sınırlandırılmaya devam eder. Web/Mobile source scan'inde GraphQL caller bulunmamıştır ve doğrudan privilege bypass kanıtlanmamıştır. Kalan Advisor warning'leri tek başına exploit kanıtı değildir; post-MVP platform hardening olarak izlenir. Bu sınıflandırma GraphQL'in güvenli olduğunun kanıtlandığı anlamına gelmez; yalnız entrypoint disable işleminin MVP-2 application migration blocker'ı olmadığını kaydeder. MVP-2B anonymous object/data exposure ve authenticated cross-tenant RLS testleri zorunludur.

## Email confirmation readiness

Verdict: **AUTH CONFIRMATION CODE READINESS REQUIRED**.

### Web

- `features/dietitians/services/dietitianService.ts` session bulunmadığında `email_confirmation_required` sonucu üretir; fakat `features/auth/pages/RegisterPage.tsx` bu sonucu tamamlanabilir confirmation UX'i yerine generic failure olarak işler.
- Signup'ta `emailRedirectTo` yoktur. Confirmation callback/route ve resend desteği yoktur.
- `/reset-password` recovery route'u vardır ve password recovery redirect'i işler; bu signup confirmation callback'i değildir.
- Session yokken diploma upload ve ayrıntılı profil tamamlama devam etmez. Confirmation sonrası onboarding'i resume eden bir sözleşme yoktur.

### Mobile

- Signup sonrası Türkçe email doğrulama alert'i gösterilir ve sign-in'e dönülür.
- `apps/mobile/app.json` içinde app scheme/deep-link confirmation callback contract'ı yoktur; signup'ta `emailRedirectTo` yoktur ve resend akışı yoktur.
- Confirmed session gelene kadar authenticated app state oluşmaz. Password reset Mobile'dan Web `/reset-password` URL'ine yönlenir.
- Launch için tek canonical karar gerekir: email link Web callback'e gidip onboarding'i orada tamamlayacaksa Mobile bunu açıkça anlatmalı; native callback seçilecekse scheme, allowed redirect ve session exchange eklenmelidir.

Email autoconfirm production'da code-readiness paketi tamamlanıp Web/Mobile regression geçmeden kapatılmamalıdır.

## Leaked password protection

Bu SQL değildir. Future production application runbook adımı `MANUAL SUPABASE AUTH CONFIG` olarak:

1. Web ve Mobile safe Turkish error mapping'e weak/leaked-password rejection ekle.
2. Signup/login/recovery regression'ını disposable ortamda çalıştır.
3. Supabase Dashboard Auth password security ayarında leaked-password protection'ı etkinleştir.
4. Önceden onaylanan smoke hesaplarıyla expected rejection ve normal login'i doğrula.

Mevcut Web register ve Mobile signup error handling generic kaldığı için code-readiness ayrı iş paketidir.

## MVP-2B local/disposable regression contract

Remote staging kullanılmayacaktır. Disposable local Supabase full migration replay'de migration tek yeni pending version olarak uygulanmalı; verification SQL'in her satırı `passed = true` olmalıdır. Fixture aktörleri: anon, client A/B, approved dietitian A/B, pending dietitian, rejected dietitian.

| Alan | Kabul senaryosu | Red senaryosu |
|---|---|---|
| Auth/role | Approved helper true | anon/client/pending/rejected false |
| Relationship | Approved A own active request/read | foreign, pending/rejected request |
| Daily logs | Client own CRUD; approved A active-client SELECT | foreign/pending/inactive; dietitian UPDATE/DELETE |
| Meals | Client own read/completion RPC; approved plan save | foreign read; pending/rejected dietitian |
| Measurements | Approved active-client read; weight trigger sync | foreign/pending; direct trigger RPC |
| Appointments | Approved own-active CRUD | foreign/pending/rejected |
| Recipes | Approved CRUD preserved | pending/rejected CRUD |
| Chat | Active client + approved linked dietitian text/read/image smoke | foreign/pending/rejected dietitian |
| Anonymous | Auth endpoints only | 20 table REST, privileged functions, GraphQL application data |
| Grants/defaults | Authenticated REST/RPC flows preserved | New disposable public objects inheriting anon grants |

MVP-2B runtime testinde `verification_status = pending`, `is_verified = false` ve active relationship taşıyan bir dietitian'ın `create_chat_image_upload_intent(...)` çağrısı başarıyla intent üretti. Root cause, image create/finalize SECURITY DEFINER body'lerinin approval-aware helper yerine yalnız inline active relationship kontrolüne güvenmesiydi. Reconciliation her iki RPC'yi de mevcut `chat_has_active_relationship(...)` sınırına bağlar; client active-relationship yolu korunurken dietitian yolu approved + active olmak zorundadır. Finalize authorization, finalized/idempotent erken dönüşünden önce uygulanır. `abort_chat_image_upload(...)` yalnız çağıranın kendi non-finalized intent'ini temizleyen owner-scoped cleanup olduğundan aynı bypass pattern'i olarak sınıflandırılmamış ve değiştirilmemiştir. GraphQL platform sınıflandırması değişmemiştir.

İlk MVP-2B future-function runtime testi, `IN SCHEMA public` ile yapılan PUBLIC revoke'un PostgreSQL global built-in `PUBLIC EXECUTE` varsayılanını kaldıramadığını ve önceki `DEFAULT-02` kontrolünün false PASS verdiğini gösterdi. Reconciliation bu nedenle future `postgres`-owned fonksiyonlar için global `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` kullanır; `anon` doğrudan grant temizliği ile `authenticated`/`service_role` grantleri `public` şemasında role-specific kalır. Düzeltilen `DEFAULT-02`, global default ACL satırını ve public-schema eklerini ayrı ayrı `aclexplode` ile doğrular. Değişiklik yalnız migration sonrasında `postgres` tarafından oluşturulan fonksiyonları etkiler; mevcut fonksiyon ACL'lerini değiştirmez ve targeted explicit REVOKE/GRANT hardening zorunlu kalır.

## Web/Mobile impact matrix

| Proposed change | Web caller | Mobile caller | Breakage risk | MVP-2B validation |
|---|---|---|---|---|
| Approved helper/gates | Clients, appointments, meals, recipes, chat | Linked dietitian profile, meals, chat | Orta: pending accounts artık fail-closed | Approved/pending/rejected + foreign actor matrix |
| Daily logs SELECT | Gelecek dietitian client-detail read | Mobile client own daily logs | Düşük | Client CRUD + approved active SELECT only |
| Connection RPC helper | Client linking UI | Yok/doğrudan değil | Düşük | Approved request; pending/rejected deny; cross-tenant |
| Meal completion | Dietitian meal reads; save RPC | Client completion RPC | Orta | Client own completion ve foreign deny |
| Measurement grants/trigger ACL | Client detail measurement read/save RPC | Client weight update | Orta | Approved read + direct deny + trigger sync |
| Anonymous grants | Pre-auth caller yok | Pre-auth caller yok | Düşük/orta: gizli pre-auth lookup olasılığı | Logged-out REST matrix; authenticated lookups |
| GraphQL platform surface | Kullanım yok; REST/RPC var | Kullanım yok; REST/RPC var | Platform-managed entrypoint açık kalabilir; application grants/RLS bypass kanıtı yok | Anon object/data deny + authenticated cross-tenant deny + REST smoke |
| Email confirmation | Register/login/recovery | Signup/login/deep link | Yüksek; code hazır değil | Ayrı code-readiness task; bu migration'a dahil değil |

## Future application runbook gates

Bu adımlar MVP-2A veya MVP-2B sırasında production'da çalıştırılmaz:

1. MVP-2B disposable replay ve actor matrix tam PASS.
2. Migration/verification artefact review ve ayrı açık production application onayı.
3. Production identity, clean Git, exact migration history ve tek pending migration preflight.
4. Maintenance window ve rollback-forward planı.
5. Yalnız approved migration application mekanizmasıyla tek migration uygula; direct SQL veya migration repair kullanma.
6. Read-only verification SQL, Advisor, REST/RPC/trigger/chat smoke ve migration list postflight.
7. Herhangi bir failed check'te Auth config değişikliğine geçme; forward-only follow-up hazırla.
8. Email confirmation ve leaked-password ayarları ancak ayrı code-readiness PASS ve ayrı manuel onaydan sonra Dashboard'da uygulanır.

## Kapsam dışında

`set_updated_at()` search_path, `pg_net` relocation, meal-photo MIME/size, body_measurements cleanup, general policy performance, unrelated repository cleanup ve application code değişiklikleri bu artefact'a dahil değildir.
