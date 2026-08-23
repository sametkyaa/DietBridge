# DietBridge automated quality gates

MVP-11 kalite altyapısı Web ve Mobile repository'lerini Node.js 24 LTS ve npm lockfile'larıyla doğrular. Otomatik testler Production Supabase, gerçek kullanıcı, dış e-posta veya gerçek Push provider kullanmaz.

## Web

Ön koşullar: Node.js 24, npm 11, backend/E2E için çalışan Docker Engine.

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:backend
npm run test:e2e:install
npm run test:e2e
```

- `npm run test`: unit/source/service/auth, Notification UI/client/core ve Push registry sözleşmeleri.
- `npm run test:backend`: 48 canonical migration + bir local prerequisite replay; Notification, Chat, appointment collision/reminder, meal completion, subscription limit, Push outbox ve Web/Mobile shared-contract runtime matrisleri.
- `npm run test:e2e`: disposable Supabase üzerinde unauthenticated access, client-role rejection, pending/rejected dietitian, approved login/session restore, kalıcı client/profile read ve logout.
- Plan/meal CRUD, appointment CRUD/collision, Chat/image authorization, subscription/limit ve reminder/Push güvenlik invariant'ları browser yerine daha deterministik disposable backend/service katmanında korunur.

## Mobile

Mobile repository'sinde:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run expo:config
npm run export:android
npm run export:ios
```

`src_backup` ve `lib_backup` production import zincirinde değildir; generated/cache/backup yolları typecheck ve lint dışında, aktif `apps/mobile/src` kapsam içindedir. `npm test` meal, water, appointments, Chat, Notifications, shared date/measurement ve Push 6C.1 sözleşmelerinin tamamını keşfeder.

## Production güvenlik sınırı

- Backend/E2E target'ları yalnız `127.0.0.1` veya `localhost` olabilir.
- Bilinen Production project ref'i `kagvxhyvxxypspdxcuxz` test guard'ı tarafından reddedilir.
- CI workflow'larında Production URL, anon/service-role key, DB password, kullanıcı credential'ı veya Push credential'ı bulunmaz.
- Fixture hesapları `example.invalid` adresleriyle disposable local Auth içinde oluşturulur ve residue sıfır doğrulanır.
- `test_insert.js` ve Production'a yazabilen tarihsel betikler quality gate değildir.

## GitHub check eşlemesi

- Web repository: `Web Quality Gate`
- Web repository: `Backend Integration Gate`
- Web repository: `Critical E2E Gate`
- Mobile repository: `Mobile Quality Gate`

Workflow token yetkisi `contents: read` ile sınırlıdır. `pull_request_target` kullanılmaz. Feature branch'ler yalnız PR event'inde çalışır; protected `main` push sonrasında yeniden doğrulanır. Yeni commit aynı PR/branch için eski koşumu iptal eder; her job timeout'ludur. Playwright trace/screenshot yalnız hata halinde, sentetik fixture'larla ve yedi gün tutulur.

## Bilinen non-blocking debt

Lint mevcut kaynakta error üretmez; tarihsel warning'ler blocker değildir ve toplu format/refactor MVP-11 kapsamı dışındadır. `npm audit` merge blocker değildir: Expo SDK/Metro zincirindeki bulgular major SDK yükseltmesi gerektirdiğinden ayrı dependency-upgrade aşamasında ele alınır; `npm audit fix --force` kullanılmaz.
