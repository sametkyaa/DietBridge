# MVP-13 Product Admin Migration Rollout

This document defines the controlled, Admin-only Production rollout for:

`supabase/migrations/20260826133224_product_admin_dietitian_verification.sql`

The migration is additive and independent of the intentionally deferred Push
Registry migration:

`20260817120000_push_registry_outbox_backend.sql`

The deferred Push migration remains unapplied. Push 6C.2+ remains `PAUSED`.
This document is a release procedure and does not authorize Production writes,
Auth mutation, Admin bootstrap, or Push rollout by itself.

## Current migration state

The known rollout state is:

- Supabase Production project: `dietbridge_Production`
- Supabase Production ref: `kagvxhyvxxypspdxcuxz`
- Production migration history before Admin: `47`
- Canonical repository history before Product Admin: `48`
- Deferred Push migration: intentionally absent from Production
- Product Admin migration: pending

The canonical repository therefore contains a migration after a deliberately
skipped migration. While that condition remains, broad canonical Production
`supabase db push` is forbidden. The Product Admin migration may only be
applied from the isolated release materialization proven by the dry-run below.

## Gate A — Production identity

Before any Production migration operation, including a linked status check,
dry-run, apply, or postflight command that could select a project, the release
operator must verify all of the following against the linked Supabase project:

- expected project name: `dietbridge_Production`
- expected project ref: `kagvxhyvxxypspdxcuxz`
- expected environment: `Production`

If any identity value differs, stop immediately with:

`ADMIN MIGRATION BLOCKED — PRODUCTION IDENTITY MISMATCH`

No migration command may run after an identity mismatch. Do not infer the
project from a local link, shell context, or a previous operator session.

## Gate B — fresh read-only Production preflight

Immediately before migration approval, perform a fresh read-only Production
preflight. Historical evidence from an earlier review is not sufficient. The
preflight must not create, update, delete, repair, seed, or otherwise mutate
Production data, Auth, Storage, schema, or migration history. It is a targeted
launch preflight, not a broad security scan.

Record evidence for each check below.

### Migration history

Verify the expected pre-Admin state:

- Production history count is exactly `47`.
- `20260817120000_push_registry_outbox_backend.sql` is absent.
- `20260826133224_product_admin_dietitian_verification.sql` is absent.
- No unexpected migration is present.

Do not rely solely on historical evidence. If the history differs, stop and
resolve the discrepancy before any migration operation.

### Existing Product Admin objects

Before the first rollout, the following objects and their equivalents must be
absent:

- `platform_admins`
- the dietitian verification audit table
- the Admin authorization helper
- the Admin approve/reject/read RPCs
- the Admin-only diploma Storage policy

If any partial or unexpected Product Admin object exists, stop. Do not repair,
drop, reorder, or mark migration history applied automatically.

### Existing security baseline

Verify the launch-critical baseline remains healthy, including:

- expected RLS coverage and critical policy/invariant health;
- Production project health;
- the `dietitian-diplomas` bucket remains private; and
- the existing product role and verification contracts remain intact.

Do not perform broad security scanning as part of this rollout procedure.

### Backup evidence

Verify that the currently approved launch backup evidence still exists and is
identified in the release record. If operational policy requires a newer backup
because Production changed after that backup, stop and request a new approved
backup before migration. Do not automatically create or overwrite a Production
backup in this procedure.

## Isolated release migration materialization

Create a disposable or temporary release migration directory outside the
canonical migration directory. If the repository already provides a canonical
migration materializer or historical-alias reconciliation mechanism, reuse that
established mechanism; do not invent a second interpretation of migration
history.

The isolated release directory must represent exactly:

1. the migration history verified to already exist in Production; plus
2. `20260826133224_product_admin_dietitian_verification.sql` as the only new
   pending migration.

It must not include the deferred Push migration as pending or applicable:

`20260817120000_push_registry_outbox_backend.sql`

Do not alter the canonical repository migration set to make the histories
appear contiguous. In particular, do not rename, move, backdate, edit, or
delete the Push migration; do not mark Push applied; and do not use migration
repair to fake Push application. Historical migration aliases may be handled
only through the repository's established reconciliation/materialization
contract.

## Mandatory linked dry-run

Before any future Production apply, run the equivalent linked Production
dry-run using the pinned repository Supabase CLI and the isolated release
migration directory. The dry-run is read-only and must prove the exact release
materialization.

The result must show exactly one pending migration, and it must be:

