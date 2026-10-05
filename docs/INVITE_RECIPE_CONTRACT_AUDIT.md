# Davet kodu ve tarif içe aktarma — canonical audit

Date: 2026-10-05 (Europe/Istanbul). Phase A: PASS for implementation preparation.
This is a new feature task authorized by the attached specification; the historical MVP roadmap remains unchanged.

## Identity and authority

| Repository | Path | Starting HEAD | Starting working tree |
| --- | --- | --- | --- |
| Web | `C:\Users\drsam\Desktop\Yeni klasör\DietBridge-Web` | `65b50e8dfd8ec9c17549a3c6b691501d660121e2` | `codex/legal-privacy-kvkk-update`, untracked `docs/legal/` |
| Mobile | `C:\dev\DietBridge-Mobile-UI` | `08aa0868ed4520064fbd55dd696d82646d4646e9` | `main`, modified `package-lock.json` |

Remotes identify `sametkyaa/DietBridge` and `sametkyaa/DietBridge-Mobile`. Both root AGENTS.md files were read. Existing user changes must be preserved. Web is shared schema/migration authority; no independent Mobile migration chain will be created. Read `docs/ROADMAP.md`, `docs/MVP_EXECUTION_STATE.md`, `docs/MVP10_SHARED_CONTRACT_INVENTORY.md`, architecture decisions, Mobile backlog and quality gates. Historical document claims are not current runtime evidence.

Linked project reference matches MCP identity `kagvxhyvxxypspdxcuxz`, `dietbridge_Production`, ACTIVE_HEALTHY, PostgreSQL 17.6.1.052. Staging is INACTIVE. Production inspection used only SELECT over catalog/schema/policy/bucket/migration metadata; no customer row content. Remote history has 58 entries through `20260901200413`; the existing disposable runner materializes 59 canonical migrations plus one local prerequisite. Deferred Push history is not silently reconciled or applied by this feature.

## Active entry points

Web: `index.html → index.tsx → App.tsx → features/clients/pages/ClientsPage.tsx` and `pages/Recipes.tsx`, `pages/RecipeDetails.tsx`; infrastructure `lib/supabaseClient.ts`. Client queries belong in feature services. Recipes use `features/recipes/services/recipeService.ts`.

Mobile: `App.js → RootNavigator/AuthNavigator → MainTabs → DashboardScreen`; ProfileScreen and SettingsScreen are active stack screens. `DietitianConnectionProvider(userId)` owns relationship refresh and realtime lifecycle. `dietitianConnectionService.js` owns queries. Keep JavaScript, Expo and MVVM.

## Relationship contract

- `dietitian_clients`: UUID identity, `dietitian_id`, `client_id`, enum `client_status` (`pending`, `active`, `rejected`, `removed`), lifecycle timestamps. All four status values confirmed in production constraints.
- Global pair uniqueness; partial unique `client_id` for pending/active ensures one occupying relationship per client. No second relationship domain.
- Current `request_client_connection_by_email(text)` creates/reactivates pending, locks `hashtext(client_id::text)` followed by `hashtext('dietitian_client_capacity:' || dietitian_id)`.
- Transition trigger requires INSERT pending; permits pending→active/rejected/removed, active→removed, rejected/removed→pending. Invite redeem can reuse pending→active inside one transaction; no trigger bypass or new active INSERT policy is necessary.
- Capacity is **active + pending**. `dietitian_effective_client_limit` uses authoritative catalog/subscription and Scale override; no subscription or inactive subscription means zero. Core 10, Plus 30, Scale 50 base. `enforce_dietitian_client_capacity` serializes slot consumption with the existing lock. Existing pending of the target dietitian already consumes a slot.
- Client legacy approval/rejection performs UPDATE on own pending request. Preserve this path and email RPC/privileges until Mobile release. RLS: own-party SELECT, own pending→active/rejected, dietitian own pending/active→removed; restrictive approved-dietitian authorization gate. No client INSERT.
- The transition function does not enforce immutable relationship IDs/parties. Add a targeted immutable-party guard during Phase B to prevent pending approval from changing dietitian ownership; retain legacy allowed transitions.
- `private.notify_dietitian_client_change` aggregates pending/accepted/rejected/removed events; accepted targets dietitian, existing removed event assumes dietitian actor and targets client. A client leave needs an explicit correct recipient/actor using the same notification aggregate producer.
- Realtime subscribes to `dietitian_clients` filtered by client ID; refreshes on app foreground and actor changes. Keep these paths.
- Legacy pending closure occurs only after successful explicit redeem under locks; migration itself performs no pending cleanup.

## Recipe contract

