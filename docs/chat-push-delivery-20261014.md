# Chat push delivery — 2026-10-14

Chat notifications previously waited 60 seconds before eligibility, then a minute-based cron and dispatch budget added up to another minute or more. The queue now coalesces for 3 seconds, polls every 10 seconds and serializes claims for 5 seconds. This reduces server scheduling delay; it does not guarantee a device arrival deadline. Android power settings, connectivity and provider delivery remain relevant.

The dispatcher sends chat pushes with high priority. Installations reporting app version 1.0.4 or later receive the new `dietbridge-chat-v1` channel with default sound. Older/unknown versions retain their installed channel. Appointment and relationship channel behavior is preserved. Payloads contain generic text and notification/conversation IDs, never the message body or health details.

Mobile PR 38 adds immediate foreground presentation, suppresses the banner/sound while the matching conversation is visible, exchanges native token rotation through Expo, retries transient registration failures with a bounded backoff and reports native app/build versions through expo-application. Notification permission is not prompted by the automatic retry.

## Production history and rollout

- The three 20261012 worker migrations were recovered verbatim from the applied database history. They are source reconciliation only and must not be applied again to the current project. In a new environment the scheduler transport prerequisite runs while dispatch is disabled.
- `20261014080429_chat_push_delivery_latency.sql` is the forward migration applied on 2026-10-14. The filename matches the hosted migration version.
- Deploy the version-aware worker before the forward migration; it also accepts the old claim shape.
- The cron keeps the owner-only synchronous HTTP transport and custom dispatch secret. Idle runs return before reading Vault or calling HTTP. Due receipts and expired claims still trigger processing.
- The queue remains private. Anonymous/authenticated users cannot claim it, and service_role cannot invoke the Vault-bearing transport. Eligibility, active relationship, ownership, health consent, read state, supersession and ambiguous-send duplicate protection are preserved.
- No synthetic production messages, users, installation tokens or Storage uploads were created for verification.

## Verification

`node --test tests/pushDispatchHandler.test.mjs` verifies six transport/auth/payload/retry cases using injected dependencies. `node scripts/runPushDeliveryPostgresVerification.mjs <isolated-pglite-package-dir>` executes the actual registry, worker, relationship guard and forward SQL against real in-memory PostgreSQL, including repeated migration, idle scheduling, permissions, queue timing, duplicate claims, consent withdrawal and source invalidation. The CI PostgreSQL job installs its verifier separately from application dependencies.

Web typecheck, lint, contract tests and production build passed locally. Deno checked the edge entrypoint. Mobile quality passed: 576 tests, typecheck, lint and Android/iOS exports. Existing lint/bundle warnings remain unrelated. Physical-device foreground/background/locked-screen checks are required after installing Android 1.0.4 (6); provider acceptance alone does not prove device display.

## Rollback

Use a new, reviewed forward migration to restore the 60-second capture delay, minute dispatch budget and `* * * * *` named cron schedule if operational monitoring warrants rollback. Restore the previous worker version 2 from the saved deployment source if necessary. Preserve the ledger and grants; do not replay historical migrations or resend ambiguous deliveries. The added Android channel is versioned because existing channel importance cannot be modified after creation. No consent or application data is rewritten by this release.
