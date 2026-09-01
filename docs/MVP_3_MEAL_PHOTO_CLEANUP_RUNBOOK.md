# MVP-3 Meal Photo Cleanup Activation Runbook

## Repository checkpoint

The forward-only migration `20260810055845_mvp3_meal_photo_lifecycle_closure.sql` creates the durable queue and service-role-only claim/complete RPC contract. The `cleanup-meal-photos` Edge Function removes exact `meal-photos` object paths and completes a queue row only after PostgreSQL confirms that neither an object nor a meal reference remains.

The same `cleanup-meal-photos` Edge Function also processes the `meal-completion-photos` queue from `20260831190352_meal_completion_photo_contract.sql` during the same scheduled invocation. It validates and deletes only canonical `<client-uuid>/<meal-uuid>/<uuid>.jpg` paths, then calls the completion-photo queue's service-role complete RPC. No second Edge Function, cron job, scheduler secret, or Vault entry is needed.

The migration does not deploy the Edge Function, set project secrets, create Vault entries, or schedule a cron job.

## Separately gated production actions

Each action below requires a fresh `HUMAN APPROVAL REQUIRED` gate:

1. Apply the exact migration after production read-only preflight and backup/restore evidence.
2. Set a dedicated high-entropy `MEAL_PHOTO_CLEANUP_SCHEDULER_SECRET` Edge Function secret. Never expose the service-role key to the browser.
3. Deploy `cleanup-meal-photos` with gateway JWT verification disabled; the function fails closed on its constant-time custom scheduler-secret check.
4. Create Vault values for the function URL and dedicated scheduler secret, then create one `pg_cron`/`pg_net` POST job using the same architecture as `cleanup-chat-images`.
5. Invoke once with the scheduler secret and verify `claimed/completed/failed`, function logs, queue retry state, and no deletion of referenced objects.

Do not add the scheduler to the migration until the exact production Vault/cron names and absence of conflicting state have passed read-only preflight. Do not reuse the chat cleanup secret.

## Release smoke

- Approved active-linked dietitian uploads JPEG/PNG/WebP up to 5 MiB.
- Linked client and the owning approved dietitian can open only a referenced private photo.
- Foreign, pending, rejected, missing-profile, and anonymous actors are denied.
- Replacing/deleting a meal queues only canonical `meal-plans/...` paths; `recipes/...` remains untouched.
- A failed plan save queues the uploaded orphan idempotently and shows a cleanup warning independently from the plan-save result.
- Worker retry leaves failed rows incomplete; completion is denied while an object or meal reference remains.
- Real Android 8+ device verifies private photo read, foreground/background, refresh-token, retry, and plan reload. This device smoke cannot be replaced by a desktop emulator.