- Canonical `recipes`: name (required, <=160), nullable description (<=2000), required meal_type (`breakfast/lunch/dinner/snack`), required integer calories (0..10000), required numeric protein/carbs/fat (0..1000), private image path, owner and timestamps.
- `RecipeInput` is camelCase name/description/mealType/calories/macros `{protein, carbs, fat}`. `normalizeRecipeInput` is the existing validation authority; create/update serialize to these DB columns. Same names are deliberately allowed (no name uniqueness).
- Manual form, recipe list/detail, meal-plan selection and snapshots consume this model. Meal `recipe_id` refers to recipes; meal snapshots preserve title/description/macros/image and deletion compatibility. Do not add recipe ingredients/instructions columns for extraction.
- Imported drafts are an incomplete version of the same create input: absent mealType/nutrition remain null. Explicit save must require dietitian completion of required fields and call the canonical validator. Never coerce missing values to zero.
- Source ingredients/preparation can be rendered into the existing description, with the 2000 character bound surfaced as an edit requirement. Source metadata stays in import items, not recipe business columns. Preview retains missing-field warnings. No AI nutrition estimation.
- Recipe RLS is owner AND approved dietitian for read/create/update/delete. Caller cannot read/save another dietitian's recipes. Import ownership must have equivalent independent RLS and RPC guards.
- `recipe-images` is private, 5 MiB, JPEG/PNG/WebP, path `recipes/<owner>/<recipe>/<random>.<ext>`, signed URL 5 minutes. Planned image client reads are a separate existing policy; recipe-imports will not inherit public/planned-image access.

## Storage, cleanup and runtime

All six production buckets are private. `recipe-imports` does not exist yet. Existing cleanup functions demonstrate retry queues/authorized Edge cleanup patterns. Proposed source retention <=24h with idempotent delete-before-expire and orphan sweep; no deletion by database metadata alone. File bytes, prompts and raw AI response must not be logged.

User explicitly corrected runtime model to `gpt-6-luna` after checking the official catalog (2026-10-05). Target: OpenAI Responses API, configured server-only model and key, store:false, strict structured output, at most one semantic repair, no fallback/provider change. DOC/DOCX file inputs are documented; spreadsheets must use deterministic parsing and zero AI calls. Real OpenAI smoke is optional and separately authorized; no paid call in default tests.

## Verification plan and gates

Node 24.18.0/npm 11.6.2 available. Supabase CLI 2.110.0 is available via npx. Docker Desktop was initially stopped; starting it restored Docker 29.8.1. Disposable runners sanitize remote environment, allocate loopback ports, materialize canonical replay and assert residue cleanup. Do not execute root `test_insert.js`.

Web supports npm ci/typecheck/lint/test/build, backend runtime and existing Playwright E2E. Mobile supports npm ci/typecheck/lint/test/expo:config/export:android/export:ios. Existing Mobile dirty lock must not be regenerated. Device testing is separate and never inferred from exports.

1. Phase B: generate migration using CLI; local clean apply and repeat-apply expectation, auth/role/grants/RLS negatives, normalization/rotate/pause, combined preview/redeem failures, lifecycle, legacy compatibility, leave notifications and last-slot concurrency. PASS before Mobile implementation.
2. Phase C: Mobile code-entry/preview/confirm/leave and auth handoff, actor isolation, pending-code-only persistence, legacy preservation; quality gates before web cutover preparation.
3. Phase D: web feature flag default legacy_email, code/link/QR/sharing/capacity/rotate/pause; no email removal. Canonical URL `https://app.dietbridge.com.tr/davet/<CODE>`.
4. Phase E: deterministic imports, immutable source/provenance, server-authoritative job states, editable preview, explicit selected transactional save, private storage/cleanup; tests before AI.
5. Phase F: server-only Luna adapter, bounded transport/semantic retries, injected fake transport tests, no direct recipes write, metrics only.
6. Phase G: supported gates, focused browser tests, diff/security review, consolidated report/runbook.

## Release-only blockers

- Actual Android signing SHA-256 and Apple Team ID are not present in app config; do not invent them. Both declared application IDs are `com.dietbridge.app`. Expo scheme is `dietbridge`. HTTPS association config is absent. Real domain hosting/association and physical-device link behavior require verification.
- `OPENAI_API_KEY` production secret required; separately approved Edge deployment/config and actual account model access smoke.
- Production migration, Storage, secrets, Edge deployment and app/web release are explicitly forbidden in this task. Prepare identity/preflight/backup/order/postflight/recovery runbook only.
- User acceptance explicitly requires per-phase gates; a failed Phase B runtime test blocks dependent phases until resolved. No later phase may be labelled complete based on static inference.
