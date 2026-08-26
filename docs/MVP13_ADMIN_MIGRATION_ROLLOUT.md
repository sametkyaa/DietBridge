# MVP-13 Product Admin Migration Rollout

This repository contains the additive Product Admin / dietitian verification migration:

`supabase/migrations/20260826133224_product_admin_dietitian_verification.sql`

The migration is independent of the deferred Push Registry migration. The Push migration remains in canonical order and is not edited, reordered, deleted, repaired, or applied by this Track B implementation.

## Release artifact

The controlled Production-shaped release artifact must contain the exact remote migration history through the current Production tail, followed by the Product Admin migration. If Production still ends before the deferred Push migration, materialize a disposable/release directory from the exact remote history and add only the Admin migration. Do not edit the canonical repository migration files to make the histories appear contiguous.

Before any remote apply, verify:

- the release directory contains the exact remote Production migration hashes plus `20260826133224_product_admin_dietitian_verification.sql`;
- the deferred Push migration is absent from that release artifact;
- a linked dry run reports exactly one pending Product Admin migration;
- the Production `dietitian-diplomas` bucket still matches private PDF, 10 MiB, and `application/pdf` requirements;
- the postflight checks for RLS, function grants, audit append-only behavior, and the Admin-only Storage SELECT policy are available for review.

The remote apply command, if separately approved, must be executed by the release operator with the repository-pinned Supabase CLI and the normal linked-project safeguards. This implementation does not run that command.

## Post-apply checks

Run read-only schema checks for `platform_admins`, `dietitian_verification_audit`, the Admin RPC signatures and grants, the private diploma policy, and the existing product verification invariant. Then perform the first Admin bootstrap through the separately approved operational process. No Admin email, UUID, seed row, or Auth account is hardcoded in this repository.

Production data, Auth users, Storage objects, RLS policies, and migrations were not mutated by this implementation.
