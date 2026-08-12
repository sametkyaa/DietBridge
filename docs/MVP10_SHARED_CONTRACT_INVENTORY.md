# MVP-10 Web / Mobile Shared Contract Inventory

Status: local/disposable verification record only. No production read or write was performed for MVP-10.

## Canonical repositories and baseline

| Surface | Repository/worktree | Branch | Baseline / closure state |
| --- | --- | --- | --- |
| Web | `C:\dev\DietBridge-Web-MVP4` | `codex/mvp10-shared-contract-closure` | MVP-9 checkpoint `10d06e9` |
| Mobile source | `C:\dev\DietBridge-Mobile-Chat-Final` | `codex/mobile-chat-final` | clean canonical source at `eb6182a` before disposable closure work |
| Mobile disposable closure | `C:\dev\DietBridge-Mobile-MVP10` | `codex/mvp10-shared-contract-closure` | local-only closure patch and export worktree |

The Mobile repository is the DietBridge client app. The separately inspected Odaklan worktree was rejected as a different product and is not part of this contract.

The verified Supabase migration state remains 41 local/41 remote, with canonical MVP-7 migration `20260812090000_mvp7_subscription_plans_and_client_limits.sql` SHA-256 `623033e5e4e61498c5f1f48b94fe00d9269bae908291a87b8bca831d775c111b`. MVP-10 does not change migration history, schema, RLS, Auth, Storage, secrets, or production data.

## Canonical contract matrix

| Domain | Web contract | Mobile contract | Reconciliation |
| --- | --- | --- | --- |
| Identity / relationship | Dietitian actor is approved and verified; client access is through active `dietitian_clients` relationship. | Client actor is `auth.uid()`; meal, measurement, daily-log, and chat reads/writes are scoped to the authenticated client and active relationship. | Same UUIDs and active status; actor direction is explicit and never inferred from UI state. |
| Client profile | `profiles` + `client_profiles`; nullable profile fields stay nullable; dietitian reads are relationship-scoped. | Client reads/updates own profile through services; no local profile truth is used after Auth switch. | No fabricated values or cross-account profile cache. |
| Meal plan | Dietitian writes the atomic `save_weekly_meal_plan(uuid,date,jsonb)` RPC; plan fields are `id`, `client_id`, `dietitian_id`, `plan_date`, `notes`. | Client reads `meal_plans` joined with `meals`, filtered by own client ID, active dietitian ID, and civil `plan_date`. | One backend plan record; date and ownership filters match. |
| Meals | Canonical type enum is `breakfast`, `lunch`, `dinner`, `snack`; fields include title, nullable calories/macros/photo/description, `time` as `HH:MM`, non-negative `sort_order`, `source`, nullable `recipe_id`, and boolean `is_eaten`. | Same four types and fields; unknown source/type fails closed; recipe snapshots may retain `source=recipe` with `recipe_id=null`; completion uses `set_my_meal_completion`. | No silent enum alias or source fallback; deleted-recipe snapshot compatibility is preserved. |
| Measurements | Dietitian analytics reads `measurements` by client and inclusive civil date; body fields are nullable and bounded `0 < value <= 500`; Web dietitian writes use the approved-dietitian RPC. | Client-owned direct upsert is scoped to `client_id=auth.uid()` and uses Istanbul `measured_at`; values use the same positive 500 upper bound. | Actual actor permissions are preserved; Mobile does not call the dietitian-only RPC. |
| Daily tracking | Analytics reads `daily_logs(date, water_intake)` and meal completion from canonical `meals.is_eaten`; null values remain unknown, not zero-derived truth. | Client writes own daily log by civil date and marks meal completion through the canonical RPC. | Web analytics/dashboard consumes the same rows and completion bit. |
| Appointments | Web uses canonical text status (`upcoming`, `completed`, `cancelled`) and `date`/`time`; ownership is dietitian/client scoped. | No current appointment UI or service surface is exposed in the canonical Mobile MVP. | Backend/type assumptions are recorded only; no Mobile appointment feature was invented. |
| Chat | Authenticated participants use canonical `chat_conversations`, `chat_messages`, `chat_read_states` and SECURITY DEFINER RPCs. | Same tables and RPCs; direct chat-table DML is absent; cursor, delete, delivery, read, and realtime state are scoped by conversation/relationship. | Same relation/conversation/message IDs, body, sender, soft-delete, and cursor semantics. |
| Subscription | Web canonical commercial model is Core/Plus/Scale with server-side entitlement and client-limit enforcement. | No subscription UI/state is exposed in current Mobile MVP. | Mobile does not invent or override Web/backend subscription state. |
| Analytics source | Web uses `meal_plans`, `meals.is_eaten`, `measurements`, and `daily_logs` as canonical rows; invalid metrics are marked/ignored according to analytics contract. | Mobile writes only canonical meal completion, measurements, and daily logs. | Source rows remain backend-owned and re-readable by Web. |

