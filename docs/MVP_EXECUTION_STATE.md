# DietBridge MVP Execution State

Current Gate:
MVP-7 — Subscription / Plans / Client Limits

Status:
MVP-7 — PRODUCT MODEL CORRECTED LOCALLY (2026-08-12) — HUMAN APPROVAL REQUIRED FOR PRODUCTION

Last Verified Base Commit:
`3308ab6` (`feat: persist dashboard daily tasks`)

MVP-4 Checkpoint:
This document is included in the verified local MVP-4 checkpoint commit.

MVP-5 Checkpoint:
This document is included in the verified MVP-5 local checkpoint commit after production closure.

Completed Gates:
- MVP-0 — PASS
- MVP-1 — PASS
- MVP-2 — COMPLETE (2026-08-10)
- MVP-3 — COMPLETE (2026-08-11)
- MVP-4 — COMPLETE (2026-08-11)
- MVP-5 — COMPLETE (2026-08-11)
- MVP-6 — COMPLETE (2026-08-11)
- MVP-7 — PRODUCT MODEL CORRECTED LOCALLY (2026-08-12); production apply pending approval

MVP-7 Local Verdict:
- Canonical, provider-neutral subscription/plan state plus server-side dietitian client-limit enforcement. No payment provider was selected or integrated; checkout/webhook/provider work is classified as separate post-MVP scope per MVP-7.3.
- Forward-only migration `20260812090000_mvp7_subscription_plans_and_client_limits.sql`: canonical commercial catalog is `Core=10`, `Plus=30`, `Scale=50`; the Free plan and the old free/pro/premium seed model are absent. `dietitian_subscriptions` remains provider-neutral, with SECURITY DEFINER entitlement/usage helpers, a fail-closed capacity trigger, the `limit_reached` RPC signal, and the read-only overview RPC.
- Plan limits are authoritative and deterministic in one catalog; no magic limit numbers are scattered across UI components.
- Effective entitlement is fail closed: an existing dietitian profile with no subscription row is backfilled to `Core/active` during migration; the helper also falls back to active Core (10) for a valid dietitian if a row is absent later, preventing accidental lockout while unauthenticated/non-dietitian identities still resolve to 0. A subscription whose status is not active/trialing, or whose plan is unknown/inactive, returns 0.
- Canonical consumed capacity = relationships in (`active`,`pending`). Enforcement covers the RPC insert path and rejected/removed -> pending reactivation. Client accept (`pending` -> `active`) does not increase used capacity and is never blocked.
- Race safety: both the capacity trigger and the RPC take a per-dietitian `pg_advisory_xact_lock` so concurrent capacity-consuming writes cannot both bypass the limit.
- `dietitian_subscriptions.client_limit_override` is nullable, non-negative, and bounded by the integer domain: NULL uses the catalog base limit, while an explicit value such as 75 supports Scale accounts above 50 without an unlimited sentinel. The browser has no write path to either subscription table; RLS grants authenticated SELECT only, and the overview RPC is denied to anon. Pending/rejected dietitians remain denied by the shared approved+verified gate.
- UI: the Settings billing tab mock (hardcoded "Pro Plan", "₺499/ay", card 4242, 2023 renewal date) was removed and replaced by a real `SubscriptionPanel` that reads authoritative plan/usage/limit ("used / limit danışan") with distinct loading/error/retry states. The Clients add-client flow surfaces a clear `limit_reached` message. No fake upgrade success and no fake subscription state.

MVP-7 Disposable Runtime Evidence:
- `npm run test:subscriptions:runtime` — pending final corrected-model rerun against a real disposable Postgres/PostgREST/Auth stack (pinned Supabase CLI `2.110.0`, 41 repository migrations + 1 local prerequisite).
- Server-side enforcement matrix PASS: Core 10, Plus 30 and Scale 50 each pass below/at/above-limit RPC and direct-insert checks; Scale override 75 is enforced as a finite limit; canceled subscription returns 0; Core→Plus→Scale upgrades free capacity; downgrade preserves existing rows but blocks new adds; client acceptance at a full boundary remains allowed; reactivation at the limit is refused; pre-migration dietitian backfill and post-migration missing-row Core fallback both preserve allowed client addition for approved dietitians.
- Tenant isolation PASS: dietitian B cannot read A's subscription row; B's overview is independent of A's usage; anonymous cannot read the plan catalog or call the overview RPC; pending dietitian denied the overview RPC (fail closed).
- Residue target: temporary relationships/subscriptions/Auth users = 0; disposable temp and Docker residue = 0.

