'use strict';
/**
 * Meal plan read/write contract tests (run via scripts/runMealPlanContractTests.mjs).
 *
 * Covers:
 *  1. Canonical Storage path read: PASS
 *  2. Canonical Storage path write: PASS
 *  3. Legacy https://images.unsplash.com/... read: PASS
 *  4. Legacy Unsplash URL never enters the write payload
 *  5. http://images.unsplash.com/... is rejected
 *  6. Other HTTPS hosts are rejected
 *  7. Invalid URL / non-string values are rejected
 *  8. Deleted recipe snapshots keep source='recipe' with recipe_id=null
 *  9. Recipe snapshots retain their source, recipe id, description and image path
 * 10. Date selection maps to the correct Monday week start
 * 11. Previous-week copy preserves durable meal image and recipe references
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) {
  throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test`.');
}

const photoService = require(path.join(buildDir, 'features/meal-plans/services/mealPhotoService.js'));
const planService = require(path.join(buildDir, 'features/meal-plans/services/mealPlanService.js'));
const readModel = require(path.join(buildDir, 'features/meal-plans/services/mealPlanReadModel.js'));
const authLifecycle = require(path.join(buildDir, 'features/auth/services/authLifecycle.js'));
const recipeService = require(path.join(buildDir, 'features/recipes/services/recipeService.js'));
const filterRecipes = require(path.join(buildDir, 'features/recipes/utils/filterRecipes.js'));
const supabaseStub = require(path.join(buildDir, 'lib/supabaseClient.js'));

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DIETITIAN_ID = '22222222-2222-4222-8222-222222222222';
const PHOTO_FILE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MEAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RECIPE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PLAN_IDS = [1, 2, 3, 4, 5, 6, 7].map((n) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`);

const WEEK_START = '2026-07-20';
const WEEK_END = '2026-07-26';
const WEEK_DATES = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];

const CANONICAL_PHOTO_PATH = `meal-plans/${CLIENT_ID}/${DIETITIAN_ID}/${PHOTO_FILE_ID}.jpg`;
const LEGACY_PHOTO_URL = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400';
const RECIPE_IMAGE_PATH = `recipes/${DIETITIAN_ID}/${RECIPE_ID}/${PHOTO_FILE_ID}.webp`;
const SNAPSHOT_MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260723182501_persist_recipe_meal_snapshots.sql'), 'utf8');
const RECIPE_MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260723164416_create_dietitian_recipes.sql'), 'utf8');
const PLANNED_RECIPE_IMAGE_ACCESS_MIGRATION = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260724100000_allow_clients_read_planned_recipe_images.sql'),
  'utf8',
);
const MEAL_PLANS_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'pages', 'MealPlans.tsx'), 'utf8');

const buildSaveDays = (mealOverrides = {}) => WEEK_DATES.map((date, index) => ({
  plan_date: date,
  notes: null,
  meals: index === 0 ? [{
    type: 'breakfast',
    title: 'Yumurta',
    calories: 200,
    description: null,
    macros: { protein: 10, carbs: 5, fat: 8 },
    photo_url: CANONICAL_PHOTO_PATH,
    sort_order: 0,
    time: '08:00',
    source: 'manual',
    recipe_id: null,
    ...mealOverrides,
  }] : [],
}));

const buildRpcWeek = (mealOverrides = {}) => ({
  client_id: CLIENT_ID,
  dietitian_id: DIETITIAN_ID,
  week_start: WEEK_START,
  week_end: WEEK_END,
  plans: WEEK_DATES.map((date, index) => ({
    id: PLAN_IDS[index],
    plan_date: date,
    notes: null,
    meals: index === 0 ? [{
      id: MEAL_ID,
      plan_id: PLAN_IDS[0],
      type: 'breakfast',
      title: 'Yumurta',
      calories: 200,
      description: null,
      macros: { protein: 10, carbs: 5, fat: 8 },
      photo_url: CANONICAL_PHOTO_PATH,
      is_eaten: false,
      sort_order: 0,
      time: '08:00',
      source: 'manual',
      recipe_id: null,
      ...mealOverrides,
    }] : [],
  })),
});

const buildFetchRows = (mealOverrides = {}) => [{
  id: PLAN_IDS[0],
  plan_date: WEEK_START,
  notes: null,
  meals: [{
    id: MEAL_ID,
    type: 'breakfast',
    title: 'Yumurta',
    calories: 200,
    description: null,
    macros: { protein: 10, carbs: 5, fat: 8 },
    photo_url: LEGACY_PHOTO_URL,
    is_eaten: false,
    sort_order: 0,
    time: '08:00:00',
    source: 'recipe',
    recipe_id: null,
    ...mealOverrides,
  }],
}];

const stubRpcResponse = (response) => {
  const captured = { calls: [] };
  supabaseStub.__setRpcHandler(async (name, args) => {
    captured.calls.push({ name, args });
    return { data: response, error: null };
  });
  return captured;
};

const stubFetchRows = (rows) => {
  supabaseStub.__setFromHandler(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: async () => ({ data: rows, error: null }),
    };
    return chain;
  });
};

supabaseStub.__setUserId(DIETITIAN_ID);

test('11: previous-week copy preserves durable image and recipe fields while resetting identity and eaten state', () => {
  const copyBlock = MEAL_PLANS_SOURCE.match(/const createPreviousWeekCopy[\s\S]*?return \{ meals, weeklyPlan, planNotes, isEmpty:/);
  assert.ok(copyBlock, 'createPreviousWeekCopy implementation is present');
  assert.match(copyBlock[0], /image:\s*meal\.photo_url/);
  assert.match(copyBlock[0], /source:\s*meal\.source/);
  assert.match(copyBlock[0], /recipeId:\s*meal\.recipe_id/);
  assert.match(copyBlock[0], /mealId:\s*undefined/);
  assert.match(copyBlock[0], /isEaten:\s*false/);
  assert.doesNotMatch(copyBlock[0], /image:\s*null/);
});

test('1+2: canonical Storage path is accepted for write payload and read response', async () => {
  const captured = stubRpcResponse(buildRpcWeek());
  const result = await planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays());

  assert.equal(captured.calls.length, 1);
  assert.equal(captured.calls[0].name, 'save_weekly_meal_plan');
  const savedMeal = captured.calls[0].args.p_days[0].meals[0];
  assert.equal(savedMeal.photo_url, CANONICAL_PHOTO_PATH);
  assert.equal(savedMeal.source, 'manual');
  assert.equal(savedMeal.recipe_id, null);

  const readMeal = result.plans[0].meals[0];
  assert.equal(readMeal.photo_url, CANONICAL_PHOTO_PATH);
  assert.equal(readMeal.source, 'manual');
  assert.equal(readMeal.recipe_id, null);
});

test('3: legacy Unsplash URL is accepted by the RPC response normalizer', async () => {
  stubRpcResponse(buildRpcWeek({ photo_url: LEGACY_PHOTO_URL }));
  const result = await planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ photo_url: null }));
  assert.equal(result.plans[0].meals[0].photo_url, LEGACY_PHOTO_URL);
});

test('3+8: recipe snapshot with a cleared FK remains readable on fetch', async () => {
  stubFetchRows(buildFetchRows());
  const rows = await planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END);
  const meal = rows[0].meals[0];
  assert.equal(meal.photo_url, LEGACY_PHOTO_URL);
  assert.equal(meal.source, 'recipe');
  assert.equal(meal.recipe_id, null);
  assert.equal(meal.time, '08:00');
});

test('8: recipe snapshot with a cleared FK remains recipe-sourced in the RPC response', async () => {
  stubRpcResponse(buildRpcWeek({ source: 'recipe', recipe_id: null }));
  const result = await planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ photo_url: null }));
  const meal = result.plans[0].meals[0];
  assert.equal(meal.source, 'recipe');
  assert.equal(meal.recipe_id, null);
});

test('4: legacy Unsplash URL is rejected from the write payload', async () => {
  stubRpcResponse(buildRpcWeek());
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ photo_url: LEGACY_PHOTO_URL })),
    (error) => error && error.code === 'INVALID_MEAL_PHOTO_PATH' && error.field === 'days[0].meals[0].photo_url',
  );
});

test('9: recipe snapshot write and read retain authoritative reference fields', async () => {
  stubRpcResponse(buildRpcWeek({
    source: 'recipe',
    recipe_id: RECIPE_ID,
    title: 'Tarif başlığı',
    description: 'Tarif açıklaması',
    calories: 320,
    macros: { protein: 18, carbs: 12, fat: 20 },
    photo_url: RECIPE_IMAGE_PATH,
  }));
  const result = await planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({
    source: 'recipe', recipe_id: RECIPE_ID, photo_url: RECIPE_IMAGE_PATH, description: 'Tarayıcı değeri',
  }));
  const savedMeal = result.plans[0].meals[0];
  assert.equal(savedMeal.source, 'recipe');
  assert.equal(savedMeal.recipe_id, RECIPE_ID);
  assert.equal(savedMeal.description, 'Tarif açıklaması');
  assert.equal(savedMeal.photo_url, RECIPE_IMAGE_PATH);

  stubFetchRows(buildFetchRows({ source: 'recipe', recipe_id: RECIPE_ID, photo_url: RECIPE_IMAGE_PATH, description: 'Tarif açıklaması' }));
  const fetchedMeal = (await planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END))[0].meals[0];
  assert.equal(fetchedMeal.source, 'recipe');
  assert.equal(fetchedMeal.recipe_id, RECIPE_ID);
  assert.equal(fetchedMeal.description, 'Tarif açıklaması');

  stubRpcResponse(buildRpcWeek());
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ recipe_id: RECIPE_ID, photo_url: null })),
    (error) => error && error.code === 'INVALID_RECIPE_ID',
  );
});

test('5: http://images.unsplash.com is rejected on read', async () => {
  assert.equal(photoService.isLegacyMealPhotoUrl('http://images.unsplash.com/photo-1'), false);
  stubFetchRows(buildFetchRows({ photo_url: 'http://images.unsplash.com/photo-1' }));
  await assert.rejects(
    planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END),
    (error) => error && error.code === 'INVALID_MEAL_PHOTO_PATH',
  );
});

test('6: non-allowlisted HTTPS hosts are rejected on read', async () => {
  const hosts = [
    'https://cdn.unsplash.com/photo-1',
    'https://images.unsplash.com.evil.com/photo-1',
    'https://example.com/photo-1',
  ];
  for (const url of hosts) {
    assert.equal(photoService.isLegacyMealPhotoUrl(url), false, url);
  }
  stubFetchRows(buildFetchRows({ photo_url: 'https://example.com/photo-1' }));
  await assert.rejects(
    planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END),
    (error) => error && error.code === 'INVALID_MEAL_PHOTO_PATH',
  );
});

test('7: invalid URLs, credentials and non-string values are rejected', async () => {
  const invalid = [
    'not a url',
    'https://user:pass@images.unsplash.com/photo-1',
    'https://user@images.unsplash.com/photo-1',
    '//images.unsplash.com/photo-1',
    42,
    null,
    undefined,
    {},
    ['https://images.unsplash.com/photo-1'],
  ];
  for (const value of invalid) {
    assert.equal(photoService.isLegacyMealPhotoUrl(value), false, String(value));
  }
});

test('read reference accepts canonical path, legacy URL and rejects the rest', async () => {
  assert.equal(photoService.isCanonicalMealPhotoPath(CANONICAL_PHOTO_PATH), true);
  assert.equal(photoService.isReadableMealPhotoReference(CANONICAL_PHOTO_PATH), true);
  assert.equal(photoService.isReadableMealPhotoReference(LEGACY_PHOTO_URL), true);
  assert.equal(photoService.isReadableMealPhotoReference('https://images.unsplash.com:443/photo-1'), true);
  assert.equal(photoService.isReadableMealPhotoReference('http://images.unsplash.com/photo-1'), false);
  assert.equal(photoService.isReadableMealPhotoReference('meal-plans/not-a-uuid/x/y.jpg'), false);
});

test('read rejects invalid recipe source combinations (fail-closed)', async () => {
  stubFetchRows(buildFetchRows({ source: 'manual', recipe_id: RECIPE_ID }));
  await assert.rejects(
    planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END),
    (error) => error && error.code === 'INVALID_RPC_RESPONSE',
  );
  stubRpcResponse(buildRpcWeek({ source: 'recipe', recipe_id: 'not-a-uuid' }));
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ photo_url: null })),
    (error) => error && error.code === 'INVALID_RPC_RESPONSE',
  );
});

test('macro contracts: canonical macros stay valid for read and write', async () => {
  const macros = { protein: 6, carbs: 32, fat: 4 };
  assert.deepEqual(planService.normalizeCanonicalMealMacros(macros), macros);
  assert.deepEqual(planService.normalizeReadableMealMacros(macros), macros);

  const captured = stubRpcResponse(buildRpcWeek());
  await planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ macros }));
  assert.deepEqual(captured.calls[0].args.p_days[0].meals[0].macros, macros);
});

test('macro contracts: legacy placement metadata is accepted only on fetch and removed', async () => {
  const legacyMacros = {
    protein: 6,
    carbs: 32,
    fat: 4,
    _time: '08:00',
    _rowName: 'Kahvaltı',
    _sortOrder: 0,
  };
  stubFetchRows(buildFetchRows({ macros: legacyMacros }));
  const rows = await planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END);
  assert.deepEqual(rows[0].meals[0].macros, { protein: 6, carbs: 32, fat: 4 });
  assert.deepEqual(
    Object.keys(rows[0].meals[0].macros).sort(),
    ['carbs', 'fat', 'protein'],
  );

  stubRpcResponse(buildRpcWeek());
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ macros: legacyMacros })),
    (error) => error && error.code === 'INVALID_MEAL_MACROS',
  );

  stubRpcResponse(buildRpcWeek({ macros: legacyMacros }));
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays()),
    (error) => error && error.code === 'INVALID_RPC_RESPONSE',
  );
});

test('macro contracts: unknown keys and invalid legacy metadata are rejected on read', () => {
  const invalidMacros = [
    { protein: 6, carbs: 32, fat: 4, unexpected: true },
    { protein: 6, carbs: 32, fat: 4, _sortOrder: '0' },
    { protein: 6, carbs: 32, fat: 4, _sortOrder: -1 },
    { protein: 6, carbs: 32, fat: 4, _sortOrder: 0.5 },
    { protein: 6, carbs: 32, fat: 4, _time: 800 },
    { protein: 6, carbs: 32, fat: 4, _rowName: {} },
    { protein: 6, carbs: 32 },
    { protein: -1, carbs: 32, fat: 4 },
    { protein: Number.NaN, carbs: 32, fat: 4 },
    { protein: 6, carbs: Number.POSITIVE_INFINITY, fat: 4 },
  ];
  for (const macros of invalidMacros) {
    assert.throws(
      () => planService.normalizeReadableMealMacros(macros),
      (error) => error && error.code === 'INVALID_MEAL_MACROS',
      JSON.stringify(macros),
    );
  }
});

test('10: picked dates map to the Monday of their week', async () => {
  assert.equal(readModel.normalizeMealPlanWeekStart('2026-07-20'), '2026-07-20');
  assert.equal(readModel.normalizeMealPlanWeekStart('2026-07-23'), '2026-07-20');
  assert.equal(readModel.normalizeMealPlanWeekStart('2026-07-26'), '2026-07-20');
  assert.equal(readModel.normalizeMealPlanWeekStart('2026-07-19'), '2026-07-13');
  assert.deepEqual(readModel.getMealPlanWeekDates('2026-07-23'), WEEK_DATES);
  assert.equal(readModel.shiftMealPlanWeek('2026-07-20', 1), '2026-07-27');
  assert.equal(readModel.shiftMealPlanWeek('2026-07-20', -1), '2026-07-13');
});

test('recipe contracts: canonical input and image paths are accepted', () => {
  const input = recipeService.normalizeRecipeInput({
    name: '  Sebzeli Omlet  ',
    description: '  Pratik tarif  ',
    mealType: 'breakfast',
    calories: 320,
    macros: { protein: 18, carbs: 12, fat: 20 },
  });
  assert.deepEqual(input, {
    name: 'Sebzeli Omlet',
    description: 'Pratik tarif',
    mealType: 'breakfast',
    calories: 320,
    macros: { protein: 18, carbs: 12, fat: 20 },
  });
  assert.equal(recipeService.isCanonicalRecipeImagePath(`recipes/${DIETITIAN_ID}/${RECIPE_ID}/${PHOTO_FILE_ID}.webp`), true);
});

test('recipe contracts: invalid names, meal types, calories and macros fail closed', () => {
  const base = {
    name: 'Tarif',
    mealType: 'breakfast',
    calories: 100,
    macros: { protein: 1, carbs: 2, fat: 3 },
  };
  const invalidInputs = [
    { ...base, name: '   ' },
    { ...base, mealType: 'brunch' },
    { ...base, calories: -1 },
    { ...base, calories: Number.NaN },
    { ...base, calories: Number.POSITIVE_INFINITY },
    { ...base, macros: { protein: -1, carbs: 2, fat: 3 } },
    { ...base, macros: { protein: Number.NaN, carbs: 2, fat: 3 } },
    { ...base, macros: { protein: 1, carbs: 2, fat: 3, legacy: true } },
  ];
  for (const input of invalidInputs) {
    assert.throws(
      () => recipeService.normalizeRecipeInput(input),
      (error) => error && error.code && String(error.code).startsWith('INVALID_RECIPE_'),
    );
  }
  assert.equal(recipeService.isCanonicalRecipeImagePath(`recipes/${DIETITIAN_ID}/${RECIPE_ID}/not-a-uuid.jpg`), false);
  assert.equal(recipeService.isCanonicalRecipeImagePath(`recipes/${DIETITIAN_ID}/${RECIPE_ID}/${PHOTO_FILE_ID}.gif`), false);
});

test('recipe snapshot migration derives protected fields server-side and preserves snapshots after deletion', () => {
  assert.match(SNAPSHOT_MIGRATION, /where id = v_recipe_id/i);
  assert.match(SNAPSHOT_MIGRATION, /and dietitian_id = v_actor_id/i);
  assert.match(SNAPSHOT_MIGRATION, /v_recipe\.description/i);
  assert.match(SNAPSHOT_MIGRATION, /foreign key \(recipe_id\) references public\.recipes\(id\) on delete set null/i);
  assert.match(SNAPSHOT_MIGRATION, /meal\.recipe_id is null/i);
  assert.doesNotMatch(SNAPSHOT_MIGRATION, /private\.save_weekly_meal_plan_impl/i);
  assert.doesNotMatch(SNAPSHOT_MIGRATION, /public\.is_canonical_meal_macros/i);
  assert.doesNotMatch(SNAPSHOT_MIGRATION, /private\.enqueue_meal_photo_cleanup/i);
  assert.doesNotMatch(SNAPSHOT_MIGRATION, /private\.queue_replaced_meal_photo/i);
  assert.match(SNAPSHOT_MIGRATION, /v_meal_id is null/i);
  assert.match(SNAPSHOT_MIGRATION, /to authenticated/i);
  assert.match(SNAPSHOT_MIGRATION, /for key share of p, dp/i);
  assert.match(SNAPSHOT_MIGRATION, /pg_advisory_xact_lock/i);
  assert.match(SNAPSHOT_MIGRATION, /on conflict \(client_id, dietitian_id, plan_date\)/i);
  assert.match(SNAPSHOT_MIGRATION, /is_eaten/i);
  assert.match(SNAPSHOT_MIGRATION, /delete from public\.meals/i);
});

test('production migration provides an ON CONFLICT-compatible weekly-plan uniqueness contract', () => {
  const uniquenessBlock = SNAPSHOT_MIGRATION.match(/Weekly-plan uniqueness:[\s\S]*?\n\$\$;/);
  assert.ok(uniquenessBlock, 'weekly-plan uniqueness DO block is present');
  const sql = uniquenessBlock[0];

  assert.match(sql, /group by client_id, dietitian_id, plan_date/i);
  assert.match(sql, /having count\(\*\) > 1/i);
  assert.match(sql, /Duplicate daily meal plans prevent creation of the weekly-plan uniqueness contract/i);
  assert.match(sql, /i\.indisunique/i);
  assert.match(sql, /i\.indimmediate/i);
  assert.match(sql, /i\.indpred is null/i);
  assert.match(sql, /i\.indnkeyatts = 3/i);
  assert.match(sql, /array_agg\(a\.attname::text order by key_columns\.ordinality\)/i);
  assert.doesNotMatch(sql, /array_agg\(a\.attname order by key_columns\.ordinality\)/i);
  assert.match(sql, /array\['client_id', 'dietitian_id', 'plan_date'\]::text\[\]/i);
  assert.match(sql, /add constraint meal_plans_client_dietitian_plan_date_key\s+unique \(client_id, dietitian_id, plan_date\)/i);
  assert.doesNotMatch(sql, /delete from public\.meal_plans/i);
  assert.match(SNAPSHOT_MIGRATION, /on conflict \(client_id, dietitian_id, plan_date\)/i);
});

test('production migration enforces canonical manual calorie bounds and reloads the PostgREST schema', () => {
  const caloriesBlock = SNAPSHOT_MIGRATION.match(/-- calories[\s\S]*?-- macros:/);
  assert.ok(caloriesBlock, 'manual calorie validation block is present');
  const sql = caloriesBlock[0];

  assert.match(sql, /jsonb_typeof\(v_meal -> 'calories'\) = 'number'/i);
  assert.match(sql, /\^\[0-9\]\+\$/);
  assert.doesNotMatch(sql, /\^\-\?\[0-9\]\+\$/);
  assert.match(sql, /v_calories > 100000/i);
  assert.match(sql, /between 0 and 100000 or null/i);

  const acceptsManualCalories = (value) => value === null
    || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100000);
  [null, 0, 420, 100000].forEach((value) => assert.equal(acceptsManualCalories(value), true));
  [-1, 100001, 12.5, '420', 2147483648].forEach((value) => assert.equal(acceptsManualCalories(value), false));

  const notifyIndex = SNAPSHOT_MIGRATION.indexOf("notify pgrst, 'reload schema';");
  const commitIndex = SNAPSHOT_MIGRATION.lastIndexOf('commit;');
  assert.ok(notifyIndex >= 0, 'PostgREST schema reload notification is present');
  assert.ok(notifyIndex < commitIndex, 'schema reload notification occurs before commit');
});

test('planned recipe-image client policy is a narrow authenticated SELECT contract', () => {
  const sql = PLANNED_RECIPE_IMAGE_ACCESS_MIGRATION;

  assert.match(sql, /drop policy if exists recipe_images_select_planned_client on storage\.objects/i);
  assert.match(sql, /create policy recipe_images_select_planned_client\s+on storage\.objects\s+for select\s+to authenticated/i);
  assert.match(sql, /storage\.objects\.bucket_id = 'recipe-images'/i);
  assert.match(sql, /storage\.objects\.name ~ '\^recipes\//i);
  assert.match(sql, /from public\.meals as meal\s+join public\.meal_plans as plan\s+on plan\.id = meal\.plan_id/i);
  assert.match(sql, /meal\.photo_url = storage\.objects\.name/i);
  assert.match(sql, /meal\.source = 'recipe'/i);
  assert.match(sql, /plan\.client_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /split_part\(storage\.objects\.name, '\/', 2\) = plan\.dietitian_id::text/i);
  assert.doesNotMatch(sql, /meal\.recipe_id/i);
  assert.match(sql, /notify pgrst, 'reload schema';/i);
  assert.ok(sql.indexOf("notify pgrst, 'reload schema';") < sql.lastIndexOf('commit;'));
});

test('planned recipe-image policy preserves private, dietitian-only write access', () => {
  const sql = PLANNED_RECIPE_IMAGE_ACCESS_MIGRATION;

  assert.doesNotMatch(sql, /storage\.buckets/i);
  assert.doesNotMatch(sql, /for insert/i);
  assert.doesNotMatch(sql, /for update/i);
  assert.doesNotMatch(sql, /for delete/i);
  assert.doesNotMatch(sql, /to anon/i);
  assert.match(RECIPE_MIGRATION, /create policy recipe_images_select_own/i);
  assert.match(RECIPE_MIGRATION, /create policy recipe_images_insert_own/i);
  assert.match(RECIPE_MIGRATION, /create policy recipe_images_delete_own/i);
  assert.doesNotMatch(SNAPSHOT_MIGRATION, /recipe_images_select_planned_client/i);
});

test('auth lifecycle: same-user refresh events update the session without resolving access again', () => {
  assert.equal(
    authLifecycle.getAuthLifecycleAction('TOKEN_REFRESHED', DIETITIAN_ID, DIETITIAN_ID, true),
    'update_session_only',
  );
  assert.equal(
    authLifecycle.getAuthLifecycleAction('SIGNED_IN', DIETITIAN_ID, DIETITIAN_ID, true),
    'update_session_only',
  );
  assert.equal(
    authLifecycle.getAuthLifecycleAction('INITIAL_SESSION', DIETITIAN_ID, null, false),
    'ignore_initial_session',
  );
  assert.equal(
    authLifecycle.getAuthLifecycleAction('SIGNED_OUT', null, DIETITIAN_ID, true),
    'clear_access',
  );
  assert.equal(
    authLifecycle.getAuthLifecycleAction('SIGNED_IN', '33333333-3333-4333-8333-333333333333', DIETITIAN_ID, true),
    'resolve_access',
  );
  assert.equal(
    authLifecycle.getAuthLifecycleAction('TOKEN_REFRESHED', DIETITIAN_ID, DIETITIAN_ID, false),
    'resolve_access',
  );
});

test('recipe category filter: all returns every recipe', () => {
  const recipes = [
    { id: 'r1', name: 'Avokadolu Yumurta Tabağı', mealType: 'breakfast', calories: 350, macros: { protein: 18, carbs: 12, fat: 20 } },
    { id: 'r2', name: 'Yoğurtlu Meyve ve Granola Kasesi', mealType: 'snack', calories: 220, macros: { protein: 8, carbs: 35, fat: 6 } },
    { id: 'r3', name: 'Fıstık Ezmeli Elma Dilimleri', mealType: 'snack', calories: 180, macros: { protein: 5, carbs: 22, fat: 8 } },
    { id: 'r4', name: 'Izgara Tavuklu Sebze ve Bulgur Tabağı', mealType: 'dinner', calories: 520, macros: { protein: 35, carbs: 45, fat: 14 } },
  ];
  const result = filterRecipes.filterRecipesByCategoryAndSearch(recipes, 'all', '');
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((r) => r.id), ['r1', 'r2', 'r3', 'r4']);
});

test('recipe category filter: each category returns only matching mealType', () => {
  const recipes = [
    { id: 'r1', name: 'Avokadolu Yumurta Tabağı', mealType: 'breakfast', calories: 350, macros: { protein: 18, carbs: 12, fat: 20 } },
    { id: 'r2', name: 'Yoğurtlu Meyve ve Granola Kasesi', mealType: 'snack', calories: 220, macros: { protein: 8, carbs: 35, fat: 6 } },
    { id: 'r3', name: 'Fıstık Ezmeli Elma Dilimleri', mealType: 'snack', calories: 180, macros: { protein: 5, carbs: 22, fat: 8 } },
    { id: 'r4', name: 'Izgara Tavuklu Sebze ve Bulgur Tabağı', mealType: 'dinner', calories: 520, macros: { protein: 35, carbs: 45, fat: 14 } },
  ];

  const breakfast = filterRecipes.filterRecipesByCategoryAndSearch(recipes, 'breakfast', '');
  assert.equal(breakfast.length, 1);
  assert.equal(breakfast[0].id, 'r1');

  const snack = filterRecipes.filterRecipesByCategoryAndSearch(recipes, 'snack', '');
  assert.equal(snack.length, 2);
  assert.deepEqual(snack.map((r) => r.id), ['r2', 'r3']);

  const dinner = filterRecipes.filterRecipesByCategoryAndSearch(recipes, 'dinner', '');
  assert.equal(dinner.length, 1);
  assert.equal(dinner[0].id, 'r4');

  const lunch = filterRecipes.filterRecipesByCategoryAndSearch(recipes, 'lunch', '');
  assert.equal(lunch.length, 0);
});

test('recipe category filter: combines with search without changing recipes', () => {
  const recipes = [
    { id: 'r1', name: 'Avokadolu Yumurta Tabağı', mealType: 'breakfast', calories: 350, macros: { protein: 18, carbs: 12, fat: 20 } },
    { id: 'r2', name: 'Yoğurtlu Meyve ve Granola Kasesi', mealType: 'snack', calories: 220, macros: { protein: 8, carbs: 35, fat: 6 } },
    { id: 'r3', name: 'Fıstık Ezmeli Elma Dilimleri', mealType: 'snack', calories: 180, macros: { protein: 5, carbs: 22, fat: 8 } },
    { id: 'r4', name: 'Izgara Tavuklu Sebze ve Bulgur Tabağı', mealType: 'dinner', calories: 520, macros: { protein: 35, carbs: 45, fat: 14 } },
  ];
  const result = filterRecipes.filterRecipesByCategoryAndSearch(recipes, 'snack', 'elma');
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'r3');
  assert.equal(result[0].mealType, 'snack');
});

test('recipe category filter: counts recipes per category', () => {
  const recipes = [
    { id: 'r1', name: 'Avokadolu Yumurta Tabağı', mealType: 'breakfast', calories: 350, macros: { protein: 18, carbs: 12, fat: 20 } },
    { id: 'r2', name: 'Yoğurtlu Meyve ve Granola Kasesi', mealType: 'snack', calories: 220, macros: { protein: 8, carbs: 35, fat: 6 } },
    { id: 'r3', name: 'Fıstık Ezmeli Elma Dilimleri', mealType: 'snack', calories: 180, macros: { protein: 5, carbs: 22, fat: 8 } },
    { id: 'r4', name: 'Izgara Tavuklu Sebze ve Bulgur Tabağı', mealType: 'dinner', calories: 520, macros: { protein: 35, carbs: 45, fat: 14 } },
  ];
  const counts = filterRecipes.countRecipesByCategory(recipes);
  assert.deepEqual(counts, { breakfast: 1, lunch: 0, dinner: 1, snack: 2 });
});

test('recipe category filter: labels are stable', () => {
  assert.equal(filterRecipes.getRecipeCategoryLabel('breakfast'), 'Kahvaltı');
  assert.equal(filterRecipes.getRecipeCategoryLabel('lunch'), 'Öğle');
  assert.equal(filterRecipes.getRecipeCategoryLabel('dinner'), 'Akşam');
  assert.equal(filterRecipes.getRecipeCategoryLabel('snack'), 'Ara Öğün');
});
