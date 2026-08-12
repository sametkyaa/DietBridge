# MVP-9 Mock / Local Cleanup Audit

Audit scope: active Web entry chain (`index.tsx` → `App.tsx` → protected routes),
plus read-only inspection of the canonical Mobile repository
(`C:\Users\drsam\Desktop\kisisel-icerik-uygulamasi`). Tests, disposable harnesses,
historical migrations, and prompt-history files were not treated as production
runtime.

## Findings

| Area | Finding | Class | Decision |
| --- | --- | --- | --- |
| Web auth | Supabase Auth session persistence and refresh lifecycle | B | Keep; canonical Auth state, not an application-record fallback. |
| Web meal-plan client selection | `localStorage` key is scoped to the authenticated dietitian and stores only the last selected client UI preference | B | Keep; backend remains authoritative and invalid/stale IDs are discarded. |
| Web signed image URLs | Short-lived in-memory URL caches for private Storage objects | B | Keep; caches hold presentation URLs only and never authorize or persist records. |
| Web `/notes` | `pages/Notes.tsx` used seeded clients and in-memory notes with `Date.now()` IDs; no backend persistence | D | Remove route/navigation exposure. Leave the legacy file untouched for conservative cleanup. |
| Web `/recipes/:id` | Detail route read the legacy hardcoded `RECIPES` catalogue instead of Supabase | D | Replace with an authenticated backend-backed detail read. |
| Web Settings | Security/notification/integration controls contained local-only toggles and fake connected states | D/E | Keep only profile navigation and the authoritative subscription panel; remove fake controls. |
| Web mock flag | `VITE_ENABLE_MOCK_DATA` was read nowhere in the active chain | C | Remove the obsolete flag from active environment typing/docs. |
| Web legacy tree | Root `constants.ts`, `context/`, `components/`, `services/`, and `src/` contain old mock code but are excluded from the active route/import chain | C | Do not delete in MVP-9; document for a separate repository-cleanup task. |
| Web avatar fallback | Generic avatar is used only when a profile has no renderable photo | B | Keep as a visual placeholder; it is not a client/profile truth substitute. |
| Mobile | Canonical repo is the separate “Odaklan” product. Its contracts cover profiles, focuses, content, daily packages and progress; it has no DietBridge client/meal-plan/measurement/chat/appointment/subscription contract | E | Do not invent cross-product features or edit the user-dirty Mobile worktree. Verify/document the boundary in MVP-10. |
| Test/disposable code | Fixtures, fake Supabase clients, demo seeds and disposable actors are isolated under tests/scripts/local-only paths | A | Keep; they are required verification infrastructure and are not production-reachable. |

## Production mutation audit

The audited Web mutation paths use canonical Supabase responses and expose an
error/retry state when a mutation or refresh fails. No local insertion path was
found for clients, meal plans/meals, appointments, daily tasks, measurements,
chat messages/images, analytics, or subscriptions. The meal-plan
`localStorage` value is only a scoped selection preference; it is never used as
an authorization or persistence decision.

## Planned MVP-9 changes

1. Remove the production-reachable Notes mock route and navigation item.
2. Make recipe details read the authenticated dietitian's canonical recipe row.
3. Remove Settings fake controls and retain the real subscription overview.
4. Remove the unused mock-data environment switch.
5. Add behavioral/source-contract coverage for the cleanup and re-run the full
   Web gate before the MVP-9 checkpoint.

No production database, Auth, Storage, RLS, migration, or application data is
changed by this audit or the planned local cleanup.
