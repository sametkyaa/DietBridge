# DietBridge MVP Execution State

Current Gate:
MVP-5 — Persistent Dashboard Daily Tasks

Status:
MVP-4 — COMPLETE; MVP-5 DISCOVERY IN PROGRESS

Last Verified Base Commit:
`33e17d2` (`fix: verify real meal photo Storage uploads`)

MVP-4 Checkpoint:
This document is included in the verified local MVP-4 checkpoint commit.

Completed Gates:
- MVP-0 — PASS
- MVP-1 — PASS
- MVP-2 — COMPLETE (2026-08-10)
- MVP-3 — COMPLETE (2026-08-11)
- MVP-4 — COMPLETE (2026-08-11)

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

Quality Gates:
- `npm run test:appointments` — 9/9 PASS.
- `npm run test:appointments:runtime` — PASS.
- `npm run typecheck` — PASS.
- `npm run lint` — PASS with 0 errors and 31 warnings (30 pre-existing; one appointment Fast Refresh warning is non-critical).
- `npm test` — 188/188 PASS.
- `npm run build` — PASS; existing >500 kB chunk warning remains non-critical.
- `git diff --check` — PASS.
- Independent corrective re-review — no remaining P0/P1; migration drift 0 and hash allowlist byte-identical to `HEAD`.

npm Audit Triage (2026-08-11):
- 5 high findings, 0 critical; no automatic upgrade was applied.
- `react-router-dom@7.18.1` / `react-router@7.18.1`: direct runtime dependency; advisory concerns RSC action handling, while this product is a Vite SPA and does not use React Router RSC mode. Fix is available in 7.18.2; schedule a controlled patch update.
- `postcss@8.5.17` via `vite@6.4.3`: build-time path/source-map disclosure requires attacker-controlled CSS/source-map input; production requests do not invoke PostCSS. Fix is available above 8.5.22; schedule controlled Vite/lockfile maintenance.
- `nanoid@3.3.16` via PostCSS: build-time transitive dependency; vulnerable custom generator with size zero is not called by appointment or runtime application code. Fix is available in 3.3.17.
- `brace-expansion@5.0.7` via `eslint -> minimatch`: lint-only dependency; untrusted network input does not reach lint glob expansion. Fix is available in 5.0.9.
- These findings are not MVP-4 P0/P1 or current data-integrity blockers; dependency updates remain a separate controlled task.

Repository Branch:
`codex/appointments`

Working Tree:
CLEAN before this required execution-state update. No push, merge, rebase or PR has been performed.

Production Mutation Allowed:
NO

Current Blocker:
- None for MVP-4. MVP-5 discovery and local implementation may proceed.
- Any MVP-5 production migration, production fixture/smoke, Auth/Storage configuration mutation, destructive production action or public launch requires fresh human approval.

Next Action:
Begin MVP-5 — Persistent Dashboard Daily Tasks using the normal Work → Codex → independent review → corrective loop. Start with read-only contract/schema/import-chain discovery, then prepare the smallest local migration/service/UI/test slice without production mutation.

Human Approval Required:
NO for MVP-5 read-only discovery and local implementation. YES before any production mutation or public launch.