## Enum, nullability, and time rules

- Database meal types are exactly `breakfast`, `lunch`, `dinner`, `snack`.
- Relationship statuses use the database `client_status` enum; only `active` is a loaded client relationship for the Mobile meal/analytics flows.
- Chat status is represented by canonical message/read-state columns and soft-delete/cursor semantics, not a client-only status string.
- Date-only values are civil `YYYY-MM-DD` values. Web analytics and Mobile date helpers use `Europe/Istanbul`; no JavaScript `new Date('YYYY-MM-DD')` timezone conversion is used for displayed date-only values in the closed paths.
- Numeric null remains null. Mobile does not fabricate zero for missing measurements/macros/water; Web analytics treats invalid or missing values as incomplete/unknown.
- Meal `time` is a timezone-free `HH:MM` contract. Message timestamps remain instants and are rendered locally.

## Account/cache isolation closure

Mobile providers remain mounted while the Auth navigator changes. MVP-10 therefore binds `userId` into `MealsProvider` and `DietitianConnectionProvider`, clears protected completion/connection/dashboard state on user change, increments a session generation, and ignores stale meal-plan results from the prior generation. The disposable Mobile tests cover signed-out → A → B transitions; the Web/Mobile runtime actor matrix separately verifies B receives no A rows and that a fresh B client authenticates as B.

Material backend reads are keyed by authenticated user/client, relationship, plan date, and conversation/relation IDs. The Web client-selection preference remains non-authoritative UI state and is scoped to the authenticated dietitian.

## Local/disposable E2E matrix

The local harness uses only a loopback Supabase API/Postgres/Auth stack created under the system temp directory and cleans all actors, rows, Docker resources, and temp paths on exit.

| Flow | Evidence |
| --- | --- |
| A — meal plan roundtrip | Web dietitian atomic RPC creates one plan/two meals; Mobile-equivalent client read sees identical canonical fields; client RPC marks one meal eaten; Web refresh sees `is_eaten=true`. |
| B — measurement | Client-owned Mobile write is re-read by Web dietitian analytics scope with the same Istanbul date/value; foreign dietitian receives zero rows. |
| C — daily tracking | Client water log and meal completion are re-read from Web source queries; dates and completion semantics remain identical. |
| D — chat | Dietitian RPC message and client reply are read from the same conversation; foreign tenant cannot read the conversation. |
| A → B isolation | A protected rows are not returned to B; B session `getUser()` is B; fresh B client cannot resurrect A payload. |

The Mobile package does not expose a canonical typecheck script. Its `tsconfig.json` remains present; the canonical gate for this repository is the 78-test Node contract set plus Android Expo export. Web typecheck remains a required gate.

The disposable shared-flow runner emits `MVP10_SHARED_CONTRACT_RUNTIME_PASS` only after flows A–D, account/tenant isolation, fixture/Auth cleanup, Docker cleanup, and temp cleanup all pass.
