# WP5.3C0 Canonical Meal Macros Contract

`public.meals.macros` stores only this canonical JSON object:

```json
{"protein": 0, "carbs": 0, "fat": 0}
```

All three keys are required. Values must be finite, non-negative JSON numbers, and no other keys are allowed. UI labels and transient state, including `_rowName`, are never persisted in `macros`.

Mobile mapping:

- DB key: `protein`
- DB key: `carbs`
- DB key: `fat`
- Mobile field mapping: `carbs` to `carbohydrate`

## Staging E2E record (2026-07-19)

- The canonical migration is applied to DietBridge Staging; linked migration dry-run reports no pending migration.
- An authenticated, approved dietitian saved and read a seven-day plan through the active `MealPlans` normalizer and `mealPlanService` RPC path. The returned meals retained the same canonical macro values, IDs, `is_eaten`, time, sort order, photo path, and manual-only source fields.
- The web normalizer rejected all tested missing, extra-key, string, null, boolean, negative, array, nested-object, `NaN`, and infinite-value cases. The RPC rejected an extra `_rowName` key and left the pre-existing week unchanged.
- Fixture RLS checks passed for the active dietitian/client relationship and rejected client writes, other-dietitian writes, pending/removed/unverified relationships, other-client reads, and direct browser table mutations.
- The staging fixture and its Auth, profile, relationship, plan, meal, and Storage scope were cleaned to zero records. No Storage object was created.
- Browser/CDP runtime acceptance was not run in this task; it remains a WP5.4 acceptance item. Static inspection confirms `_rowName` remains UI-only and previous-week copying preserves canonical macros.
