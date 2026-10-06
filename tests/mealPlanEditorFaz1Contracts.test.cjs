'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:meal-plan`.');

const payload = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanPayload.js'));
const insights = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanInsights.js'));
const planService = require(path.join(buildDir, 'features/meal-plans/services/mealPlanService.js'));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const WEEK_DATES = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
const content = (overrides = {}) => ({
  id: 'c', name: 'Yulaflı kefir', image: null, calories: 300, description: null,
  macros: { protein: 10, carbs: 30, fat: 8 }, source: 'manual', recipeId: null, ...overrides,
});

test('custom row names persist as slot_label; plain type names stay null', () => {
  assert.equal(payload.resolveMealSlotLabel('Kahvaltı', 'breakfast'), null);
  assert.equal(payload.resolveMealSlotLabel('  ara öğün ', 'snack'), null);
  assert.equal(payload.resolveMealSlotLabel('Antrenman Öncesi', 'snack'), 'Antrenman Öncesi');
  assert.equal(payload.resolveMealSlotLabel('Öğle Yemeği', 'lunch'), 'Öğle Yemeği');
  assert.equal(payload.resolveMealSlotLabel('x'.repeat(60), 'snack').length, 40);
  const rows = [{ id: 'r1', name: 'Kahvaltı', time: '08:00' }, { id: 'r2', name: 'Antrenman Öncesi', time: '17:00' }];
  const days = payload.buildWeeklyMealPlanPayload({
    days: DAYS, weekDates: WEEK_DATES, meals: rows,
    weeklyPlan: { Pazartesi: { r1: content(), r2: content({ id: 'd', name: 'Muz' }) } },
    mapMealTypeToDb: planService.mapMealTypeToDb,
    normalizeMealTime: planService.normalizeMealTime,
    normalizeCanonicalMealMacros: planService.normalizeCanonicalMealMacros,
  });
  assert.deepEqual(days[0].meals.map((meal) => [meal.type, meal.slot_label, meal.sort_order]), [['breakfast', null, 0], ['snack', 'Antrenman Öncesi', 1]]);
  assert.equal(planService.isValidMealSlotLabel('Antrenman Öncesi'), true);
  assert.equal(planService.isValidMealSlotLabel(' boşluklu '), false);
  assert.equal(planService.isValidMealSlotLabel(''), false);
  assert.equal(planService.isValidMealSlotLabel(null), true);
});

test('daily kcal totals never estimate missing calories and compare with the real target band', () => {
  const plan = {
    Pazartesi: { r1: content({ calories: 400 }), r2: content({ calories: 900 }) },
    Salı: { r1: content({ calories: 0 }), r2: content({ calories: 500 }) },
  };
  const target = { minKcal: 1400, maxKcal: 1800 };
  const totals = insights.summarizeDailyCalories(DAYS, ['r1', 'r2'], plan, target);
  assert.deepEqual(totals[0], { day: 'Pazartesi', calories: 1300, mealCount: 2, missingCalories: 0, status: 'below' });
  assert.deepEqual(totals[1], { day: 'Salı', calories: 500, mealCount: 2, missingCalories: 1, status: 'below' });
  assert.equal(totals[2].status, 'none');
  const within = insights.summarizeDailyCalories(['Pazartesi'], ['r1', 'r2'], { Pazartesi: { r1: content({ calories: 1500 }) } }, target);
  assert.equal(within[0].status, 'within');
  const above = insights.summarizeDailyCalories(['Pazartesi'], ['r1'], { Pazartesi: { r1: content({ calories: 2500 }) } }, { minKcal: null, maxKcal: 2000 });
  assert.equal(above[0].status, 'above');
  // Without a target there is no judgement, only the total.
  assert.equal(insights.summarizeDailyCalories(['Pazartesi'], ['r1'], { Pazartesi: { r1: content() } }, null)[0].status, 'none');
});

test('dietary conflicts match the client\'s own entries in the meal text', () => {
  const result = insights.findDietaryConflicts('Yoğurtlu SÜT kasesi ve ceviz', ['Süt', 'Gluten', 'Ay'], ['Ceviz', 'Brokoli']);
  assert.deepEqual(result, { intolerances: ['Süt'], dislikes: ['Ceviz'] });
  assert.deepEqual(insights.findDietaryConflicts('', ['Süt'], []), { intolerances: [], dislikes: [] });
});

test('editor has no hardcoded meal rows and reads the client from the URL', () => {
  const page = read('pages/MealPlans.tsx');
  assert.doesNotMatch(page, /DEFAULT_MEAL_ROWS/);
  assert.match(page, /useState<MealRow\[\]>\(\[\]\)/);
  assert.match(page, /new URLSearchParams\(location\.search\)\.get\('clientId'\)/);
  assert.match(page, /createPreviousWeekCopy\(previousPlans, previousWeekStart\)\.meals/);
  assert.match(page, /öğünler kopyalanmadı/);
  assert.match(page, /summarizeDailyCalories\(/);
  assert.match(page, /findDietaryConflicts\(/);
  assert.match(page, /storedSlotLabel \|\| rowNamesByPlacement/);
  assert.match(read('features/meal-plans/services/mealPlanService.ts'), /recipe_id,\s*slot_label/);
});
