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
 *  8. Legacy source='recipe' + recipe_id=null read is accepted and normalized to manual
 *  9. Write payload source stays manual-only
 * 10. Date selection maps to the correct Monday week start
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) {
  throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test`.');
}

const photoService = require(path.join(buildDir, 'features/meal-plans/services/mealPhotoService.js'));
const planService = require(path.join(buildDir, 'features/meal-plans/services/mealPlanService.js'));
const readModel = require(path.join(buildDir, 'features/meal-plans/services/mealPlanReadModel.js'));
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

const buildSaveDays = (mealOverrides = {}) => WEEK_DATES.map((date, index) => ({
  plan_date: date,
  notes: null,
  meals: index === 0 ? [{
    type: 'breakfast',
    title: 'Yumurta',
    calories: 200,
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

test('3+8: legacy Unsplash URL and source=recipe row is normalized on fetch', async () => {
  stubFetchRows(buildFetchRows());
  const rows = await planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END);
  const meal = rows[0].meals[0];
  assert.equal(meal.photo_url, LEGACY_PHOTO_URL);
  assert.equal(meal.source, 'manual');
  assert.equal(meal.recipe_id, null);
  assert.equal(meal.time, '08:00');
});

test('8: legacy source=recipe + recipe_id=null is normalized to manual in the RPC response', async () => {
  stubRpcResponse(buildRpcWeek({ source: 'recipe', recipe_id: null }));
  const result = await planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ photo_url: null }));
  const meal = result.plans[0].meals[0];
  assert.equal(meal.source, 'manual');
  assert.equal(meal.recipe_id, null);
});

test('4: legacy Unsplash URL is rejected from the write payload', async () => {
  stubRpcResponse(buildRpcWeek());
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ photo_url: LEGACY_PHOTO_URL })),
    (error) => error && error.code === 'INVALID_MEAL_PHOTO_PATH' && error.field === 'days[0].meals[0].photo_url',
  );
});

test('9: write payload rejects source=recipe and non-null recipe_id', async () => {
  stubRpcResponse(buildRpcWeek());
  await assert.rejects(
    planService.saveWeeklyMealPlan(CLIENT_ID, WEEK_START, buildSaveDays({ source: 'recipe', recipe_id: null, photo_url: null })),
    (error) => error && error.code === 'RECIPE_SOURCE_NOT_SUPPORTED',
  );
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

test('read rejects recipe rows that carry a real recipe_id (fail-closed)', async () => {
  stubFetchRows(buildFetchRows({ recipe_id: RECIPE_ID }));
  await assert.rejects(
    planService.fetchWeeklyMealPlan(CLIENT_ID, DIETITIAN_ID, WEEK_START, WEEK_END),
    (error) => error && error.code === 'INVALID_RPC_RESPONSE',
  );
  stubRpcResponse(buildRpcWeek({ source: 'recipe', recipe_id: RECIPE_ID }));
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
