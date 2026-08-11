# DietBridge MVP Execution State

Current Gate:
MVP-4 — Appointment Reliability

Status:
MVP-4 LOCAL VERIFIED — PRODUCTION SMOKE APPROVAL REQUIRED

Last Verified Base Commit:
`33e17d2` (`fix: verify real meal photo Storage uploads`)

MVP-4 Checkpoint:
This document is included in the verified local MVP-4 checkpoint commit.

Completed Gates:
- MVP-0 — PASS
- MVP-1 — PASS
- MVP-2 — COMPLETE (2026-08-10)
- MVP-3 — COMPLETE (2026-08-11)

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
DIRTY — coherent verified MVP-4 checkpoint is ready for the authorized local commit. No push, merge, rebase or PR has been performed.

Production Mutation Allowed:
NO

Current Blocker:
- Final production appointment CRUD/refresh/restart smoke would create and delete a temporary production appointment. That write requires explicit production approval.
- Local/disposable evidence cannot substitute for the required production persistence evidence.

Next Action:
After explicit approval, use only the existing developer/test account and an existing active linked test client. Run the minimum production appointment create → refresh/restart → update → refresh/restart → delete flow, verify foreign/ownership behavior without touching customer rows, clean only the temporary appointment and confirm residue 0. Then record either `MVP-4 — COMPLETE` or the exact critical blocker. Do not start MVP-5 before this gate closes.

Human Approval Required:
YES — only for the minimum temporary production appointment smoke and cleanup. No migration, policy, Storage, Auth-account, secret, worker, Vault, cron or bucket change is authorized or required.