MVP-7 Quality Gates:
- `npm run test:subscriptions` — 17/17 PASS (service mapping + Core/Plus/Scale/override/backfill SQL contract + UI-replacement assertions).
- `npm test` — pending final corrected-model rerun.
- `npm run typecheck` — PASS.
- `npm run lint` — 0 errors, 26 pre-existing/non-critical warnings.
- `npm run build` — PASS; existing >500 kB chunk warning remains non-critical.
- `git diff --check` — pending final corrected-model rerun.
- Disposable replay guardrails and the canonical `tests/fixtures/canonicalReplaySyntaxEdits.json` inventory remain 34 canonical / 7 image / 41 total. No historical migration or historical hash entry was edited; only the unshipped MVP-7 entry was recalculated for this corrected migration.

MVP-7 Production Gate:
- `MVP-7 PRODUCT MODEL CORRECTED LOCALLY — HUMAN APPROVAL REQUIRED FOR PRODUCTION`.
- Proposed production change: after approval, apply exactly one forward-only migration `20260812090000_mvp7_subscription_plans_and_client_limits.sql` (`598561599a709ef7795aaa871be2f07cbf94cfef60b25769e1c5e2f3b4d2010c`).
- Schema impact: two new tables (`subscription_plans`, `dietitian_subscriptions`), the nullable non-negative `client_limit_override` column, one index, four subscription/enforcement functions, one new BEFORE trigger on `dietitian_clients`, a Core backfill for existing dietitian profiles, and a redefinition of `request_client_connection_by_email` that adds capacity checks while preserving prior return values plus `limit_reached`.
- RLS impact: RLS enabled on both new tables; authenticated SELECT-only; no anon access; no browser write path.
- Additive only: no existing table/column is dropped or rewritten, no relationship/history data is rewritten, and no Auth/Storage/secret/Vault/cron change is made. The only data backfill is new `dietitian_subscriptions` rows for profiles that lack one, set to `Core/active`.
- Backup/restore: take a fresh production logical backup/restore point before apply (matching prior MVP practice), because the production project has no managed PITR.
- Exact production smoke (developer/test accounts only, after approval): confirm only `Core/10`, `Plus/30`, `Scale/50`; verify existing approved dietitians lacking a row receive `Core/active` and can add clients; verify `get_dietitian_subscription_overview`, a finite Scale override, and a capacity-blocked add returning `limit_reached`; then remove any temporary fixture.
- Rollback/corrective: the migration is additive; corrective forward-only migration can drop the new trigger/functions/tables if required. No historical migration is mutated.
- No production access, write, migration, or mutation has been performed for corrected MVP-7.

MVP-6 Local Verdict:
- The active `/analytics` route now reads real Supabase-backed analytics data; the legacy `CLIENTS` mock, fake loading delay, hardcoded KPI/chart/activity/risk content and inert AI/export actions are absent from the active chain.
- Client selection is authenticated, active-relationship scoped, fail closed, deterministic and fully paginated. It reads only the selector fields `id`, `full_name` and `avatar_url`; health, medication, email and unrelated profile fields are not fetched.
- Analytics source reads are restricted to the selected client; meal-plan reads also require the authenticated dietitian ID. A removed, foreign, pending, rejected, missing-profile, client-role or anonymous actor cannot reach the analytics source reads.
- Date ranges use `Europe/Istanbul` civil dates with inclusive 7-day, 30-day, calendar three-month and all-time boundaries. Partial weekly buckets are clamped to the selected range.
- Weight KPIs use the earliest and latest valid 20–500 kg measurements independently of the selected trend window, with profile fallbacks only where the metric contract permits them.
- Water averages exclude missing/invalid days but retain real zero values; coverage and goal-eligible denominators remain visible. Meal adherence reports completed/planned meals and returns no percentage when no meal is planned.
- Persisted water, calorie and macro values are bounded against the canonical product limits in both service mapping and pure aggregation; overflow-safe totals cannot emit `NaN` or `Infinity` into the UI.
- Calories and macros are labelled only as planned nutrition. Missing values preserve incomplete coverage instead of being converted to zero or presented as consumed intake.
- Weight, water and each real body-measurement field expose 0/1/N-safe trends plus accessible history tables. Loading, error, retry, idle and section-specific empty states remain distinct, and stale requests cannot overwrite a newer selection.
- Active-client avatar values use the canonical private signed-URL resolver; raw private Storage paths are not rendered as image URLs.
- Existing schema and RLS were sufficient; no migration was created or applied for MVP-6.