`20260826133224_product_admin_dietitian_verification.sql`

The result must not list:

- `20260817120000_push_registry_outbox_backend.sql`;
- any historical migration;
- any unrelated migration; or
- more than one migration.

If the result is anything other than exactly that one Product Admin migration,
stop with:

`ADMIN MIGRATION BLOCKED — RELEASE MATERIALIZATION NOT EXACT`

Do not repair history automatically and do not proceed to a Production
mutation.

## Explicit human approval

Even after the identity gate, fresh preflight, and exact dry-run succeed, stop
and request explicit human approval before applying anything to Production.
The approval must specifically authorize:

`20260826133224_product_admin_dietitian_verification.sql`

Product Admin approval does not authorize the Push migration, migration repair,
history fabrication, Auth mutation, initial Admin entitlement bootstrap, or any
unrelated schema change. Initial `platform_admins` bootstrap requires a
separate later human approval.

## Production apply boundary

Only the isolated release migration materialization proven by the exact
dry-run may be used. The rule is explicit: broad canonical Production `supabase db push` is forbidden while the deferred Push migration remains pending.

The approved application must:

- apply only `20260826133224_product_admin_dietitian_verification.sql`;
- stop on the first error; and
- never silently apply a second migration.

No operator may substitute the canonical migration directory, apply Push,
repair migration history, or broaden the approval during the apply.

## Mandatory read-only postflight

Immediately after a future Product Admin application, perform a fresh read-only
postflight and record the evidence. Do not use postflight as permission to
bootstrap an Admin or make another schema change.

### Product Admin objects

Verify that the expected Product Admin objects now exist:

- entitlement table;
- verification audit table;
- Admin authorization helper;
- Admin RPCs;
- expected RLS and grants; and
- the Admin-only Storage `SELECT` policy.

### Existing contracts

Verify that:

- the product role enum is unchanged;
- the `client`/`dietitian` role contract is unchanged;
- existing product RLS is unchanged except for the intended additive Admin
  objects and policy; and
- the diploma bucket remains private.

### Push isolation

Confirm that the deferred Push migration remains absent and that Push-specific
objects previously absent remain absent. Product Admin rollout must not change
Push 6C.2+ status. The expected state is:

`Push 6C.2+ = PAUSED`

### Migration history

Verify that the Product Admin migration is recorded exactly once, with no
unexpected migration drift. Do not require Production migration history to
equal the full canonical repository history while Push is intentionally
deferred. The release record must classify the state explicitly:

- Push migration: intentionally deferred and absent;
- Product Admin migration: applied exactly once; and
- no unexpected migration drift.

### Health

Verify that Production remains healthy, critical invariants remain valid, and
no unintended Storage or public exposure occurred.

## Rollback boundary

If the Product Admin migration fails before commit or application completes:

- stop;
- collect the command output and migration-history evidence; and
- do not retry blindly.

If the migration applies successfully but a frontend defect is later found,
prefer a frontend rollback. Do not automatically roll back the database schema.
Database restore is reserved for actual Production data or schema corruption
where forward repair is unsafe. This procedure contains no automatic
destructive down migration.

## Admin bootstrap separation

Applying the Product Admin migration does not create the first
`platform_admins` entitlement. After migration postflight passes, the first
Admin bootstrap requires a separate controlled operation with:

- exact Auth user UUID verification;
- approved internal-account verification;
- separate explicit human approval;
- an exact entitlement `INSERT` through a privileged controlled operation;
- a post-bootstrap access check; and
- a documented revocation procedure.

There must be no email hardcoding, browser bootstrap, or service-role key in
frontend code. No entitlement is created by this migration rollout document.

## Production Admin smoke separation

Approve/reject transitions were already proven in disposable runtime. After
bootstrap, initial Production smoke is limited to:

- Admin authentication;
- `/admin` access;
- Admin deep-link and refresh;
- summary;
- list;
- detail;
- a short-lived private diploma signed URL; and
- ordinary non-Admin access denial.

Do not automatically create a synthetic Production applicant to repeat
approve/reject tests. Any decision on a real applicant is a real operational
action and is not synthetic smoke.

## Procedure safety invariants

This procedure does not run `supabase db push`, apply a migration, repair
history, create an Admin entitlement, mutate Auth, upload or change Storage,
or change Push status. It does not authorize a Production operation without
the identity gate, fresh read-only preflight, exact one-migration dry-run, and
explicit human approval.