MVP-6 Disposable Runtime Evidence:
- Hash-verified replay PASS: 40 repository migrations plus one local-only prerequisite using pinned Supabase CLI `2.110.0`.
- The real compiled analytics service passed Istanbul inclusive range, canonical earliest/latest valid weight, meal adherence, water null/zero, water goal, planned-nutrition coverage and fresh authenticated-session checks.
- Approved own/foreign tenant isolation PASS. Pending and rejected dietitians were denied even with admin-created active relationships; missing-profile, client-role and anonymous actors were denied; removed relationships failed closed.
- Temporary meals, meal plans, daily logs, measurements, client profiles, relationships, Auth users and actor-source rows = 0.
- Per-run disposable temp directory, Docker containers, volumes and networks = 0.
- Production access/mutation = none; customer data touched = none; production Auth users created = none.

MVP-6 Quality Gates:
- `npm run test:analytics` — 8/8 PASS, including huge-finite-value overflow regression coverage.
- `npm run test:analytics:runtime` — PASS with 40-migration replay and exact fixture/Auth/temp/Docker residue zero.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS with 0 errors and 26 pre-existing/non-critical warnings.
- `npm test` — 207/207 PASS.
- `npm run build` — PASS; existing >500 kB chunk warning remains non-critical.
- `git diff --check` — PASS; only line-ending conversion warnings were reported.
- Final independent closure review found one numeric-overflow P1; the code-only corrective loop added bounded/overflow-safe metrics and regression coverage. Corrective independent re-review — PASS with no remaining findings.

MVP-6 Production Read-Only Smoke Evidence:
- Human approval for the minimum production read-only analytics smoke was received on 2026-08-11; no production data mutation was authorized.
- Production identity PASS: expected project ref, `dietbridge_Production`, `ACTIVE_HEALTHY`, linked repository project and authenticated Data API URL matched.
- Existing developer/test dietitian identity PASS: authenticated session usable, role `dietitian`, verification `approved` and `is_verified = true`.
- Exactly one ACTIVE relationship matched the approved test-domain filter; unrelated production identities were not enumerated and customer data was not accessed.
- The actual compiled MVP-6 analytics service and independent canonical source SELECT path both reached production without mock/fallback substitution.
- Europe/Istanbul 30-day range construction and source-query boundaries PASS.
- Existing test client data was insufficient for weight baseline/latest/delta, water coverage, meal adherence and planned-nutrition source-vs-analytics acceptance. No wider customer/history search and no fixture creation was performed.
- Representative production foreign-client check was not run because no second known-safe test identity was available; the disposable tenant actor matrix remains PASS.
- Production database writes = 0. Normal managed Auth session activity was the only permitted authentication side effect.
- Production migration/schema/RLS/Auth/Storage/Edge/secret/Vault/cron configuration changes = 0.
- Credential values were not written to repository files, reports, screenshots or commits; the credentialless temporary smoke runner was removed.

MVP-6 Minimum Production Fixture and Final Smoke Evidence:
- Separate human approval for the minimum temporary developer/test-only production fixture and its complete cleanup was received on 2026-08-11.
- Preflight reconfirmed the expected production project, approved/verified developer/test dietitian, exactly one ACTIVE test-domain client relationship, empty marker set, no valid canonical weight baseline collision and no fixture-date collisions.
- Created exactly two synthetic measurements on two recent Europe/Istanbul civil dates: `80.0 kg` followed by `77.5 kg`; no unnecessary body measurements were added.
- Created exactly one synthetic daily log with `2400 ml` water.
- Created exactly one marked meal plan containing exactly two marked manual meals: one eaten and one not eaten. Planned totals were `1000 kcal`, `70 g` protein, `100 g` carbohydrates and `30 g` fat.
- The actual compiled production analytics service matched independent source SELECT evidence: weight baseline/latest/delta `80.0 → 77.5 / -2.5 kg`, water coverage `1/30` with `2400 ml`, adherence `1/2 = 50%`, and all planned-nutrition totals PASS.
- Europe/Istanbul range and fixture civil-date inclusion PASS; no UTC day shift, `NaN`, `Infinity`, overflow or mock/fallback output was observed.
- Production foreign-client representative check remained `NOT-RUN-SAFE-IDENTITY-UNAVAILABLE`; no second account was created and the full disposable actor/tenant matrix remains PASS.
- Cleanup deleted only the recorded fixture IDs. Final residue: temporary measurements = 0, daily logs = 0, meal plans = 0, meals = 0, Auth rows = 0, relationships = 0, Storage objects = 0, cleanup queue delta = 0.
- Customer data was not accessed or modified. No migration, schema, RLS, Auth configuration, Storage configuration, Edge Function, secret, Vault or cron change occurred.
- The credentialless fixture runner was removed after cleanup; credential values were not persisted or reported.

MVP-4 Local Verdict:
- No fake-success or local-only appointment persistence remains in the active Web chain.
- Fetch/create/update/delete are authenticated, dietitian-owned, active-relationship scoped and fail closed.
- Create sets `upcoming`; update omits `status` and preserves existing `upcoming`, `completed` or `cancelled` state.
- Zero-row update/delete is not treated as success.
- Appointment UI uses real active linked clients, awaits mutation results, exposes loading/error/retry, confirms delete and locks duplicate submits synchronously.
- Local date parsing/serialization avoids UTC date-key drift; invalid/past schedule, duration, type, title and client IDs are rejected.
- Historical migrations and `tests/fixtures/canonicalReplaySyntaxEdits.json` were not modified.
- Windows CRLF closure uses three explicit `text eol=lf` entries and canonical Git blobs only for LF-pinned sources; semantic working-tree drift and non-EOL tampering remain fail-closed.

Disposable Runtime Evidence:
- Hash-verified replay PASS: 39 repository migrations plus one local-only prerequisite.
- Real local Auth/PostgREST/RLS actor matrix PASS for approved dietitian A/B, linked client A/B, foreign actor, unrelated client, pending, rejected, missing-profile and anonymous actors.
- Approved create/read/update/delete, fresh-session persistence, `upcoming` default and completed-status preservation PASS.
- Foreign/random-ID zero-row update/delete, client write denial, inactive-relationship revocation and Istanbul date boundary PASS.
- Temporary appointments = 0; temporary relationships = 0; cleanup queue residue = 0.
- Per-run disposable Docker containers = 0; per-run temp directory residue = 0.
- Production access/mutation = none; customer data touched = none; Auth users created in production = none.

MVP-4 Production Smoke Evidence:
- Checkpoint `0a3e748` and clean `codex/appointments` worktree reconfirmed before production access.
- Production identity PASS: `dietbridge_Production` / `kagvxhyvxxypspdxcuxz` / `ACTIVE_HEALTHY`.
- Migration parity PASS: 39/39; canonical appointment schema, RLS and table privileges PASS.
- Existing developer/test dietitian identity PASS: role `dietitian`, verification `approved`, `is_verified = true`.
- Existing same-domain test client relationship PASS: active before and unchanged after smoke.
- Real authenticated `appointmentService.ts` create PASS with a production row ID and deterministic `MVP4_TEST_0a3e748` marker.
- Canonical refresh and fresh authenticated session reload PASS after create.
- Real update PASS on the same row ID; title/time persisted and `status = upcoming` was preserved.
- Canonical refresh and fresh authenticated session reload PASS after update.
- Representative foreign-client authenticated read returned zero rows; tenant isolation PASS.
- Canonical service delete PASS; fresh authenticated session and direct read-only DB postflight both confirmed row absence.
- Temporary marker appointments = 0; total appointments returned to baseline 0; unrelated appointment set unchanged.
- Target active relationship unchanged; expected Auth identities intact; marker Storage objects and cleanup queue rows = 0.
- No customer data, Auth configuration, Storage configuration, migration, RLS, Edge Function, secret, Vault, cron or dependency was changed.

MVP-5 Local Verdict:
- The active Dashboard task flow now uses persistent Supabase-backed `daily_tasks`; the legacy `TASKS` constant is not imported by the active page.
- Create, edit, delete, complete and reopen operations are authenticated, owner-scoped, fail closed and followed by a canonical refresh; no local/mock persistence fallback exists.
- Tasks support optional active linked clients, title, optional description, Istanbul civil due date/time, low/medium/high priority, pending/completed status and server-controlled completion timestamps.
- Overdue, today, upcoming and completed groups use explicit `Europe/Istanbul` civil boundaries and re-evaluate every 30 seconds while the page remains open.
- Loading, error, retry, empty, pending-mutation and mutation-error states are distinct; duplicate mutations are synchronously locked.
- The task dialog uses stable initial focus, Tab focus containment, Escape close, opener focus restoration and real active-client UUID values.
- Migration `20260811103909_create_persistent_dashboard_daily_tasks.sql` creates the complete table, constraints, indexes, trigger, explicit RLS policies and fail-closed grants without fixtures or production writes.
- The trigger protects immutable identity/ownership/creation fields, normalizes text, enforces completion timestamp invariants and requires an active relationship when a client link is created or changed.

MVP-5 Disposable Runtime Evidence:
- Hash-verified replay PASS: 40 repository migrations plus one local-only prerequisite using pinned Supabase CLI `2.110.0`.
- Real compiled `dailyTaskService.ts` PASS for general and linked create, read, update, complete, reopen and delete with fresh authenticated sessions.
- Approved dietitian tenant isolation PASS; foreign dietitian, clients, pending/rejected/missing-profile dietitians and anonymous actors remained fail closed.
- Immutable ID, owner and `created_at` enforcement PASS; completed timestamp anti-forgery and status transition invariants PASS.
- Removed-relationship existing-task management/unlink behavior PASS; new create/relink against removed or unrelated relationships denied.
- Temporary daily tasks = 0; temporary relationships = 0; temporary Auth users = 0.
- Per-run disposable temp directory, Docker containers, volumes and networks = 0.
- Production access/mutation = none; customer data touched = none; production Auth users created = none.

MVP-5 Alternative Logical Restore Evidence:
- Production Free Plan had no managed backup or PITR; no plan upgrade was performed.
- Exact migration additive-only invariant PASS: only new `daily_tasks` table/constraints/indexes/trigger/function/policies/grants/comments; no existing table/data rewrite and no Auth, Storage, Vault, cron, secret or unrelated RLS mutation.
- Private logical backup created outside the repository at `2026-08-11T14:54:09+03:00` with current-user-only ACL.
- Official CLI artifacts captured: roles, full application schema, full application data, migration-history schema/data and separate Auth/Storage customization schema evidence.
- Manifest contains nine artifact byte sizes and SHA-256 values; all hashes re-read byte-identically. Manifest SHA-256: `a76057fde47b8f8be0d3a2be2c6faacb05673d11077e30ab5969bc8a3a3596dd`.
- Disposable local Supabase restore PASS: application schema/data and 39-row migration history restored without SQL corruption; key row counts matched the production snapshot exactly.
- Restore validation found 28 public tables, all 28 with RLS enabled, 83 public policies, 38 public functions and the required `private` schema.
- Managed-role limitation documented: canonical local Supabase rejects dump-time ALTER of its pre-seeded reserved `supabase_admin`; the disposable target retained its canonical seeded roles.
- Official managed-vector exclusions applied for `storage.buckets_vectors` and `storage.vector_indexes`; no production schema was weakened.
- Disposable restore containers, volumes and networks = 0; private backup remains preserved outside Git.

MVP-5 Production Migration and Smoke Evidence:
- Production identity reconfirmed: `dietbridge_Production` / `kagvxhyvxxypspdxcuxz` / `ACTIVE_HEALTHY` / PostgreSQL `17.6.1.052`.
- Pre-apply migration history 39/39 and key production counts matched the logical-backup snapshot; no drift was found.
- Migration SHA-256 reconfirmed: `32160e12b6485890cb184156dfbb087393c09bd120eb8991e77869046bdf967f`.
- Pinned CLI dry-run showed exactly one migration, no seed and no role changes; only `20260811103909_create_persistent_dashboard_daily_tasks.sql` was applied.
- Postflight migration history advanced exactly once to 40 with latest version `20260811103909` and subsequent dry-run reported up-to-date.
- Production contract PASS: 12 columns, nine constraints, three indexes, RLS enabled, four authenticated owner-scoped policies, trigger, invoker function with fixed search path, authenticated CRUD grants and no anon CRUD privilege.
- Real compiled `dailyTaskService.ts` authenticated smoke PASS using only existing safe developer/test identities and the existing active test relationship.
- Create and canonical refresh persistence PASS; duplicate marker count stayed exactly one.
- Complete and fresh-session refresh persistence PASS; reopen and fresh-session refresh persistence PASS.
- Update and fresh-session persistence PASS; pending status was preserved.
- Anonymous access denial PASS; delete and fresh-session absence PASS.
- Final direct postflight: `MVP5_TEST` rows = 0, total daily tasks = 0, relationships = 5, Auth users = 7 and unrelated key application counts unchanged.
- No Auth users or relationships were created; no customer data, Storage, Auth configuration, secret, Vault, cron or unrelated object was modified.
- Credential and token values were not written to repository files, reports, screenshots or commits; the credentialless temp smoke runner was removed.

Quality Gates:
- `npm run test:daily-tasks` — 10/10 PASS.
- `npm run test:daily-tasks:runtime` — PASS with zero fixture, Auth, temp and Docker residue.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS with 0 errors and 31 pre-existing/non-critical warnings.
- `npm test` — 199/199 PASS.
- `npm run build` — PASS; existing >500 kB chunk warning remains non-critical.
- `git diff --check` — PASS.
- Independent corrective re-review — no findings after the clock, filter, staged-index and dialog accessibility corrective loop.
- Migration SHA-256 allowlist remains byte-identical: `32160e12b6485890cb184156dfbb087393c09bd120eb8991e77869046bdf967f`.

npm Audit Triage (2026-08-11):
- 5 high findings, 0 critical; no automatic upgrade was applied.
- `react-router-dom@7.18.1` / `react-router@7.18.1`: direct runtime dependency; advisory concerns RSC action handling, while this product is a Vite SPA and does not use React Router RSC mode. Fix is available in 7.18.2; schedule a controlled patch update.
- `postcss@8.5.17` via `vite@6.4.3`: build-time path/source-map disclosure requires attacker-controlled CSS/source-map input; production requests do not invoke PostCSS. Fix is available above 8.5.22; schedule controlled Vite/lockfile maintenance.
- `nanoid@3.3.16` via PostCSS: build-time transitive dependency; vulnerable custom generator with size zero is not called by appointment or runtime application code. Fix is available in 3.3.17.
- `brace-expansion@5.0.7` via `eslint -> minimatch`: lint-only dependency; untrusted network input does not reach lint glob expansion. Fix is available in 5.0.9.
- These findings are not MVP-4 P0/P1 or current data-integrity blockers; dependency updates remain a separate controlled task.

Repository Branch:
`codex/subscriptions`

Working Tree:
DIRTY with the reviewed MVP-7 subscription/client-limit implementation and this execution-state update, on top of the committed MVP-6 checkpoint. The MVP-7 migration and `.gitattributes` entry are staged so the canonical replay reader can hash them; nothing has been committed, pushed, merged or rebased for MVP-7 yet.

Production Mutation Allowed:
NO

Current Blocker:
- None for MVP-6; it is COMPLETE.
- MVP-7 local closure is verified; its only open item is the production apply/smoke gate, which requires explicit human approval.
- Per the active supervisor program, MVP-8 (Dashboard Closure) proceeds autonomously; MVP-7 production apply is deferred to a human-approval boundary and does not block MVP-8 local work.

Next Action:
Continue MVP-8 (Dashboard Closure) autonomously on its own branch. Hold the MVP-7 production migration/smoke for explicit human approval.

Human Approval Required:
YES before applying the MVP-7 production migration or running any production smoke/writes. Local/disposable MVP-8 work is authorized.
